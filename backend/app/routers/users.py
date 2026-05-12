import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query, Request
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.database import get_db
from app.deps import get_current_user
from app.limiter import user_limiter
from app import models
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
# Document → schema helpers
# ---------------------------------------------------------------------------

def _doc_to_preferences(user: dict) -> UserPreferences:
    prefs = user.get("preferences") or {}
    return UserPreferences(
        tts_enabled=prefs.get("tts_enabled", True),
        last_visited_path=prefs.get("last_visited_path"),
    )


def _doc_to_personality(data: dict | None) -> PersonalityAnalysis | None:
    if not data:
        return None
    vm_data = data.get("view_model") or {}
    prof_data = vm_data.get("profile") or {}
    profile = PersonalityProfile(
        name=prof_data.get("name", ""),
        category=prof_data.get("category", ""),
        description=prof_data.get("description", ""),
        color=prof_data.get("color", ""),
        traits=prof_data.get("traits") or [],
        strengths=prof_data.get("strengths") or [],
        growth_areas=prof_data.get("growth_areas") or [],
        famous_people=[
            FamousPerson(**p) for p in (prof_data.get("famous_people") or [])
            if isinstance(p, dict) and p.get("name")
        ],
    )
    vm = PersonalityViewModel(
        type=vm_data.get("type", ""),
        scores=vm_data.get("scores") or {},
        profile=profile,
    )
    return PersonalityAnalysis(source=data.get("source", ""), view_model=vm)


def _doc_to_journey(data: dict | None) -> JourneyRecommendations | None:
    if not data:
        return None
    return JourneyRecommendations(
        pathway_overview=data.get("pathway_overview", ""),
        focus_areas=[FocusArea(**fa) for fa in (data.get("focus_areas") or []) if isinstance(fa, dict)],
        initial_missions=[InitialMission(**im) for im in (data.get("initial_missions") or []) if isinstance(im, dict)],
    )


def _doc_to_onboarding(doc: dict | None) -> OnboardingState:
    if not doc:
        return OnboardingState()
    child_data: OnboardingChildData | None = None
    if doc.get("phase", 0) > 0:
        child_data = OnboardingChildData(
            name=doc.get("child_name") or "",
            age=doc.get("child_age") or "",
            school=doc.get("child_school") or "",
            strengths=doc.get("child_strengths") or [],
            hobbies=doc.get("child_hobbies") or [],
            thinking_pattern=doc.get("child_thinking_pattern") or "",
            communication_style=doc.get("child_communication_style") or "",
            energy_level=doc.get("child_energy_level") or "",
            social_behaviour=doc.get("child_social_behaviour") or "",
            emotional_behaviour=doc.get("child_emotional_behaviour") or "",
        )
    return OnboardingState(
        phase=doc.get("phase", 0),
        child_data=child_data,
        personality=_doc_to_personality(doc.get("personality")),
        recommendations=_doc_to_journey(doc.get("journey")),
    )


def _doc_to_growth_area(doc: dict) -> CompletedGrowthArea:
    child_activity: ChildActivity | None = None
    has_activity = (
        doc.get("child_selections") or doc.get("child_summary")
        or doc.get("child_strengths") or doc.get("child_suggested")
    )
    if has_activity:
        results: ChildActivityResults | None = None
        if doc.get("child_summary") or doc.get("child_strengths") or doc.get("child_suggested"):
            results = ChildActivityResults(
                summary=doc.get("child_summary") or "",
                strengths=doc.get("child_strengths") or [],
                suggested_activities=doc.get("child_suggested") or [],
            )
        child_activity = ChildActivity(
            selections=doc.get("child_selections") or [],
            results=results,
        )
    return CompletedGrowthArea(
        area_id=doc["area_id"],
        area_name=doc["area_name"],
        area_color=doc["area_color"],
        answers=doc.get("answers") or {},
        recommendations=doc.get("recommendations"),
        child_activity=child_activity,
    )


# ---------------------------------------------------------------------------
# Preferences
# ---------------------------------------------------------------------------

