from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

# ---------------------------------------------------------------------------
# Jobs
# ---------------------------------------------------------------------------

JobType = Literal[
    "generate_recommendations",
    "generate_goals_plan",
    "generate_activity",
    "generate_personality_analysis",
    "generate_journey_insights",
    "generate_life_pathway",
    "generate_growth_parent_questions",
    "generate_growth_child_rounds",
    "generate_observations",
]

# Allowed write-back collections — prevents clients from targeting arbitrary collections
_ALLOWED_WRITE_BACK_COLLECTIONS = {
    "growth_areas",
    "goals",
    "goal_months",
    "goal_insights",
    "observations",
    "children",
}

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
    "generate_recommendations": {
        "recommendations",
        "recommendations_plan",
        "pending_recommendations",
    },
    "generate_goals_plan": {"goals_plan"},
    "generate_activity": {
        "activity",
        "activity_plan",
        "suggested_activity",
        "pending_child_activity",
    },
    # personality analysis writes to a staging field; the client transforms the
    # raw LLM output via adaptAiPersonalityToViewModel before finalising the
    # canonical personality.view_model field.
    "generate_personality_analysis": {"pending_personality_vm"},
    # insights written to the goal_insights staging field; finalizeInsights promotes
    # it to insight_items via PATCH after the job completes.
    "generate_journey_insights": {"pending_insights"},
    # Life Pathway milestone narrative, generated lazily one growth area at a time
    # and cached on that area's growth_areas document — alongside the answers and
    # recommendations the milestone prompt is built from. Written straight to the
    # canonical field with no staging step: the client shows a loading state for an
    # area it has no content for, so a partially-populated set is always a valid
    # state and there is nothing for a promote step to do.
    #
    # A flat field name, not a dot-path, because the area is identified by
    # write_back.filter.area_id. Same reasoning as the two growth-question job
    # types below.
    "generate_life_pathway": {"life_pathway_milestones"},
    # The two Growth Areas question sets, generated lazily per area on first click
    # and cached on that area's growth_areas document — the same document that
    # already holds the answers to them, the child's picks and the resulting
    # recommendations. Written straight to the canonical field with no staging
    # step: the client shows a loading state for an area it has no questions for,
    # so a partially-populated set is always a valid state.
    #
    # Flat field names, not dot-paths, because the area is identified by
    # write_back.filter.area_id rather than baked into the path. That keeps this
    # allowlist independent of GROWTH_AREAS, and takes the whole class of "cannot
    # create field 'x' in element {y: null}" write failures off the table — there
    # is no nullable ancestor for MongoDB to trip over.
    #
    # Split across two job types rather than one so the parent-questions job
    # structurally cannot write into the child-rounds field, and each stage gets
    # its own active_jobs slot and in-flight budget.
    "generate_growth_parent_questions": {"parent_questions"},
    "generate_growth_child_rounds": {"child_rounds"},
    # Observation patterns for the Release page, clustered from the parent's own
    # onboarding answers, growth-area answers and stated concern. Staged, then
    # promoted to the canonical `observations` field by the client — same shape of
    # handoff as pending_personality_vm, and for the same reason: the client
    # validates the icon/source enums and drops any item the provider returned
    # malformed before it becomes the thing the page renders.
    "generate_observations": {"pending_observations"},
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
                        raise ValueError(f"write_back.filter key {path!r} must not start with '$'")
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
    def validate_write_back_field(self) -> EnqueueJobRequest:
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
