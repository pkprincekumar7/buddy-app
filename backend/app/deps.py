from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.auth_utils import decode_token
from app.database import get_db
from app.models import User


def get_current_user(
    authorization: str | None = Header(None),
    db: Session = Depends(get_db),
) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.split(" ", 1)[1]
    payload = decode_token(token)
    if not payload or not payload.get("sub") or payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid token")
    user = db.get(User, payload["sub"])
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user