@router.get("/user/preferences", response_model=UserPreferences)
@user_limiter.limit("60/minute")
async def get_preferences(
    request: Request,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    return _doc_to_preferences(user)


@router.patch("/user/preferences", response_model=UserPreferences)
@user_limiter.limit("30/minute")
async def patch_preferences(
    request: Request,
    body: UserPreferencesPatch,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    set_fields: dict = {"updated_at": datetime.now(timezone.utc)}
    if "tts_enabled" in body.model_fields_set:
        set_fields["preferences.tts_enabled"] = body.tts_enabled
    if "last_visited_path" in body.model_fields_set:
        set_fields["preferences.last_visited_path"] = body.last_visited_path

    updated = await db[models.USERS].find_one_and_update(
        {"_id": user["_id"], "location": user["location"]},
        {"$set": set_fields},
        return_document=True,
    )
    return _doc_to_preferences(updated or user)


# ---------------------------------------------------------------------------
# Onboarding
# ---------------------------------------------------------------------------

@router.get("/user/onboarding", response_model=OnboardingState)
@user_limiter.limit("60/minute")
async def get_onboarding(
    request: Request,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    doc = await db[models.ONBOARDING].find_one({"_id": user["_id"], "location": user["location"]})
    return _doc_to_onboarding(doc)


@router.patch("/user/onboarding", response_model=OnboardingState)
@user_limiter.limit("20/minute")
async def patch_onboarding(
    request: Request,
    body: OnboardingPatch,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    set_fields: dict = {"updated_at": now}
    # _id and location are equality conditions in the filter; MongoDB sets them
    # automatically on insert, so they are omitted from $setOnInsert.
    set_on_insert: dict = {"created_at": now}

    if body.phase is not None:
        set_fields["phase"] = body.phase

    if body.clear_child_data:
        for f in [
            "child_name", "child_age", "child_school", "child_strengths", "child_hobbies",
            "child_thinking_pattern", "child_communication_style", "child_energy_level",
            "child_social_behaviour", "child_emotional_behaviour",
        ]:
            set_fields[f] = None
    elif body.child_data is not None:
        cd = body.child_data
        set_fields.update({
            "child_name": cd.name or None,
            "child_age": cd.age or None,
            "child_school": cd.school or None,
            "child_strengths": cd.strengths or None,
            "child_hobbies": cd.hobbies or None,
            "child_thinking_pattern": cd.thinking_pattern or None,
            "child_communication_style": cd.communication_style or None,
            "child_energy_level": cd.energy_level or None,
            "child_social_behaviour": cd.social_behaviour or None,
            "child_emotional_behaviour": cd.emotional_behaviour or None,
        })

    if body.clear_personality:
        set_fields["personality"] = None
    elif body.personality is not None:
        set_fields["personality"] = body.personality.model_dump()

    if body.clear_recommendations:
        set_fields["journey"] = None
    elif body.recommendations is not None:
        set_fields["journey"] = body.recommendations.model_dump()

    doc = await db[models.ONBOARDING].find_one_and_update(
        {"_id": user["_id"], "location": user["location"]},
        {"$set": set_fields, "$setOnInsert": set_on_insert},
        upsert=True,
        return_document=True,
    )
    return _doc_to_onboarding(doc)


# ---------------------------------------------------------------------------
# Recommendations progress
# ---------------------------------------------------------------------------

@router.get("/user/recommendations-progress", response_model=RecommendationsProgress)
@user_limiter.limit("60/minute")
async def get_recommendations_progress(
    request: Request,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    doc = await db[models.RECOMMENDATIONS].find_one({"_id": user["_id"], "location": user["location"]})
    if not doc or not doc.get("progress"):
        return RecommendationsProgress()
    return RecommendationsProgress.model_validate(doc["progress"])


@router.patch("/user/recommendations-progress", response_model=RecommendationsProgress)
@user_limiter.limit("30/minute")
async def patch_recommendations_progress(
    request: Request,
    body: RecommendationsProgress,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    progress_dict = body.model_dump()
    set_fields: dict = {
        "progress": progress_dict,
        "step": str(progress_dict.get("step") or "intro"),
        "current_area_index": int(progress_dict.get("current_area_index") or 0),
        "updated_at": now,
    }
    set_on_insert: dict = {"created_at": now}
    doc = await db[models.RECOMMENDATIONS].find_one_and_update(
        {"_id": user["_id"], "location": user["location"]},
        {"$set": set_fields, "$setOnInsert": set_on_insert},
        upsert=True,
        return_document=True,
    )
    return RecommendationsProgress.model_validate(doc["progress"]) if doc and doc.get("progress") else body


# ---------------------------------------------------------------------------
# Completed growth areas
# ---------------------------------------------------------------------------

@router.get("/user/completed-growth-areas", response_model=CompletedGrowthAreasResponse)
@user_limiter.limit("60/minute")
async def list_completed_growth_areas(
    request: Request,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    docs = await (
        db[models.GROWTH_AREAS]
        .find({"user_id": user["_id"], "location": user["location"]})
        .sort("created_at", 1)
        .skip(offset)
        .to_list(limit)
    )
    return CompletedGrowthAreasResponse(areas=[_doc_to_growth_area(d) for d in docs])


@router.post("/user/completed-growth-areas", response_model=CompletedGrowthAreasResponse)
@user_limiter.limit("20/minute")
async def append_completed_growth_area(
    request: Request,
    body: AppendGrowthAreaRequest,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    ca = body.child_activity
    set_fields: dict = {
        "area_name": body.area_name,
        "area_color": body.area_color,
        "answers": body.answers,
        "recommendations": body.recommendations,
        "child_selections": ca.selections if ca else [],
        "child_summary": ca.results.summary if (ca and ca.results) else None,
        "child_strengths": ca.results.strengths if (ca and ca.results) else [],
        "child_suggested": ca.results.suggested_activities if (ca and ca.results) else [],
        "updated_at": now,
    }
    # user_id, area_id, and location are equality conditions in the filter;
    # only _id and created_at need explicit $setOnInsert.
    set_on_insert: dict = {
        "_id": str(uuid.uuid4()),
        "created_at": now,
    }
    await db[models.GROWTH_AREAS].update_one(
        {"user_id": user["_id"], "area_id": body.area_id, "location": user["location"]},
        {"$set": set_fields, "$setOnInsert": set_on_insert},
        upsert=True,
    )
    docs = await (
        db[models.GROWTH_AREAS]
        .find({"user_id": user["_id"], "location": user["location"]})
        .sort("created_at", 1)
        .to_list(200)
    )
    return CompletedGrowthAreasResponse(areas=[_doc_to_growth_area(d) for d in docs])


@router.delete("/user/completed-growth-areas", status_code=204)
@user_limiter.limit("10/minute")
async def clear_completed_growth_areas(
    request: Request,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    await db[models.GROWTH_AREAS].delete_many({"user_id": user["_id"], "location": user["location"]})


# ---------------------------------------------------------------------------
# Goals
# ---------------------------------------------------------------------------

@router.get("/user/goals", response_model=UserGoals)
@user_limiter.limit("60/minute")
async def get_goals(
    request: Request,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    doc = await db[models.GOALS].find_one({"_id": user["_id"], "location": user["location"]})
    if not doc:
        return UserGoals()
    plan = GoalsPlan.model_validate(doc["goals_plan"]) if doc.get("goals_plan") else None
    return UserGoals(parent_concern=doc.get("parent_concern"), plan=plan)


@router.patch("/user/goals", response_model=UserGoals)
@user_limiter.limit("20/minute")
async def patch_goals(
    request: Request,
    body: UserGoalsPatch,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    set_fields: dict = {"updated_at": now}
    set_on_insert: dict = {"created_at": now}

    if body.clear_concern:
        set_fields["parent_concern"] = None
    elif body.parent_concern is not None:
        set_fields["parent_concern"] = body.parent_concern

    if body.clear_plan:
        set_fields["goals_plan"] = None
    elif body.plan is not None:
        set_fields["goals_plan"] = body.plan.model_dump()

    doc = await db[models.GOALS].find_one_and_update(
        {"_id": user["_id"], "location": user["location"]},
        {"$set": set_fields, "$setOnInsert": set_on_insert},
        upsert=True,
        return_document=True,
    )
    plan = GoalsPlan.model_validate(doc["goals_plan"]) if doc and doc.get("goals_plan") else None
    return UserGoals(parent_concern=doc.get("parent_concern") if doc else None, plan=plan)
