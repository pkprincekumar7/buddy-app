import asyncio
import logging
import uuid
from datetime import UTC, datetime
from typing import Any, Literal

import boto3
import botocore.exceptions
from fastapi import APIRouter, Body, Depends, HTTPException, Path, Query, Request
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel, Field
from pymongo import ASCENDING, DESCENDING

from app import models
from app.database import get_db
from app.deps import get_current_parent
from app.limiter import user_limiter
from app.models_api import (
    ChildCreate,
    ChildPatch,
    ChildResponse,
)
from app.settings import settings

# Fields returned by the child-card list view. Heavy sub-documents
# (personality scores/traits, full recommendations blob) are excluded and
# fetched in full by GET /children/{child_id} when a specific child loads.
# current_phase is intentionally excluded from the list view.
_LIST_PROJECTION = {
    "name": 1,
    "age": 1,
    "school": 1,
    "onboarding_completed": 1,
    "recommendations.pathway_overview": 1,
    "personality.view_model.profile.name": 1,
    "created_at": 1,
}

router = APIRouter(tags=["children"])
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
}


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
    sort: Literal["created_date", "-created_date", "name", "-name"] | None = Query(
        default="-created_date"
    ),
    limit: int = Query(default=50, ge=1, le=200),
    user: dict = Depends(get_current_parent),
    db: AsyncIOMotorDatabase = Depends(get_db),
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
    user: dict = Depends(get_current_parent),
    db: AsyncIOMotorDatabase = Depends(get_db),
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
    child_id: str = Path(..., min_length=1, max_length=100),
    user: dict = Depends(get_current_parent),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    doc = await db[models.CHILDREN].find_one(
        {"_id": child_id, "user_id": user["_id"], "location": user["location"], "is_deleted": False}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Child not found")
    return _child_to_api(doc)


@router.patch(
    "/children/{child_id}",
    response_model=ChildResponse,
    description="Update details of an existing child profile.",
)
@user_limiter.limit("30/minute")
async def update_child(
    request: Request,
    child_id: str = Path(..., min_length=1, max_length=100),
    patch: ChildPatch = Body(...),
    user: dict = Depends(get_current_parent),
    db: AsyncIOMotorDatabase = Depends(get_db),
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

    update_op: dict = {"$set": set_fields}
    if add_to_set_tabs:
        update_op["$addToSet"] = {"visited_tabs": {"$each": add_to_set_tabs}}
    if clear_pending_vm:
        update_op["$unset"] = {"pending_personality_vm": ""}

    doc = await db[models.CHILDREN].find_one_and_update(
        {
            "_id": child_id,
            "user_id": user["_id"],
            "location": user["location"],
            "is_deleted": False,
        },
        update_op,
        return_document=True,
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Child not found")
    return _child_to_api(doc)


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
    child_id: str = Path(..., min_length=1, max_length=100),
    user: dict = Depends(get_current_parent),
    db: AsyncIOMotorDatabase = Depends(get_db),
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
    child_id: str = Path(..., min_length=1, max_length=100),
    payload: AvatarPresignRequest = Body(...),
    user: dict = Depends(get_current_parent),
    db: AsyncIOMotorDatabase = Depends(get_db),
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
