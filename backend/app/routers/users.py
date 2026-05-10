import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.database import get_db, get_upsert_insert
from app.deps import get_current_user
from app.limiter import user_limiter
from app.models import (
    CompletedGrowthAreaRecord,
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
    ChildActivity,
    ChildActivityResults,
    CompletedGrowthArea,
    CompletedGrowthAreasResponse,
    FamousPerson,
    FocusArea,
    GoalsPlan,
    InitialMission,
    JourneyRecommendations,
    OnboardingChildData,
    OnboardingPatch,
    OnboardingState,
    PersonalityAnalysis,
    PersonalityProfile,
    PersonalityViewModel,
    RecommendationsProgress,
    UserGoals,
    UserGoalsPatch,
    UserPreferences,
    UserPreferencesPatch,
)

router = APIRouter(tags=["users"])
log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# ORM ↔ schema helpers
# ---------------------------------------------------------------------------

def _preferences_to_schema(row: UserPreferencesRecord) -> UserPreferences:
    return UserPreferences(tts_enabled=row.tts_enabled, last_visited_path=row.last_visited_path)


def _personality_row_to_schema(row: UserPersonalityRecord) -> PersonalityAnalysis:
    profile = PersonalityProfile(
        name=row.profile_name or "",
        category=row.category or "",
        description=row.description or "",
        color=row.color or "",
        traits=row.traits or [],
        strengths=row.strengths or [],
        growth_areas=row.growth_areas or [],
        famous_people=[
            FamousPerson(**p) for p in (row.famous_people or [])
            if isinstance(p, dict) and p.get("name")
        ],
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
# Preferences
# ---------------------------------------------------------------------------

@router.get("/user/preferences", response_model=UserPreferences)
@user_limiter.limit("60/minute")
def get_preferences(request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.get(UserPreferencesRecord, user.id)
    return _preferences_to_schema(row) if row else UserPreferences()


@router.patch("/user/preferences", response_model=UserPreferences)
@user_limiter.limit("30/minute")
def patch_preferences(
    request: Request,
    body: UserPreferencesPatch,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.get(UserPreferencesRecord, user.id)
    if not row:
        row = UserPreferencesRecord(user_id=user.id)
        db.add(row)
    if 'tts_enabled' in body.model_fields_set:
        row.tts_enabled = body.tts_enabled
    if 'last_visited_path' in body.model_fields_set:
        row.last_visited_path = body.last_visited_path
    db.commit()
    db.refresh(row)
    return _preferences_to_schema(row)


# ---------------------------------------------------------------------------
# Onboarding
# ---------------------------------------------------------------------------

@router.get("/user/onboarding", response_model=OnboardingState)
@user_limiter.limit("60/minute")
def get_onboarding(request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ob = db.get(UserOnboardingRecord, user.id)
    per = db.get(UserPersonalityRecord, user.id)
    jrn = db.get(UserJourneyRecord, user.id)
    return _onboarding_to_schema(ob, per, jrn)


@router.patch("/user/onboarding", response_model=OnboardingState)
@user_limiter.limit("20/minute")
def patch_onboarding(
    request: Request,
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
# Recommendations progress
# ---------------------------------------------------------------------------

@router.get("/user/recommendations-progress", response_model=RecommendationsProgress)
@user_limiter.limit("60/minute")
def get_recommendations_progress(request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.get(UserRecommendationsProgressRecord, user.id)
    if not row or not row.progress:
        return RecommendationsProgress()
    return RecommendationsProgress.model_validate(row.progress)


@router.patch("/user/recommendations-progress", response_model=RecommendationsProgress)
@user_limiter.limit("30/minute")
# Full-replace semantics: the entire progress blob is overwritten.
# Callers must GET first, merge client-side, then send the complete object.
def patch_recommendations_progress(
    request: Request,
    body: RecommendationsProgress,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.get(UserRecommendationsProgressRecord, user.id)
    if not row:
        row = UserRecommendationsProgressRecord(user_id=user.id)
        db.add(row)
    progress_dict = body.model_dump()
    row.progress = progress_dict
    # Keep promoted columns in sync so analytics queries can filter by step
    # without scanning the JSON blob.
    if "step" in progress_dict:
        row.step = str(progress_dict["step"] or "intro")
    if "current_area_index" in progress_dict:
        row.current_area_index = int(progress_dict["current_area_index"] or 0)
    db.commit()
    db.refresh(row)
    return RecommendationsProgress.model_validate(row.progress)


# ---------------------------------------------------------------------------
# Completed growth areas
# ---------------------------------------------------------------------------

@router.get("/user/completed-growth-areas", response_model=CompletedGrowthAreasResponse)
@user_limiter.limit("60/minute")
def list_completed_growth_areas(
    request: Request,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = db.execute(
        select(CompletedGrowthAreaRecord)
        .where(CompletedGrowthAreaRecord.user_id == user.id)
        .order_by(CompletedGrowthAreaRecord.created_at)
        .limit(limit)
        .offset(offset)
    ).scalars().all()
    return CompletedGrowthAreasResponse(areas=[_completed_area_row_to_schema(r) for r in rows])


@router.post("/user/completed-growth-areas", response_model=CompletedGrowthAreasResponse)
@user_limiter.limit("20/minute")
def append_completed_growth_area(
    request: Request,
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
        get_upsert_insert(db)(CompletedGrowthAreaRecord)
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
        .limit(200)
    ).scalars().all()
    return CompletedGrowthAreasResponse(areas=[_completed_area_row_to_schema(r) for r in rows])


@router.delete("/user/completed-growth-areas", status_code=204)
@user_limiter.limit("10/minute")
def clear_completed_growth_areas(request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.execute(
        delete(CompletedGrowthAreaRecord).where(CompletedGrowthAreaRecord.user_id == user.id)
    )
    db.commit()


# ---------------------------------------------------------------------------
# Goals
# ---------------------------------------------------------------------------

@router.get("/user/goals", response_model=UserGoals)
@user_limiter.limit("60/minute")
def get_goals(request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.get(UserGoalsRecord, user.id)
    if not row:
        return UserGoals()
    plan = GoalsPlan.model_validate(row.goals_plan) if row.goals_plan else None
    return UserGoals(parent_concern=row.parent_concern, plan=plan)


@router.patch("/user/goals", response_model=UserGoals)
@user_limiter.limit("20/minute")
# Full-replace semantics for `plan`: when plan is provided it overwrites the entire goals_plan blob.
# Callers must GET first, merge client-side, then send the complete plan.
def patch_goals(
    request: Request,
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
