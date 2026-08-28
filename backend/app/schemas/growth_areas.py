from __future__ import annotations

import json
from typing import Annotated

from pydantic import BaseModel, Field, model_validator

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
    area_color: str | None = None
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
    # The two question sets this area was actually presented with, generated once
    # per child per area and then reused for good. Written only by the
    # generate_growth_parent_questions / generate_growth_child_rounds workers —
    # append_completed_growth_area writes an explicit field allowlist, so a client
    # cannot reach them.
    #
    # They sit alongside `answers` and `child_activity.selections` on purpose:
    # those hold responses keyed by ids derived positionally from these sets, so
    # splitting the two apart would leave answers whose wording lives elsewhere.
    # Both must be declared here or _doc_to_growth_area, which constructs this
    # model field by field, would silently drop them from every response.
    parent_questions: dict | None = None
    child_rounds: dict | None = None
    # Life Pathway milestone narrative for this area, written by the
    # generate_life_pathway worker. Lives here rather than on the child document
    # because it is per-area content built from this document's own answers and
    # recommendations — and because the child document is fetched on nearly every
    # page, where ~3 KB of milestone prose per area is dead weight.
    #
    # Invalidated by update_child when a generation input (age, gender) changes;
    # see _LIFE_PATHWAY_INPUTS in routers/children.py.
    life_pathway_milestones: dict | None = None


class CompletedGrowthAreasResponse(BaseModel):
    areas: list[CompletedGrowthArea]


_GROWTH_AREA_MAX_BYTES = 65_536  # 64 KB cap on the total serialised dict payload


class AppendGrowthAreaRequest(BaseModel):
    area_id: str = Field(max_length=50)
    area_name: str = Field(max_length=100)
    area_color: str | None = Field(None, max_length=100)
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
