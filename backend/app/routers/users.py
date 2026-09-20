import asyncio
import logging
import uuid
from datetime import UTC, datetime

import botocore.exceptions
from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from motor.motor_asyncio import AsyncIOMotorDatabase

from app import models
from app.deps import CurrentParent, CurrentUser, Db, SettingsDep
from app.limiter import rate_limit
from app.schemas.growth_areas import (
    AppendGrowthAreaRequest,
    ChildActivity,
    CompletedGrowthArea,
    CompletedGrowthAreasResponse,
)
from app.schemas.ninety_day_plan import (
    NinetyDayPlanPatch,
    NinetyDayPlanPhotoPresignRequest,
    NinetyDayPlanPhotoPresignResponse,
    NinetyDayPlanResponse,
)
from app.schemas.observations import ObservationsPatch, ObservationsResponse
from app.schemas.preferences import UserPreferences, UserPreferencesPatch
from app.services.s3_uploads import (
    ALLOWED_IMAGE_CONTENT_TYPES,
    build_public_url,
    build_upload_key,
    get_s3_client,
)

router = APIRouter(tags=["users"])
log = logging.getLogger(__name__)

# Hard cap on growth-area documents returned in a single response.
# Exceeding this is extremely unlikely in practice but logged so it's visible.
_GROWTH_AREAS_MAX = 500

# Optional fields in AppendGrowthAreaRequest that must only be written when
# explicitly set by the caller — prevents silently null-overwriting existing data.
_GROWTH_AREA_OPTIONAL_FIELDS = (
    "recommendations",
    "status",
    "step",
    "selected_activity",
    "parent_liked",
    "want_child_activity",
    "feedback",
    "interactive_step",
    "interactive_answers",
    "interactive_draft",
    "generated_activity",
    "show_game",
    "child_activity_selections",
    "ai_three_month_recommendations",
)


async def _require_child(db: AsyncIOMotorDatabase, child_id: str, user: dict) -> dict:
    """Raise 404 if child_id does not belong to the authenticated user; return the child doc."""
    child = await db[models.CHILDREN].find_one(
        {"_id": child_id, "user_id": user["_id"], "location": user["location"], "is_deleted": False}
    )
    if not child:
        raise HTTPException(status_code=404, detail="Child not found")
    return child


# ---------------------------------------------------------------------------
# Document → schema helpers
# ---------------------------------------------------------------------------


def _doc_to_preferences(user: dict) -> UserPreferences:
    prefs = user.get("preferences") or {}
    return UserPreferences(
        tts_enabled=prefs.get("tts_enabled", True),
        dark_mode=prefs.get("dark_mode", True),
        last_visited_path=prefs.get("last_visited_path"),
    )


def _doc_to_growth_area(doc: dict) -> CompletedGrowthArea:
    ca_data = doc.get("child_activity")
    child_activity = ChildActivity.model_validate(ca_data) if ca_data else None
    return CompletedGrowthArea(
        area_id=doc["area_id"],
        area_name=doc["area_name"],
        area_color=doc.get("area_color"),
        answers=doc.get("answers") or {},
        recommendations=doc.get("recommendations"),
        child_activity=child_activity,
        status=doc.get("status"),
        step=doc.get("step"),
        selected_activity=doc.get("selected_activity"),
        parent_liked=doc.get("parent_liked"),
        want_child_activity=doc.get("want_child_activity"),
        feedback=doc.get("feedback"),
        interactive_step=doc.get("interactive_step"),
        interactive_answers=doc.get("interactive_answers"),
        interactive_draft=doc.get("interactive_draft"),
        generated_activity=doc.get("generated_activity"),
        show_game=doc.get("show_game"),
        child_activity_selections=doc.get("child_activity_selections"),
        ai_three_month_recommendations=doc.get("ai_three_month_recommendations"),
        pending_recommendations=doc.get("pending_recommendations"),
        pending_child_activity=doc.get("pending_child_activity"),
        parent_questions=doc.get("parent_questions"),
        child_rounds=doc.get("child_rounds"),
        life_pathway_milestones=doc.get("life_pathway_milestones"),
    )


