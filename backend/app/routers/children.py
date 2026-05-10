import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.limiter import user_limiter
from app.models import ChildRecord, GrowthMissionRecord, User
from app.models_api import (
    BulkMissionBody,
    ChildCreate,
    ChildPatch,
    ChildResponse,
    GrowthMissionResponse,
)

router = APIRouter(tags=["children"])
log = logging.getLogger(__name__)

# Fields promoted to real columns — kept in sync with the model and migrations.
_CHILD_PROMOTED = {"name", "age", "school"}
_MISSION_PROMOTED = {"title", "status", "pillar"}


def _assert_promoted_sets_in_sync() -> None:
    """
    Guard that fires at import time if a promoted-field set drifts from its ORM
    model.  Without this check, adding a new column to ChildRecord or
    GrowthMissionRecord without updating the corresponding set would silently
    route that field into the JSON payload blob instead of its real column.
    """
    child_cols = {c.key for c in ChildRecord.__mapper__.columns}
    missing = _CHILD_PROMOTED - child_cols
    if missing:
        raise RuntimeError(
            f"_CHILD_PROMOTED references columns not on ChildRecord: {missing}. "
            "Update _CHILD_PROMOTED (and the migration) to match the model."
        )
    mission_cols = {c.key for c in GrowthMissionRecord.__mapper__.columns}
    missing = _MISSION_PROMOTED - mission_cols
    if missing:
        raise RuntimeError(
            f"_MISSION_PROMOTED references columns not on GrowthMissionRecord: {missing}. "
            "Update _MISSION_PROMOTED (and the migration) to match the model."
        )


_assert_promoted_sets_in_sync()


# ---------------------------------------------------------------------------
# ORM ↔ schema helpers
# ---------------------------------------------------------------------------

def _child_to_api(row: ChildRecord) -> dict:
    base = dict(row.payload or {})
    base["id"] = row.id
    base["created_date"] = row.created_at.isoformat() if row.created_at else ""
    base["name"] = row.name          # NOT NULL — always present
    if row.age is not None:
        base["age"] = row.age
    if row.school is not None:
        base["school"] = row.school
    return base


def _mission_to_api(row: GrowthMissionRecord) -> dict:
    base = dict(row.payload or {})
    base["id"] = row.id
    base["child_id"] = row.child_id
    base["created_date"] = row.created_at.isoformat() if row.created_at else ""
    base["title"] = row.title        # NOT NULL — always present
    base["status"] = row.status      # NOT NULL — always present
    if row.pillar is not None:
        base["pillar"] = row.pillar
    return base


# ---------------------------------------------------------------------------
# Children
# ---------------------------------------------------------------------------

