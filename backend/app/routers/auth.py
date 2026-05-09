import hashlib
import logging
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from email_validator import validate_email as _validate_email, EmailNotValidError

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy import select, delete, update

try:
    from google.oauth2 import id_token as _google_id_token
    from google.auth.transport import requests as _google_requests
except ImportError:
    _google_id_token = None  # type: ignore[assignment]
    _google_requests = None  # type: ignore[assignment]
    logging.getLogger(__name__).warning(
        "google-auth package is not installed — Google sign-in endpoints will "
        "return 503.  Install with: pip install 'google-auth[requests]'"
    )

import anyio

from app.auth_utils import (
    async_hash_password,
    async_verify_password,
    create_access_token,
    create_refresh_token,
    decode_access_token_ignore_exp,
    decode_token_of_type,
    hash_password,
    verify_password,
)
from app.database import db_for_region, get_db, get_router_db
from app.deps import get_current_user
from app.limiter import limiter, user_limiter
from app.models import RefreshToken, User, UserRegionRecord
from app.routing import resolve_region, REGION_RE
from app.settings import settings

router = APIRouter(tags=["auth"])
log = logging.getLogger(__name__)

_DUMMY_HASH: str = hash_password("__dummy_constant_time__")

# Path for the refresh-token cookie — scoped to /api/v1/auth/ so it is sent to both
# /auth/refresh (rotation) and /auth/logout (server-side invalidation), but not to
# any other API request.
_REFRESH_COOKIE_PATH = "/api/v1/auth/"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _email_hash(email: str) -> str:
    """sha256(email.lower()) — used as PII-free routing key."""
    return hashlib.sha256(email.lower().encode()).hexdigest()


def _compensate_router_record(
    router_db: Session,
    route_record: "UserRegionRecord",
    ehash: str,
    op: str,
) -> None:
    """
    Saga Phase-1 compensation: delete the router record so the email is not
    permanently blocked after a Phase-2 failure.

    Returns normally when the delete succeeds; the caller is then responsible
    for raising the appropriate HTTPException (e.g. "please try again").

    Raises HTTPException(500, "… cleanup incomplete") when the delete itself
    fails, logging the email_hash so ops can run:
        DELETE FROM user_regions WHERE email_hash = '<ehash>';
    """
    try:
        router_db.delete(route_record)
        router_db.commit()
    except Exception as comp_exc:
        log.error(
            "%s saga compensation failed for email_hash=%s; "
            "router record may be orphaned — manual cleanup required. "
            "compensation_error=%s",
            op, ehash, comp_exc, exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail=f"{op} failed and cleanup incomplete — please contact support",
        ) from comp_exc


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class RegisterBody(BaseModel):
    email: str = Field(max_length=255)
    password: str = Field(min_length=8, max_length=128)
    full_name: str | None = Field(default=None, max_length=255)
    # ISO-3166-1 alpha-2 country code — determines the data-residency region.
    # The frontend MUST present a country selector before calling this endpoint.
    country_code: str = Field(
        min_length=2,
        max_length=2,
        description="ISO-3166-1 alpha-2 country code (e.g. 'IN', 'US', 'DE')",
    )

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        try:
            info = _validate_email(v.strip(), check_deliverability=False)
            return info.normalized
        except EmailNotValidError as exc:
            raise ValueError(str(exc))

    @field_validator("country_code", mode="before")
    @classmethod
    def normalise_country_code(cls, v: object) -> object:
        # Strip whitespace BEFORE Pydantic applies min_length/max_length so that
        # " IN" (2 chars) doesn't pass the length check and then strip to "I" (1 char).
        return v.strip().upper() if isinstance(v, str) else v


class LoginBody(BaseModel):
    email: str = Field(max_length=255)
    password: str = Field(max_length=128)

    @field_validator("email")
    @classmethod
    def normalise_email(cls, v: str) -> str:
        return v.strip().lower()


class GoogleAuthBody(BaseModel):
    id_token: str = Field(max_length=4096)
    # Required only for NEW sign-ups (is_new_user=true from /auth/google/check).
    # For returning users this field is ignored — their region is read from
    # user_regions.  Omit it on subsequent logins; supply it on first sign-up.
    country_code: str | None = Field(
        default=None,
        min_length=2,
        max_length=2,
        description="ISO-3166-1 alpha-2 country code — required for new accounts",
    )

    @field_validator("country_code", mode="before")
    @classmethod
    def normalise_country_code(cls, v: object) -> object:
        # Strip whitespace BEFORE Pydantic applies min_length/max_length (same
        # fix as RegisterBody) so " IN" doesn't pass length then strip to "I".
        return v.strip().upper() if isinstance(v, str) else v


