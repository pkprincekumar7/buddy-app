import logging
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from motor.motor_asyncio import AsyncIOMotorDatabase

from app import models
from app.database import get_db
from app.deps import get_current_parent, get_current_user
from app.limiter import user_limiter
from app.models_api import (
    AppendGrowthAreaRequest,
    ChildActivity,
    CompletedGrowthArea,
    CompletedGrowthAreasResponse,
    GoalInsightsPatch,
    GoalInsightsResponse,
    GoalMonthsPatch,
    GoalMonthsResponse,
    GoalsMonth,
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
        area_color=doc.get("area_color"),
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
    user: dict = Depends(get_current_parent),
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
    user: dict = Depends(get_current_parent),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    await _require_child(db, child_id, user)
    now = datetime.now(UTC)
    # Always write the required fields (area_name, answers).
    set_fields: dict = {
        "area_name": body.area_name,
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

    # When the area is finalised, remove all transient wizard and staging fields.
    # pending_* are written by job workers and committed into their canonical
    # counterparts (ai_three_month_recommendations, child_activity) by the client
    # before sending status=completed. interactive_* and step track in-progress
    # wizard state that has no meaning once the area is done. child_activity_selections
    # duplicates child_activity.selections and is no longer needed.
    unset_fields: dict = {}
    if body.status == "completed":
        unset_fields = {
            "pending_child_activity": "",
            "pending_recommendations": "",
            "child_activity_selections": "",
            "interactive_step": "",
            "interactive_answers": "",
            "interactive_draft": "",
            "step": "",
        }

    update_doc: dict = {"$set": set_fields, "$setOnInsert": set_on_insert}
    if unset_fields:
        update_doc["$unset"] = unset_fields

    await db[models.GROWTH_AREAS].update_one(
        {
            "user_id": user["_id"],
            "child_id": child_id,
            "area_id": body.area_id,
            "location": user["location"],
        },
        update_doc,
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
    user: dict = Depends(get_current_parent),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    await _require_child(db, child_id, user)
    await db[models.GROWTH_AREAS].delete_many(
        {"user_id": user["_id"], "child_id": child_id, "location": user["location"]}
    )


# ---------------------------------------------------------------------------
# Goals — base document (parent_concern only)
# ---------------------------------------------------------------------------


@router.get(
    "/user/goals",
    response_model=UserGoals,
    description="Retrieve the parent concern for a given child.",
)
@user_limiter.limit("60/minute")
async def get_goals(
    request: Request,
    child_id: str = Query(..., min_length=1, max_length=100),
    user: dict = Depends(get_current_parent),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    await _require_child(db, child_id, user)
    # goals uses child_id as _id — one document per child.
    doc = await db[models.GOALS].find_one(
        {"_id": child_id, "user_id": user["_id"], "location": user["location"]}
    )
    if not doc:
        return UserGoals()
    return UserGoals(
        parent_concern=doc.get("parent_concern"),
        goals_plan=doc.get("goals_plan"),
    )


@router.patch(
    "/user/goals",
    response_model=UserGoals,
    description="Update the parent concern for a given child.",
)
@user_limiter.limit("20/minute")
async def patch_goals(
    request: Request,
    body: UserGoalsPatch,
    child_id: str = Query(..., min_length=1, max_length=100),
    user: dict = Depends(get_current_parent),
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

    if body.clear_goals_plan:
        set_fields["goals_plan"] = None

    doc = await db[models.GOALS].find_one_and_update(
        {"_id": child_id, "user_id": user["_id"], "location": user["location"]},
        {"$set": set_fields, "$setOnInsert": set_on_insert},
        upsert=True,
        return_document=True,
    )
    return UserGoals(
        parent_concern=doc.get("parent_concern") if doc else None,
        goals_plan=doc.get("goals_plan") if doc else None,
    )


# ---------------------------------------------------------------------------
# Goal months — one document per month per child
# ---------------------------------------------------------------------------


def _month_doc_to_api(doc: dict) -> GoalsMonth:
    return GoalsMonth.model_validate({
        "month": doc["month"],
        "goal": doc.get("goal", ""),
        "objective": doc.get("objective", ""),
        "periods": doc.get("periods", []),
    })


@router.get(
    "/user/goal-months",
    response_model=GoalMonthsResponse,
    description="Retrieve all month plan documents for a given child.",
)
@user_limiter.limit("60/minute")
async def get_goal_months(
    request: Request,
    child_id: str = Query(..., min_length=1, max_length=100),
    user: dict = Depends(get_current_parent),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    await _require_child(db, child_id, user)
    docs = await (
        db[models.GOAL_MONTHS]
        .find({"child_id": child_id, "user_id": user["_id"], "location": user["location"]})
        .sort("month", 1)
        .to_list(12)
    )
    return GoalMonthsResponse(months=[_month_doc_to_api(d) for d in docs])


@router.patch(
    "/user/goal-months/{month_number}",
    status_code=204,
    description="Upsert a single month plan document for a given child.",
)
@user_limiter.limit("30/minute")
async def patch_goal_month_single(
    request: Request,
    month_number: int,
    body: GoalsMonth,
    child_id: str = Query(..., min_length=1, max_length=100),
    user: dict = Depends(get_current_parent),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    await _require_child(db, child_id, user)
    now = datetime.now(UTC)
    set_fields = {
        "goal": body.goal,
        "objective": body.objective,
        "periods": [p.model_dump() for p in body.periods],
        "updated_at": now,
    }
    await db[models.GOAL_MONTHS].update_one(
        {
            "child_id": child_id,
            "user_id": user["_id"],
            "month": month_number,
            "location": user["location"],
        },
        {
            "$set": set_fields,
            "$setOnInsert": {
                "_id": str(uuid.uuid4()),
                "created_at": now,
                "user_id": user["_id"],
                "child_id": child_id,
                "location": user["location"],
            },
        },
        upsert=True,
    )


@router.patch(
    "/user/goal-months",
    status_code=204,
    description="Replace all month plan documents for a given child in one operation.",
)
@user_limiter.limit("20/minute")
async def patch_goal_months(
    request: Request,
    body: GoalMonthsPatch,
    child_id: str = Query(..., min_length=1, max_length=100),
    user: dict = Depends(get_current_parent),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    await _require_child(db, child_id, user)
    now = datetime.now(UTC)
    filter_key = {"child_id": child_id, "user_id": user["_id"], "location": user["location"]}
    # Delete all existing month docs for this child then bulk-insert the new set.
    # Two DB ops regardless of how many months exist.
    # TODO: Wrap in a transaction once Atlas M10+ is available — currently if insert_many
    #       fails after delete_many succeeds, the child's goal months are lost.
    await db[models.GOAL_MONTHS].delete_many(filter_key)
    if body.months:
        await db[models.GOAL_MONTHS].insert_many([
            {
                "_id": str(uuid.uuid4()),
                "child_id": child_id,
                "user_id": user["_id"],
                "location": user["location"],
                "month": month.month,
                "goal": month.goal,
                "objective": month.objective,
                "periods": [p.model_dump() for p in month.periods],
                "created_at": now,
                "updated_at": now,
            }
            for month in body.months
        ])


# ---------------------------------------------------------------------------
# Goal insights — one document per child
# ---------------------------------------------------------------------------


@router.get(
    "/user/goal-insights",
    response_model=GoalInsightsResponse,
    description="Retrieve the insights document for a given child.",
)
@user_limiter.limit("60/minute")
async def get_goal_insights(
    request: Request,
    child_id: str = Query(..., min_length=1, max_length=100),
    user: dict = Depends(get_current_parent),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    await _require_child(db, child_id, user)
    # goal_insights uses child_id as _id — one document per child.
    doc = await db[models.GOAL_INSIGHTS].find_one(
        {"_id": child_id, "user_id": user["_id"], "location": user["location"]}
    )
    if not doc:
        return GoalInsightsResponse()
    return GoalInsightsResponse(
        schema_version=doc.get("schema_version"),
        insight_items=doc.get("insight_items", []),
        insights_signature=doc.get("insights_signature"),
    )


@router.patch(
    "/user/goal-insights",
    response_model=GoalInsightsResponse,
    description="Update the insights document for a given child.",
)
@user_limiter.limit("20/minute")
async def patch_goal_insights(
    request: Request,
    body: GoalInsightsPatch,
    child_id: str = Query(..., min_length=1, max_length=100),
    user: dict = Depends(get_current_parent),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    await _require_child(db, child_id, user)
    now = datetime.now(UTC)
    set_fields: dict = {"updated_at": now}
    if body.schema_version is not None:
        set_fields["schema_version"] = body.schema_version
    if body.insight_items is not None:
        set_fields["insight_items"] = [item.model_dump() for item in body.insight_items]
    if body.insights_signature is not None:
        set_fields["insights_signature"] = body.insights_signature

    doc = await db[models.GOAL_INSIGHTS].find_one_and_update(
        {"_id": child_id, "user_id": user["_id"], "location": user["location"]},
        {
            "$set": set_fields,
            "$setOnInsert": {"created_at": now, "user_id": user["_id"]},
        },
        upsert=True,
        return_document=True,
    )
    return GoalInsightsResponse(
        schema_version=doc.get("schema_version") if doc else None,
        insight_items=doc.get("insight_items", []) if doc else [],
        insights_signature=doc.get("insights_signature") if doc else None,
    )
