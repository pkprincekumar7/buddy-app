import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

import bcrypt as _bcrypt
import jwt
from fastapi import Request, Response
from jwt.exceptions import PyJWTError
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


def _encode(payload: dict[str, Any]) -> str:
    return jwt.encode(
        payload,
        settings.jwt_private_key,
        algorithm=settings.jwt_algorithm,
        headers={"kid": settings.jwt_key_id},
    )


def create_access_token(
    sub: str,
    location: str = settings.default_location,
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
        _reserved = {"sub", "iat", "exp", "type", "location"}
        overlap = _reserved & extra.keys()
        if overlap:
            raise ValueError(f"extra must not override reserved JWT claims: {overlap}")
        payload.update(extra)
    return _encode(payload)


def create_refresh_token(sub: str, location: str = settings.default_location) -> tuple[str, str]:
    jti = str(uuid.uuid4())
    expire = datetime.now(UTC) + timedelta(hours=settings.jwt_refresh_expire_hours)
    token = _encode(
        {"sub": sub, "exp": expire, "type": "refresh", "jti": jti, "location": location}
    )
    return token, jti


def decode_token(token: str) -> dict[str, Any] | None:
    try:
        return jwt.decode(token, settings.jwt_public_key, algorithms=[settings.jwt_algorithm])
    except PyJWTError:
        return None


def decode_token_of_type(
    token: str, expected: Literal["access", "refresh"]
) -> dict[str, Any] | None:
    payload = decode_token(token)
    if not payload or payload.get("type") != expected:
        return None
    return payload


def decode_access_token_ignore_exp(token: str) -> dict[str, Any] | None:
    try:
        payload = jwt.decode(
            token,
            settings.jwt_public_key,
            algorithms=[settings.jwt_algorithm],
            options={"verify_exp": False},
        )
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
