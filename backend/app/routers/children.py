import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
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


# ---------------------------------------------------------------------------
# ORM ↔ schema helpers
# ---------------------------------------------------------------------------

def _child_to_api(row: ChildRecord) -> dict:
    base = dict(row.payload or {})
    base["id"] = row.id
    base["created_date"] = row.created_at.isoformat() if row.created_at else ""
    return base


def _mission_to_api(row: GrowthMissionRecord) -> dict:
    base = dict(row.payload or {})
    base["id"] = row.id
    base["child_id"] = row.child_id
    base["created_date"] = row.created_at.isoformat() if row.created_at else ""
    return base


# ---------------------------------------------------------------------------
# Children
# ---------------------------------------------------------------------------

@router.get("/children", response_model=list[ChildResponse])
def list_children(
    sort: Literal["created_date", "-created_date"] | None = Query(default="-created_date"),
    limit: int = Query(default=50, ge=1, le=200),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    order = ChildRecord.created_at.desc() if (sort or "").startswith("-") else ChildRecord.created_at.asc()
    rows = db.execute(
        select(ChildRecord).where(ChildRecord.user_id == user.id).order_by(order).limit(limit)
    ).scalars().all()
    return [_child_to_api(r) for r in rows]


@router.post("/children", response_model=ChildResponse)
def create_child(payload: ChildCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    data = payload.model_dump(exclude_none=True)
    data.pop("id", None)
    data.pop("created_date", None)
    data.pop("user_id", None)
    row = ChildRecord(user_id=user.id, payload=data)
    db.add(row)
    db.commit()
    db.refresh(row)
    return _child_to_api(row)


@router.patch("/children/{child_id}", response_model=ChildResponse)
def update_child(
    child_id: str,
    patch: ChildPatch,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.get(ChildRecord, child_id)
    if not row or row.user_id != user.id:
        raise HTTPException(status_code=404, detail="Child not found")
    data = dict(row.payload or {})
    for k, v in patch.model_dump(exclude_unset=True).items():
        if k not in ("id", "created_date"):
            data[k] = v
    row.payload = data
    db.commit()
    db.refresh(row)
    return _child_to_api(row)


@router.delete("/children/{child_id}", status_code=204)
def delete_child(child_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.get(ChildRecord, child_id)
    if not row or row.user_id != user.id:
        raise HTTPException(status_code=404, detail="Child not found")
    db.delete(row)
    db.commit()


# ---------------------------------------------------------------------------
# Growth missions
# ---------------------------------------------------------------------------

@router.get("/growth-missions", response_model=list[GrowthMissionResponse])
def list_missions(
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
    order = GrowthMissionRecord.created_at.desc() if (sort or "").startswith("-") else GrowthMissionRecord.created_at.asc()
    rows = db.execute(
        select(GrowthMissionRecord)
        .where(GrowthMissionRecord.child_id == child_id)
        .order_by(order)
        .limit(limit)
    ).scalars().all()
    return [_mission_to_api(r) for r in rows]


@router.post("/growth-missions/bulk", response_model=list[GrowthMissionResponse])
def bulk_missions(body: BulkMissionBody, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    child_ids = {p.child_id for p in body.items if p.child_id}
    owned = {
        c.id: c
        for c in db.execute(
            select(ChildRecord).where(ChildRecord.id.in_(child_ids), ChildRecord.user_id == user.id)
        ).scalars().all()
    }
    out = []
    for payload in body.items:
        cid = payload.child_id
        if not cid or cid not in owned:
            raise HTTPException(status_code=400, detail="Invalid or unauthorized child_id")
        sub = payload.model_dump(exclude_none=True)
        sub.pop("id", None)
        sub.pop("created_date", None)
        sub.pop("child_id", None)
        row = GrowthMissionRecord(child_id=cid, payload=sub)
        db.add(row)
        out.append(row)
    db.commit()
    for r in out:
        db.refresh(r)
    return [_mission_to_api(r) for r in out]