@router.get("/children", response_model=list[ChildResponse])
@user_limiter.limit("60/minute")
def list_children(
    request: Request,
    sort: Literal["created_date", "-created_date", "name", "-name"] | None = Query(default="-created_date"),
    limit: int = Query(default=50, ge=1, le=200),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    List all children for the current user.

    Sort options:
      created_date  — oldest first
      -created_date — newest first (default)
      name          — A→Z (uses the indexed `name` column)
      -name         — Z→A
    """
    _sort = sort or "-created_date"
    if _sort in ("name", "-name"):
        order = ChildRecord.name.asc() if _sort == "name" else ChildRecord.name.desc()
    else:
        order = ChildRecord.created_at.desc() if _sort.startswith("-") else ChildRecord.created_at.asc()

    rows = db.execute(
        select(ChildRecord).where(ChildRecord.user_id == user.id).order_by(order).limit(limit)
    ).scalars().all()
    return [_child_to_api(r) for r in rows]


@router.post("/children", response_model=ChildResponse)
@user_limiter.limit("20/minute")
def create_child(
    request: Request,
    payload: ChildCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    data = payload.model_dump(exclude_none=True)
    data.pop("id", None)
    data.pop("created_date", None)
    data.pop("user_id", None)

    # Extract promoted columns from the payload dict (see _CHILD_PROMOTED).
    name   = str(data.pop("name", "") or "")
    age    = data.pop("age", None)
    school = data.pop("school", None)

    row = ChildRecord(
        user_id=user.id,
        name=name,
        age=age,
        school=school,
        payload=data,  # remaining flexible fields
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _child_to_api(row)


@router.patch("/children/{child_id}", response_model=ChildResponse)
@user_limiter.limit("30/minute")
def update_child(
    request: Request,
    child_id: str,
    patch: ChildPatch,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.get(ChildRecord, child_id)
    if not row or row.user_id != user.id:
        raise HTTPException(status_code=404, detail="Child not found")

    updates = patch.model_dump(exclude_unset=True)

    # Apply promoted columns directly on the ORM object.
    # _CHILD_PROMOTED is the authoritative list — extend it (and the model) to add new columns.
    for field in _CHILD_PROMOTED:
        if field in updates:
            val = updates.pop(field)
            if field == "name":
                # `name` is NOT NULL in the DB.  A null patch is a no-op so
                # callers cannot accidentally clear it; use "" explicitly to
                # store an empty string.
                if val is not None:
                    setattr(row, field, str(val))
            else:
                # Other promoted fields are nullable — None clears the value.
                # Explicit None from the caller means "clear"; any other value
                # (including "") is stored as-is.
                setattr(row, field, val)

    # Remaining patch fields go into the payload JSON
    if updates:
        data = dict(row.payload or {})
        for k, v in updates.items():
            if k not in ("id", "created_date"):
                data[k] = v
        row.payload = data

    db.commit()
    db.refresh(row)
    return _child_to_api(row)


@router.delete("/children/{child_id}", status_code=204)
@user_limiter.limit("10/minute")
def delete_child(
    request: Request,
    child_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.get(ChildRecord, child_id)
    if not row or row.user_id != user.id:
        raise HTTPException(status_code=404, detail="Child not found")
    db.delete(row)
    db.commit()


# ---------------------------------------------------------------------------
# Growth missions
# ---------------------------------------------------------------------------

@router.get("/growth-missions", response_model=list[GrowthMissionResponse])
@user_limiter.limit("60/minute")
def list_missions(
    request: Request,
    child_id: str | None = None,
    sort: Literal["created_date", "-created_date"] | None = Query(default="-created_date"),
    limit: int = Query(default=50, ge=1, le=200),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not child_id:
        return []
    child = db.get(ChildRecord, child_id)
    if not child or child.user_id != user.id:
        raise HTTPException(status_code=404, detail="Child not found")
    order = (
        GrowthMissionRecord.created_at.desc()
        if (sort or "").startswith("-")
        else GrowthMissionRecord.created_at.asc()
    )
    rows = db.execute(
        select(GrowthMissionRecord)
        .where(GrowthMissionRecord.child_id == child_id)
        .order_by(order)
        .limit(limit)
    ).scalars().all()
    return [_mission_to_api(r) for r in rows]


@router.post("/growth-missions/bulk", response_model=list[GrowthMissionResponse])
@user_limiter.limit("10/minute")
def bulk_missions(
    request: Request,
    body: BulkMissionBody,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    child_ids = {p.child_id for p in body.items if p.child_id}
    owned = {
        c.id: c
        for c in db.execute(
            select(ChildRecord).where(ChildRecord.id.in_(child_ids), ChildRecord.user_id == user.id)
        ).scalars().all()
    }
    out = []
    for item in body.items:
        cid = item.child_id
        if not cid or cid not in owned:
            raise HTTPException(status_code=400, detail="Invalid or unauthorized child_id")

        sub = item.model_dump(exclude_none=True)
        sub.pop("id", None)
        sub.pop("created_date", None)
        sub.pop("child_id", None)

        # Extract promoted mission columns.
        # _MISSION_PROMOTED drives this extraction — extend it (and the model) to add new columns.
        promoted = {field: sub.pop(field, None) for field in _MISSION_PROMOTED}
        title  = str(promoted.get("title")  or "")
        status = str(promoted.get("status") or "active")
        pillar = promoted.get("pillar")

        row = GrowthMissionRecord(
            child_id=cid,
            title=title,
            status=status,
            pillar=pillar,
            payload=sub,  # remaining flexible fields
        )
        db.add(row)
        out.append(row)

    db.flush()   # populate DB-generated defaults (created_at) into ORM objects
    db.commit()
    return [_mission_to_api(r) for r in out]
