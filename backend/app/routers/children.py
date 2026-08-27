import asyncio
import logging
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any, Literal

import boto3
import botocore.exceptions
from fastapi import APIRouter, Body, Depends, HTTPException, Path, Query, Request
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel, Field
from pymongo import ASCENDING, DESCENDING

from app import models
from app.deps import CurrentParent, Db, SettingsDep, get_current_parent
from app.limiter import user_limiter
from app.schemas.children import (
    ChildCreate,
    ChildPatch,
    ChildResponse,
)
from app.services.journey_progress import has_completed_growth_area

# Fields returned by the child-card list view. Heavy sub-documents
# (personality scores/traits, full recommendations blob) are excluded and
# fetched in full by GET /children/{child_id} when a specific child loads.
# current_phase is intentionally excluded from the list view.
#
# gender/avatar_id/avatar_url are small scalars, not heavy sub-documents, but
# must stay in this projection: the frontend's Onboarding page also calls this
# endpoint (sorted, limit=1) to auto-resume the most recently created child
# when no child id is in the URL, and reuses the same prefill path as
# GET /children/{child_id}. Dropping them here silently blanks out the saved
# gender and avatar/photo on that resume path while name/age/school still
# prefill correctly, since only those are covered by this projection.
_LIST_PROJECTION = {
    "name": 1,
    "age": 1,
    "gender": 1,
    "school": 1,
    "avatar_id": 1,
    "avatar_url": 1,
    "onboarding_completed": 1,
    "recommendations.pathway_overview": 1,
    "personality.view_model.profile.name": 1,
    "created_at": 1,
}

# Every route needs an authenticated parent whose id/location scope the query —
# declared at the router level as a safety net, and again per-function since
# the handlers need the returned user document (FastAPI caches the dependency
# result per request, so it only runs once).
router = APIRouter(tags=["children"], dependencies=[Depends(get_current_parent)])
log = logging.getLogger(__name__)

# Fields that the server assigns — must never be accepted from client input.
# Stripping these before the **data spread ensures user-supplied values cannot
# overwrite server-controlled fields (especially `location`, which is the shard
# key and the foundation of all owner-scoped queries).
_CHILD_SYSTEM_FIELDS = {
    "id",
    "created_date",  # API aliases
    "_id",
    "user_id",
    "location",  # DB identity / shard key
    "created_at",
    "updated_at",  # server-managed timestamps
    "is_deleted",
    "deleted_at",  # soft-delete — only writable via DELETE /children/{id}
    # Personality Journey progression flags — never settable via this generic
    # PATCH. grow_completed is derived live (see app/services/journey_progress.py)
    # rather than stored at all. conversational_onboarding_completed is set as
    # a side effect inside update_child below, not from client input directly.
    # The rest have no independent data footprint to derive from, so they're
    # only writable one-way (false→true) through POST /children/{id}/progress/{flag}.
    "onboarding_profile_completed",
    "conversational_onboarding_completed",
    "discover_completed",
    "grow_completed",
    "transform_visited",
    "release_visited",
    "connect_visited",
}

# Child fields the Life Pathway milestone cache is generated against. A change to
# any of them invalidates every cached area — the milestones live on the child's
# growth_areas documents (CompletedGrowthArea.life_pathway_milestones), so
# invalidating means clearing that field across them, not touching this document.
#
# The generated copy bakes these values in as literal text that cannot be
# re-resolved after the fact:
#
#   age    — milestones are keyed by offset slot (y1…y10) relative to the age at
#            generation time, so a birthday re-points every slot at a different
#            year: copy written for "age 11" would render under the "age 12" node.
#   gender — the model is asked to write he/she/they literally, so cached copy
#            keeps the old pronoun while the page's own templated copy switches
#            voice around it, leaving both voices on screen at once.
#
# Compared by raw stored value rather than by resolved pronoun voice: mapping
# gender to a voice here would duplicate copyTokensFor() from
# frontend/src/lib/growthAreaData.ts, and if the two ever drifted the failure would
# be a *missed* invalidation — stale pronouns, the bug this exists to prevent.
# Comparing raw values can only ever over-invalidate (e.g. "Other" → ""), which
# costs a regeneration rather than showing wrong copy.
_LIFE_PATHWAY_INPUTS = ("age", "gender")


