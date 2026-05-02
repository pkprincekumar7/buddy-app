from datetime import datetime, timedelta
from typing import Any, Literal

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.settings import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def _encode(payload: dict[str, Any]) -> str:
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_access_token(sub: str, extra: dict[str, Any] | None = None) -> str:
    expire = datetime.utcnow() + timedelta(minutes=settings.jwt_access_expire_minutes)
    payload: dict[str, Any] = {"sub": sub, "exp": expire, "type": "access"}
    if extra:
        payload.update(extra)
    return _encode(payload)


def create_refresh_token(sub: str) -> str:
    expire = datetime.utcnow() + timedelta(hours=settings.jwt_refresh_expire_hours)
    return _encode({"sub": sub, "exp": expire, "type": "refresh"})


def decode_token(token: str) -> dict[str, Any] | None:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError:
        return None


def decode_token_of_type(token: str, expected: Literal["access", "refresh"]) -> dict[str, Any] | None:
    payload = decode_token(token)
    if not payload or payload.get("type") != expected:
        return None
    return payload
