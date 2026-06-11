from __future__ import annotations

import json
import re
from typing import Annotated

from pydantic import BaseModel, Field, field_validator, model_validator

# Relative path: starts with a single /, no control chars, no protocol chars (:)
# and no characters that enable HTML/script injection or open-redirect via //host.
_SAFE_PATH_RE = re.compile(r'^/(?!/)[^\x00-\x1f\\<>"\':`]*$')


# ---------------------------------------------------------------------------
# Preferences
# ---------------------------------------------------------------------------


class UserPreferences(BaseModel):
    tts_enabled: bool = True
    dark_mode: bool = True
    last_visited_path: str | None = None


class UserPreferencesPatch(BaseModel):
    tts_enabled: bool | None = None
    dark_mode: bool | None = None
    last_visited_path: str | None = Field(None, max_length=500)

    @field_validator("last_visited_path")
    @classmethod
    def validate_last_visited_path(cls, v: str | None) -> str | None:
        if v is None:
            return None
        if not _SAFE_PATH_RE.match(v):
            raise ValueError(
                "last_visited_path must be a relative path starting with '/' "
                "and must not contain control characters, backslashes, colons, or quotes"
            )
        return v


# ---------------------------------------------------------------------------
# Completed growth areas
# ---------------------------------------------------------------------------


class ChildActivityResults(BaseModel):
    summary: str = Field(default="", max_length=2000)
    strengths: list[str] = Field(default_factory=list, max_length=20)
    suggested_activities: list[str] = Field(default_factory=list, max_length=20)


class ChildActivity(BaseModel):
    selections: list[str] = Field(default_factory=list, max_length=50)
    results: ChildActivityResults | None = None


class CompletedGrowthArea(BaseModel):
    area_id: str
    area_name: str
    area_color: str
    answers: dict[str, str] = Field(default_factory=dict)
    recommendations: list[str] | None = None
    child_activity: ChildActivity | None = None
    # Status: "in_progress" while wizard is active, "completed" once the area is finalised.
    # Legacy docs without this field are treated as completed.
    status: str | None = None
    # Per-area wizard state — only present when status == "in_progress"
    step: str | None = None
    selected_activity: dict | None = None
    parent_liked: bool | None = None
    want_child_activity: bool | None = None
    feedback: str | None = None
    interactive_step: int | None = None
    interactive_answers: dict | None = None
    interactive_draft: dict | None = None
    generated_activity: dict | None = None
    show_game: bool | None = None
    child_activity_selections: list | None = None
    ai_three_month_recommendations: list | None = None


class CompletedGrowthAreasResponse(BaseModel):
    areas: list[CompletedGrowthArea]


_GROWTH_AREA_MAX_BYTES = 65_536  # 64 KB cap on the total serialised dict payload


class AppendGrowthAreaRequest(BaseModel):
    area_id: str = Field(max_length=50)
    area_name: str = Field(max_length=100)
    area_color: str = Field(max_length=100)
    answers: dict[str, Annotated[str, Field(max_length=1000)]] = Field(
        default_factory=dict, max_length=100
    )
    recommendations: list[str] | None = Field(None, max_length=50)
    child_activity: ChildActivity | None = None
    # Status + per-area wizard state
    status: str | None = Field(None, max_length=50)
    step: str | None = Field(None, max_length=100)
    selected_activity: dict | None = None
    parent_liked: bool | None = None
    want_child_activity: bool | None = None
    feedback: str | None = Field(None, max_length=2000)
    interactive_step: int | None = None
    interactive_answers: dict | None = None
    interactive_draft: dict | None = None
    generated_activity: dict | None = None
    show_game: bool | None = None
    child_activity_selections: list | None = None
    ai_three_month_recommendations: list | None = None

    @model_validator(mode="after")
    def limit_dict_payload_size(self) -> AppendGrowthAreaRequest:
        """Guard against deeply-nested or oversized fields bloating MongoDB documents."""
        serialisable_fields = (
            self.answers,  # max_length=100 caps key count, not value byte size
            self.recommendations,
            self.child_activity.model_dump() if self.child_activity else None,
            self.selected_activity,
            self.interactive_answers,
            self.interactive_draft,
            self.generated_activity,
            self.ai_three_month_recommendations,
            self.child_activity_selections,
        )
        try:
            total = sum(len(json.dumps(f)) for f in serialisable_fields if f is not None)
        except (RecursionError, ValueError, TypeError):
            raise ValueError(
                "Growth area payload contains an invalid or too-deeply nested structure"
            ) from None
        for str_field in (self.feedback, self.step, self.status):
            if str_field is not None:
                total += len(str_field)
        if total > _GROWTH_AREA_MAX_BYTES:
            raise ValueError(
                f"Growth area payload exceeds maximum allowed size ({_GROWTH_AREA_MAX_BYTES // 1024} KB)"
            )
        return self


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


