from __future__ import annotations

import json
from typing import Annotated, Any

from pydantic import BaseModel, Field, field_validator, model_validator

# ---------------------------------------------------------------------------
# observations — one document per child
#
# Its own collection rather than a field on `children`, matching goals and
# goal_insights: same shape of thing (one per child, LLM-generated, staged then
# promoted), and it keeps a few KB off the child document, which is read on almost
# every page and shares a single 64 KB payload budget across all its extra fields.
# ---------------------------------------------------------------------------

_OBSERVATIONS_MAX_BYTES = 65_536  # 64 KB cap on the serialised item list

# Slightly above what the page shows: the client asks the provider for up to 8
# candidates and selects 6, so a staged set legitimately arrives larger than the
# set that ends up rendered.
_OBSERVATIONS_MAX_ITEMS = 8


class ObservationsResponse(BaseModel):
    model_config = {"extra": "ignore"}

    source: str | None = None
    # Raw provider objects, validated client-side by normalizeObservations before
    # they are promoted here — kept as an open list for the same reason
    # GoalInsightsResponse keeps pending_insights open.
    items: list = Field(default_factory=list, max_length=_OBSERVATIONS_MAX_ITEMS)
    # Observation ids the parent ticked, plus the span and start they chose.
    watching: list[str] = Field(default_factory=list, max_length=_OBSERVATIONS_MAX_ITEMS)
    span: str | None = None
    started_at: str | None = None
    # Staging field: the generate_observations worker writes the full LLM response
    # here; the client validates it and promotes `items` via PATCH.
    pending_observations: dict | None = None

    @field_validator("items", "watching", mode="before")
    @classmethod
    def truncate_to_cap(cls, v: Any) -> Any:
        """
        Truncate rather than reject an over-long stored list.

        Same intent as the legacy-shape unwrapping in get_goal_insights: these
        fields are populated straight from a stored document, and a plain
        max_length would make Pydantic raise — turning one oversized document
        (an older client, a raised client-side limit, a manual edit) into a
        permanent 500 on every read, with no way for the page to recover.
        """
        if isinstance(v, list) and len(v) > _OBSERVATIONS_MAX_ITEMS:
            return v[:_OBSERVATIONS_MAX_ITEMS]
        return v


class ObservationsPatch(BaseModel):
    # None means "no update" throughout, so a PATCH that only sets `watching`
    # cannot blank the generated set.
    source: str | None = Field(None, max_length=50)
    items: list | None = Field(None, max_length=_OBSERVATIONS_MAX_ITEMS)
    watching: list[Annotated[str, Field(max_length=100)]] | None = Field(
        None, max_length=_OBSERVATIONS_MAX_ITEMS
    )
    span: str | None = Field(None, max_length=50)
    started_at: str | None = Field(None, max_length=64)

    @model_validator(mode="after")
    def limit_observations_size(self) -> ObservationsPatch:
        if self.items is None:
            return self
        try:
            size = len(json.dumps(self.items))
        except (RecursionError, ValueError, TypeError):
            raise ValueError(
                "Observations payload contains an invalid or too-deeply nested structure"
            ) from None
        if size > _OBSERVATIONS_MAX_BYTES:
            raise ValueError(
                f"Observations payload exceeds maximum allowed size ({_OBSERVATIONS_MAX_BYTES // 1024} KB)"
            )
        return self