# ---------------------------------------------------------------------------
# Preferences
# ---------------------------------------------------------------------------


@router.get(
    "/user/preferences",
    response_model=UserPreferences,
    description="Retrieve the authenticated user's app preferences.",
    dependencies=[Depends(rate_limit("60/minute"))],
)
async def get_preferences(
    request: Request,
    user: CurrentUser,
    db: Db,
):
    return _doc_to_preferences(user)


@router.patch(
    "/user/preferences",
    response_model=UserPreferences,
    description="Update one or more of the authenticated user's app preferences.",
    dependencies=[Depends(rate_limit("30/minute"))],
)
async def patch_preferences(
    request: Request,
    body: UserPreferencesPatch,
    user: CurrentUser,
    db: Db,
):
    set_fields: dict = {"updated_at": datetime.now(UTC)}
    if "tts_enabled" in body.model_fields_set:
        set_fields["preferences.tts_enabled"] = body.tts_enabled
    if "dark_mode" in body.model_fields_set:
        set_fields["preferences.dark_mode"] = body.dark_mode
    if "last_visited_path" in body.model_fields_set:
        set_fields["preferences.last_visited_path"] = body.last_visited_path

    updated = await db[models.USERS].find_one_and_update(
        {"_id": user["_id"], "location": user["location"]},
        {"$set": set_fields},
        return_document=True,
    )
    return _doc_to_preferences(updated or user)


# ---------------------------------------------------------------------------
# Completed growth areas
# ---------------------------------------------------------------------------