class UserGoals(BaseModel):
    parent_concern: str | None = None
    plan: GoalsPlan | None = None


class UserGoalsPatch(BaseModel):
    parent_concern: str | None = Field(None, max_length=2000)
    plan: GoalsPlan | None = None
    clear_plan: bool = False
    clear_concern: bool = False

    @model_validator(mode="after")
    def limit_goals_plan_size(self) -> UserGoalsPatch:
        if self.plan is not None:
            try:
                size = len(json.dumps(self.plan.model_dump()))
            except (RecursionError, ValueError, TypeError):
                raise ValueError(
                    "Goals plan contains an invalid or too-deeply nested structure"
                ) from None
            if size > _GOALS_PLAN_MAX_BYTES:
                raise ValueError(
                    f"Goals plan exceeds maximum allowed size ({_GOALS_PLAN_MAX_BYTES // 1024} KB)"
                )
        return self


# ---------------------------------------------------------------------------
# Children
# ---------------------------------------------------------------------------


class ChildResponse(BaseModel):
    model_config = {"extra": "ignore"}

    id: str
    created_date: str
    name: str = ""
    age: str | int | None = None
    gender: str | None = None
    school: str | None = None
    onboarding_phase: int = 0
    onboarding_completed: bool | None = None
    personality: dict | None = None
    recommendations: dict | None = None
    strengths: list | None = None
    hobbies: list | None = None
    thinking_pattern: str | None = None
    communication_style: str | None = None
    energy_level: str | None = None
    social_behaviour: str | None = None
    emotional_behaviour: str | None = None
    visited_tabs: list[str] = Field(default_factory=list)


_PAYLOAD_MAX_BYTES = 65_536  # 64 KB limit for extra payload fields


class ChildCreate(BaseModel):
    # extra="allow" is intentional: unknown fields pass through to the JSON payload blob,
    # letting the frontend evolve fields without a backend migration. System fields
    # (id, created_date, user_id) must be stripped by the route handler before storage.
    model_config = {"extra": "allow"}

    name: str | None = Field(None, max_length=255)
    age: str | int | None = Field(None, max_length=20)
    school: str | None = Field(None, max_length=300)
    onboarding_phase: int = 0
    onboarding_completed: bool | None = None
    personality: dict | None = None
    recommendations: dict | None = None
    strengths: list | None = None
    hobbies: list | None = None
    thinking_pattern: str | None = None
    communication_style: str | None = None
    energy_level: str | None = None
    social_behaviour: str | None = None
    emotional_behaviour: str | None = None
    visited_tabs: list[str] | None = None

    @model_validator(mode="after")
    def reject_unsafe_extra_keys(self) -> ChildCreate:
        if self.__pydantic_extra__:
            for key in self.__pydantic_extra__:
                if key.startswith("$") or "." in key:
                    raise ValueError(f"Field name {key!r} is not allowed")
        return self

    @model_validator(mode="after")
    def limit_extra_payload_size(self) -> ChildCreate:
        if self.__pydantic_extra__:
            try:
                size = len(json.dumps(self.__pydantic_extra__))
            except (RecursionError, TypeError, ValueError):
                raise ValueError(
                    "Child payload contains invalid or non-serialisable data"
                ) from None
            if size > _PAYLOAD_MAX_BYTES:
                raise ValueError("Child payload exceeds maximum allowed size (64 KB)")
        return self


class ChildPatch(BaseModel):
    # extra="allow": same payload-blob design as ChildCreate.
    model_config = {"extra": "allow"}

    name: str | None = Field(None, max_length=255)
    # Promoted columns — declared explicitly so max_length validation applies on the patch path.
    age: str | int | None = Field(None, max_length=20)
    school: str | None = Field(None, max_length=300)
    onboarding_phase: int | None = None
    onboarding_completed: bool | None = None
    personality: dict | None = None
    recommendations: dict | None = None
    strengths: list | None = None
    hobbies: list | None = None
    thinking_pattern: str | None = None
    communication_style: str | None = None
    energy_level: str | None = None
    social_behaviour: str | None = None
    emotional_behaviour: str | None = None
    visited_tabs: list[str] | None = None

    @model_validator(mode="after")
    def reject_unsafe_extra_keys(self) -> ChildPatch:
        if self.__pydantic_extra__:
            for key in self.__pydantic_extra__:
                if key.startswith("$") or "." in key:
                    raise ValueError(f"Field name {key!r} is not allowed")
        return self

    @model_validator(mode="after")
    def limit_extra_payload_size(self) -> ChildPatch:
        if self.__pydantic_extra__:
            try:
                size = len(json.dumps(self.__pydantic_extra__))
            except (RecursionError, TypeError, ValueError):
                raise ValueError(
                    "Child payload contains invalid or non-serialisable data"
                ) from None
            if size > _PAYLOAD_MAX_BYTES:
                raise ValueError("Child payload exceeds maximum allowed size (64 KB)")
        return self
