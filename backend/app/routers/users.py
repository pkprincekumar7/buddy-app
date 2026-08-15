import asyncio
import logging
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Body, Depends, HTTPException, Path, Query, Request
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import ValidationError

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
        {"_id": child_id, "user_id": user["_id"], "location": user["location"], "is_deleted": False}
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
        parent_questions=doc.get("parent_questions"),
        child_rounds=doc.get("child_rounds"),
        life_pathway_milestones=doc.get("life_pathway_milestones"),
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
    description="List completed growth areas for a given child, with pagination. Returns an empty list if the child does not exist (query is scoped by user_id so no data leaks).",
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
    # Read-only: query is already scoped by user_id + location so an unknown
    # child_id returns an empty list rather than leaking data. Skip _require_child
    # to save one round-trip on M0's shared-cluster I/O.
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
    status_code=204,
    description="Upsert a growth area document for a given child.",
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
    # These fields must also be removed from set_fields: MongoDB raises a conflict
    # error if the same path appears in both $set and $unset.
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
        for transient in unset_fields:
            set_fields.pop(transient, None)

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
# Goals
# ---------------------------------------------------------------------------


@router.get(
    "/user/goals",
    response_model=UserGoals,
    description="Retrieve the parent concern for a given child. Returns an empty document if the child does not exist (query is scoped by user_id so no data leaks).",
)
@user_limiter.limit("60/minute")
async def get_goals(
    request: Request,
    child_id: str = Query(..., min_length=1, max_length=100),
    user: dict = Depends(get_current_parent),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    # Read-only: query scoped by user_id + location. Skip _require_child (see list_completed_growth_areas).
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
    set_on_insert: dict = {"created_at": now, "user_id": user["_id"], "location": user["location"]}

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


def _month_doc_to_api(doc: dict) -> GoalsMonth | None:
    try:
        # Pass raw values without defaults so Pydantic raises ValidationError on
        # missing required fields (goal, objective). Pre-filling "" would silently
        # hide schema drift — e.g. a worker writing "title" instead of "goal".
        # periods defaults to [] because an empty periods list is valid.
        return GoalsMonth.model_validate(
            {
                "month": doc.get("month"),
                "goal": doc.get("goal"),
                "objective": doc.get("objective"),
                "periods": doc.get("periods", []),
            }
        )
    except (ValidationError, KeyError, TypeError):
        log.warning(
            "_month_doc_to_api: skipping invalid month doc _id=%s month=%s",
            doc.get("_id"),
            doc.get("month"),
            exc_info=True,
        )
        return None


@router.get(
    "/user/goal-months",
    response_model=GoalMonthsResponse,
    description="Retrieve all month plan documents for a given child. Returns an empty list if the child does not exist (query is scoped by user_id so no data leaks).",
)
@user_limiter.limit("60/minute")
async def get_goal_months(
    request: Request,
    child_id: str = Query(..., min_length=1, max_length=100),
    user: dict = Depends(get_current_parent),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    # Read-only: query scoped by user_id + location. Skip _require_child (see list_completed_growth_areas).
    docs = await (
        db[models.GOAL_MONTHS]
        .find({"child_id": child_id, "user_id": user["_id"], "location": user["location"]})
        .sort("month", 1)
        .to_list(12)
    )
    months = [m for m in (_month_doc_to_api(d) for d in docs) if m is not None]
    return GoalMonthsResponse(months=months)


@router.patch(
    "/user/goal-months/{month_number}",
    status_code=204,
    description="Upsert a single month plan document for a given child.",
)
@user_limiter.limit("30/minute")
async def patch_goal_month_single(
    request: Request,
    month_number: int = Path(..., ge=1, le=12),
    body: GoalsMonth = Body(...),
    child_id: str = Query(..., min_length=1, max_length=100),
    user: dict = Depends(get_current_parent),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    if body.month != month_number:
        raise HTTPException(
            status_code=422,
            detail=f"Path month_number ({month_number}) does not match body month ({body.month})",
        )
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

    # TODO(M10+): Replace upsert-then-delete below with an atomic transaction once the
    # cluster is upgraded to Atlas M10 or higher.
    #
    # Why upsert-per-month instead of insert_many + delete_many:
    # goal_months has a unique index on (location, child_id, user_id, month). This
    # index is intentionally kept — it enforces data integrity (no duplicate month
    # docs per child) and satisfies the Atlas sharding requirement that every unique
    # index must have the shard key (location) as its leading field (required on M10+).
    # insert_many would fail with DuplicateKeyError on every call after the first
    # because old docs still hold the index entries at insert time. Upserting each
    # month individually is compatible with the unique index: update_one matches the
    # existing doc by (filter_key + month) and overwrites it in-place, or inserts a
    # new doc if none exists — no duplicate key violation in either case.
    #
    # Crash safety with this approach:
    #   - Crash mid-upsert loop → partial update; each upsert is idempotent so a
    #     retry converges to the correct state (no data loss).
    #   - Crash after upserts but before delete_many → stale month docs for months
    #     that were removed from the plan remain; the next successful call will
    #     clean them up (no data loss).
    # On M10+ wrap both the upsert loop and the delete in a session transaction to
    # make the replace fully atomic.
    submitted_months: list[int] = [m.month for m in body.months]

    async def _upsert_month(month: GoalsMonth) -> None:
        await db[models.GOAL_MONTHS].update_one(
            {**filter_key, "month": month.month},
            {
                "$set": {
                    "goal": month.goal,
                    "objective": month.objective,
                    "periods": [p.model_dump() for p in month.periods],
                    "updated_at": now,
                },
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

    # Run all per-month upserts concurrently — each is independent and idempotent.
    # asyncio.gather preserves crash-safety: a partial failure leaves some months
    # updated and some not, but a retry converges to the correct state.
    await asyncio.gather(*[_upsert_month(m) for m in body.months])

    # Delete any month docs whose month number was not included in this submission
    # (i.e. months that were removed from the plan). $nin: [] means "delete all",
    # which is the correct behaviour when body.months is empty (clearing the plan).
    await db[models.GOAL_MONTHS].delete_many({**filter_key, "month": {"$nin": submitted_months}})


# ---------------------------------------------------------------------------
# Goal insights — one document per child
# ---------------------------------------------------------------------------


@router.get(
    "/user/goal-insights",
    response_model=GoalInsightsResponse,
    description="Retrieve the insights document for a given child. Returns an empty document if the child does not exist (query is scoped by user_id so no data leaks).",
)
@user_limiter.limit("60/minute")
async def get_goal_insights(
    request: Request,
    child_id: str = Query(..., min_length=1, max_length=100),
    user: dict = Depends(get_current_parent),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    # Read-only: query scoped by user_id + location. Skip _require_child (see list_completed_growth_areas).
    doc = await db[models.GOAL_INSIGHTS].find_one(
        {"_id": child_id, "user_id": user["_id"], "location": user["location"]}
    )
    if not doc:
        return GoalInsightsResponse()
    raw_items = doc.get("insight_items", [])
    # Resilience: before the pending_insights staging-field pattern was introduced,
    # the worker wrote the full LLM response dict to insight_items directly.
    # Extract the inner list so old documents don't cause a 500 on GET.
    if isinstance(raw_items, dict):
        raw_items = raw_items.get("insight_items", [])
    if not isinstance(raw_items, list):
        raw_items = []
    return GoalInsightsResponse(
        schema_version=doc.get("schema_version"),
        insight_items=raw_items,
        insights_signature=doc.get("insights_signature"),
        pending_insights=doc.get("pending_insights"),
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
    # clear_* takes precedence over the value field — mirrors UserGoalsPatch pattern.
    if body.clear_schema_version:
        set_fields["schema_version"] = None
    elif body.schema_version is not None:
        set_fields["schema_version"] = body.schema_version
    unset_fields: dict = {}
    if body.insight_items is not None:
        set_fields["insight_items"] = [item.model_dump() for item in body.insight_items]
        # Committing insight_items means the staging field has been promoted — clear it.
        unset_fields["pending_insights"] = ""
    if body.clear_insights_signature:
        set_fields["insights_signature"] = None
    elif body.insights_signature is not None:
        set_fields["insights_signature"] = body.insights_signature

    update_op: dict = {
        "$set": set_fields,
        "$setOnInsert": {
            "created_at": now,
            "user_id": user["_id"],
            "location": user["location"],
        },
    }
    if unset_fields:
        update_op["$unset"] = unset_fields

    doc = await db[models.GOAL_INSIGHTS].find_one_and_update(
        {"_id": child_id, "user_id": user["_id"], "location": user["location"]},
        update_op,
        upsert=True,
        return_document=True,
    )
    return GoalInsightsResponse(
        schema_version=doc.get("schema_version") if doc else None,
        insight_items=doc.get("insight_items", []) if doc else [],
        insights_signature=doc.get("insights_signature") if doc else None,
    )