class DeleteAccountBody(BaseModel):
    confirm_email: str = Field(max_length=255)


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


def _set_auth_cookies(
    response: Response,
    user_id: str,
    region: str,
    db: Session,
) -> None:
    """Issue access + refresh tokens and write the refresh JTI to the DB."""
    kw = _cookie_kwargs()
    response.set_cookie(
        key="access_token",
        value=create_access_token(user_id, region=region),
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
# Google token verification helper (shared by /check and /google)
# ---------------------------------------------------------------------------

def _verify_google_token(id_token_str: str) -> dict:
    """
    Verify a Google ID token and return the decoded info dict.

    Raises HTTPException on any verification failure so callers don't need
    to repeat the error-classification logic.
    """
    if not settings.google_client_id:
        raise HTTPException(status_code=503, detail="Google sign-in is not configured")
    if _google_id_token is None:
        raise HTTPException(
            status_code=503,
            detail=(
                "Server cannot verify Google tokens: the `google-auth[requests]` package "
                "is not installed.  Contact the server administrator."
            ),
        )
    try:
        return _google_id_token.verify_oauth2_token(
            id_token_str,
            _google_requests.Request(),
            settings.google_client_id,
            clock_skew_in_seconds=60,
        )
    except Exception as exc:
        log.warning(
            "Google ID token verification failed: %s: %s",
            type(exc).__name__, exc, exc_info=True,
        )
        msg = str(exc).lower()
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


# ---------------------------------------------------------------------------
# Auth endpoints
# ---------------------------------------------------------------------------

@router.post("/auth/register", status_code=200)
@limiter.limit("5/minute")
async def register(
    request: Request,
    body: RegisterBody,
    response: Response,
    router_db: Session = Depends(get_router_db),
):
    """
    Register a new user.

    Saga pattern (two-phase write):
      Phase 1 — write UserRegionRecord to the Global Router DB (PII-free).
                 Fails with 409 if email already registered.
      Phase 2 — write User to the correct regional DB.
                 On failure, compensate by deleting the Phase-1 record so
                 the email is not permanently blocked.

    In single-instance mode both DBs are the same engine, so this is
    effectively a two-step transaction on a single database.
    Compensation failure is logged with the email_hash for manual ops cleanup:
      DELETE FROM user_regions WHERE email_hash = '<ehash>';
    """
    ehash = _email_hash(body.email)
    region = resolve_region(body.country_code or "")

    # Phase 1 — claim the email in the router DB
    existing_route = router_db.get(UserRegionRecord, ehash)
    if existing_route:
        # Run a dummy bcrypt to equalise response time whether or not the email
        # exists, preventing timing-based email enumeration (Vuln 2 fix).
        await async_verify_password(body.password, _DUMMY_HASH)
        if existing_route.is_deleted:
            # Account deletion is in progress — window is normally milliseconds.
            raise HTTPException(
                status_code=409,
                detail="This email address is temporarily unavailable. Please try again shortly.",
            )
        raise HTTPException(status_code=409, detail="Email already registered")

    new_user_id = str(uuid.uuid4())

    route_record = UserRegionRecord(
        email_hash=ehash,
        user_id=new_user_id,
        region=region,
        status='pending',
    )
    router_db.add(route_record)
    try:
        router_db.commit()
    except IntegrityError:
        router_db.rollback()
        # Concurrent request won the race — equalise timing before returning 409.
        await async_verify_password(body.password, _DUMMY_HASH)
        raise HTTPException(status_code=409, detail="Email already registered")

    # Phase 2 — write the User to the regional DB
    try:
        with db_for_region(region) as regional_db:
            user = User(
                id=new_user_id,
                email=body.email,
                password_hash=await async_hash_password(body.password),
                full_name=body.full_name or "Parent",
                role="parent",
                country_code=body.country_code,
            )
            regional_db.add(user)
            try:
                regional_db.commit()
            except IntegrityError:
                regional_db.rollback()
                # Email already exists in the regional DB (race or pre-existing row).
                # Compensate Phase 1 before surfacing 409.
                _compensate_router_record(router_db, route_record, ehash, op="Registration")
                raise HTTPException(status_code=409, detail="Email already registered")

            regional_db.refresh(user)
            log.info("user.register id=%s region=%s", user.id, region)

            # Phase 3 — mark router record active now that Phase 2 is confirmed
            route_record.status = 'active'
            try:
                router_db.commit()
            except Exception as status_exc:
                router_db.rollback()
                log.warning(
                    "user.register status update failed email_hash=%s — "
                    "reconciler will repair within %d min: %s",
                    ehash, settings.reconciler_interval_minutes, status_exc,
                )

            # Issue cookies — refresh token written to regional DB
            _set_auth_cookies(response, user.id, region, regional_db)
    except HTTPException:
        raise
    except Exception as exc:
        log.error("user.register regional write failed, compensating: %s", exc)
        _compensate_router_record(router_db, route_record, ehash, op="Registration")
        raise HTTPException(status_code=500, detail="Registration failed — please try again")

    return {"status": "ok"}


@router.post("/auth/login", status_code=200)
@limiter.limit("10/minute")
async def login(
    request: Request,
    body: LoginBody,
    response: Response,
    router_db: Session = Depends(get_router_db),
):
    """
    Authenticate a user.

    Two-phase lookup:
      1. Hash the email and look up the router DB → get region + user_id.
      2. Load the User from the correct regional DB and verify password.

    In single-instance mode the router DB is the main DB, so this is
    equivalent to the original single-query login.
    """
    ehash = _email_hash(body.email)
    route_record = router_db.get(UserRegionRecord, ehash)

    # -----------------------------------------------------------------
    # Tombstone check — account deletion in progress: treat as not found
    # (same constant-time dummy hash path) so we don't leak the state.
    # -----------------------------------------------------------------
    if route_record and route_record.is_deleted:
        await async_verify_password(body.password, _DUMMY_HASH)   # constant-time
        raise HTTPException(status_code=401, detail="Invalid email or password")

    region = route_record.region if route_record else settings.default_region

    with db_for_region(region) as regional_db:
        user = regional_db.execute(
            select(User).where(User.email == body.email)
        ).scalar_one_or_none()

        target_hash = user.password_hash if user else _DUMMY_HASH
        password_ok = await async_verify_password(body.password, target_hash)

        if not user or not password_ok:
            log.warning("auth.login.failed email_hash=%s", ehash)
            raise HTTPException(status_code=401, detail="Invalid email or password")

        log.info("auth.login.ok id=%s region=%s", user.id, region)
        _set_auth_cookies(response, user.id, region, regional_db)

    return {"status": "ok"}


@router.post("/auth/refresh", status_code=200)
@user_limiter.limit("20/minute")
def refresh_tokens(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    """
    Rotate access + refresh token pair.

    get_db is region-aware: it reads the region from the (possibly expired)
    access_token cookie, so the RefreshToken lookup always hits the right DB.
    The new access token carries forward the same region claim.

    Rotation is atomic: the old token is deleted and the new token is committed
    in the same transaction, so there is no window where both tokens are valid.
    """
    access_token = request.cookies.get("access_token")
    refresh_token_val = request.cookies.get("refresh_token")
    if not access_token or not refresh_token_val:
        raise HTTPException(status_code=401, detail="Missing tokens")

    access_payload = decode_access_token_ignore_exp(access_token)
    refresh_payload = decode_token_of_type(refresh_token_val, "refresh")
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

    expires_at = row.expires_at if row.expires_at.tzinfo is not None else row.expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        db.delete(row)
        db.commit()
        _clear_auth_cookies(response)
        log.warning("auth.refresh.failed reason=db_expiry sub=%s", refresh_payload.get("sub"))
        raise HTTPException(status_code=401, detail="Session expired")

    uid = row.user_id
    # Carry forward the region from the original access token, validating it
    # against the same REGION_RE allowlist used in _region_from_request so a
    # tampered-but-still-signed token cannot embed an unexpected region value.
    raw_region = access_payload.get("region", settings.default_region)
    region = (
        raw_region
        if isinstance(raw_region, str) and REGION_RE.match(raw_region)
        else settings.default_region
    )
    # Delete old token and issue new tokens atomically so there is never a
    # window where both the old and new refresh tokens are simultaneously valid.
    db.delete(row)
    _set_auth_cookies(response, uid, region, db)
    return {"status": "ok"}


@router.post("/auth/logout", status_code=204)
@user_limiter.limit("20/minute")
def logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    """
    Invalidate the refresh token.  get_db is region-aware so the correct
    regional DB is hit automatically via the access_token cookie.
    """
    refresh_token_val = request.cookies.get("refresh_token")
    if refresh_token_val:
        refresh_payload = decode_token_of_type(refresh_token_val, "refresh")
        if refresh_payload and (jti := refresh_payload.get("jti")):
            access_token = request.cookies.get("access_token")
            if access_token:
                access_payload = decode_access_token_ignore_exp(access_token)
                if access_payload and access_payload.get("sub") != refresh_payload.get("sub"):
                    _clear_auth_cookies(response)
                    raise HTTPException(status_code=401, detail="Token mismatch")
            db.execute(delete(RefreshToken).where(RefreshToken.jti == jti))
            db.commit()
    _clear_auth_cookies(response)


@router.post("/auth/google", status_code=200)
@limiter.limit("5/minute")
async def google_auth(
    request: Request,
    body: GoogleAuthBody,
    response: Response,
    router_db: Session = Depends(get_router_db),
):
    """
    Google sign-in / sign-up.

    Existing user  — country_code is not required; region comes from user_regions.
    New user       — country_code is required; returns 422 country_code_required if
                     omitted so the frontend knows to show a country-selector screen
                     before retrying this endpoint.
    """
    info = await anyio.to_thread.run_sync(_verify_google_token, body.id_token)

    raw_email = (info.get("email") or "").strip()
    if not raw_email:
        raise HTTPException(status_code=400, detail="Google did not return an email")
    if not info.get("email_verified"):
        raise HTTPException(status_code=400, detail="Google account email is not verified")
    try:
        email = _validate_email(raw_email, check_deliverability=False).normalized
    except EmailNotValidError:
        raise HTTPException(status_code=400, detail="Google did not return a valid email")

    ehash = _email_hash(email)
    route_record = router_db.get(UserRegionRecord, ehash)

    if route_record:
        if route_record.is_deleted:
            raise HTTPException(
                status_code=409,
                detail="This account is temporarily unavailable. Please try again shortly.",
            )
        # ── Existing user — region from router DB, country_code ignored ──
        region = route_record.region
        with db_for_region(region) as regional_db:
            user = regional_db.execute(
                select(User).where(User.email == email)
            ).scalar_one_or_none()
            if not user:
                raise HTTPException(
                    status_code=500,
                    detail="Account inconsistency; please contact support",
                )
            if user.id != route_record.user_id:
                log.error(
                    "google_auth user_id mismatch: router=%s regional=%s email_hash=%s",
                    route_record.user_id, user.id, ehash,
                )
                raise HTTPException(
                    status_code=500,
                    detail="Account inconsistency; please contact support",
                )
            _set_auth_cookies(response, user.id, region, regional_db)

    else:
        # ── New user — country_code is mandatory ──────────────────────────
        if not body.country_code:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "country_code_required",
                    "msg": (
                        "country_code is required for new accounts. "
                        "Present a country selector to the user and retry with country_code set."
                    ),
                },
            )

        region = resolve_region(body.country_code)
        new_user_id = str(uuid.uuid4())

        # Saga Phase 1: claim email in router DB
        new_route = UserRegionRecord(email_hash=ehash, user_id=new_user_id, region=region, status='pending')
        router_db.add(new_route)
        try:
            router_db.commit()
        except IntegrityError:
            router_db.rollback()
            # Lost race — another concurrent request claimed this email in Phase 1.
            route_record = router_db.get(UserRegionRecord, ehash)

            if route_record is None:
                # The winner also compensated (it claimed Phase 1 then failed
                # Phase 2 and rolled back).  Both requests are now in a clean
                # state — tell the caller to retry.
                log.warning(
                    "google_auth lost-race: competing registration also "
                    "compensated for email_hash=%s; asking client to retry.",
                    ehash,
                )
                raise HTTPException(
                    status_code=409,
                    detail="Sign-in temporarily unavailable due to a concurrent request. Please try again.",
                )

            # Winner succeeded — sign in under their router record's region.
            if route_record.is_deleted:
                raise HTTPException(
                    status_code=409,
                    detail="This account is temporarily unavailable. Please try again shortly.",
                )
            region = route_record.region
            with db_for_region(region) as regional_db:
                user = regional_db.execute(
                    select(User).where(User.email == email)
                ).scalar_one_or_none()
                if not user:
                    raise HTTPException(
                        status_code=500,
                        detail="Account inconsistency; please contact support",
                    )
                if user.id != route_record.user_id:
                    log.error(
                        "google_auth race-recovery user_id mismatch: router=%s regional=%s email_hash=%s",
                        route_record.user_id, user.id, ehash,
                    )
                    raise HTTPException(
                        status_code=500,
                        detail="Account inconsistency; please contact support",
                    )
                _set_auth_cookies(response, user.id, region, regional_db)
            return {"status": "ok"}

        # Saga Phase 2: create user in regional DB
        #
        # _route_needs_compensation tracks whether Phase 1 still needs to be
        # rolled back on failure.  It starts True (Phase 1 is live and must be
        # cleaned up if Phase 2 fails) and is set False once the router record
        # is either successfully patched to point at an existing user OR the
        # user row is committed — at that point deleting the router record would
        # orphan a real account.
        _route_needs_compensation = True
        try:
            with db_for_region(region) as regional_db:
                raw_name = re.sub(r'[\x00-\x1f\x7f]', '', (info.get("name") or "").strip())
                full_name = (raw_name or email.split("@")[0])[:255]
                user = User(
                    id=new_user_id,
                    email=email,
                    password_hash=await async_hash_password(secrets.token_urlsafe(32)),
                    full_name=full_name,
                    role="parent",
                    country_code=body.country_code,
                )
                regional_db.add(user)
                try:
                    regional_db.commit()
                except IntegrityError:
                    # User row already exists (race between /check and sign-up).
                    # Update the Phase-1 router record to point at the existing
                    # user rather than deleting it — deleting would leave the user
                    # permanently without a routing record, breaking password login
                    # and causing every subsequent Google sign-in to loop through
                    # the new-user path (Vuln 3 fix).
                    regional_db.rollback()
                    with db_for_region(region) as fresh_db:
                        existing_user = fresh_db.execute(
                            select(User).where(User.email == email)
                        ).scalar_one()
                    new_route.user_id = existing_user.id
                    new_route.status = 'active'
                    try:
                        router_db.commit()
                    except Exception as patch_exc:
                        router_db.rollback()
                        log.error(
                            "google_auth router record patch failed for email_hash=%s; "
                            "error=%s", ehash, patch_exc, exc_info=True,
                        )
                        raise HTTPException(
                            status_code=500, detail="Sign-in failed — please try again"
                        ) from patch_exc
                    # Patch committed — router record now points at a real user.
                    # Do NOT compensate (delete) it if something fails after this.
                    _route_needs_compensation = False
                    with db_for_region(region) as fresh_db:
                        user = fresh_db.execute(
                            select(User).where(User.email == email)
                        ).scalar_one()
                        _set_auth_cookies(response, user.id, region, fresh_db)
                else:
                    # New user row committed — Phase 1 and Phase 2 are both live.
                    # The router record is now permanently valid; stop compensation.
                    _route_needs_compensation = False
                    regional_db.refresh(user)
                    # Phase 3 — mark router record active
                    new_route.status = 'active'
                    try:
                        router_db.commit()
                    except Exception as status_exc:
                        router_db.rollback()
                        log.warning(
                            "google_auth status update failed email_hash=%s — "
                            "reconciler will repair within %d min: %s",
                            ehash, settings.reconciler_interval_minutes, status_exc,
                        )
                    _set_auth_cookies(response, user.id, region, regional_db)
        except HTTPException:
            raise
        except Exception as exc:
            # Only compensate (delete the router record) if the user row was
            # never committed and the router record was never patched to point
            # at an existing user.  If _route_needs_compensation is False the
            # router record is valid and must be kept.
            log.error("google_auth regional write failed, compensating: %s", exc)
            if _route_needs_compensation:
                live_route = router_db.get(UserRegionRecord, ehash)
                if live_route:
                    _compensate_router_record(router_db, live_route, ehash, op="Sign-in")
            raise HTTPException(status_code=500, detail="Sign-in failed — please try again")

    return {"status": "ok"}


