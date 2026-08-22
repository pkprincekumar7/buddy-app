from __future__ import annotations

import re

from pydantic import BaseModel, Field, field_validator

# Relative path: starts with a single /, no control chars, no protocol chars (:)
# and no characters that enable HTML/script injection or open-redirect via //host.
_SAFE_PATH_RE = re.compile(r'^/(?!/)[^\x00-\x1f\\<>"\':`]*$')


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