# ---------------------------------------------------------------------------
# Document → API helpers
# ---------------------------------------------------------------------------


def _child_to_api(doc: dict) -> dict:
    out = {
        k: v
        for k, v in doc.items()
        if k not in ("_id", "user_id", "location", "created_at", "updated_at")
    }
    out["id"] = doc["_id"]
    out["created_date"] = doc["created_at"].isoformat() if doc.get("created_at") else ""
    return out


async def _child_to_api_with_progress(
    doc: dict, db: AsyncIOMotorDatabase, user: dict
) -> dict:
    """_child_to_api, plus grow_completed recomputed live from the growth_areas
    collection — never trusted from the stored document. See
    app/services/journey_progress.py for why."""
    out = _child_to_api(doc)
    out["grow_completed"] = await has_completed_growth_area(
        db, user["_id"], doc["_id"], user["location"]
    )
    return out


# ---------------------------------------------------------------------------
# Children
# ---------------------------------------------------------------------------


@router.get(
    "/children",
    response_model=list[ChildResponse],
    description="List all children linked to the authenticated user's account.",
)
@user_limiter.limit("60/minute")
async def list_children(
    request: Request,
    user: CurrentParent,
    db: Db,
    sort: Literal["created_date", "-created_date", "name", "-name"] | None = Query(
        default="-created_date"
    ),
    limit: int = Query(default=50, ge=1, le=200),
):
    _sort = sort or "-created_date"
    if _sort in ("name", "-name"):
        sort_spec = [("name", ASCENDING if _sort == "name" else DESCENDING)]
    else:
        sort_spec = [("created_at", DESCENDING if _sort.startswith("-") else ASCENDING)]

    docs = await (
        db[models.CHILDREN]
        .find(
            {"user_id": user["_id"], "location": user["location"], "is_deleted": False},
            _LIST_PROJECTION,
        )
        .sort(sort_spec)
        .to_list(limit)
    )
    return [_child_to_api(d) for d in docs]


@router.post(
    "/children",
    response_model=ChildResponse,
    status_code=201,
    description="Add a new child profile to the authenticated user's account (maximum 10).",
)
@user_limiter.limit("20/minute")
async def create_child(
    request: Request,
    payload: ChildCreate,
    user: CurrentParent,
    db: Db,
):
    count = await db[models.CHILDREN].count_documents(
        {"user_id": user["_id"], "location": user["location"], "is_deleted": False}
    )
    if count >= 10:
        raise HTTPException(status_code=422, detail="Maximum of 10 children allowed per account")

    now = datetime.now(UTC)
    data = payload.model_dump(exclude_none=True)
    for f in _CHILD_SYSTEM_FIELDS:
        data.pop(f, None)
    # Always initialise visited_tabs so the field exists in every document.
    data.setdefault("visited_tabs", [])

    child_id = str(uuid.uuid4())
    doc = {
        "_id": child_id,
        "user_id": user["_id"],
        "location": user["location"],
        "is_deleted": False,
        "deleted_at": None,
        "created_at": now,
        "updated_at": now,
        **data,
    }
    await db[models.CHILDREN].insert_one(doc)
    return _child_to_api(doc)


