from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Annotated, Any, Literal

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
    # Staging field written by the generate_recommendations worker before the
    # client finalises ai_three_month_recommendations in the domain document.
    pending_recommendations: dict | None = None
    # Staging field written by the generate_activity worker before the client
    # finalises child_activity on the domain document.
    pending_child_activity: dict | None = None


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
    # job_type → job_id; empty dict on existing documents (field absent in MongoDB)
    active_jobs: dict[str, str] = Field(default_factory=dict)
    # Staging field written by the generate_personality_analysis worker before the
    # client transforms and finalises the canonical personality.view_model.
    pending_personality_vm: dict | None = None


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


# ---------------------------------------------------------------------------
# Jobs
# ---------------------------------------------------------------------------

JobType = Literal[
    "generate_recommendations",
    "generate_goals_plan",
    "generate_activity",
    "generate_personality_analysis",
    "generate_journey_recommendations",
    "generate_journey_insights",
]

# Allowed write-back collections — prevents clients from targeting arbitrary collections
_ALLOWED_WRITE_BACK_COLLECTIONS = {"growth_areas", "goals", "children"}

_SAFE_FIELD_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_.]{0,99}$")
# Dots in a field path are interpreted by MongoDB $set as nested sub-field
# writes (e.g. "plan.months" updates doc.plan.months, not a literal key).
# This is intentional for nested write-back, but callers MUST only send
# pre-approved paths — arbitrary dot-separated paths could overwrite
# unrelated nested fields within an allow-listed collection document.

# Per-job-type allowlist of valid write_back.field values.
# Restricts which fields the LLM result can be written into, preventing a
# crafted request from using a legitimate collection + a malicious dot-path to
# overwrite sensitive neighbouring fields (e.g. "user_id", "location").
# Validated in EnqueueJobRequest.validate_write_back_field (needs both
# write_back.field and type, which are siblings — can't be done in WriteBackConfig).
_ALLOWED_WRITE_BACK_FIELDS: dict[str, set[str]] = {
    "generate_recommendations": {"recommendations", "recommendations_plan", "pending_recommendations"},
    "generate_goals_plan": {"plan", "goals_plan", "plan.months"},
    "generate_activity": {"activity", "activity_plan", "suggested_activity", "pending_child_activity"},
    # personality analysis writes to a staging field; the client transforms the
    # raw LLM output via adaptAiPersonalityToViewModel before finalising the
    # canonical personality.view_model field.
    "generate_personality_analysis": {"pending_personality_vm"},
    # journey recommendations are written directly — no client-side transform required.
    "generate_journey_recommendations": {"recommendations"},
    # insights written to the nested insights sub-document inside goals_plan.
    "generate_journey_insights": {"goals_plan.insights"},
}

_FILTER_MAX_KEYS = 20
_FILTER_MAX_DEPTH = 4


class WriteBackConfig(BaseModel):
    collection: str = Field(max_length=50)
    filter: dict[str, Any]
    field: str = Field(max_length=200)

    @field_validator("collection")
    @classmethod
    def validate_collection(cls, v: str) -> str:
        if v not in _ALLOWED_WRITE_BACK_COLLECTIONS:
            raise ValueError(
                f"write_back.collection must be one of: {sorted(_ALLOWED_WRITE_BACK_COLLECTIONS)}"
            )
        return v

    @field_validator("filter")
    @classmethod
    def validate_filter(cls, v: dict) -> dict:
        total_keys: list[int] = [0]

        def _check(obj: Any, path: str, depth: int) -> None:
            if depth > _FILTER_MAX_DEPTH:
                raise ValueError(
                    f"write_back.filter exceeds maximum nesting depth ({_FILTER_MAX_DEPTH})"
                )
            if isinstance(obj, dict):
                for key, val in obj.items():
                    total_keys[0] += 1
                    if total_keys[0] > _FILTER_MAX_KEYS:
                        raise ValueError(
                            f"write_back.filter exceeds maximum key count ({_FILTER_MAX_KEYS})"
                        )
                    if key.startswith("$"):
                        raise ValueError(
                            f"write_back.filter key {path!r} must not start with '$'"
                        )
                    _check(val, f"{path}.{key}", depth + 1)
            elif isinstance(obj, list):
                for item in obj:
                    _check(item, path, depth + 1)

        _check(v, "filter", 0)
        return v

    @field_validator("field")
    @classmethod
    def validate_field(cls, v: str) -> str:
        if not _SAFE_FIELD_RE.match(v):
            raise ValueError(
                "write_back.field must start with a letter or underscore and contain only "
                "alphanumeric characters, underscores, or dots"
            )
        return v


class EnqueueJobPayload(BaseModel):
    prompt: str = Field(max_length=32000)
    response_json_schema: dict[str, Any] | None = None
    provider: str | None = None

    @field_validator("response_json_schema")
    @classmethod
    def validate_schema_size(cls, v: dict | None) -> dict | None:
        if v is None:
            return v
        serialised = json.dumps(v)
        if len(serialised) > 4000:
            raise ValueError("response_json_schema must not exceed 4000 characters when serialised")
        # Reject external $ref URIs (absolute and protocol-relative) — they could
        # trigger SSRF if the schema were ever passed to a validator that resolves
        # references. Protocol-relative ("//evil.com") is also rejected because some
        # validators resolve those as network URIs under the current document scheme.
        if re.search(r'"\\?\$ref"\s*:\s*"(?:https?:)?//', serialised):
            raise ValueError("response_json_schema must not contain external $ref URIs")
        return v


class EnqueueJobRequest(BaseModel):
    type: JobType
    child_id: str = Field(max_length=100)
    payload: EnqueueJobPayload
    write_back: WriteBackConfig

    @model_validator(mode="after")
    def validate_write_back_field(self) -> "EnqueueJobRequest":
        allowed = _ALLOWED_WRITE_BACK_FIELDS.get(self.type, set())
        if self.write_back.field not in allowed:
            raise ValueError(
                f"write_back.field {self.write_back.field!r} is not allowed for job type "
                f"{self.type!r}. Allowed fields: {sorted(allowed)}"
            )
        return self


class EnqueueJobResponse(BaseModel):
    job_id: str


class JobStatusResponse(BaseModel):
    job_id: str
    status: str
    error: str | None = None
    created_at: datetime
