from typing import Any
from copy import deepcopy
import logging
import secrets

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.auth_utils import (
    create_access_token,
    create_refresh_token,
    decode_token_of_type,
    hash_password,
    verify_password,
)
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

log = logging.getLogger(__name__)

_APP_STATE_PUBLIC_DEFAULTS: dict[str, Any] = {"tts_enabled": True}


def _coerce_user_app_state_patch_value(key: str, value: Any) -> Any:
    """Normalize known scalar keys so stored onboarding_phase stays integer-backed."""
    if key != "onboarding_phase":
        return value
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        try:
            return int(value.strip())
        except ValueError:
            return value
    return value


def _normalize_app_payload_for_response(data: dict[str, Any]) -> dict[str, Any]:
    """Ensure known keys appear in GET/PATCH responses (defaults remain virtual until client PATCH persists)."""
    merged = dict(data)
    for k, v in _APP_STATE_PUBLIC_DEFAULTS.items():
        if k not in merged:
            merged[k] = v
    return merged


def _dedupe_personality_profile_growth_fields(payload: dict[str, Any]) -> None:
    """view_model.profile historically duplicated growthAreas vs growth_areas; keep camelCase only."""
    analysis = payload.get("onboarding_personality_analysis")
    if not isinstance(analysis, dict):
        return
    vm = analysis.get("view_model")
    if not isinstance(vm, dict):
        return
    prof = vm.get("profile")
    if isinstance(prof, dict) and "growthAreas" in prof and "growth_areas" in prof:
        prof.pop("growth_areas", None)


def _omit_redundant_onboarding_personality_copies(payload: dict[str, Any]) -> None:
    """GET responses only: onboarding_profile / legacy onboarding_mbti duplicate view_model (clients derive profile via VM)."""
    analysis = payload.get("onboarding_personality_analysis")
    if not isinstance(analysis, dict):
        return
    vm = analysis.get("view_model")
    if not isinstance(vm, dict) or not vm.get("type") or not vm.get("profile"):
        return
    payload.pop("onboarding_profile", None)
    payload.pop("onboarding_mbti", None)


def _app_state_payload_for_response(raw: dict[str, Any]) -> dict[str, Any]:
    """Deep-copy payload so responses never alias ORM JSON; normalize nested onboarding shapes."""
    try:
        out = deepcopy(raw)
    except Exception:
        out = dict(raw)
    _dedupe_personality_profile_growth_fields(out)
    _omit_redundant_onboarding_personality_copies(out)
    return _normalize_app_payload_for_response(out)


class AuthTokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RegisterBody(BaseModel):
    email: str
    password: str
    full_name: str | None = "Parent"


class LoginBody(BaseModel):
    email: str
    password: str


class RefreshBody(BaseModel):
    access_token: str
    refresh_token: str


class GoogleAuthBody(BaseModel):
    id_token: str


class MeResponse(BaseModel):
    id: str
    email: str
    full_name: str
    role: str
    parent_pin: str


def _issue_token_pair(user_id: str) -> AuthTokenResponse:
    return AuthTokenResponse(
        access_token=create_access_token(user_id),
        refresh_token=create_refresh_token(user_id),
    )


@router.post("/auth/register", response_model=AuthTokenResponse)
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
    return _issue_token_pair(user.id)


@router.post("/auth/login", response_model=AuthTokenResponse)
def login(body: LoginBody, db: Session = Depends(get_db)):
    user = db.execute(select(User).where(User.email == body.email)).scalar_one_or_none()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return _issue_token_pair(user.id)


@router.post("/auth/refresh", response_model=AuthTokenResponse)
def refresh_tokens(body: RefreshBody, db: Session = Depends(get_db)):
    """Both tokens must still be valid (unexpired). Expired tokens cannot be rotated."""
    access_payload = decode_token_of_type(body.access_token, "access")
    refresh_payload = decode_token_of_type(body.refresh_token, "refresh")
    if not access_payload or not refresh_payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    if access_payload.get("sub") != refresh_payload.get("sub"):
        raise HTTPException(status_code=401, detail="Token mismatch")
    uid = access_payload["sub"]
    if not db.get(User, uid):
        raise HTTPException(status_code=401, detail="User not found")
    return _issue_token_pair(uid)


