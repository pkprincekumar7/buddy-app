import logging
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from motor.motor_asyncio import AsyncIOMotorDatabase

from app import models
from app.database import get_db
from app.deps import get_current_user
from app.limiter import user_limiter
from app.models_api import (
    AppendGrowthAreaRequest,
    ChildActivity,
    CompletedGrowthArea,
    CompletedGrowthAreasResponse,
    GoalsPlan,
    UserGoals,
    UserGoalsPatch,
    UserPreferences,
    UserPreferencesPatch,
)

router = APIRouter(tags=["users"])
log = logging.getLogger(__name__)

# Hard cap on growth-area documents returned in a single response.
# Exceeding this is extremely unlikely in practice but logged so it's visible.
_GROWTH_AREAS_MAX = 500

# Optional fields in AppendGrowthAreaRequest that must only be written when
# explicitly set by the caller — prevents silently null-overwriting existing data.
_GROWTH_AREA_OPTIONAL_FIELDS = (
    "recommendations",
    "status",
    "step",
    "selected_activity",
    "parent_liked",
    "want_child_activity",
    "feedback",
    "interactive_step",
    "interactive_answers",
    "interactive_draft",
    "generated_activity",
    "show_game",
    "child_activity_selections",
    "ai_three_month_recommendations",
)


async def _require_child(db: AsyncIOMotorDatabase, child_id: str, user: dict) -> None:
    """Raise 404 if child_id does not belong to the authenticated user."""
    child = await db[models.CHILDREN].find_one(
        {"_id": child_id, "user_id": user["_id"], "location": user["location"]}
    )
    if not child:
        raise HTTPException(status_code=404, detail="Child not found")


# ---------------------------------------------------------------------------
# Document → schema helpers
# ---------------------------------------------------------------------------


def _doc_to_preferences(user: dict) -> UserPreferences:
    prefs = user.get("preferences") or {}
    return UserPreferences(
        tts_enabled=prefs.get("tts_enabled", True),
        dark_mode=prefs.get("dark_mode", True),
        last_visited_path=prefs.get("last_visited_path"),
    )


def _doc_to_growth_area(doc: dict) -> CompletedGrowthArea:
    ca_data = doc.get("child_activity")
    child_activity = ChildActivity.model_validate(ca_data) if ca_data else None
    return CompletedGrowthArea(
        area_id=doc["area_id"],
        area_name=doc["area_name"],
        area_color=doc["area_color"],
        answers=doc.get("answers") or {},
        recommendations=doc.get("recommendations"),
        child_activity=child_activity,
        status=doc.get("status"),
        step=doc.get("step"),
        selected_activity=doc.get("selected_activity"),
        parent_liked=doc.get("parent_liked"),
        want_child_activity=doc.get("want_child_activity"),
        feedback=doc.get("feedback"),
        interactive_step=doc.get("interactive_step"),
        interactive_answers=doc.get("interactive_answers"),
        interactive_draft=doc.get("interactive_draft"),
        generated_activity=doc.get("generated_activity"),
        show_game=doc.get("show_game"),
        child_activity_selections=doc.get("child_activity_selections"),
        ai_three_month_recommendations=doc.get("ai_three_month_recommendations"),
        pending_recommendations=doc.get("pending_recommendations"),
        pending_child_activity=doc.get("pending_child_activity"),
    )


# ---------------------------------------------------------------------------
# Preferences
# ---------------------------------------------------------------------------


