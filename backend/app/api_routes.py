import logging
import secrets
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field, field_validator

from app.limiter import limiter
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth_utils import (
    create_access_token,
    create_refresh_token,
    decode_access_token_ignore_exp,
    decode_token_of_type,
    hash_password,
    verify_password,
)
from app.database import get_db, get_upsert_insert
from app.deps import get_current_user
from app.models import (
    ChildRecord,
    CompletedGrowthAreaRecord,
    GrowthMissionRecord,
    ParentInsightRecord,
    ReflectionRecord,
    User,
    UserGoalsRecord,
    UserJourneyRecord,
    UserOnboardingRecord,
    UserPersonalityRecord,
    UserPreferencesRecord,
    UserRecommendationsProgressRecord,
)
from app.models_api import (
    AppendGrowthAreaRequest,
    BulkMissionBody,
    ChildActivity,
    ChildActivityResults,
    ChildCreate,
    ChildPatch,
    ChildResponse,
    CompletedGrowthArea,
    CompletedGrowthAreasResponse,
    FamousPerson,
    FocusArea,
    GoalsPlan,
    GrowthMissionCreate,
    GrowthMissionPatch,
    GrowthMissionResponse,
    InitialMission,
    JourneyRecommendations,
    OnboardingChildData,
    OnboardingPatch,
    OnboardingState,
    ParentInsightCreate,
    ParentInsightResponse,
    UpdateInsightBody,
    PersonalityAnalysis,
    PersonalityProfile,
    PersonalityViewModel,
    RecommendationsProgress,
    ReflectionCreate,
    ReflectionResponse,
    UserGoals,
    UserGoalsPatch,
    UserPreferences,
)
from app.settings import settings

_upsert_insert = get_upsert_insert()

# Pre-computed hash used to keep login response time constant whether or not
# the email exists, preventing user-enumeration via timing.
_DUMMY_HASH: str = hash_password("__dummy_constant_time__")

router = APIRouter(tags=["api"])

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Auth models
# ---------------------------------------------------------------------------

class AuthTokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RegisterBody(BaseModel):
    email: str = Field(max_length=255)
    password: str = Field(min_length=8, max_length=128)
    full_name: str | None = "Parent"

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        v = v.strip().lower()
        if "@" not in v or "." not in v.split("@")[-1]:
            raise ValueError("Invalid email address")
        return v

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters long")
        return v

    @field_validator("full_name")
    @classmethod
    def validate_full_name(cls, v: str | None) -> str | None:
        if v and len(v) > 255:
            raise ValueError("Name must not exceed 255 characters")
        return v


