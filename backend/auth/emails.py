"""Emails: one normalisation, and the HMAC keys that stand in for them (docs/auth-users-split.md, 6).

`email_index` and `allowed_emails` are unsharded, so they sit in one region. They're keyed
by `HMAC-SHA256(pepper, normalise(email))`, never the address, so a copy of them reveals
nothing without the pepper, which only auth can read.

`normalise()` is the only normalisation, used on every path: trim and lower-case, nothing
else. No Gmail dot or `+tag` stripping, because that changes which mailbox the address
means; any difference between code paths would silently create duplicate accounts (6.3).

**Peppers and rotation (6.5).** EMAIL_HMAC_PEPPER is either one pepper (version 1) or a
JSON object of version → pepper while a rotation is under way, e.g. `{"2": "…", "1": "…"}`.
The highest version is current: new rows use it, and lookups try it first, then the older
ones.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from collections.abc import Iterator, Mapping
from dataclasses import dataclass

from email_validator import EmailNotValidError, validate_email

MIN_PEPPER_LENGTH = 32  # `openssl rand -hex 32` gives 64; anything shorter is a mistake


def normalise(email: str) -> str:
    """`"  Jane.Doe@Example.com "` → `"jane.doe@example.com"`. The only normalisation."""
    return email.strip().lower()


def is_valid_address(email: str) -> bool:
    """A syntactically valid address (no deliverability check). Not a normalisation."""
    try:
        validate_email(email, check_deliverability=False)
    except EmailNotValidError:
        return False
    return True


def mask(email: str) -> str:
    """`jane.doe@example.com` → `j***@example.com`: an allow-list entry's hint for admins."""
    local, _, domain = normalise(email).partition("@")
    return f"{local[:1]}***@{domain}"


@dataclass(frozen=True)
class Peppers:
    """The HMAC keys by version; the highest version is current."""

    by_version: Mapping[int, bytes]

    def __post_init__(self) -> None:
        if not self.by_version:
            raise ValueError("EMAIL_HMAC_PEPPER is empty")
        for version, pepper in self.by_version.items():
            if version < 1:
                raise ValueError("pepper versions start at 1")
            if len(pepper) < MIN_PEPPER_LENGTH:
                raise ValueError(
                    f"pepper v{version} is shorter than {MIN_PEPPER_LENGTH} characters "
                    "(use `openssl rand -hex 32`)"
                )

    @classmethod
    def parse(cls, raw: str) -> Peppers:
        """EMAIL_HMAC_PEPPER: one pepper, or `{"<version>": "<pepper>", …}` during a rotation."""
        raw = raw.strip()
        if raw.startswith("{"):
            try:
                data = json.loads(raw)
            except json.JSONDecodeError as exc:
                raise ValueError("EMAIL_HMAC_PEPPER isn't valid JSON") from exc
            if not isinstance(data, dict) or not all(
                isinstance(k, str) and k.isdigit() and isinstance(v, str) for k, v in data.items()
            ):
                raise ValueError("EMAIL_HMAC_PEPPER must map versions to peppers")
            return cls({int(k): v.encode() for k, v in data.items()})
        return cls({1: raw.encode()})

    @property
    def current(self) -> int:
        return max(self.by_version)

    def key(self, email: str, version: int | None = None) -> str:
        """The 64-hex HMAC key of `email` under `version` (default: the current one)."""
        pepper = self.by_version[self.current if version is None else version]
        return hmac.new(pepper, normalise(email).encode(), hashlib.sha256).hexdigest()

    def keys(self, email: str) -> Iterator[tuple[int, str]]:
        """(version, key) for every pepper, current first: the order lookups use."""
        for version in sorted(self.by_version, reverse=True):
            yield version, self.key(email, version)


def log_key(key: str) -> str:
    """What logs carry instead of the email: the first 16 hex characters of its key (6.3)."""
    return key[:16]
