from __future__ import annotations

import json

from pydantic import BaseModel, Field, model_validator

# ---------------------------------------------------------------------------
# Goals
# ---------------------------------------------------------------------------


class GoalsActivity(BaseModel):
    title: str = Field(max_length=200)
    objective: str = Field(max_length=500)
    scorable: bool = True
    completed: bool | None = None
    score: float | None = None
    note: str | None = Field(None, max_length=1000)
    progress_observation: str | None = Field(None, max_length=1000)
    ai_feedback: str | None = Field(None, max_length=2000)
    parent_feedback: str | None = Field(None, max_length=2000)
    what_changed: str | None = Field(None, max_length=2000)
    what_learned: str | None = Field(None, max_length=2000)
    recommendation: str | None = Field(None, max_length=2000)
    answers_text: str | None = Field(None, max_length=5000)


class GoalsPeriod(BaseModel):
    label: str = Field(max_length=100)
    activities: list[GoalsActivity] = Field(max_length=20)


class GoalsMonth(BaseModel):
    month: int
    goal: str = Field(max_length=500)
    objective: str = Field(max_length=500)
    periods: list[GoalsPeriod] = Field(max_length=10)


class InsightItem(BaseModel):
    text: str = Field(max_length=1000)
    type: str = Field(max_length=50)
    details: str = Field(max_length=1000)


class GoalsPlanInsights(BaseModel):
    schema_version: int | None = None
    insight_items: list[InsightItem] = Field(default_factory=list, max_length=50)


class GoalsPlan(BaseModel):
    months: list[GoalsMonth] = Field(max_length=12)
    insights: GoalsPlanInsights | None = None
    insights_signature: int | None = None


_GOALS_PLAN_MAX_BYTES = 262_144  # 256 KB cap on the total serialised goals plan

# ---------------------------------------------------------------------------
# goals — base document (parent_concern only)
# ---------------------------------------------------------------------------


class UserGoals(BaseModel):
    parent_concern: str | None = None
    # Staging field written by the generate_goals_plan worker.
    # The client reads this, splits it into goal_months docs, then clears it.
    goals_plan: dict | None = None


class UserGoalsPatch(BaseModel):
    parent_concern: str | None = Field(None, max_length=2000)
    clear_concern: bool = False
    clear_goals_plan: bool = False  # set True after client splits goals_plan into goal_months


# ---------------------------------------------------------------------------
# goal_months — one document per month per child
# ---------------------------------------------------------------------------


class GoalMonthsResponse(BaseModel):
    months: list[GoalsMonth]


class GoalMonthsPatch(BaseModel):
    # min_length=1 prevents an accidental empty submission from silently deleting
    # all month documents for the child (the route handler's delete_many with
    # $nin: [] would wipe every doc). Submitting zero months is not a valid plan
    # update — use a dedicated clear endpoint if that behaviour is ever needed.
    months: list[GoalsMonth] = Field(min_length=1, max_length=12)

    @model_validator(mode="after")
    def validate_months(self) -> GoalMonthsPatch:
        month_numbers = [m.month for m in self.months]
        if len(month_numbers) != len(set(month_numbers)):
            raise ValueError("months list contains duplicate month numbers")
        try:
            # _GOALS_PLAN_MAX_BYTES is reused here as a cap on the total batch
            # payload size (up to 12 months × 10 periods × 20 activities), not
            # on a single stored document — each month is persisted as its own doc.
            size = len(json.dumps([m.model_dump() for m in self.months]))
        except (RecursionError, ValueError, TypeError):
            raise ValueError(
                "Goal months payload contains an invalid or too-deeply nested structure"
            ) from None
        if size > _GOALS_PLAN_MAX_BYTES:
            raise ValueError(
                f"Goal months payload exceeds maximum allowed size ({_GOALS_PLAN_MAX_BYTES // 1024} KB)"
            )
        return self


# ---------------------------------------------------------------------------
# goal_insights — one document per child
# ---------------------------------------------------------------------------


class GoalInsightsResponse(BaseModel):
    schema_version: int | None = None
    insight_items: list[InsightItem] = Field(default_factory=list, max_length=50)
    insights_signature: int | None = None
    # Staging field: worker writes the full LLM response here; frontend promotes
    # insight_items via PATCH then the staging field is cleared.
    pending_insights: dict | None = None


class GoalInsightsPatch(BaseModel):
    # For int fields, None means "no update" (leave the stored value unchanged).
    # To explicitly reset a field to null, set the corresponding clear_* flag to True.
    # This mirrors the clear_concern / clear_goals_plan pattern used in UserGoalsPatch.
    schema_version: int | None = None
    clear_schema_version: bool = False
    # None means "no update" — use explicit None rather than default_factory=list
    # so that `is not None` guards in the route handler work correctly.
    insight_items: list[InsightItem] | None = Field(None, max_length=50)
    insights_signature: int | None = None
    clear_insights_signature: bool = False

    @model_validator(mode="after")
    def limit_insights_size(self) -> GoalInsightsPatch:
        if self.insight_items is None:
            return self
        try:
            size = len(json.dumps([i.model_dump() for i in self.insight_items]))
        except (RecursionError, ValueError, TypeError):
            raise ValueError(
                "Goal insights payload contains an invalid or too-deeply nested structure"
            ) from None
        if size > _GOALS_PLAN_MAX_BYTES:
            raise ValueError(
                f"Goal insights payload exceeds maximum allowed size ({_GOALS_PLAN_MAX_BYTES // 1024} KB)"
            )
        return self