class LoginBody(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def normalise_email(cls, v: str) -> str:
        return v.strip().lower()


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


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------

def _issue_token_pair(user_id: str) -> AuthTokenResponse:
    return AuthTokenResponse(
        access_token=create_access_token(user_id),
        refresh_token=create_refresh_token(user_id),
    )


# ---------------------------------------------------------------------------
# Auth endpoints
# ---------------------------------------------------------------------------

@router.post("/auth/register", response_model=AuthTokenResponse)
@limiter.limit("5/minute")
def register(request: Request, body: RegisterBody, db: Session = Depends(get_db)):
    if db.execute(select(User).where(User.email == body.email)).scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already registered")
    user = User(
        email=body.email,
        password_hash=hash_password(body.password),
        full_name=body.full_name or "Parent",
        role="parent",
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Email already registered")
    db.refresh(user)
    log.info("user.register id=%s", user.id)
    return _issue_token_pair(user.id)


@router.post("/auth/login", response_model=AuthTokenResponse)
@limiter.limit("10/minute")
def login(request: Request, body: LoginBody, db: Session = Depends(get_db)):
    user = db.execute(select(User).where(User.email == body.email)).scalar_one_or_none()
    target_hash = user.password_hash if user else _DUMMY_HASH
    password_ok = verify_password(body.password, target_hash)
    if not user or not password_ok:
        log.warning("auth.login.failed email=%s", body.email)
        raise HTTPException(status_code=401, detail="Invalid email or password")
    log.info("auth.login.ok id=%s", user.id)
    return _issue_token_pair(user.id)


@router.post("/auth/refresh", response_model=AuthTokenResponse)
@limiter.limit("5/minute")
def refresh_tokens(request: Request, body: RefreshBody, db: Session = Depends(get_db)):
    # Access token may be expired — decode ignoring expiry just to extract sub.
    # Refresh token must still be fully valid (signature + expiry).
    access_payload = decode_access_token_ignore_exp(body.access_token)
    refresh_payload = decode_token_of_type(body.refresh_token, "refresh")
    if not access_payload or not refresh_payload:
        log.warning("auth.refresh.failed reason=invalid_tokens")
        raise HTTPException(status_code=401, detail="Invalid token")
    if access_payload.get("sub") != refresh_payload.get("sub"):
        log.warning("auth.refresh.failed reason=subject_mismatch sub=%s", access_payload.get("sub"))
        raise HTTPException(status_code=401, detail="Token mismatch")
    uid = access_payload["sub"]
    if not db.get(User, uid):
        raise HTTPException(status_code=401, detail="User not found")
    return _issue_token_pair(uid)


@router.post("/auth/google", response_model=AuthTokenResponse)
@limiter.limit("10/minute")
def google_auth(request: Request, body: GoogleAuthBody, db: Session = Depends(get_db)):
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
            raise HTTPException(
                status_code=500,
                detail=(
                    "Server cannot verify Google tokens: install the `requests` package "
                    "(use `google-auth[requests]` in requirements)."
                ),
            ) from exc
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

    email = (info.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="Google did not return an email")
    if not info.get("email_verified"):
        raise HTTPException(status_code=400, detail="Google account email is not verified")
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if not user:
        raw_name = (info.get("name") or "").strip()
        full_name = (raw_name or email.split("@")[0])[:255]
        user = User(
            email=email,
            password_hash=hash_password(secrets.token_urlsafe(32)),
            full_name=full_name,
            role="parent",
        )
        db.add(user)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            user = db.execute(select(User).where(User.email == email)).scalar_one()
        else:
            db.refresh(user)
    return _issue_token_pair(user.id)


@router.get("/auth/me", response_model=MeResponse)
def auth_me(user: User = Depends(get_current_user)):
    return MeResponse(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=user.role,
    )


@router.delete("/user/me", status_code=204)
def delete_account(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.delete(user)
    db.commit()


# ---------------------------------------------------------------------------
# ORM ↔ schema conversion helpers
# ---------------------------------------------------------------------------

def _preferences_to_schema(row: UserPreferencesRecord) -> UserPreferences:
    return UserPreferences(tts_enabled=row.tts_enabled)


def _personality_row_to_schema(row: UserPersonalityRecord) -> PersonalityAnalysis:
    profile = PersonalityProfile(
        name=row.profile_name or "",
        category=row.category or "",
        description=row.description or "",
        color=row.color or "",
        traits=row.traits or [],
        strengths=row.strengths or [],
        growth_areas=row.growth_areas or [],
        famous_people=[FamousPerson(**p) for p in (row.famous_people or []) if isinstance(p, dict)],
    )
    vm = PersonalityViewModel(
        type=row.personality_type or "",
        scores=row.scores or {},
        profile=profile,
    )
    return PersonalityAnalysis(source=row.source or "", view_model=vm)


def _journey_row_to_schema(row: UserJourneyRecord) -> JourneyRecommendations:
    return JourneyRecommendations(
        pathway_overview=row.overview or "",
        focus_areas=[FocusArea(**fa) for fa in (row.focus_areas or []) if isinstance(fa, dict)],
        initial_missions=[InitialMission(**im) for im in (row.initial_missions or []) if isinstance(im, dict)],
    )


def _onboarding_to_schema(
    ob: UserOnboardingRecord | None,
    per: UserPersonalityRecord | None,
    jrn: UserJourneyRecord | None,
) -> OnboardingState:
    child_data: OnboardingChildData | None = None
    if ob and ob.phase > 0:
        child_data = OnboardingChildData(
            name=ob.child_name or "",
            age=ob.child_age or "",
            school=ob.child_school or "",
            strengths=ob.child_strengths or [],
            hobbies=ob.child_hobbies or [],
            thinking_pattern=ob.child_thinking_pattern or "",
            communication_style=ob.child_communication_style or "",
            energy_level=ob.child_energy_level or "",
            social_behaviour=ob.child_social_behaviour or "",
            emotional_behaviour=ob.child_emotional_behaviour or "",
        )
    return OnboardingState(
        phase=ob.phase if ob else 0,
        child_data=child_data,
        personality=_personality_row_to_schema(per) if per else None,
        recommendations=_journey_row_to_schema(jrn) if jrn else None,
    )


def _completed_area_row_to_schema(row: CompletedGrowthAreaRecord) -> CompletedGrowthArea:
    child_activity: ChildActivity | None = None
    has_activity = row.child_selections or row.child_summary or row.child_strengths or row.child_suggested
    if has_activity:
        results: ChildActivityResults | None = None
        if row.child_summary or row.child_strengths or row.child_suggested:
            results = ChildActivityResults(
                summary=row.child_summary or "",
                strengths=row.child_strengths or [],
                suggested_activities=row.child_suggested or [],
            )
        child_activity = ChildActivity(
            selections=row.child_selections or [],
            results=results,
        )
    return CompletedGrowthArea(
        area_id=row.area_id,
        area_name=row.area_name,
        area_color=row.area_color,
        answers=row.answers or {},
        recommendations=row.recommendations,
        child_activity=child_activity,
    )


# ---------------------------------------------------------------------------
# Preferences endpoints
# ---------------------------------------------------------------------------

@router.get("/user/preferences", response_model=UserPreferences)
def get_preferences(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.get(UserPreferencesRecord, user.id)
    return _preferences_to_schema(row) if row else UserPreferences()


@router.patch("/user/preferences", response_model=UserPreferences)
def patch_preferences(
    body: UserPreferences,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.get(UserPreferencesRecord, user.id)
    if not row:
        row = UserPreferencesRecord(user_id=user.id)
        db.add(row)
    row.tts_enabled = body.tts_enabled
    db.commit()
    db.refresh(row)
    return _preferences_to_schema(row)


# ---------------------------------------------------------------------------
# Onboarding endpoints
# ---------------------------------------------------------------------------

@router.get("/user/onboarding", response_model=OnboardingState)
def get_onboarding(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ob = db.get(UserOnboardingRecord, user.id)
    per = db.get(UserPersonalityRecord, user.id)
    jrn = db.get(UserJourneyRecord, user.id)
    return _onboarding_to_schema(ob, per, jrn)


@router.patch("/user/onboarding", response_model=OnboardingState)
def patch_onboarding(
    body: OnboardingPatch,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ob = db.get(UserOnboardingRecord, user.id)

    if body.phase is not None or body.child_data is not None or body.clear_child_data:
        if not ob:
            ob = UserOnboardingRecord(user_id=user.id)
            db.add(ob)
        if body.phase is not None:
            ob.phase = body.phase
        if body.clear_child_data:
            ob.child_name = ob.child_age = ob.child_school = None
            ob.child_strengths = ob.child_hobbies = None
            ob.child_thinking_pattern = ob.child_communication_style = None
            ob.child_energy_level = ob.child_social_behaviour = ob.child_emotional_behaviour = None
        elif body.child_data is not None:
            cd = body.child_data
            ob.child_name = cd.name or None
            ob.child_age = cd.age or None
            ob.child_school = cd.school or None
            ob.child_strengths = cd.strengths or None
            ob.child_hobbies = cd.hobbies or None
            ob.child_thinking_pattern = cd.thinking_pattern or None
            ob.child_communication_style = cd.communication_style or None
            ob.child_energy_level = cd.energy_level or None
            ob.child_social_behaviour = cd.social_behaviour or None
            ob.child_emotional_behaviour = cd.emotional_behaviour or None

    per = db.get(UserPersonalityRecord, user.id)
    if body.clear_personality:
        if per:
            db.delete(per)
            per = None
    elif body.personality is not None:
        vm = body.personality.view_model
        prof = vm.profile
        if not per:
            per = UserPersonalityRecord(user_id=user.id)
            db.add(per)
        per.source = body.personality.source
        per.personality_type = vm.type
        per.profile_name = prof.name
        per.category = prof.category
        per.description = prof.description
        per.color = prof.color
        per.scores = vm.scores
        per.traits = prof.traits
        per.strengths = prof.strengths
        per.growth_areas = prof.growth_areas
        per.famous_people = [fp.model_dump() for fp in prof.famous_people]

    jrn = db.get(UserJourneyRecord, user.id)
    if body.clear_recommendations:
        if jrn:
            db.delete(jrn)
            jrn = None
    elif body.recommendations is not None:
        rec = body.recommendations
        if not jrn:
            jrn = UserJourneyRecord(user_id=user.id)
            db.add(jrn)
        jrn.overview = rec.pathway_overview
        jrn.focus_areas = [fa.model_dump() for fa in rec.focus_areas]
        jrn.initial_missions = [im.model_dump() for im in rec.initial_missions]

    db.commit()
    if ob:
        db.refresh(ob)
    if per:
        db.refresh(per)
    if jrn:
        db.refresh(jrn)
    return _onboarding_to_schema(ob, per, jrn)


# ---------------------------------------------------------------------------
# Recommendations progress endpoints
# ---------------------------------------------------------------------------

@router.get("/user/recommendations-progress", response_model=RecommendationsProgress)
def get_recommendations_progress(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.get(UserRecommendationsProgressRecord, user.id)
    if not row or not row.progress:
        return RecommendationsProgress()
    return RecommendationsProgress.model_validate(row.progress)


@router.patch("/user/recommendations-progress", response_model=RecommendationsProgress)
def patch_recommendations_progress(
    body: RecommendationsProgress,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.get(UserRecommendationsProgressRecord, user.id)
    if not row:
        row = UserRecommendationsProgressRecord(user_id=user.id)
        db.add(row)
    row.progress = body.model_dump()
    db.commit()
    db.refresh(row)
    return RecommendationsProgress.model_validate(row.progress)


# ---------------------------------------------------------------------------
# Completed growth areas endpoints
# ---------------------------------------------------------------------------

@router.get("/user/completed-growth-areas", response_model=CompletedGrowthAreasResponse)
def list_completed_growth_areas(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.execute(
        select(CompletedGrowthAreaRecord)
        .where(CompletedGrowthAreaRecord.user_id == user.id)
        .order_by(CompletedGrowthAreaRecord.created_at)
    ).scalars().all()
    return CompletedGrowthAreasResponse(areas=[_completed_area_row_to_schema(r) for r in rows])


@router.post("/user/completed-growth-areas", response_model=CompletedGrowthAreasResponse)
def append_completed_growth_area(
    body: AppendGrowthAreaRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ca = body.child_activity
    insert_values = {
        "id": str(uuid.uuid4()),
        "user_id": user.id,
        "area_id": body.area_id,
        "area_name": body.area_name,
        "area_color": body.area_color,
        "answers": body.answers,
        "recommendations": body.recommendations,
        "child_selections": ca.selections if ca else [],
        "child_summary": ca.results.summary if (ca and ca.results) else None,
        "child_strengths": ca.results.strengths if (ca and ca.results) else [],
        "child_suggested": ca.results.suggested_activities if (ca and ca.results) else [],
    }
    update_values = {k: v for k, v in insert_values.items() if k not in ("id", "user_id", "area_id")}
    update_values["updated_at"] = func.now()
    stmt = (
        _upsert_insert(CompletedGrowthAreaRecord)
        .values(**insert_values)
        .on_conflict_do_update(
            index_elements=["user_id", "area_id"],
            set_=update_values,
        )
    )
    db.execute(stmt)
    db.commit()

    rows = db.execute(
        select(CompletedGrowthAreaRecord)
        .where(CompletedGrowthAreaRecord.user_id == user.id)
        .order_by(CompletedGrowthAreaRecord.created_at)
    ).scalars().all()
    return CompletedGrowthAreasResponse(areas=[_completed_area_row_to_schema(r) for r in rows])


@router.delete("/user/completed-growth-areas", status_code=204)
def clear_completed_growth_areas(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.execute(
        delete(CompletedGrowthAreaRecord).where(CompletedGrowthAreaRecord.user_id == user.id)
    )
    db.commit()


# ---------------------------------------------------------------------------
# Goals endpoints
# ---------------------------------------------------------------------------

@router.get("/user/goals", response_model=UserGoals)
def get_goals(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.get(UserGoalsRecord, user.id)
    if not row:
        return UserGoals()
    plan = GoalsPlan.model_validate(row.goals_plan) if row.goals_plan else None
    return UserGoals(parent_concern=row.parent_concern, plan=plan)


@router.patch("/user/goals", response_model=UserGoals)
def patch_goals(
    body: UserGoalsPatch,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.get(UserGoalsRecord, user.id)
    if not row:
        row = UserGoalsRecord(user_id=user.id)
        db.add(row)
    if body.clear_concern:
        row.parent_concern = None
    elif body.parent_concern is not None:
        row.parent_concern = body.parent_concern
    if body.clear_plan:
        row.goals_plan = None
    elif body.plan is not None:
        row.goals_plan = body.plan.model_dump()
    db.commit()
    db.refresh(row)
    plan = GoalsPlan.model_validate(row.goals_plan) if row.goals_plan else None
    return UserGoals(parent_concern=row.parent_concern, plan=plan)


# ---------------------------------------------------------------------------
# Children endpoints
# ---------------------------------------------------------------------------

def _child_to_api(row: ChildRecord) -> dict:
    base = dict(row.payload or {})
    base["id"] = row.id
    base["created_date"] = row.created_at.isoformat()
    return base


@router.get("/children", response_model=list[ChildResponse])
def list_children(
    sort: Literal["created_date", "-created_date"] | None = Query(default="-created_date"),
    limit: int | None = Query(None, ge=1, le=200),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    order = ChildRecord.created_at.desc() if (sort or "").startswith("-") else ChildRecord.created_at.asc()
    q = select(ChildRecord).where(ChildRecord.user_id == user.id).order_by(order)
    if limit is not None:
        q = q.limit(limit)
    rows = db.execute(q).scalars().all()
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
# Growth missions endpoints
# ---------------------------------------------------------------------------

def _mission_to_api(row: GrowthMissionRecord) -> dict:
    base = dict(row.payload or {})
    base["id"] = row.id
    base["child_id"] = row.child_id
    base["created_date"] = row.created_at.isoformat()
    return base


@router.get("/growth-missions", response_model=list[GrowthMissionResponse])
def list_missions(
    child_id: str | None = None,
    sort: Literal["created_date", "-created_date"] | None = Query(default="-created_date"),
    limit: int | None = Query(None, ge=1, le=200),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not child_id:
        return []
    child = db.get(ChildRecord, child_id)
    if not child or child.user_id != user.id:
        raise HTTPException(status_code=404, detail="Child not found")
    order = GrowthMissionRecord.created_at.desc() if (sort or "").startswith("-") else GrowthMissionRecord.created_at.asc()
    q = select(GrowthMissionRecord).where(GrowthMissionRecord.child_id == child_id).order_by(order)
    if limit is not None:
        q = q.limit(limit)
    rows = db.execute(q).scalars().all()
    return [_mission_to_api(r) for r in rows]


@router.post("/growth-missions", response_model=GrowthMissionResponse)
@limiter.limit("30/minute")
def create_mission(request: Request, payload: GrowthMissionCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    cid = payload.child_id
    child = db.get(ChildRecord, cid) if cid else None
    if not child or child.user_id != user.id:
        raise HTTPException(status_code=404, detail="Invalid child")
    body = payload.model_dump(exclude_none=True)
    body.pop("id", None)
    body.pop("created_date", None)
    body.pop("child_id", None)
    body.pop("user_id", None)
    row = GrowthMissionRecord(child_id=cid, payload=body)
    db.add(row)
    db.commit()
    db.refresh(row)
    return _mission_to_api(row)


@router.post("/growth-missions/bulk", response_model=list[GrowthMissionResponse])
@limiter.limit("10/minute")
def bulk_missions(request: Request, body: BulkMissionBody, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    out = []
    for payload in body.items:
        cid = payload.child_id
        child = db.get(ChildRecord, cid) if cid else None
        if not child or child.user_id != user.id:
            raise HTTPException(status_code=400, detail="Invalid or unauthorized child_id")
        sub = payload.model_dump(exclude_none=True)
        sub.pop("id", None)
        sub.pop("created_date", None)
        sub.pop("child_id", None)
        sub.pop("user_id", None)
        row = GrowthMissionRecord(child_id=cid, payload=sub)
        db.add(row)
        out.append(row)
    db.commit()
    for r in out:
        db.refresh(r)
    return [_mission_to_api(r) for r in out]


@router.get("/growth-missions/{mission_id}", response_model=GrowthMissionResponse)
def get_mission(mission_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.execute(
        select(GrowthMissionRecord)
        .join(ChildRecord, GrowthMissionRecord.child_id == ChildRecord.id)
        .where(GrowthMissionRecord.id == mission_id, ChildRecord.user_id == user.id)
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Mission not found")
    return _mission_to_api(row)


@router.patch("/growth-missions/{mission_id}", response_model=GrowthMissionResponse)
def update_mission(
    mission_id: str,
    patch: GrowthMissionPatch,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.execute(
        select(GrowthMissionRecord)
        .join(ChildRecord, GrowthMissionRecord.child_id == ChildRecord.id)
        .where(GrowthMissionRecord.id == mission_id, ChildRecord.user_id == user.id)
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Mission not found")
    data = dict(row.payload or {})
    for k, v in patch.model_dump(exclude_unset=True).items():
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


# ---------------------------------------------------------------------------
# Parent insights endpoints
# ---------------------------------------------------------------------------

def _insight_to_api(row: ParentInsightRecord) -> dict:
    base = dict(row.payload or {})
    base["id"] = row.id
    base["child_id"] = row.child_id
    base["is_read"] = row.is_read
    base["created_date"] = row.created_at.isoformat()
    return base


@router.get("/parent-insights", response_model=list[ParentInsightResponse])
def list_insights(
    child_id: str | None = None,
    is_read: str | None = None,
    sort: Literal["created_date", "-created_date"] | None = Query(default="-created_date"),
    limit: int | None = Query(None, ge=1, le=200),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not child_id:
        return []
    child = db.get(ChildRecord, child_id)
    if not child or child.user_id != user.id:
        raise HTTPException(status_code=404, detail="Child not found")
    order = ParentInsightRecord.created_at.desc() if (sort or "").startswith("-") else ParentInsightRecord.created_at.asc()
    q = select(ParentInsightRecord).where(ParentInsightRecord.child_id == child_id)
    if is_read is not None:
        v = is_read.strip().lower()
        if v in ("true", "1", "yes"):
            q = q.where(ParentInsightRecord.is_read.is_(True))
        elif v in ("false", "0", "no"):
            q = q.where(ParentInsightRecord.is_read.is_(False))
    q = q.order_by(order)
    if limit is not None:
        q = q.limit(limit)
    rows = db.execute(q).scalars().all()
    return [_insight_to_api(r) for r in rows]


@router.post("/parent-insights", response_model=ParentInsightResponse)
def create_insight(payload: ParentInsightCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    cid = payload.child_id
    child = db.get(ChildRecord, cid) if cid else None
    if not child or child.user_id != user.id:
        raise HTTPException(status_code=404, detail="Child not found")
    body = payload.model_dump(exclude_none=True)
    body.pop("id", None)
    body.pop("created_date", None)
    body.pop("is_read", None)
    body.pop("child_id", None)
    body.pop("user_id", None)
    row = ParentInsightRecord(child_id=cid, is_read=False, payload=body)
    db.add(row)
    db.commit()
    db.refresh(row)
    return _insight_to_api(row)


@router.patch("/parent-insights/{insight_id}", response_model=ParentInsightResponse)
def update_insight(
    insight_id: str,
    body: UpdateInsightBody,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.execute(
        select(ParentInsightRecord)
        .join(ChildRecord, ParentInsightRecord.child_id == ChildRecord.id)
        .where(ParentInsightRecord.id == insight_id, ChildRecord.user_id == user.id)
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Insight not found")
    row.is_read = body.is_read
    db.commit()
    db.refresh(row)
    return _insight_to_api(row)


@router.delete("/parent-insights/{insight_id}", status_code=204)
def delete_insight(insight_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.execute(
        select(ParentInsightRecord)
        .join(ChildRecord, ParentInsightRecord.child_id == ChildRecord.id)
        .where(ParentInsightRecord.id == insight_id, ChildRecord.user_id == user.id)
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Insight not found")
    db.delete(row)
    db.commit()


# ---------------------------------------------------------------------------
# Reflections endpoints
# ---------------------------------------------------------------------------

def _reflection_to_api(row: ReflectionRecord) -> dict:
    base = dict(row.payload or {})
    base["id"] = row.id
    base["child_id"] = row.child_id
    base["created_date"] = row.created_at.isoformat()
    return base


@router.get("/reflections", response_model=list[ReflectionResponse])
def list_reflections(
    child_id: str | None = None,
    sort: Literal["created_date", "-created_date"] | None = Query(default="-created_date"),
    limit: int | None = Query(None, ge=1, le=200),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not child_id:
        return []
    child = db.get(ChildRecord, child_id)
    if not child or child.user_id != user.id:
        raise HTTPException(status_code=404, detail="Child not found")
    order = ReflectionRecord.created_at.desc() if (sort or "").startswith("-") else ReflectionRecord.created_at.asc()
    q = select(ReflectionRecord).where(ReflectionRecord.child_id == child_id).order_by(order)
    if limit is not None:
        q = q.limit(limit)
    rows = db.execute(q).scalars().all()
    return [_reflection_to_api(r) for r in rows]


@router.post("/reflections", response_model=ReflectionResponse)
def create_reflection(payload: ReflectionCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    cid = payload.child_id
    child = db.get(ChildRecord, cid) if cid else None
    if not child or child.user_id != user.id:
        raise HTTPException(status_code=404, detail="Child not found")
    body = payload.model_dump(exclude_none=True)
    body.pop("id", None)
    body.pop("created_date", None)
    body.pop("child_id", None)
    body.pop("user_id", None)
    row = ReflectionRecord(child_id=cid, payload=body)
    db.add(row)
    db.commit()
    db.refresh(row)
    return _reflection_to_api(row)


@router.delete("/reflections/{reflection_id}", status_code=204)
def delete_reflection(reflection_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.execute(
        select(ReflectionRecord)
        .join(ChildRecord, ReflectionRecord.child_id == ChildRecord.id)
        .where(ReflectionRecord.id == reflection_id, ChildRecord.user_id == user.id)
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Reflection not found")
    db.delete(row)
    db.commit()
