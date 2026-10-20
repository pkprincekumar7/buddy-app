import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from typing import Any, Literal

import bcrypt as _bcrypt
import jwt
from cryptography.hazmat.primitives.serialization import load_pem_private_key, load_pem_public_key
from fastapi import Request, Response
from jwt.exceptions import InvalidTokenError, PyJWTError
from jwt.types import Options
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel

from app import models
from app.constants import API_V1_PREFIX
from app.settings import settings


def extract_token(request: Request, cookie_name: str) -> str | None:
    """Extract an auth token from an HttpOnly cookie or an Authorization: Bearer header.

    Cookie takes priority (web clients). React Native's fetch polyfill has no
    cookie jar, so mobile clients store tokens in AsyncStorage and send them as
    a Bearer header instead — used as a fallback when no cookie is present.
    """
    token = request.cookies.get(cookie_name)
    if token:
        return token
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header[len("Bearer ") :]
    return None


def hash_password(password: str) -> str:
    return _bcrypt.hashpw(password.encode(), _bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _bcrypt.checkpw(plain.encode(), hashed.encode())
    except Exception:
        return False


async def async_hash_password(password: str) -> str:
    return await asyncio.to_thread(hash_password, password)


async def async_verify_password(plain: str, hashed: str) -> bool:
    return await asyncio.to_thread(verify_password, plain, hashed)


# Parsed key objects, cached by PEM: PyJWT re-parses a PEM string on every
# encode/decode otherwise (EDGE-04). Keyed by the PEM itself, so a test that
# swaps settings simply gets a fresh entry.
@lru_cache(maxsize=4)
def _signing_key(pem: str) -> Any:
    return load_pem_private_key(pem.encode(), password=None)


@lru_cache(maxsize=16)
def _verification_key(pem: str) -> Any:
    return load_pem_public_key(pem.encode())


class TokenMintingNotAllowed(RuntimeError):
    """This component has no JWT_PRIVATE_KEY — only auth (or all) mints tokens."""


def _encode(payload: dict[str, Any]) -> str:
    # Always signs with the current key only (APP-02), and stamps this
    # environment's iss/aud (EDGE-04) — setdefault, so tests can override them.
    if not settings.can_mint_tokens or not settings.jwt_private_key:
        raise TokenMintingNotAllowed(
            f"APP_COMPONENT={settings.app_component} can't mint tokens — only auth (or all) "
            "holds JWT_PRIVATE_KEY"
        )
    payload = {**payload}
    payload.setdefault("iss", settings.jwt_issuer)
    payload.setdefault("aud", settings.jwt_audience)
    return jwt.encode(
        payload,
        _signing_key(settings.jwt_private_key),
        algorithm=settings.jwt_algorithm,
        headers={"kid": settings.jwt_key_id},
    )


def create_access_token(
    sub: str,
    location: str,
    extra: dict[str, Any] | None = None,
) -> str:
    now = datetime.now(UTC)
    expire = now + timedelta(minutes=settings.jwt_access_expire_minutes)
    payload: dict[str, Any] = {
        "sub": sub,
        "iat": now,
        "exp": expire,
        "type": "access",
        "location": location,
    }
    if extra:
        _reserved = {"sub", "iat", "exp", "type", "location", "iss", "aud"}
        overlap = _reserved & extra.keys()
        if overlap:
            raise ValueError(f"extra must not override reserved JWT claims: {overlap}")
        payload.update(extra)
    return _encode(payload)


def create_refresh_token(sub: str, location: str) -> tuple[str, str]:
    jti = str(uuid.uuid4())
    now = datetime.now(UTC)
    expire = now + timedelta(hours=settings.jwt_refresh_expire_hours)
    token = _encode(
        {
            "sub": sub,
            "iat": now,
            "exp": expire,
            "type": "refresh",
            "jti": jti,
            "location": location,
        }
    )
    return token, jti


# Claims every token must carry, whatever its type. decode_token_of_type adds
# the per-type ones; the shared decode only requires what both types have.
# `location` is deliberately not listed: every caller validates it itself
# (location_from_claims) and logs a precise reason (invalid_location) rather
# than a generic decode failure.
_BASE_CLAIMS: tuple[str, ...] = ("exp", "iat", "sub", "type", "iss", "aud")
_REQUIRED_CLAIMS: dict[str, tuple[str, ...]] = {
    "access": _BASE_CLAIMS,
    "refresh": (*_BASE_CLAIMS, "jti"),
}


def decode_verified(
    token: str, *, require: tuple[str, ...] = _BASE_CLAIMS, verify_exp: bool = True
) -> dict[str, Any]:
    """Verify a token's signature and claims, or raise PyJWTError.

    The key is picked by the token's `kid` header from
    settings.jwt_verification_keys (APP-02) — a missing or unknown kid is
    rejected, never verified against a default key. `require` claims must be
    present (even when verify_exp=False, `exp` must still exist). exp/nbf/iat
    allow settings.jwt_leeway_seconds of clock skew; `iss` and `aud` must equal
    this environment's jwt_issuer / jwt_audience (EDGE-04). The single place every
    decode site (here, deps.py via the helpers below, limiter.py) goes
    through, so they can't drift apart.
    """
    kid = jwt.get_unverified_header(token).get("kid")
    if not isinstance(kid, str) or not kid:
        raise InvalidTokenError("missing kid")
    pem = settings.jwt_verification_keys.get(kid)
    if pem is None:
        raise InvalidTokenError(f"unknown kid: {kid}")
    # verify_exp is merged with `require`, never replacing it (EDGE-04).
    options: Options = {"require": list(require), "verify_exp": verify_exp}
    return jwt.decode(
        token,
        _verification_key(pem),
        algorithms=[settings.jwt_algorithm],
        leeway=settings.jwt_leeway_seconds,
        issuer=settings.jwt_issuer,
        audience=settings.jwt_audience,
        options=options,
    )


def decode_token(token: str) -> dict[str, Any] | None:
    try:
        return decode_verified(token)
    except PyJWTError:
        return None


def decode_token_of_type(
    token: str, expected: Literal["access", "refresh"]
) -> dict[str, Any] | None:
    try:
        payload = decode_verified(token, require=_REQUIRED_CLAIMS[expected])
    except PyJWTError:
        return None
    if payload.get("type") != expected:
        return None
    return payload


def decode_access_token_ignore_exp(token: str) -> dict[str, Any] | None:
    try:
        payload = decode_verified(token, require=_REQUIRED_CLAIMS["access"], verify_exp=False)
    except PyJWTError:
        return None
    if payload.get("type") != "access":
        return None
    return payload


# ---------------------------------------------------------------------------
# Auth cookies
# ---------------------------------------------------------------------------

REFRESH_COOKIE_PATH = f"{API_V1_PREFIX}/auth/"


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str


def cookie_kwargs() -> dict:
    return {
        "httponly": True,
        "secure": settings.cookie_secure,
        "samesite": settings.cookie_samesite,
        "domain": settings.cookie_domain or None,
    }


async def set_auth_cookies(
    response: Response,
    user_id: str,
    location: str,
    db: AsyncIOMotorDatabase,
) -> TokenPair:
    """Set HttpOnly auth cookies (for web) and return tokens for mobile clients."""
    kw = cookie_kwargs()
    access_token = create_access_token(user_id, location=location)
    response.set_cookie(
        key="access_token",
        value=access_token,
        max_age=settings.jwt_access_expire_minutes * 60,
        path="/",
        **kw,
    )
    refresh_token, jti = create_refresh_token(user_id, location=location)
    expires_at = datetime.now(UTC) + timedelta(hours=settings.jwt_refresh_expire_hours)
    await db[models.SESSIONS].insert_one(
        {
            "_id": jti,
            "user_id": user_id,
            "location": location,
            "expires_at": expires_at,
        }
    )
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        max_age=settings.jwt_refresh_expire_hours * 3600,
        path=REFRESH_COOKIE_PATH,
        **kw,
    )
    return TokenPair(access_token=access_token, refresh_token=refresh_token)


def clear_auth_cookies(response: Response) -> None:
    kw = cookie_kwargs()
    response.delete_cookie("access_token", path="/", **kw)
    response.delete_cookie("refresh_token", path=REFRESH_COOKIE_PATH, **kw)
