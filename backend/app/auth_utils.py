import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any, Literal
import uuid

import bcrypt as _bcrypt
import jwt
from jwt.exceptions import PyJWTError

from app.settings import settings


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
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_access_token(
    sub: str,
    location: str = settings.default_location,
    extra: dict[str, Any] | None = None,
) -> str:
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=settings.jwt_access_expire_minutes)
    payload: dict[str, Any] = {
        "sub": sub,
        "iat": now,
        "exp": expire,
        "type": "access",
        "location": location,
    }
    if extra:
        _RESERVED = {"sub", "iat", "exp", "type", "location"}
        overlap = _RESERVED & extra.keys()
        if overlap:
            raise ValueError(f"extra must not override reserved JWT claims: {overlap}")
        payload.update(extra)
    return _encode(payload)


def create_refresh_token(sub: str, location: str = settings.default_location) -> tuple[str, str]:
    jti = str(uuid.uuid4())
    expire = datetime.now(timezone.utc) + timedelta(hours=settings.jwt_refresh_expire_hours)
    token = _encode({"sub": sub, "exp": expire, "type": "refresh", "jti": jti, "location": location})
    return token, jti


def decode_token(token: str) -> dict[str, Any] | None:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except PyJWTError:
        return None


def decode_token_of_type(token: str, expected: Literal["access", "refresh"]) -> dict[str, Any] | None:
    payload = decode_token(token)
    if not payload or payload.get("type") != expected:
        return None
    return payload


def decode_access_token_ignore_exp(token: str) -> dict[str, Any] | None:
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
            options={"verify_exp": False},
        )
    except PyJWTError:
        return None
    if payload.get("type") != "access":
        return None
    return payload
