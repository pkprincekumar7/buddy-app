from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, HTTPException, Request
from fastapi.security import APIKeyCookie, HTTPAuthorizationCredentials, HTTPBearer
from motor.motor_asyncio import AsyncIOMotorDatabase

from app import models
from app.auth_utils import decode_token, extract_token
from app.database import get_db
from app.routing import LOCATION_RE
from app.settings import Settings, get_settings

# These two schemes exist solely so FastAPI advertises the auth requirement in
# the OpenAPI schema (Swagger UI's padlocks / "Authorize" dialog). auto_error=False
# means neither raises on its own — get_current_user below does the real
# extraction and verification via extract_token(), which accepts either form.
_cookie_scheme = APIKeyCookie(name="access_token", auto_error=False)
_bearer_scheme = HTTPBearer(auto_error=False)

Db = Annotated[AsyncIOMotorDatabase, Depends(get_db)]
SettingsDep = Annotated[Settings, Depends(get_settings)]


async def get_current_user(
    request: Request,
    db: Db,
    settings: SettingsDep,
    _cookie: Annotated[str | None, Depends(_cookie_scheme)] = None,
    _bearer: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer_scheme)] = None,
) -> dict:
    token = extract_token(request, "access_token")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = decode_token(token)
    if not payload or not payload.get("sub") or payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid token")

    user_id = payload["sub"]
    raw_location = payload.get("location", settings.default_location)
    location = (
        raw_location
        if isinstance(raw_location, str) and LOCATION_RE.match(raw_location)
        else settings.default_location
    )

    user = await db[models.USERS].find_one({"_id": user_id, "location": location})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    if user.get("is_locked"):
        raise HTTPException(
            status_code=403, detail="Your account has been locked. Please contact support."
        )

    if user.get("tokens_revoked_at") is not None:
        iat = payload.get("iat")
        if iat is None:
            raise HTTPException(status_code=401, detail="Session revoked")
        token_issued_at = datetime.fromtimestamp(iat, tz=UTC)
        revoked_at = user["tokens_revoked_at"]
        if revoked_at.tzinfo is None:
            revoked_at = revoked_at.replace(tzinfo=UTC)
        if token_issued_at <= revoked_at:
            raise HTTPException(status_code=401, detail="Session revoked")

    return user


async def get_current_admin(
    user: Annotated[dict, Depends(get_current_user)],
) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


async def get_current_parent(
    user: Annotated[dict, Depends(get_current_user)],
) -> dict:
    if user.get("role") == "admin":
        raise HTTPException(status_code=403, detail="Not available for admin accounts")
    return user


# Reusable Annotated aliases — import these in routers instead of repeating
# `= Depends(get_current_user)` / `= Depends(get_current_parent)` / etc. FastAPI
# caches each dependency's result per-request, so using the same alias in a
# router-level `dependencies=[...]` and again as a function parameter does not
# re-run the check twice.
CurrentUser = Annotated[dict, Depends(get_current_user)]
CurrentParent = Annotated[dict, Depends(get_current_parent)]
CurrentAdmin = Annotated[dict, Depends(get_current_admin)]
