"""Access and refresh tokens, and bcrypt (docs/auth-users-split.md, 9.1, 9.2).

Only auth holds JWT_PRIVATE_KEY, so only auth mints tokens; every service verifies them
with JWT_PUBLIC_KEYS (common.authz). Claims (9.2):
- both: `sub`, `location`, `iss`, `aud`, `iat` (seconds, as the standard says), `iat_ms`
  (milliseconds, compared with `revoked_at_ms`), `exp`, `type`;
- access: `role`, for cheap coarse checks only (the cached role is authoritative, 9.3);
- refresh: `jti` (its session) and `family_id` (its rotation chain).
No email or names: a JWT is signed, not encrypted.
"""

from __future__ import annotations

import asyncio
import re
import secrets
import time
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from functools import lru_cache
from typing import Any

import bcrypt
import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPrivateKey
from cryptography.hazmat.primitives.serialization import load_pem_private_key
from jwt.exceptions import PyJWTError

from common.authz import AuthzConfig
from common.regions import location_from_claims

BCRYPT_COST = 12  # as today (5.1)
_UUID4 = r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"
_REFRESH_CLAIMS = ["exp", "iat", "iat_ms", "sub", "type", "iss", "aud", "jti", "family_id"]


class InvalidToken(Exception):
    """A refresh token that fails verification."""


# ── passwords ──────────────────────────────────────────────────────────────────


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=BCRYPT_COST)).decode()


def check_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except ValueError:  # a malformed stored hash never matches
        return False


@lru_cache(maxsize=1)
def dummy_hash() -> str:
    """A real hash of nothing, so a miss costs as much as a wrong password (timing-safe)."""
    return hash_password(secrets.token_urlsafe(16))


async def async_hash_password(password: str) -> str:
    return await asyncio.to_thread(hash_password, password)


async def async_check_password(password: str, hashed: str | None) -> bool:
    """bcrypt off the event loop; `None` checks the dummy hash and is always False."""
    if hashed is None:
        await asyncio.to_thread(check_password, password, dummy_hash())
        return False
    return await asyncio.to_thread(check_password, password, hashed)


async def unusable_password_hash() -> str:
    """For Google sign-ups: a random password nobody knows, hashed like any other (5.1)."""
    return await async_hash_password(secrets.token_urlsafe(32))


# ── tokens ─────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class IssuedTokens:
    access_token: str
    refresh_token: str
    jti: str
    family_id: str
    refresh_expires_at: datetime


@dataclass(frozen=True)
class TokenIssuer:
    private_key_pem: str
    kid: str
    issuer: str
    audience: str
    access_minutes: int = 30
    refresh_hours: int = 24
    _key: RSAPrivateKey = field(init=False, repr=False, compare=False)

    def __post_init__(self) -> None:
        try:
            key = load_pem_private_key(
                self.private_key_pem.replace("\\n", "\n").encode(), password=None
            )
        except (ValueError, TypeError) as exc:
            raise ValueError("JWT_PRIVATE_KEY isn't a valid PEM private key") from exc
        if not isinstance(key, RSAPrivateKey):
            raise ValueError("JWT_PRIVATE_KEY must be an RSA key (RS256)")
        object.__setattr__(self, "_key", key)

    def public_pem(self) -> str:
        return (
            self._key.public_key()
            .public_bytes(
                serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
            )
            .decode()
        )

    def check_published(self, config: AuthzConfig) -> None:
        """JWT_PUBLIC_KEYS must hold this key under JWT_KEY_ID, or no service could verify
        what auth issues (the deploy workflow checks it too)."""
        published = config.key(self.kid)
        if (
            published is None
            or published.public_numbers() != self._key.public_key().public_numbers()
        ):
            raise ValueError(
                f"JWT_PUBLIC_KEYS[{self.kid!r}] isn't JWT_PRIVATE_KEY's public key: "
                "every token auth issues would be rejected"
            )

    def _encode(self, claims: dict[str, Any]) -> str:
        return jwt.encode(
            {**claims, "iss": self.issuer, "aud": self.audience},
            self._key,
            algorithm="RS256",
            headers={"kid": self.kid},
        )

    def issue(
        self, user_id: str, location: str, role: str, family_id: str | None = None
    ) -> IssuedTokens:
        """A new access and refresh pair; the refresh token joins `family_id` (or a new one)."""
        now_ms = int(time.time() * 1000)
        now = now_ms // 1000
        jti = str(uuid.uuid4())
        family = family_id or str(uuid.uuid4())
        base = {"sub": user_id, "location": location, "iat": now, "iat_ms": now_ms}
        access = self._encode(
            {**base, "type": "access", "role": role, "exp": now + self.access_minutes * 60}
        )
        refresh_exp = now + self.refresh_hours * 3600
        refresh = self._encode(
            {**base, "type": "refresh", "jti": jti, "family_id": family, "exp": refresh_exp}
        )
        return IssuedTokens(
            access_token=access,
            refresh_token=refresh,
            jti=jti,
            family_id=family,
            refresh_expires_at=datetime.fromtimestamp(refresh_exp, UTC),
        )

    @property
    def access_max_age(self) -> int:
        return self.access_minutes * 60

    @property
    def refresh_max_age(self) -> int:
        return self.refresh_hours * 3600


def _decode(
    token: str, config: AuthzConfig, *, require: list[str], verify_exp: bool
) -> dict[str, Any]:
    key = config.key(jwt.get_unverified_header(token).get("kid"))
    if key is None:
        raise InvalidToken("unknown kid")
    claims: dict[str, Any] = jwt.decode(
        token,
        key,
        algorithms=[config.algorithm],
        leeway=config.leeway_seconds,
        issuer=config.issuer,
        audience=config.audience,
        options={"require": require, "verify_exp": verify_exp},
    )
    return claims


def decode_refresh(token: str, config: AuthzConfig) -> dict[str, Any]:
    """A refresh token's claims, or InvalidToken (signature by `kid`, iss, aud, exp, shape)."""
    try:
        claims = _decode(token, config, require=_REFRESH_CLAIMS, verify_exp=True)
    except PyJWTError as exc:
        raise InvalidToken(type(exc).__name__) from exc
    iat_ms = claims.get("iat_ms")
    if (
        claims.get("type") != "refresh"
        or not all(
            isinstance(claims.get(name), str) and re.fullmatch(_UUID4, claims[name])
            for name in ("sub", "jti", "family_id")
        )
        or not isinstance(iat_ms, int)
        or isinstance(iat_ms, bool)
        or location_from_claims(claims) is None
    ):
        raise InvalidToken("malformed refresh token")
    return claims


def access_subject(token: str, config: AuthzConfig) -> str | None:
    """The `sub` of a validly signed access token, expired or not; None for anything else.

    Refresh and logout compare it with the refresh token's, as today: a mismatched pair is
    refused (defence in depth)."""
    try:
        claims = _decode(token, config, require=["sub", "type", "iss", "aud"], verify_exp=False)
    except (PyJWTError, InvalidToken):
        return None
    sub = claims.get("sub")
    return sub if claims.get("type") == "access" and isinstance(sub, str) else None