@router.get(
    "/user/preferences",
    response_model=UserPreferences,
    description="Retrieve the authenticated user's app preferences.",
)
@user_limiter.limit("60/minute")
async def get_preferences(
    request: Request,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    return _doc_to_preferences(user)


@router.patch(
    "/user/preferences",
    response_model=UserPreferences,
    description="Update one or more of the authenticated user's app preferences.",
)
@user_limiter.limit("30/minute")
async def patch_preferences(
    request: Request,
    body: UserPreferencesPatch,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    set_fields: dict = {"updated_at": datetime.now(UTC)}
    if "tts_enabled" in body.model_fields_set:
        set_fields["preferences.tts_enabled"] = body.tts_enabled
    if "dark_mode" in body.model_fields_set:
        set_fields["preferences.dark_mode"] = body.dark_mode
    if "last_visited_path" in body.model_fields_set:
        set_fields["preferences.last_visited_path"] = body.last_visited_path

    updated = await db[models.USERS].find_one_and_update(
        {"_id": user["_id"], "location": user["location"]},
        {"$set": set_fields},
        return_document=True,
    )
    return _doc_to_preferences(updated or user)


# ---------------------------------------------------------------------------
# Completed growth areas
# ---------------------------------------------------------------------------


@router.get(
    "/user/completed-growth-areas",
    response_model=CompletedGrowthAreasResponse,
    description="List completed growth areas for a given child, with pagination.",
)
@user_limiter.limit("60/minute")
async def list_completed_growth_areas(
    request: Request,
    child_id: str = Query(..., min_length=1, max_length=100),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    await _require_child(db, child_id, user)
    docs = await (
        db[models.GROWTH_AREAS]
        .find({"user_id": user["_id"], "child_id": child_id, "location": user["location"]})
        .sort("created_at", 1)
        .skip(offset)
        .to_list(limit)
    )
    return CompletedGrowthAreasResponse(areas=[_doc_to_growth_area(d) for d in docs])


@router.post(
    "/user/completed-growth-areas",
    response_model=CompletedGrowthAreasResponse,
    description="Record a growth area as completed for a given child.",
)
@user_limiter.limit("60/minute")
async def append_completed_growth_area(
    request: Request,
    body: AppendGrowthAreaRequest,
    child_id: str = Query(..., min_length=1, max_length=100),
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    await _require_child(db, child_id, user)
    now = datetime.now(UTC)
    # Always write the required fields (area_name, area_color, answers).
    set_fields: dict = {
        "area_name": body.area_name,
        "area_color": body.area_color,
        "answers": body.answers,
        "updated_at": now,
    }
    # Only write optional fields when explicitly included in the request — avoids
    # silently overwriting existing data with null when the caller omits the field.
    for field in _GROWTH_AREA_OPTIONAL_FIELDS:
        if field in body.model_fields_set:
            set_fields[field] = getattr(body, field)
    # child_activity is a nested model — only write when explicitly provided.
    if body.child_activity is not None:
        set_fields["child_activity"] = body.child_activity.model_dump()
    # user_id, child_id, area_id, location are equality conditions in the filter.
    set_on_insert: dict = {"_id": str(uuid.uuid4()), "created_at": now}
    await db[models.GROWTH_AREAS].update_one(
        {
            "user_id": user["_id"],
            "child_id": child_id,
            "area_id": body.area_id,
            "location": user["location"],
        },
        {"$set": set_fields, "$setOnInsert": set_on_insert},
        upsert=True,
    )
    docs = await (
        db[models.GROWTH_AREAS]
        .find({"user_id": user["_id"], "child_id": child_id, "location": user["location"]})
        .sort("created_at", 1)
        .to_list(_GROWTH_AREAS_MAX)
    )
    if len(docs) == _GROWTH_AREAS_MAX:
        log.warning(
            "append_completed_growth_area: hit _GROWTH_AREAS_MAX cap (%d) for user=%s child=%s",
            _GROWTH_AREAS_MAX,
            user["_id"],
            child_id,
        )
    return CompletedGrowthAreasResponse(areas=[_doc_to_growth_area(d) for d in docs])


@router.delete(
    "/user/completed-growth-areas",
    status_code=204,
    description="Clear all completed growth areas for a given child.",
)
@user_limiter.limit("10/minute")
async def clear_completed_growth_areas(
    request: Request,
    child_id: str = Query(..., min_length=1, max_length=100),
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    await _require_child(db, child_id, user)
    await db[models.GROWTH_AREAS].delete_many(
        {"user_id": user["_id"], "child_id": child_id, "location": user["location"]}
    )


# ---------------------------------------------------------------------------
# Goals
# ---------------------------------------------------------------------------


@router.get(
    "/user/goals",
    response_model=UserGoals,
    description="Retrieve the goals plan for a given child.",
)
@user_limiter.limit("60/minute")
async def get_goals(
    request: Request,
    child_id: str = Query(..., min_length=1, max_length=100),
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    await _require_child(db, child_id, user)
    doc = await db[models.GOALS].find_one(
        {"_id": child_id, "user_id": user["_id"], "location": user["location"]}
    )
    if not doc:
        return UserGoals()
    plan = GoalsPlan.model_validate(doc["goals_plan"]) if doc.get("goals_plan") else None
    return UserGoals(parent_concern=doc.get("parent_concern"), plan=plan)


@router.patch(
    "/user/goals",
    response_model=UserGoals,
    description="Update the parent concern or goals plan for a given child.",
)
@user_limiter.limit("20/minute")
async def patch_goals(
    request: Request,
    body: UserGoalsPatch,
    child_id: str = Query(..., min_length=1, max_length=100),
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    await _require_child(db, child_id, user)
    now = datetime.now(UTC)
    set_fields: dict = {"updated_at": now}
    set_on_insert: dict = {"created_at": now, "user_id": user["_id"]}

    if body.clear_concern:
        set_fields["parent_concern"] = None
    elif body.parent_concern is not None:
        set_fields["parent_concern"] = body.parent_concern

    if body.clear_plan:
        set_fields["goals_plan"] = None
    elif body.plan is not None:
        set_fields["goals_plan"] = body.plan.model_dump()

    doc = await db[models.GOALS].find_one_and_update(
        {"_id": child_id, "user_id": user["_id"], "location": user["location"]},
        {"$set": set_fields, "$setOnInsert": set_on_insert},
        upsert=True,
        return_document=True,
    )
    plan = GoalsPlan.model_validate(doc["goals_plan"]) if doc and doc.get("goals_plan") else None
    return UserGoals(parent_concern=doc.get("parent_concern") if doc else None, plan=plan)
