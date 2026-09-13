from __future__ import annotations

from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# goals — base document (parent_concern only)
# ---------------------------------------------------------------------------


class UserGoals(BaseModel):
    parent_concern: str | None = None


class UserGoalsPatch(BaseModel):
    parent_concern: str | None = Field(None, max_length=2000)
    clear_concern: bool = False
