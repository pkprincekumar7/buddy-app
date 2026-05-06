import logging
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy import select, delete

from app.auth_utils import (
    create_access_token,
    create_refresh_token,
    decode_access_token_ignore_exp,
    decode_token_of_type,
    hash_password,
    verify_password,
)
from app.database import get_db
from app.deps import get_current_user
from app.models import RefreshToken, User
from app.settings import settings

router = APIRouter(tags=["auth"])
log = logging.getLogger(__name__)

_DUMMY_HASH: str = hash_password("__dummy_constant_time__")

# Path for the refresh-token cookie — scoped so it is only sent to the refresh endpoint,
# never included in regular API requests.
_REFRESH_COOKIE_PATH = "/api/v1/auth/refresh"


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class RegisterBody(BaseModel):
    email: str = Field(max_length=255)
    password: str = Field(min_length=8, max_length=128)
    full_name: str | None = "Parent"

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        v = v.strip().lower()
        if "@" not in v or "." not in v.split("@")[-1]:
            raise ValueError("Invalid email address")
        return v

    @field_validator("full_name")
    @classmethod
    def validate_full_name(cls, v: str | None) -> str | None:
        if v and len(v) > 255:
            raise ValueError("Name must not exceed 255 characters")
        return v


class LoginBody(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def normalise_email(cls, v: str) -> str:
        return v.strip().lower()


class GoogleAuthBody(BaseModel):
    id_token: str


class DeleteAccountBody(BaseModel):
    confirm_email: str


class MeResponse(BaseModel):
    id: str
    email: str
    full_name: str
    role: str


# ---------------------------------------------------------------------------
# Cookie helpers
# ---------------------------------------------------------------------------

def _cookie_kwargs() -> dict:
    return dict(
        httponly=True,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
        domain=settings.cookie_domain or None,
    )


def _set_auth_cookies(response: Response, user_id: str, db: Session) -> None:
    kw = _cookie_kwargs()
    response.set_cookie(
        key="access_token",
        value=create_access_token(user_id),
        max_age=settings.jwt_access_expire_minutes * 60,
        path="/",
        **kw,
    )
    refresh_token, jti = create_refresh_token(user_id)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=settings.jwt_refresh_expire_hours)
    db.add(RefreshToken(jti=jti, user_id=user_id, expires_at=expires_at))
    db.commit()
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        max_age=settings.jwt_refresh_expire_hours * 3600,
        path=_REFRESH_COOKIE_PATH,
        **kw,
    )


def _clear_auth_cookies(response: Response) -> None:
    kw = _cookie_kwargs()
    response.delete_cookie("access_token", path="/", **kw)
    response.delete_cookie("refresh_token", path=_REFRESH_COOKIE_PATH, **kw)


# ---------------------------------------------------------------------------
# Auth endpoints
# ---------------------------------------------------------------------------

