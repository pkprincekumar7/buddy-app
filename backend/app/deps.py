from datetime import datetime, timezone

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.auth_utils import decode_token
from app.database import get_db
from app.models import User


def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
) -> User:
    token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = decode_token(token)
    if payload is None or not payload.get("sub") or payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid token")
    user = db.get(User, payload["sub"])
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if user.tokens_revoked_at is not None:
        iat = payload.get("iat")
        if iat is None:
            raise HTTPException(status_code=401, detail="Session revoked")
        token_issued_at = datetime.fromtimestamp(iat, tz=timezone.utc)
        # Normalise to aware UTC — DateTime(timezone=True) returns aware datetimes
        # from PostgreSQL; SQLite may return naive ones, so we coerce either way.
        revoked_at = user.tokens_revoked_at
        if revoked_at.tzinfo is None:
            revoked_at = revoked_at.replace(tzinfo=timezone.utc)
        if token_issued_at <= revoked_at:
            raise HTTPException(status_code=401, detail="Session revoked")
    return user
