from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.auth_utils import create_access_token, hash_password, verify_password
from app.models import (
    ChildRecord,
    GrowthMissionRecord,
    ParentInsightRecord,
    ReflectionRecord,
    User,
    UserAppState,
)
from app.settings import settings

router = APIRouter(tags=["auth"])


class BootstrapResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class RegisterBody(BaseModel):
    email: str
    password: str
    full_name: str | None = "Parent"


class LoginBody(BaseModel):
    email: str
    password: str


class MeResponse(BaseModel):
    id: str
    email: str
    full_name: str
    role: str
    parent_pin: str


@router.post("/auth/bootstrap", response_model=BootstrapResponse)
def bootstrap_demo_account(db: Session = Depends(get_db)):
    demo_email = "demo@buddy360.local"
    user = db.execute(select(User).where(User.email == demo_email)).scalar_one_or_none()
    pw = "demo!"
    if not user:
        user = User(
            email=demo_email,
            password_hash=hash_password(pw),
            full_name="Parent",
            role="parent",
            parent_pin=settings.demo_parent_pin,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    token = create_access_token(user.id)
    return BootstrapResponse(access_token=token)


@router.post("/auth/register", response_model=BootstrapResponse)
def register(body: RegisterBody, db: Session = Depends(get_db)):
    if db.execute(select(User).where(User.email == body.email)).scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already registered")
    user = User(
        email=body.email,
        password_hash=hash_password(body.password),
        full_name=body.full_name or "Parent",
        role="parent",
        parent_pin=settings.demo_parent_pin,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return BootstrapResponse(access_token=create_access_token(user.id))


@router.post("/auth/login", response_model=BootstrapResponse)
def login(body: LoginBody, db: Session = Depends(get_db)):
    user = db.execute(select(User).where(User.email == body.email)).scalar_one_or_none()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return BootstrapResponse(access_token=create_access_token(user.id))


@router.get("/auth/me", response_model=MeResponse)
def auth_me(user: User = Depends(get_current_user)):
    return MeResponse(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=user.role,
        parent_pin=user.parent_pin,
    )


@router.get("/user/app-state")
def get_user_app_state(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.get(UserAppState, user.id)
    return dict(row.payload) if row and row.payload else {}


@router.patch("/user/app-state")
def patch_user_app_state(
    body: dict[str, Any],
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.get(UserAppState, user.id)
    if not row:
        row = UserAppState(user_id=user.id, payload={})
        db.add(row)
    data = dict(row.payload or {})
    for k, v in body.items():
        if v is None:
            data.pop(k, None)
        else:
            data[k] = v
    row.payload = data
    db.commit()
    db.refresh(row)
    return dict(row.payload)


class CompletedGrowthAreaResponse(BaseModel):
    completed_growth_areas: list[Any]


@router.post("/user/app-state/completed-growth-area", response_model=CompletedGrowthAreaResponse)
def append_completed_growth_area(
    body: dict[str, Any],
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Atomically upsert one growth area entry by id without losing sibling areas (serialized per user row)."""
    if not body.get("id"):
        raise HTTPException(status_code=400, detail="Missing area id")

    for _ in range(6):
        try:
            row = db.execute(
                select(UserAppState).where(UserAppState.user_id == user.id).with_for_update()
            ).scalar_one_or_none()
            if not row:
                row = UserAppState(user_id=user.id, payload={})
                db.add(row)
                db.flush()
            data = dict(row.payload or {})
            existing = data.get("completed_growth_areas")
            if not isinstance(existing, list):
                existing = []
            aid = body["id"]
            updated = [a for a in existing if isinstance(a, dict) and a.get("id") != aid]
            updated.append(body)
            data["completed_growth_areas"] = updated
            row.payload = data
            db.commit()
            db.refresh(row)
            return CompletedGrowthAreaResponse(completed_growth_areas=updated)
        except IntegrityError:
            db.rollback()
    raise HTTPException(status_code=500, detail="Could not save completed growth area")


def _child_to_api(row: ChildRecord) -> dict[str, Any]:
    base = dict(row.payload or {})
    base["id"] = row.id
    base["created_date"] = row.created_at.isoformat()
    return base




def _mission_to_api(row: GrowthMissionRecord) -> dict[str, Any]:
    base = dict(row.payload or {})
    base["id"] = row.id
    base["child_id"] = row.child_id
    base["created_date"] = row.created_at.isoformat()
    return base


def _insight_to_api(row: ParentInsightRecord) -> dict[str, Any]:
    base = dict(row.payload or {})
    base["id"] = row.id
    base["child_id"] = row.child_id
    base["created_date"] = row.created_at.isoformat()
    return base


def _reflection_to_api(row: ReflectionRecord) -> dict[str, Any]:
    base = dict(row.payload or {})
    base["id"] = row.id
    base["child_id"] = row.child_id
    base["created_date"] = row.created_at.isoformat()
    return base


@router.get("/children")
def list_children(
    sort: str | None = "-created_date",
    limit: int | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = select(ChildRecord).where(ChildRecord.user_id == user.id)
    rows = list(db.execute(q).scalars().all())
    descending = sort.startswith("-") if sort else True
    rows.sort(key=lambda r: r.created_at, reverse=descending)
    if limit is not None:
        rows = rows[: int(limit)]
    return [_child_to_api(r) for r in rows]


@router.post("/children")
def create_child(payload: dict[str, Any], user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = ChildRecord(user_id=user.id, payload={k: v for k, v in payload.items() if k not in ("id", "created_date")})
    db.add(row)
    db.commit()
    db.refresh(row)
    return _child_to_api(row)


@router.patch("/children/{child_id}")
def update_child(
    child_id: str,
    patch: dict[str, Any],
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.get(ChildRecord, child_id)
    if not row or row.user_id != user.id:
        raise HTTPException(status_code=404)
    data = dict(row.payload or {})
    for k, v in patch.items():
        if k in ("id", "created_date"):
            continue
        data[k] = v
    row.payload = data
    db.commit()
    db.refresh(row)
    return _child_to_api(row)


@router.delete("/children/{child_id}")
def delete_child(child_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.get(ChildRecord, child_id)
    if not row or row.user_id != user.id:
        raise HTTPException(status_code=404)
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.get("/growth-missions")
def list_missions(
    child_id: str | None = None,
    sort: str | None = "-created_date",
    limit: int | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not child_id:
        return []
    child = db.get(ChildRecord, child_id)
    if not child or child.user_id != user.id:
        raise HTTPException(status_code=404)
    rows = list(db.execute(select(GrowthMissionRecord).where(GrowthMissionRecord.child_id == child_id)).scalars().all())
    descending = sort.startswith("-") if sort else True
    rows.sort(key=lambda r: r.created_at, reverse=descending)
    if limit is not None:
        rows = rows[: int(limit)]
    return [_mission_to_api(r) for r in rows]


@router.post("/growth-missions")
def create_mission(payload: dict[str, Any], user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    cid = payload.get("child_id")
    child = db.get(ChildRecord, cid) if cid else None
    if not child or child.user_id != user.id:
        raise HTTPException(status_code=404, detail="Invalid child")
    body = {k: v for k, v in payload.items() if k not in ("id", "created_date")}
    row = GrowthMissionRecord(child_id=cid, payload=body)
    db.add(row)
    db.commit()
    db.refresh(row)
    return _mission_to_api(row)


class BulkMissionBody(BaseModel):
    items: list[dict[str, Any]]


@router.post("/growth-missions/bulk")
def bulk_missions(body: BulkMissionBody, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    out = []
    for payload in body.items:
        cid = payload.get("child_id")
        child = db.get(ChildRecord, cid) if cid else None
        if not child or child.user_id != user.id:
            continue
        sub = {k: v for k, v in payload.items() if k not in ("id", "created_date")}
        row = GrowthMissionRecord(child_id=cid, payload=sub)
        db.add(row)
        out.append(row)
    db.commit()
    for r in out:
        db.refresh(r)
    return [_mission_to_api(r) for r in out]


@router.patch("/growth-missions/{mission_id}")
def update_mission(
    mission_id: str,
    patch: dict[str, Any],
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.get(GrowthMissionRecord, mission_id)
    if not row:
        raise HTTPException(status_code=404)
    child = db.get(ChildRecord, row.child_id)
    if not child or child.user_id != user.id:
        raise HTTPException(status_code=404)
    data = dict(row.payload or {})
    for k, v in patch.items():
        if k in ("id", "child_id", "created_date"):
            continue
        if k == "ai_insights" and isinstance(v, dict) and isinstance(data.get("ai_insights"), dict):
            merged = dict(data["ai_insights"])
            merged.update(v)
            data[k] = merged
        else:
            data[k] = v
    row.payload = data
    db.commit()
    db.refresh(row)
    return _mission_to_api(row)


@router.get("/parent-insights")
def list_insights(
    child_id: str | None = None,
    is_read: str | None = None,
    sort: str | None = "-created_date",
    limit: int | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not child_id:
        return []
    child = db.get(ChildRecord, child_id)
    if not child or child.user_id != user.id:
        raise HTTPException(status_code=404)
    rows = list(db.execute(select(ParentInsightRecord).where(ParentInsightRecord.child_id == child_id)).scalars().all())
    filt_bool: bool | None = None
    if is_read is not None:
        v = is_read.strip().lower()
        if v in ("true", "1", "yes"):
            filt_bool = True
        elif v in ("false", "0", "no"):
            filt_bool = False
    if filt_bool is not None:
        rows = [r for r in rows if bool((r.payload or {}).get("is_read")) is filt_bool]
    descending = sort.startswith("-") if sort else True
    rows.sort(key=lambda r: r.created_at, reverse=descending)
    if limit is not None:
        rows = rows[: int(limit)]
    return [_insight_to_api(r) for r in rows]


@router.post("/parent-insights")
def create_insight(payload: dict[str, Any], user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    cid = payload.get("child_id")
    child = db.get(ChildRecord, cid) if cid else None
    if not child or child.user_id != user.id:
        raise HTTPException(status_code=404)
    body = {k: v for k, v in payload.items() if k not in ("id", "created_date")}
    body.setdefault("is_read", False)
    row = ParentInsightRecord(child_id=cid, payload=body)
    db.add(row)
    db.commit()
    db.refresh(row)
    return _insight_to_api(row)


@router.get("/reflections")
def list_reflections(
    child_id: str | None = None,
    sort: str | None = "-created_date",
    limit: int | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not child_id:
        return []
    child = db.get(ChildRecord, child_id)
    if not child or child.user_id != user.id:
        raise HTTPException(status_code=404)
    rows = list(db.execute(select(ReflectionRecord).where(ReflectionRecord.child_id == child_id)).scalars().all())
    descending = sort.startswith("-") if sort else True
    rows.sort(key=lambda r: r.created_at, reverse=descending)
    if limit is not None:
        rows = rows[: int(limit)]
    return [_reflection_to_api(r) for r in rows]


@router.post("/reflections")
def create_reflection(payload: dict[str, Any], user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    cid = payload.get("child_id")
    child = db.get(ChildRecord, cid) if cid else None
    if not child or child.user_id != user.id:
        raise HTTPException(status_code=404)
    body = {k: v for k, v in payload.items() if k not in ("id", "created_date")}
    row = ReflectionRecord(child_id=cid, payload=body)
    db.add(row)
    db.commit()
    db.refresh(row)
    return _reflection_to_api(row)