@router.post("/auth/register", status_code=200)
def register(body: RegisterBody, response: Response, db: Session = Depends(get_db)):
    if db.execute(select(User).where(User.email == body.email)).scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already registered")
    user = User(
        email=body.email,
        password_hash=hash_password(body.password),
        full_name=body.full_name or "Parent",
        role="parent",
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Email already registered")
    db.refresh(user)
    log.info("user.register id=%s", user.id)
    _set_auth_cookies(response, user.id, db)
    return {"status": "ok"}


@router.post("/auth/login", status_code=200)
def login(body: LoginBody, response: Response, db: Session = Depends(get_db)):
    user = db.execute(select(User).where(User.email == body.email)).scalar_one_or_none()
    target_hash = user.password_hash if user else _DUMMY_HASH
    password_ok = verify_password(body.password, target_hash)
    if not user or not password_ok:
        log.warning("auth.login.failed email=%s", body.email)
        raise HTTPException(status_code=401, detail="Invalid email or password")
    log.info("auth.login.ok id=%s", user.id)
    _set_auth_cookies(response, user.id, db)
    return {"status": "ok"}


@router.post("/auth/refresh", status_code=200)
def refresh_tokens(request: Request, response: Response, db: Session = Depends(get_db)):
    access_token = request.cookies.get("access_token")
    refresh_token = request.cookies.get("refresh_token")
    if not access_token or not refresh_token:
        raise HTTPException(status_code=401, detail="Missing tokens")
    access_payload = decode_access_token_ignore_exp(access_token)
    refresh_payload = decode_token_of_type(refresh_token, "refresh")
    if not access_payload or not refresh_payload:
        _clear_auth_cookies(response)
        log.warning("auth.refresh.failed reason=invalid_tokens")
        raise HTTPException(status_code=401, detail="Invalid token")
    if access_payload.get("sub") != refresh_payload.get("sub"):
        _clear_auth_cookies(response)
        log.warning("auth.refresh.failed reason=subject_mismatch sub=%s", access_payload.get("sub"))
        raise HTTPException(status_code=401, detail="Token mismatch")
    jti = refresh_payload.get("jti")
    if not jti:
        _clear_auth_cookies(response)
        raise HTTPException(status_code=401, detail="Invalid token")
    row = db.get(RefreshToken, jti)
    if not row:
        _clear_auth_cookies(response)
        log.warning("auth.refresh.failed reason=jti_not_found sub=%s", refresh_payload.get("sub"))
        raise HTTPException(status_code=401, detail="Session expired or already logged out")
    uid = row.user_id
    db.delete(row)
    _set_auth_cookies(response, uid, db)
    return {"status": "ok"}


@router.post("/auth/logout", status_code=204)
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    refresh_token = request.cookies.get("refresh_token")
    if refresh_token:
        payload = decode_token_of_type(refresh_token, "refresh")
        if payload and (jti := payload.get("jti")):
            db.execute(delete(RefreshToken).where(RefreshToken.jti == jti))
            db.commit()
    _clear_auth_cookies(response)


@router.post("/auth/google", status_code=200)
def google_auth(body: GoogleAuthBody, response: Response, db: Session = Depends(get_db)):
    if not settings.google_client_id:
        raise HTTPException(status_code=503, detail="Google sign-in is not configured")
    try:
        from google.oauth2 import id_token as google_id_token
        from google.auth.transport import requests as google_requests

        info = google_id_token.verify_oauth2_token(
            body.id_token,
            google_requests.Request(),
            settings.google_client_id,
            clock_skew_in_seconds=60,
        )
    except Exception as exc:
        log.warning("Google ID token verification failed: %s: %s", type(exc).__name__, exc, exc_info=True)
        msg = str(exc).lower()
        if "requests library is not installed" in msg or "requests` package" in msg:
            raise HTTPException(
                status_code=500,
                detail=(
                    "Server cannot verify Google tokens: install the `requests` package "
                    "(use `google-auth[requests]` in requirements)."
                ),
            ) from exc
        if "audience" in msg or "wrong audience" in msg:
            detail = (
                "Google token does not match GOOGLE_CLIENT_ID on this server. "
                "Set GOOGLE_CLIENT_ID to the same OAuth Web client ID as VITE_GOOGLE_CLIENT_ID."
            )
        elif "expired" in msg or "too late" in msg:
            detail = "Google sign-in token has expired. Use a fresh credential from the browser."
        elif any(x in msg for x in ("certificate", "urlopen", "connection", "ssl", "timeout", "resolve")):
            detail = (
                "Could not verify Google sign-in (failed to reach Google). "
                "Check outbound HTTPS from the API (e.g. Docker network) and try again."
            )
        else:
            detail = "Invalid Google credential."
        raise HTTPException(status_code=401, detail=detail) from exc

    email = (info.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="Google did not return an email")
    if not info.get("email_verified"):
        raise HTTPException(status_code=400, detail="Google account email is not verified")
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if not user:
        raw_name = (info.get("name") or "").strip()
        full_name = (raw_name or email.split("@")[0])[:255]
        user = User(
            email=email,
            password_hash=hash_password(secrets.token_urlsafe(32)),
            full_name=full_name,
            role="parent",
        )
        db.add(user)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            user = db.execute(select(User).where(User.email == email)).scalar_one()
        else:
            db.refresh(user)
    _set_auth_cookies(response, user.id, db)
    return {"status": "ok"}


@router.get("/auth/me", response_model=MeResponse)
def auth_me(user: User = Depends(get_current_user)):
    return MeResponse(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=user.role,
    )


@router.delete("/user/me", status_code=204)
def delete_account(
    body: DeleteAccountBody,
    response: Response,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if body.confirm_email.strip().lower() != user.email:
        raise HTTPException(status_code=400, detail="Email confirmation does not match")
    db.delete(user)
    db.commit()
    _clear_auth_cookies(response)
