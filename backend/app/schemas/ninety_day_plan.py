from __future__ import annotations

import json

from pydantic import BaseModel, Field, model_validator

# ---------------------------------------------------------------------------
# ninety_day_plans — one document per child
#
# Backs the StartJourneyModal's Dashboard/Tracker steps (the "Start {name}'s
# 90 days" flow on Transform). Two kinds of fields on the same document:
#   - LLM-written, no staging (`plan`, `track_steps`): the generate_ninety_day_plan
#     / generate_event_tracker jobs write these directly, same as
#     growth_areas.pending_recommendations/life_pathway_milestones — the
#     schema-constrained LLM output needs no parent review before rendering.
#   - Parent/child-entered via PATCH (everything else): the achievement
#     checklist, per-field inputs/counters, feedback tags, the Day-90 target
#     event, and the tracker's own step progress — previously kept only in
#     the frontend's local useNinetyDayProgress state, now given a home.
# ---------------------------------------------------------------------------

_MAX_BYTES = 65_536  # 64 KB cap on the serialised patch body, same budget as observations


class NinetyDayPlanResponse(BaseModel):
    model_config = {"extra": "ignore"}

    ask: str | None = None
    plan: dict | None = None
    # The generate_event_tracker job's own schema wraps its 9 steps in a
    # {"steps": [...]} object (LLM structured-output schemas here are always
    # a top-level object, never a bare array — same reason parent_questions/
    # child_rounds in growth_areas.py are dicts, not lists), and write_to_domain
    # stores that whole response verbatim. So this holds the wrapper, not the
    # array — callers read track_steps.steps, e.g. mergeTrackSteps in
    # `@/lib/startJourneyPlans` on the frontend.
    track_steps: dict | None = None

    applied: dict[str, bool] = Field(default_factory=dict)
    act_inputs: dict[str, str] = Field(default_factory=dict)
    act_counts: dict[str, int] = Field(default_factory=dict)
    feedback: dict[str, dict] = Field(default_factory=dict)

    event_name: str | None = None
    event_date: str | None = None
    event_set: bool = False

    track_done: dict[str, bool] = Field(default_factory=dict)
    track_inputs: dict[str, str] = Field(default_factory=dict)
    track_sittings: dict[str, bool] = Field(default_factory=dict)

    # field_key -> S3 URLs, covering both the Dashboard's per-activity photo
    # fields (key "act:{activityId}:{fieldK}") and the Tracker's own photo-import
    # steps (key is that step's static `up.key`) — one shared map, matching the
    # single `photoFiles` map the frontend already keeps locally.
    photos: dict[str, list[str]] = Field(default_factory=dict)


class NinetyDayPlanPatch(BaseModel):
    # None means "no update" throughout, so a PATCH that only sets one field
    # (e.g. a single toggle) cannot blank the rest of the document.
    ask: str | None = Field(None, max_length=2000)

    applied: dict[str, bool] | None = None
    act_inputs: dict[str, str] | None = None
    act_counts: dict[str, int] | None = None
    feedback: dict[str, dict] | None = None

    event_name: str | None = Field(None, max_length=200)
    event_date: str | None = Field(None, max_length=32)
    event_set: bool | None = None

    track_done: dict[str, bool] | None = None
    track_inputs: dict[str, str] | None = None
    track_sittings: dict[str, bool] | None = None
    photos: dict[str, list[str]] | None = None

    # Set when the parent picks a new Day-90 target after the tracker was
    # already generated for the old one — the client sends this alongside the
    # new event_name/event_date so the stale, now-mismatched tracker content
    # gets cleared instead of silently sticking around. Clearing (rather than
    # regenerating server-side) keeps this endpoint free of LLM calls; the
    # client's own hasTrackSteps gate picks the absence back up and re-enqueues
    # generate_event_tracker for the new target.
    clear_track_steps: bool = False

    @model_validator(mode="after")
    def limit_payload_size(self) -> NinetyDayPlanPatch:
        try:
            size = len(json.dumps(self.model_dump(exclude_unset=True)))
        except (RecursionError, ValueError, TypeError):
            raise ValueError(
                "Ninety-day-plan payload contains an invalid or too-deeply nested structure"
            ) from None
        if size > _MAX_BYTES:
            raise ValueError(
                f"Ninety-day-plan payload exceeds maximum allowed size ({_MAX_BYTES // 1024} KB)"
            )
        return self


# Matches the field-key shapes the frontend already generates locally:
# "act:m101:sketch" (Dashboard activity fields) and plain keys like "ideas"
# (the Tracker's static up.key). Constrained so it can be interpolated
# straight into an S3 key without risking a manipulated path (e.g. "../").
_FIELD_KEY_RE = r"^[a-zA-Z0-9:_-]{1,100}$"


class NinetyDayPlanPhotoPresignRequest(BaseModel):
    field_key: str = Field(pattern=_FIELD_KEY_RE)
    content_type: str = Field(max_length=100)


class NinetyDayPlanPhotoPresignResponse(BaseModel):
    upload_url: str
    photo_url: str
