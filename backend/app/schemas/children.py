from __future__ import annotations

import json
import re
from datetime import datetime

from pydantic import BaseModel, Field, field_validator, model_validator

# ---------------------------------------------------------------------------
# Children
# ---------------------------------------------------------------------------


class ChildResponse(BaseModel):
    model_config = {"extra": "ignore"}

    id: str
    created_date: str
    name: str = ""
    age: int | None = None
    gender: str | None = None
    school: str | None = None
    onboarding_phase: int = 0
    onboarding_completed: bool | None = None
    current_phase: str | None = None
    personality: dict | None = None
    strengths: list | None = None
    hobbies: list | None = None
    thinking_pattern: str | None = None
    communication_style: str | None = None
    energy_level: str | None = None
    social_behaviour: str | None = None
    emotional_behaviour: str | None = None
    visited_tabs: list[str] = Field(default_factory=list)
    # Personality Journey progression flags — the full chain, in order:
    #   onboarding_profile_completed → conversational_onboarding_completed →
    #   discover_completed → grow_completed → transform_visited →
    #   release_visited → connect_visited
    # Each step (except the first) requires the previous one to already be
    # true — enforced centrally in app/routers/children.py's
    # mark_journey_progress / update_child, not scattered per call site.
    #
    # None of these seven are declared on ChildCreate/ChildPatch below — a
    # client can never set them via POST/PATCH /children (see
    # _CHILD_SYSTEM_FIELDS in app/routers/children.py).
    #   - grow_completed is computed live from the growth_areas collection,
    #     never stored (app/services/journey_progress.py).
    #   - conversational_onboarding_completed is set as a server-side side
    #     effect, inside update_child, the moment a patch legitimately
    #     transitions onboarding_completed to true — not from a dedicated
    #     client call, since that transition happens from more than one
    #     frontend call site (ConversationalOnboarding.tsx,
    #     PersonalityJourney.tsx) and hooking the one shared backend path
    #     covers all of them without each needing to remember a second call.
    #   - the remaining five are one-way (false→true), writable only via
    #     POST /children/{id}/progress/{flag}.
    onboarding_profile_completed: bool = False
    conversational_onboarding_completed: bool = False
    discover_completed: bool = False
    grow_completed: bool = False
    transform_visited: bool = False
    release_visited: bool = False
    connect_visited: bool = False
    # job_type → job_id; empty dict on existing documents (field absent in MongoDB)
    active_jobs: dict[str, str] = Field(default_factory=dict)
    # Staging field written by the generate_personality_analysis worker before the
    # client transforms and finalises the canonical personality.view_model.
    pending_personality_vm: dict | None = None
    # Avatar / profile photo — set during onboarding step 2.
    avatar_id: str | None = None  # emoji avatar selection (e.g. "capper-boy")
    avatar_url: str | None = None  # S3 URL of an uploaded profile photo
    # Soft-delete fields — present on all documents; False by default.
    # deleted_at is set when is_deleted is set to True.
    is_deleted: bool = False
    deleted_at: datetime | None = None


_PAYLOAD_MAX_BYTES = 65_536  # 64 KB limit for extra payload fields


def _parse_age(v: int | str | None) -> int | None:
    """Accept an integer or a string like '12', '12 years', '18 months'."""
    if v is None or isinstance(v, int):
        return v
    m = re.match(r"^\s*(\d+)", str(v))
    if not m:
        raise ValueError("age must be a number or start with a number (e.g. '12' or '12 years')")
    return int(m.group(1))


class ChildCreate(BaseModel):
    # extra="allow" is intentional: unknown fields pass through to the JSON payload blob,
    # letting the frontend evolve fields without a backend migration. System fields
    # (id, created_date, user_id) must be stripped by the route handler before storage.
    model_config = {"extra": "allow"}

    name: str | None = Field(None, max_length=255)
    age: int | None = None

    @field_validator("age", mode="before")
    @classmethod
    def coerce_age(cls, v: object) -> int | None:
        return _parse_age(v)  # type: ignore[arg-type]

    school: str | None = Field(None, max_length=300)
    avatar_id: str | None = Field(None, max_length=100)
    avatar_url: str | None = Field(None, max_length=2048)
    onboarding_phase: int = 0
    onboarding_completed: bool | None = None
    current_phase: str | None = Field(None, max_length=100)
    personality: dict | None = None
    strengths: list | None = None
    hobbies: list | None = None
    thinking_pattern: str | None = None
    communication_style: str | None = None
    energy_level: str | None = None
    social_behaviour: str | None = None
    emotional_behaviour: str | None = None
    visited_tabs: list[str] | None = None
    # Journey progress flags (onboarding_profile_completed,
    # conversational_onboarding_completed, discover_completed,
    # grow_completed, transform_visited, release_visited, connect_visited)
    # are deliberately NOT declared here — see the comment on ChildResponse
    # above.

    @field_validator("avatar_url")
    @classmethod
    def avatar_url_must_be_https(cls, v: str | None) -> str | None:
        if v is not None and not v.startswith("https://"):
            raise ValueError("avatar_url must be an HTTPS URL")
        return v

    @model_validator(mode="after")
    def avatar_fields_are_exclusive(self) -> ChildCreate:
        if self.avatar_id is not None and self.avatar_url is not None:
            raise ValueError("Provide either avatar_id or avatar_url, not both")
        return self

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
    age: int | None = None

    @field_validator("age", mode="before")
    @classmethod
    def coerce_age(cls, v: object) -> int | None:
        return _parse_age(v)  # type: ignore[arg-type]

    school: str | None = Field(None, max_length=300)
    avatar_id: str | None = Field(None, max_length=100)
    avatar_url: str | None = Field(None, max_length=2048)
    onboarding_phase: int | None = None
    onboarding_completed: bool | None = None
    current_phase: str | None = Field(None, max_length=100)
    personality: dict | None = None
    strengths: list | None = None
    hobbies: list | None = None
    thinking_pattern: str | None = None
    communication_style: str | None = None
    energy_level: str | None = None
    social_behaviour: str | None = None
    emotional_behaviour: str | None = None
    visited_tabs: list[str] | None = None
    # Journey progress flags (onboarding_profile_completed,
    # conversational_onboarding_completed, discover_completed,
    # grow_completed, transform_visited, release_visited, connect_visited)
    # are deliberately NOT declared here — see the comment on ChildResponse
    # above.

    @field_validator("avatar_url")
    @classmethod
    def avatar_url_must_be_https(cls, v: str | None) -> str | None:
        if v is not None and not v.startswith("https://"):
            raise ValueError("avatar_url must be an HTTPS URL")
        return v

    @model_validator(mode="after")
    def avatar_fields_are_exclusive(self) -> ChildPatch:
        if self.avatar_id is not None and self.avatar_url is not None:
            raise ValueError("Provide either avatar_id or avatar_url, not both")
        return self

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
