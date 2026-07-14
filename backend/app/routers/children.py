import asyncio
import logging
import uuid
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Body, Depends, HTTPException, Path, Query, Request
from motor.motor_asyncio import AsyncIOMotorDatabase
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

    # Only fetch the fields actually consumed by the child-card list view.
    # Heavy sub-documents (personality scores/traits, full recommendations blob)
    # are excluded here and fetched in full by GET /children/{child_id} when a
    # specific child's page loads.
    _LIST_PROJECTION = {
        "name": 1,
        "age": 1,
        "school": 1,
        "onboarding_completed": 1,
        "recommendations.pathway_overview": 1,
        "personality.view_model.profile.name": 1,
        "created_at": 1,
        # current_phase is intentionally excluded: the child-card list view does
        # not render it.  It is returned in full by GET /children/{child_id} when
        # the detail page loads.  Add it here only if a list-view consumer needs it.
    }
    docs = await (
        db[models.CHILDREN]
        .find({"user_id": user["_id"], "location": user["location"]}, _LIST_PROJECTION)
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
        {"user_id": user["_id"], "location": user["location"]}
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
        {"_id": child_id, "user_id": user["_id"], "location": user["location"]}
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

    update_op: dict = {"$set": set_fields}
    if add_to_set_tabs:
        update_op["$addToSet"] = {"visited_tabs": {"$each": add_to_set_tabs}}
    # When the client commits the final personality, clear the staging field to
    # avoid keeping ~2 KB of duplicate LLM output permanently on the document.
    if "personality" in set_fields:
        update_op["$unset"] = {"pending_personality_vm": ""}

    doc = await db[models.CHILDREN].find_one_and_update(
        {"_id": child_id, "user_id": user["_id"], "location": user["location"]},
        update_op,
        return_document=True,
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Child not found")
    return _child_to_api(doc)


@router.delete(
    "/children/{child_id}",
    status_code=204,
    description="Remove a child profile and all associated data.",
)
@user_limiter.limit("10/minute")
async def delete_child(
    request: Request,
    child_id: str = Path(..., min_length=1, max_length=100),
    user: dict = Depends(get_current_parent),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    existing = await db[models.CHILDREN].find_one(
        {"_id": child_id, "user_id": user["_id"], "location": user["location"]}
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Child not found")
    loc = existing["location"]
    # TODO(M10+): Wrap all deletes below in a single multi-document transaction once
    # the cluster is upgraded to Atlas M10 or higher. Atlas M0/M2/M5 shared tiers
    # do not support multi-document transactions, so we use sequential operations
    # for now. A crash mid-sequence may leave orphaned goal/growth-area documents
    # for the child; they are inert (no child record to link them) but should be
    # cleaned up by a periodic orphan-sweep job before the M10+ migration.
    # Child-data collections are independent — delete them in parallel to reduce
    # wall-clock time on M0's shared-cluster I/O.
    await asyncio.gather(
        db[models.GOALS].delete_one({"_id": child_id, "location": loc}),
        db[models.GOAL_INSIGHTS].delete_one({"_id": child_id, "location": loc}),
        db[models.GOAL_MONTHS].delete_many({"child_id": child_id, "location": loc}),
        db[models.GROWTH_AREAS].delete_many({"child_id": child_id, "location": loc}),
    )
    await db[models.CHILDREN].delete_one({"_id": child_id, "location": loc})