@router.get(
    "/children/{child_id}",
    response_model=ChildResponse,
    description="Retrieve a single child profile by ID.",
)
@user_limiter.limit("60/minute")
async def get_child(
    request: Request,
    user: CurrentParent,
    db: Db,
    child_id: str = Path(..., min_length=1, max_length=100),
):
    doc = await db[models.CHILDREN].find_one(
        {"_id": child_id, "user_id": user["_id"], "location": user["location"], "is_deleted": False}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Child not found")
    return await _child_to_api_with_progress(doc, db, user)


@router.patch(
    "/children/{child_id}",
    response_model=ChildResponse,
    description="Update details of an existing child profile.",
)
@user_limiter.limit("30/minute")
async def update_child(
    request: Request,
    user: CurrentParent,
    db: Db,
    child_id: str = Path(..., min_length=1, max_length=100),
    patch: ChildPatch = Body(...),
):
    updates = patch.model_dump(exclude_unset=True)
    set_fields: dict = {"updated_at": datetime.now(UTC)}
    # visited_tabs uses $addToSet so concurrent patches from different sessions
    # or devices never overwrite each other — each patch only adds new entries.
    add_to_set_tabs: list[str] | None = None
    for k, v in updates.items():
        if k in _CHILD_SYSTEM_FIELDS:
            continue
        if k == "name" and v is None:
            continue  # name is required — ignore null patch
        if k == "visited_tabs":
            if isinstance(v, list):
                add_to_set_tabs = v
            # None means "no change" — skip rather than nullifying the field.
        else:
            set_fields[k] = v

    # When the client commits the final personality, clear the staging field via
    # $unset to avoid keeping ~2 KB of duplicate LLM output permanently on the
    # document. Remove it from $set first — MongoDB raises ConflictingUpdateOperators
    # (code 40) if the same path appears in both $set and $unset.
    clear_pending_vm = "personality" in set_fields
    if clear_pending_vm:
        set_fields.pop("pending_personality_vm", None)

    unset_fields: dict[str, str] = {}
    if clear_pending_vm:
        unset_fields["pending_personality_vm"] = ""

    owner_filter = {
        "_id": child_id,
        "user_id": user["_id"],
        "location": user["location"],
        "is_deleted": False,
    }

    # Auto-derive conversational_onboarding_completed as a side effect of the
    # client legitimately committing onboarding_completed=true — this is the
    # one shared backend path both ConversationalOnboarding.tsx and
    # PersonalityJourney.tsx's finalize-personality logic funnel through, so
    # hooking it here covers every current and future call site without each
    # one needing to remember a second API call (see the comment on
    # ChildResponse in app/schemas/children.py for the full chain).
    # Requires onboarding_profile_completed to already be true; if it isn't,
    # this patch still succeeds (onboarding_completed itself is not blocked)
    # but the marker is simply left unset.
    if set_fields.get("onboarding_completed"):
        prev_profile = await db[models.CHILDREN].find_one(
            owner_filter, {"onboarding_profile_completed": 1}
        )
        if prev_profile and prev_profile.get("onboarding_profile_completed"):
            set_fields["conversational_onboarding_completed"] = True

    # Drop the Life Pathway cache when any input it was generated against changes,
    # so it regenerates lazily against the new values (see _LIFE_PATHWAY_INPUTS).
    # Keyed off a real change rather than mere presence in the patch: callers
    # re-send the whole fetched record with these fields unchanged (see
    # useOnboardingComplete), which must not invalidate anything. One read covers
    # every input, on the primary-key index.
    #
    # The cache lives on this child's growth_areas documents, so this is a
    # cross-collection clear rather than an $unset on the document being patched.
    # It runs after the child write below, not here: invalidating first and then
    # failing to apply the change would throw away good copy for nothing.
    invalidate_pathway = False
    touched_inputs = [f for f in _LIFE_PATHWAY_INPUTS if f in set_fields]
    if touched_inputs:
        prev = await db[models.CHILDREN].find_one(
            owner_filter, dict.fromkeys(_LIFE_PATHWAY_INPUTS, 1)
        )
        invalidate_pathway = prev is not None and any(
            prev.get(f) != set_fields[f] for f in touched_inputs
        )

    update_op: dict = {"$set": set_fields}
    if add_to_set_tabs:
        update_op["$addToSet"] = {"visited_tabs": {"$each": add_to_set_tabs}}
    if unset_fields:
        update_op["$unset"] = unset_fields

    doc = await db[models.CHILDREN].find_one_and_update(
        owner_filter,
        update_op,
        return_document=True,
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Child not found")

    if invalidate_pathway:
        # Every area at once: the inputs are child-level, so no area's cached copy
        # survives a change to them. Areas with nothing cached simply match nothing
        # to unset. Failure here is non-fatal — the patch itself has landed, and the
        # cost is stale milestone copy rather than a lost edit, so it is logged and
        # left rather than 500ing a successful profile update.
        try:
            await db[models.GROWTH_AREAS].update_many(
                {
                    "user_id": user["_id"],
                    "child_id": child_id,
                    "location": user["location"],
                },
                {"$unset": {"life_pathway_milestones": ""}},
            )
        except Exception:
            log.exception("life pathway cache invalidation failed child_id=%s", child_id)

    return await _child_to_api_with_progress(doc, db, user)


async def _always_true(child: dict, db: AsyncIOMotorDatabase, user: dict, child_id: str) -> bool:
    return True


async def _requires_conversational_onboarding(
    child: dict, db: AsyncIOMotorDatabase, user: dict, child_id: str
) -> bool:
    return bool(child.get("conversational_onboarding_completed"))


async def _requires_grow_completed(
    child: dict, db: AsyncIOMotorDatabase, user: dict, child_id: str
) -> bool:
    return await has_completed_growth_area(db, user["_id"], child_id, user["location"])


async def _requires_transform_visited(
    child: dict, db: AsyncIOMotorDatabase, user: dict, child_id: str
) -> bool:
    return bool(child.get("transform_visited"))


async def _requires_release_visited(
    child: dict, db: AsyncIOMotorDatabase, user: dict, child_id: str
) -> bool:
    return bool(child.get("release_visited"))


# Ordered Personality Journey progression chain — one entry per flag settable
# through POST /children/{id}/progress/{flag}, mapped to the async check that
# must pass before it can flip to true, and the 403 detail on failure.
# Centralised here rather than duplicated per call site: the whole chain
# reads top-to-bottom in one place instead of scattered ad hoc conditions.
# grow_completed and conversational_onboarding_completed aren't in this dict
# because neither is settable through this endpoint at all — see the
# ChildResponse comment in app/schemas/children.py for why.
_PROGRESS_PRECONDITIONS: dict[str, tuple[Callable[..., Awaitable[bool]], str]] = {
    "onboarding_profile_completed": (_always_true, ""),
    "discover_completed": (
        _requires_conversational_onboarding,
        "Complete onboarding before Discover.",
    ),
    "transform_visited": (
        _requires_grow_completed,
        "Complete a growth area before visiting Transform.",
    ),
    "release_visited": (_requires_transform_visited, "Visit Transform before Release."),
    "connect_visited": (_requires_release_visited, "Visit Release before Connect."),
}


@router.post(
    "/children/{child_id}/progress/{flag}",
    response_model=ChildResponse,
    description=(
        "Mark a Personality Journey progression flag as done. One-way "
        "(false→true), one flag per call, gated on the previous step in the "
        "chain already being true — this is the only way to set these flags; "
        "PATCH /children/{child_id} silently ignores them."
    ),
)
@user_limiter.limit("30/minute")
async def mark_journey_progress(
    request: Request,
    user: CurrentParent,
    db: Db,
    child_id: str = Path(..., min_length=1, max_length=100),
    flag: Literal[
        "onboarding_profile_completed",
        "discover_completed",
        "transform_visited",
        "release_visited",
        "connect_visited",
    ] = Path(...),
):
    owner_filter = {
        "_id": child_id,
        "user_id": user["_id"],
        "location": user["location"],
        "is_deleted": False,
    }
    child = await db[models.CHILDREN].find_one(owner_filter)
    if not child:
        raise HTTPException(status_code=404, detail="Child not found")

    check, message = _PROGRESS_PRECONDITIONS[flag]
    if not await check(child, db, user, child_id):
        raise HTTPException(status_code=403, detail=message)

    doc = await db[models.CHILDREN].find_one_and_update(
        owner_filter,
        {"$set": {flag: True, "updated_at": datetime.now(UTC)}},
        return_document=True,
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Child not found")
    return await _child_to_api_with_progress(doc, db, user)


@router.delete(
    "/children/{child_id}",
    status_code=204,
    description=(
        "Soft-delete a child profile. The profile is hidden immediately but retained "
        "for 30 days so accidental deletions can be recovered. Associated data "
        "(goals, growth areas, etc.) is preserved during the retention window and "
        "purged by a scheduled hard-delete job after expiry."
    ),
)
@user_limiter.limit("10/minute")
async def delete_child(
    request: Request,
    user: CurrentParent,
    db: Db,
    child_id: str = Path(..., min_length=1, max_length=100),
):
    now = datetime.now(UTC)
    result = await db[models.CHILDREN].update_one(
        {
            "_id": child_id,
            "user_id": user["_id"],
            "location": user["location"],
            "is_deleted": False,
        },
        {"$set": {"is_deleted": True, "deleted_at": now, "updated_at": now}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Child not found")


# ---------------------------------------------------------------------------
# Avatar presign
# ---------------------------------------------------------------------------

_ALLOWED_CONTENT_TYPES: dict[str, str] = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
}

# Lazily initialised on first presign request (region not available at import time).
# Reused across requests to avoid creating a new connection pool per call.
_s3_client: Any | None = None


def _get_s3_client(region: str) -> Any:
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client("s3", region_name=region)
    return _s3_client


class AvatarPresignRequest(BaseModel):
    content_type: str = Field(max_length=100)


class AvatarPresignResponse(BaseModel):
    upload_url: str
    avatar_url: str


@router.post(
    "/children/{child_id}/avatar/presign",
    response_model=AvatarPresignResponse,
    description=(
        "Generate a presigned S3 PUT URL for uploading a child avatar photo. "
        "The client uploads directly to S3 using this URL, then PATCHes the child "
        "with the returned avatar_url."
    ),
)
@user_limiter.limit("20/minute")
async def presign_child_avatar(
    request: Request,
    user: CurrentParent,
    db: Db,
    settings: SettingsDep,
    child_id: str = Path(..., min_length=1, max_length=100),
    payload: AvatarPresignRequest = Body(...),
):
    if not settings.uploads_bucket_name or not settings.aws_region:
        raise HTTPException(
            status_code=503,
            detail="File upload is not configured on this server (UPLOADS_BUCKET_NAME / AWS_REGION not set).",
        )

    if payload.content_type not in _ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported image type. Allowed: {', '.join(sorted(_ALLOWED_CONTENT_TYPES))}",
        )

    doc = await db[models.CHILDREN].find_one(
        {"_id": child_id, "user_id": user["_id"], "location": user["location"], "is_deleted": False}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Child not found")

    ext = _ALLOWED_CONTENT_TYPES[payload.content_type]
    bucket = settings.uploads_bucket_name
    region = settings.aws_region
    key = f"uploads/{child_id}/{uuid.uuid4()}.{ext}"

    try:
        s3 = _get_s3_client(region)
        loop = asyncio.get_running_loop()
        upload_url: str = await loop.run_in_executor(
            None,
            lambda: s3.generate_presigned_url(
                "put_object",
                Params={"Bucket": bucket, "Key": key, "ContentType": payload.content_type},
                ExpiresIn=300,
            ),
        )
    except (botocore.exceptions.BotoCoreError, botocore.exceptions.ClientError) as exc:
        log.warning("avatar.presign.s3_error child=%s: %s", child_id, exc)
        raise HTTPException(
            status_code=502, detail="Failed to generate upload URL. Please try again."
        ) from exc

    cdn = settings.uploads_cdn_domain
    avatar_url = (
        f"https://{cdn}/{key}" if cdn else f"https://{bucket}.s3.{region}.amazonaws.com/{key}"
    )
    return AvatarPresignResponse(upload_url=upload_url, avatar_url=avatar_url)