@router.get("/auth/me", response_model=MeResponse)
@user_limiter.limit("60/minute")
def auth_me(request: Request, user: User = Depends(get_current_user)):
    return MeResponse(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=user.role,
    )


@router.delete("/user/me", status_code=204)
@user_limiter.limit("3/minute")
def delete_account(
    request: Request,
    body: DeleteAccountBody,
    response: Response,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    router_db: Session = Depends(get_router_db),
):
    """
    Delete the authenticated user's account.

    Four-step deletion — revokes tokens immediately and closes the re-registration
    race window:
      Step 0  SET tokens_revoked_at on the user row.
              All outstanding access tokens are immediately invalidated by
              get_current_user, so no existing session can perform further actions.
      Step 1  SET is_deleted=TRUE on the router record (soft-delete / tombstone).
              Concurrent register/login calls see the tombstone and get a
              "temporarily unavailable" / 401 response before we touch user data.
      Step 2  DELETE the user row (cascade removes all owned data).
      Step 3  DELETE the router record — email is now fully free.

    Failure modes:
      Step 0 fails → nothing deleted; tokens still valid; caller retries.
      Step 1 fails → tokens revoked, user row intact; caller retries.
      Step 2 fails → tokens revoked, tombstone set, user row intact; caller retries.
      Step 3 fails → user row gone, tombstone orphaned; email is blocked with a
                     clear message.  Ops cleanup:
                       DELETE FROM user_regions WHERE is_deleted = TRUE;
    """
    if body.confirm_email.strip().lower() != user.email:
        raise HTTPException(status_code=400, detail="Email confirmation does not match")

    ehash = _email_hash(user.email)
    route_record = router_db.get(UserRegionRecord, ehash)

    # Step 0 — revoke all outstanding access tokens immediately.
    # Purging all RefreshToken rows in the same commit means refresh_tokens()
    # finds no JTI and returns 401 immediately, closing the race window where
    # an attacker with a stolen refresh token could re-issue a new access token
    # after tokens_revoked_at is set but before the user row is deleted (Vuln 1 fix).
    revoke_time = datetime.now(timezone.utc)
    user.tokens_revoked_at = revoke_time
    db.execute(delete(RefreshToken).where(RefreshToken.user_id == user.id))
    try:
        db.commit()
    except Exception as exc:
        log.error(
            "delete_account Step 0 (token revocation) failed for email_hash=%s; "
            "aborting — no data changed. error=%s",
            ehash, exc, exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail="Account deletion failed — please try again or contact support",
        ) from exc

    # Step 1 — tombstone
    if route_record:
        route_record.is_deleted = True
        try:
            router_db.commit()
        except Exception as exc:
            log.error(
                "delete_account Step 1 (tombstone) failed for email_hash=%s; "
                "aborting — no data changed. error=%s",
                ehash, exc, exc_info=True,
            )
            raise HTTPException(
                status_code=500,
                detail="Account deletion failed — please try again or contact support",
            ) from exc

    # Step 2 — delete user row (cascade)
    db.delete(user)
    try:
        db.commit()
    except Exception as exc:
        log.error(
            "delete_account Step 2 (user row) failed for email_hash=%s; "
            "attempting to restore account to usable state. error=%s",
            ehash, exc, exc_info=True,
        )
        # Attempt to restore: clear token revocation so the user can still log in.
        try:
            db.rollback()
            db.execute(
                update(User)
                .where(User.id == user.id)
                .values(tokens_revoked_at=None)
            )
            db.commit()
        except Exception as restore_exc:
            log.error(
                "delete_account Step 2 restore failed for email_hash=%s; "
                "tokens remain revoked — user cannot log in. "
                "Manual fix: UPDATE users SET tokens_revoked_at = NULL WHERE id = '%s'; "
                "error=%s",
                ehash, user.id, restore_exc,
            )
        # Attempt to clear the tombstone so new registrations are not blocked.
        if route_record:
            try:
                route_record.is_deleted = False
                router_db.commit()
            except Exception:
                log.error(
                    "delete_account Step 2 tombstone revert failed for email_hash=%s",
                    ehash,
                )
        raise HTTPException(
            status_code=500,
            detail="Account deletion failed — please try again or contact support.",
        ) from exc

    # Step 3 — hard-delete router record
    if route_record:
        router_db.delete(route_record)
        try:
            router_db.commit()
        except Exception as exc:
            # Non-fatal: user row is gone, only the tombstone remains.
            # Email is effectively blocked until ops removes the orphan.
            log.error(
                "delete_account Step 3 (router record) failed for email_hash=%s; "
                "user row deleted but tombstone is orphaned. "
                "Clean up with: DELETE FROM user_regions WHERE is_deleted = TRUE; "
                "error=%s",
                ehash, exc, exc_info=True,
            )
            # Do not raise — the account is deleted from the user's perspective.

    _clear_auth_cookies(response)
