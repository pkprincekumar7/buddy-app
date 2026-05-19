from __future__ import annotations

import json
import re

from pydantic import BaseModel, Field, field_validator, model_validator

# Relative path: starts with a single /, no control chars, no protocol chars (:)
# and no characters that enable HTML/script injection or open-redirect via //host.
_SAFE_PATH_RE = re.compile(r'^/(?!/)[^\x00-\x1f\\<>"\':`]*$')


# ---------------------------------------------------------------------------
# Preferences
# ---------------------------------------------------------------------------

class UserPreferences(BaseModel):
    tts_enabled: bool = True
    last_visited_path: str | None = None


class UserPreferencesPatch(BaseModel):
    tts_enabled: bool | None = None
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
    summary: str = ""
    strengths: list[str] = Field(default_factory=list)
    suggested_activities: list[str] = Field(default_factory=list)


class ChildActivity(BaseModel):
    selections: list[str] = Field(default_factory=list)
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


class AppendGrowthAreaRequest(BaseModel):
    area_id: str = Field(max_length=50)
    area_name: str = Field(max_length=100)
    area_color: str = Field(max_length=100)
    answers: dict[str, str] = Field(default_factory=dict, max_length=100)
    recommendations: list[str] | None = Field(None, max_length=50)
    child_activity: ChildActivity | None = None
    # Status + per-area wizard state
    status: str | None = None
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


# ---------------------------------------------------------------------------
# Recommendations progress
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Goals
# ---------------------------------------------------------------------------

class GoalsActivity(BaseModel):
    title: str
    objective: str
    scorable: bool = True
    completed: bool | None = None
    score: float | None = None
    note: str | None = None
    progress_observation: str | None = None
    ai_feedback: str | None = None
    parent_feedback: str | None = None


class GoalsPeriod(BaseModel):
    label: str
    activities: list[GoalsActivity]


class GoalsMonth(BaseModel):
    month: int
    goal: str
    objective: str
    periods: list[GoalsPeriod]


class InsightItem(BaseModel):
    text: str
    type: str
    details: str


class GoalsPlanInsights(BaseModel):
    schema_version: int | None = None
    insight_items: list[InsightItem] = []


class GoalsPlan(BaseModel):
    months: list[GoalsMonth]
    insights: GoalsPlanInsights | None = None
    insights_signature: int | None = None


class UserGoals(BaseModel):
    parent_concern: str | None = None
    plan: GoalsPlan | None = None


class UserGoalsPatch(BaseModel):
    parent_concern: str | None = None
    plan: GoalsPlan | None = None
    clear_plan: bool = False
    clear_concern: bool = False


# ---------------------------------------------------------------------------
# Children
# ---------------------------------------------------------------------------

class ChildResponse(BaseModel):
    model_config = {"extra": "ignore"}

    id: str
    created_date: str
    name: str = ""
    age: str | int | None = None
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
    # Global wizard navigation — replaces the old wizard_progress blob.
    # wizard_step: current sub-step inside the recommendations phase (intro, area_selection, etc.)
    # wizard_area_index: index into the growthAreas array for the currently active area.
    wizard_step: str | None = None
    wizard_area_index: int | None = None


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

    @model_validator(mode="after")
    def limit_extra_payload_size(self) -> "ChildCreate":
        if self.__pydantic_extra__:
            if len(json.dumps(self.__pydantic_extra__)) > _PAYLOAD_MAX_BYTES:
                raise ValueError("Child payload exceeds maximum allowed size (64 KB)")
        return self


class ChildPatch(BaseModel):
    # extra="allow": same payload-blob design as ChildCreate.
    model_config = {"extra": "allow"}

    name: str | None = None
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
    wizard_step: str | None = None
    wizard_area_index: int | None = None

    @model_validator(mode="after")
    def limit_extra_payload_size(self) -> "ChildPatch":
        if self.__pydantic_extra__:
            if len(json.dumps(self.__pydantic_extra__)) > _PAYLOAD_MAX_BYTES:
                raise ValueError("Child payload exceeds maximum allowed size (64 KB)")
        return self
