import logging
import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pymongo import ASCENDING, DESCENDING
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.database import get_db
from app.deps import get_current_user
from app.limiter import user_limiter
from app import models
from app.models_api import (
    ChildCreate,
    ChildPatch,
    ChildResponse,
)

router = APIRouter(tags=["children"])
log = logging.getLogger(__name__)

_CHILD_SYSTEM_FIELDS = {"id", "created_date", "user_id"}


# ---------------------------------------------------------------------------
# Document → API helpers
# ---------------------------------------------------------------------------

def _child_to_api(doc: dict) -> dict:
    out = {
        k: v for k, v in doc.items()
        if k not in ("_id", "user_id", "location", "created_at", "updated_at")
    }
    out["id"] = doc["_id"]
    out["created_date"] = doc["created_at"].isoformat() if doc.get("created_at") else ""
    return out


# ---------------------------------------------------------------------------
# Children
# ---------------------------------------------------------------------------

@router.get("/children", response_model=list[ChildResponse])
@user_limiter.limit("60/minute")
async def list_children(
    request: Request,
    sort: Literal["created_date", "-created_date", "name", "-name"] | None = Query(default="-created_date"),
    limit: int = Query(default=50, ge=1, le=200),
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    _sort = sort or "-created_date"
    if _sort in ("name", "-name"):
        sort_spec = [("name", ASCENDING if _sort == "name" else DESCENDING)]
    else:
        sort_spec = [("created_at", DESCENDING if _sort.startswith("-") else ASCENDING)]

    docs = await (
        db[models.CHILDREN]
        .find({"user_id": user["_id"], "location": user["location"]})
        .sort(sort_spec)
        .to_list(limit)
    )
    return [_child_to_api(d) for d in docs]


@router.post("/children", response_model=ChildResponse)
@user_limiter.limit("20/minute")
async def create_child(
    request: Request,
    payload: ChildCreate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    data = payload.model_dump(exclude_none=True)
    for f in _CHILD_SYSTEM_FIELDS:
        data.pop(f, None)

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


@router.get("/children/{child_id}", response_model=ChildResponse)
@user_limiter.limit("60/minute")
async def get_child(
    request: Request,
    child_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    doc = await db[models.CHILDREN].find_one({"_id": child_id, "user_id": user["_id"], "location": user["location"]})
    if not doc:
        raise HTTPException(status_code=404, detail="Child not found")
    return _child_to_api(doc)


@router.patch("/children/{child_id}", response_model=ChildResponse)
@user_limiter.limit("30/minute")
async def update_child(
    request: Request,
    child_id: str,
    patch: ChildPatch,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    existing = await db[models.CHILDREN].find_one({"_id": child_id, "user_id": user["_id"], "location": user["location"]})
    if not existing:
        raise HTTPException(status_code=404, detail="Child not found")

    updates = patch.model_dump(exclude_unset=True)
    set_fields: dict = {"updated_at": datetime.now(timezone.utc)}
    for k, v in updates.items():
        if k in _CHILD_SYSTEM_FIELDS:
            continue
        if k == "name" and v is None:
            continue  # name is required — ignore null patch
        set_fields[k] = v

    doc = await db[models.CHILDREN].find_one_and_update(
        {"_id": child_id, "user_id": user["_id"], "location": user["location"]},
        {"$set": set_fields},
        return_document=True,
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Child not found")
    return _child_to_api(doc)


@router.delete("/children/{child_id}", status_code=204)
@user_limiter.limit("10/minute")
async def delete_child(
    request: Request,
    child_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    existing = await db[models.CHILDREN].find_one({"_id": child_id, "user_id": user["_id"], "location": user["location"]})
    if not existing:
        raise HTTPException(status_code=404, detail="Child not found")
    loc = existing["location"]
    # All three collections are sharded by location, so they land on the same shard
    # and can be included in a single transaction — identical pattern to account deletion.
    async with await db.client.start_session() as session:
        async with session.start_transaction():
            await db[models.GOALS].delete_one({"_id": child_id, "location": loc}, session=session)
            await db[models.GROWTH_AREAS].delete_many({"child_id": child_id, "location": loc}, session=session)
            await db[models.CHILDREN].delete_one({"_id": child_id, "location": loc}, session=session)