@router.get(
    "/user/completed-growth-areas",
    response_model=CompletedGrowthAreasResponse,
    description="List completed growth areas for a given child, with pagination. Returns an empty list if the child does not exist (query is scoped by user_id so no data leaks).",
    dependencies=[Depends(rate_limit("60/minute"))],
)
async def list_completed_growth_areas(
    request: Request,
    user: CurrentParent,
    db: Db,
    child_id: str = Query(..., min_length=1, max_length=100),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    # Read-only: query is already scoped by user_id + location so an unknown
    # child_id returns an empty list rather than leaking data. Skip _require_child
    # to save one round-trip on M0's shared-cluster I/O.
    docs = await (
        db[models.GROWTH_AREAS]
        .find({"user_id": user["_id"], "child_id": child_id, "location": user["location"]})
        .sort("created_at", 1)
        .skip(offset)
        .to_list(limit)
    )
    return CompletedGrowthAreasResponse(areas=[_doc_to_growth_area(d) for d in docs])


@router.post(
    "/user/completed-growth-areas",
    status_code=204,
    description="Upsert a growth area document for a given child.",
    dependencies=[Depends(rate_limit("60/minute"))],
)
async def append_completed_growth_area(
    request: Request,
    body: AppendGrowthAreaRequest,
    user: CurrentParent,
    db: Db,
    child_id: str = Query(..., min_length=1, max_length=100),
):
    child = await _require_child(db, child_id, user)
    # Grow only unlocks on the DimensionCircles page once Discover has been
    # completed — enforce the same dependency server-side so it can't be
    # bypassed by writing straight to this endpoint.
    if not child.get("discover_completed"):
        raise HTTPException(
            status_code=403, detail="Complete Discover before starting a growth area."
        )
    now = datetime.now(UTC)
    # Always write the required fields (area_name, answers).
    set_fields: dict = {
        "area_name": body.area_name,
        "answers": body.answers,
        "updated_at": now,
    }
    # Only write optional fields when explicitly included in the request — avoids
    # silently overwriting existing data with null when the caller omits the field.
    for field in _GROWTH_AREA_OPTIONAL_FIELDS:
        if field in body.model_fields_set:
            set_fields[field] = getattr(body, field)
    # child_activity is a nested model — only write when explicitly provided.
    if body.child_activity is not None:
        set_fields["child_activity"] = body.child_activity.model_dump()
    # user_id, child_id, area_id, location are equality conditions in the filter.
    set_on_insert: dict = {"_id": str(uuid.uuid4()), "created_at": now}

    # When the area is finalised, remove all transient wizard and staging fields.
    # These fields must also be removed from set_fields: MongoDB raises a conflict
    # error if the same path appears in both $set and $unset.
    unset_fields: dict = {}
    if body.status == "completed":
        unset_fields = {
            "pending_child_activity": "",
            "pending_recommendations": "",
            "child_activity_selections": "",
            "interactive_step": "",
            "interactive_answers": "",
            "interactive_draft": "",
            "step": "",
        }
        for transient in unset_fields:
            set_fields.pop(transient, None)

    update_doc: dict = {"$set": set_fields, "$setOnInsert": set_on_insert}
    if unset_fields:
        update_doc["$unset"] = unset_fields

    await db[models.GROWTH_AREAS].update_one(
        {
            "user_id": user["_id"],
            "child_id": child_id,
            "area_id": body.area_id,
            "location": user["location"],
        },
        update_doc,
        upsert=True,
    )


@router.delete(
    "/user/completed-growth-areas",
    status_code=204,
    description="Clear all completed growth areas for a given child.",
    dependencies=[Depends(rate_limit("10/minute"))],
)
async def clear_completed_growth_areas(
    request: Request,
    user: CurrentParent,
    db: Db,
    child_id: str = Query(..., min_length=1, max_length=100),
):
    await _require_child(db, child_id, user)
    await db[models.GROWTH_AREAS].delete_many(
        {"user_id": user["_id"], "child_id": child_id, "location": user["location"]}
    )


# ---------------------------------------------------------------------------
# observations — one document per child
# ---------------------------------------------------------------------------


@router.get(
    "/user/observations",
    response_model=ObservationsResponse,
    description="Retrieve the observations document for a given child. Returns an empty document if the child does not exist (query is scoped by user_id so no data leaks).",
    dependencies=[Depends(rate_limit("60/minute"))],
)
async def get_observations(
    request: Request,
    user: CurrentParent,
    db: Db,
    child_id: str = Query(..., min_length=1, max_length=100),
):
    # Read-only: query scoped by user_id + location. Skip _require_child (see list_completed_growth_areas).
    doc = await db[models.OBSERVATIONS].find_one(
        {"_id": child_id, "user_id": user["_id"], "location": user["location"]}
    )
    if not doc:
        return ObservationsResponse()
    # Shape coercion only — ObservationsResponse truncates over-long lists itself,
    # so a document that outgrew the cap cannot 500 this endpoint.
    raw_watching = doc.get("watching", [])
    if not isinstance(raw_watching, list):
        raw_watching = []
    return ObservationsResponse(
        source=doc.get("source"),
        items=doc.get("items", []),
        watching=[w for w in raw_watching if isinstance(w, str)],
        span=doc.get("span"),
        started_at=doc.get("started_at"),
        pending_observations=doc.get("pending_observations"),
    )


@router.patch(
    "/user/observations",
    response_model=ObservationsResponse,
    description="Update the observations document for a given child.",
    dependencies=[Depends(rate_limit("20/minute"))],
)
async def patch_observations(
    request: Request,
    body: ObservationsPatch,
    user: CurrentParent,
    db: Db,
    child_id: str = Query(..., min_length=1, max_length=100),
):
    child = await _require_child(db, child_id, user)
    # Release/Connect only unlock on the DimensionCircles page once Transform has
    # been visited — enforce the same dependency server-side so it can't be
    # bypassed by writing straight to this endpoint.
    if not child.get("transform_visited"):
        raise HTTPException(
            status_code=403, detail="Visit Transform (Life Pathway) before recording Observations."
        )
    now = datetime.now(UTC)
    set_fields: dict = {"updated_at": now}
    unset_fields: dict = {}

    # exclude_unset so a PATCH carrying only `watching` cannot blank the generated
    # set — the old shape stored everything in one field and had to rewrite it whole.
    updates = body.model_dump(exclude_unset=True)
    for key in ("source", "items", "watching", "span", "started_at"):
        if key in updates and updates[key] is not None:
            set_fields[key] = updates[key]

    # Committing items means the staging field has been promoted — clear it.
    if "items" in set_fields:
        unset_fields["pending_observations"] = ""

    update_op: dict = {
        "$set": set_fields,
        "$setOnInsert": {
            "created_at": now,
            "user_id": user["_id"],
            "location": user["location"],
        },
    }
    if unset_fields:
        update_op["$unset"] = unset_fields

    doc = await db[models.OBSERVATIONS].find_one_and_update(
        {"_id": child_id, "user_id": user["_id"], "location": user["location"]},
        update_op,
        upsert=True,
        return_document=True,
    )
    return ObservationsResponse(
        source=doc.get("source") if doc else None,
        items=doc.get("items", []) if doc else [],
        watching=doc.get("watching", []) if doc else [],
        span=doc.get("span") if doc else None,
        started_at=doc.get("started_at") if doc else None,
    )


# ---------------------------------------------------------------------------
# ninety_day_plans — one document per child
# ---------------------------------------------------------------------------

_NINETY_DAY_PLAN_PATCH_FIELDS = (
    "ask",
    "applied",
    "act_inputs",
    "act_counts",
    "feedback",
    "event_name",
    "event_date",
    "event_set",
    "track_done",
    "track_inputs",
    "track_sittings",
    "photos",
)


def _doc_to_ninety_day_plan(doc: dict | None) -> NinetyDayPlanResponse:
    if not doc:
        return NinetyDayPlanResponse()
    return NinetyDayPlanResponse(
        ask=doc.get("ask"),
        plan=doc.get("plan"),
        track_steps=doc.get("track_steps"),
        applied=doc.get("applied", {}),
        act_inputs=doc.get("act_inputs", {}),
        act_counts=doc.get("act_counts", {}),
        feedback=doc.get("feedback", {}),
        event_name=doc.get("event_name"),
        event_date=doc.get("event_date"),
        event_set=doc.get("event_set", False),
        track_done=doc.get("track_done", {}),
        track_inputs=doc.get("track_inputs", {}),
        track_sittings=doc.get("track_sittings", {}),
        photos=doc.get("photos", {}),
    )


@router.get(
    "/user/ninety-day-plan",
    response_model=NinetyDayPlanResponse,
    description="Retrieve the 90-day plan document for a given child. Returns an empty document if the child does not exist (query is scoped by user_id so no data leaks).",
    dependencies=[Depends(rate_limit("60/minute"))],
)
async def get_ninety_day_plan(
    request: Request,
    user: CurrentParent,
    db: Db,
    child_id: str = Query(..., min_length=1, max_length=100),
):
    # Read-only: query scoped by user_id + location. Skip _require_child (see list_completed_growth_areas).
    doc = await db[models.NINETY_DAY_PLANS].find_one(
        {"_id": child_id, "user_id": user["_id"], "location": user["location"]}
    )
    return _doc_to_ninety_day_plan(doc)


@router.patch(
    "/user/ninety-day-plan",
    response_model=NinetyDayPlanResponse,
    description="Update the 90-day plan document for a given child.",
    dependencies=[Depends(rate_limit("60/minute"))],
)
async def patch_ninety_day_plan(
    request: Request,
    body: NinetyDayPlanPatch,
    user: CurrentParent,
    db: Db,
    child_id: str = Query(..., min_length=1, max_length=100),
):
    child = await _require_child(db, child_id, user)
    # This document only exists behind Transform's own "Start the 90 days" flow,
    # so this is trivially satisfied by the time a client can reach this PATCH —
    # kept for the same defense-in-depth reasoning as patch_observations above.
    if not child.get("transform_visited"):
        raise HTTPException(
            status_code=403,
            detail="Visit Transform (Life Pathway) before starting the 90-day plan.",
        )
    now = datetime.now(UTC)
    set_fields: dict = {"updated_at": now}
    unset_fields: dict = {}

    # exclude_unset so a PATCH carrying only one field (e.g. a single toggle)
    # cannot blank the rest of the document.
    updates = body.model_dump(exclude_unset=True)
    for key in _NINETY_DAY_PLAN_PATCH_FIELDS:
        if key in updates and updates[key] is not None:
            set_fields[key] = updates[key]

    # A re-targeted Day-90 event invalidates the tracker generated for the old
    # one — clear it so the client's hasTrackSteps gate sees it as absent and
    # re-enqueues generate_event_tracker for the new target.
    if body.clear_track_steps:
        unset_fields["track_steps"] = ""

    update_op: dict = {
        "$set": set_fields,
        "$setOnInsert": {
            "created_at": now,
            "user_id": user["_id"],
            "location": user["location"],
        },
    }
    if unset_fields:
        update_op["$unset"] = unset_fields

    doc = await db[models.NINETY_DAY_PLANS].find_one_and_update(
        {"_id": child_id, "user_id": user["_id"], "location": user["location"]},
        update_op,
        upsert=True,
        return_document=True,
    )
    return _doc_to_ninety_day_plan(doc)


@router.post(
    "/user/ninety-day-plan/photo-presign",
    response_model=NinetyDayPlanPhotoPresignResponse,
    description=(
        "Generate a presigned S3 PUT URL for uploading an achievement/tracker photo. "
        "The client uploads directly to S3 using this URL, then PATCHes "
        "/user/ninety-day-plan with the returned photo_url recorded against field_key "
        "in the `photos` map."
    ),
    dependencies=[Depends(rate_limit("20/minute"))],
)
async def presign_ninety_day_plan_photo(
    request: Request,
    user: CurrentParent,
    db: Db,
    settings: SettingsDep,
    child_id: str = Query(..., min_length=1, max_length=100),
    payload: NinetyDayPlanPhotoPresignRequest = Body(...),
):
    if not settings.uploads_bucket_name or not settings.aws_region:
        raise HTTPException(
            status_code=503,
            detail="File upload is not configured on this server (UPLOADS_BUCKET_NAME / AWS_REGION not set).",
        )

    if payload.content_type not in ALLOWED_IMAGE_CONTENT_TYPES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported image type. Allowed: {', '.join(sorted(ALLOWED_IMAGE_CONTENT_TYPES))}",
        )

    child = await _require_child(db, child_id, user)
    if not child.get("transform_visited"):
        raise HTTPException(
            status_code=403,
            detail="Visit Transform (Life Pathway) before starting the 90-day plan.",
        )

    ext = ALLOWED_IMAGE_CONTENT_TYPES[payload.content_type]
    bucket = settings.uploads_bucket_name
    region = settings.aws_region
    # Namespaced under ninety-day-plan/{field_key}/ so these can never collide
    # with the avatar's own uploads/{location}/{child_id}/{uuid}.ext keys, and
    # multiple photos can accumulate under the same field (some fields, e.g.
    # the Dashboard's "Sketch page", import several).
    key = build_upload_key(
        user["location"], child_id, "ninety-day-plan", payload.field_key, ext=ext
    )

    try:
        s3 = get_s3_client(region)
        upload_url: str = await asyncio.to_thread(
            s3.generate_presigned_url,
            "put_object",
            Params={"Bucket": bucket, "Key": key, "ContentType": payload.content_type},
            ExpiresIn=300,
        )
    except (botocore.exceptions.BotoCoreError, botocore.exceptions.ClientError) as exc:
        log.warning(
            "ninety_day_plan.photo_presign.s3_error child=%s field_key=%s: %s",
            child_id,
            payload.field_key,
            exc,
        )
        raise HTTPException(
            status_code=502, detail="Failed to generate upload URL. Please try again."
        ) from exc

    photo_url = build_public_url(bucket, region, settings.uploads_cdn_domain, key)
    return NinetyDayPlanPhotoPresignResponse(upload_url=upload_url, photo_url=photo_url)
