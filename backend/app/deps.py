from datetime import datetime, timezone

from fastapi import Depends, HTTPException, Request
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.auth_utils import decode_token
from app.database import get_db
from app import models
from app.routing import LOCATION_RE
from app.settings import settings


async def get_current_user(
    request: Request,
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> dict:
    token = request.cookies.get("access_token")
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

    if user.get("tokens_revoked_at") is not None:
        iat = payload.get("iat")
        if iat is None:
            raise HTTPException(status_code=401, detail="Session revoked")
        token_issued_at = datetime.fromtimestamp(iat, tz=timezone.utc)
        revoked_at = user["tokens_revoked_at"]
        if revoked_at.tzinfo is None:
            revoked_at = revoked_at.replace(tzinfo=timezone.utc)
        if token_issued_at <= revoked_at:
            raise HTTPException(status_code=401, detail="Session revoked")

    return user