@router.post("/auth/google", response_model=AuthTokenResponse)
def google_auth(body: GoogleAuthBody, db: Session = Depends(get_db)):
    if not settings.google_client_id:
        raise HTTPException(status_code=503, detail="Google sign-in is not configured")
    try:
        from google.oauth2 import id_token as google_id_token
        from google.auth.transport import requests as google_requests

        info = google_id_token.verify_oauth2_token(
            body.id_token,
            google_requests.Request(),
            settings.google_client_id,
            clock_skew_in_seconds=60,
        )
    except Exception as exc:
        log.warning("Google ID token verification failed: %s: %s", type(exc).__name__, exc, exc_info=True)
        msg = str(exc).lower()
        if "requests library is not installed" in msg or "requests` package" in msg:
            detail = (
                "Server cannot verify Google tokens: install the `requests` package "
                "(use `google-auth[requests]` in requirements)."
            )
            raise HTTPException(status_code=500, detail=detail) from exc
        if "audience" in msg or "wrong audience" in msg:
            detail = (
                "Google token does not match GOOGLE_CLIENT_ID on this server. "
                "Set GOOGLE_CLIENT_ID to the same OAuth Web client ID as VITE_GOOGLE_CLIENT_ID."
            )
        elif "expired" in msg or "too late" in msg:
            detail = "Google sign-in token has expired. Use a fresh credential from the browser."
        elif any(x in msg for x in ("certificate", "urlopen", "connection", "ssl", "timeout", "resolve")):
            detail = (
                "Could not verify Google sign-in (failed to reach Google). "
                "Check outbound HTTPS from the API (e.g. Docker network) and try again."
            )
        else:
            detail = "Invalid Google credential."
        raise HTTPException(status_code=401, detail=detail) from exc
    email = info.get("email")
    if not email:
        raise HTTPException(status_code=400, detail="Google did not return an email")
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if not user:
        user = User(
            email=email,
            password_hash=hash_password(secrets.token_urlsafe(32)),
            full_name=(info.get("name") or email.split("@")[0])[:255],
            role="parent",
            parent_pin=settings.demo_parent_pin,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    return _issue_token_pair(user.id)


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
    raw = dict(row.payload) if row and row.payload else {}
    return _app_state_payload_for_response(raw)


@router.patch("/user/app-state")
def patch_user_app_state(
    body: dict[str, Any],
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Merge PATCH JSON into the user's app-state blob.

    Clients should send small, step-scoped payloads (clear keys with null per-field).
    Common onboarding keys: onboarding_phase, onboarding_childData,
    onboarding_personality_analysis, onboarding_recommendations, tts_enabled, goals_plan, ...
    Nested under recommendations_progress: child_activity_by_area (per growth-area id),
    child_activity_game (legacy mirror for the active area), interactiveAnswers, etc.
    GET returns the stored payload unchanged except personality-field dedupe helpers.
    """
    row = db.get(UserAppState, user.id)
    if not row:
        row = UserAppState(user_id=user.id, payload={})
        db.add(row)
    data = dict(row.payload or {})
    for k, v in body.items():
        if v is None:
            data.pop(k, None)
        else:
            data[k] = _coerce_user_app_state_patch_value(k, v)
    row.payload = data
    db.commit()
    db.refresh(row)
    return _app_state_payload_for_response(dict(row.payload))


class CompletedGrowthAreaResponse(BaseModel):
    completed_growth_areas: list[Any]


@router.post("/user/app-state/completed-growth-area", response_model=CompletedGrowthAreaResponse)
def append_completed_growth_area(
    body: dict[str, Any],
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Atomically upsert one growth area entry by id without losing sibling areas (serialized per user row).

    Body may include answers, recommendations (3‑month bullets), child_activity / child_activity_game
    (same object: selections, optional results LLM payload, optional parent_interactive_snapshot).
    """
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
