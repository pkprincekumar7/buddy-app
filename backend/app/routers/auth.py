import logging
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from email_validator import validate_email as _validate_email, EmailNotValidError

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field, field_validator
from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo.errors import DuplicateKeyError

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

from app.auth_utils import (
    async_hash_password,
    async_verify_password,
    create_access_token,
    create_refresh_token,
    decode_access_token_ignore_exp,
    decode_token_of_type,
    hash_password,
)
from app.database import get_db
from app.deps import get_current_user
from app.limiter import limiter, user_limiter
from app import models
from app.routing import resolve_region, LOCATION_RE
from app.settings import settings

router = APIRouter(tags=["auth"])
log = logging.getLogger(__name__)

_DUMMY_HASH: str = hash_password("__dummy_constant_time__")

_REFRESH_COOKIE_PATH = "/api/v1/auth/"


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class RegisterBody(BaseModel):
    email: str = Field(max_length=255)
    password: str = Field(min_length=8, max_length=128)
    full_name: str | None = Field(default=None, max_length=255)
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
    country_code: str | None = Field(
        default=None,
        min_length=2,
        max_length=2,
        description="ISO-3166-1 alpha-2 country code — required for new accounts",
    )

    @field_validator("country_code", mode="before")
    @classmethod
    def normalise_country_code(cls, v: object) -> object:
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


async def _set_auth_cookies(
    response: Response,
    user_id: str,
    location: str,
    db: AsyncIOMotorDatabase,
) -> None:
    kw = _cookie_kwargs()
    response.set_cookie(
        key="access_token",
        value=create_access_token(user_id, location=location),
        max_age=settings.jwt_access_expire_minutes * 60,
        path="/",
        **kw,
    )
    refresh_token, jti = create_refresh_token(user_id, location=location)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=settings.jwt_refresh_expire_hours)
    await db[models.SESSIONS].insert_one({
        "_id": jti,
        "user_id": user_id,
        "location": location,
        "expires_at": expires_at,
    })
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
# Google token verification helper
# ---------------------------------------------------------------------------

def _verify_google_token(id_token_str: str) -> dict:
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
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    # Registration uses a two-step compensating pattern instead of a transaction.
    # Reason: email_index is an unsharded collection (global uniqueness guard) and
    # users is sharded by location.  Including both in one transaction would make it
    # a cross-shard transaction, which Atlas M0/M2/M5 does not support — the same
    # constraint that keeps email_index outside the transaction in delete_account.
    #
    # Pattern:
    #   Step 1 — reserve the email in email_index (unsharded, outside any transaction).
    #   Step 2 — create the user document on the correct location shard.
    #   Compensating action — if Step 2 fails, release the Step 1 reservation so the
    #   address can be retried. This is the manual equivalent of a transaction rollback.

    location = resolve_region(body.country_code or "")
    now = datetime.now(timezone.utc)
    new_user_id = str(uuid.uuid4())

    # Step 1 — reserve the email address (unsharded, outside any transaction).
    # Inserting first means we own the email before touching any sharded collection.
    try:
        await db[models.EMAIL_INDEX].insert_one({
            "_id": body.email,
            "user_id": new_user_id,
            "location": location,
        })
    except DuplicateKeyError:
        # The email already exists in the index.  Check whether the user document is
        # also present — if not, this is an orphaned reservation left by a failed
        # delete_account (see Step 5 of delete_account; that path is best-effort).
        # Reclaim the orphan and let registration proceed; otherwise reject.
        existing_entry = await db[models.EMAIL_INDEX].find_one({"_id": body.email})
        orphaned_user = (
            await db[models.USERS].find_one({
                "_id": existing_entry["user_id"],
                "location": existing_entry["location"],
            })
            if existing_entry else None
        )
        if existing_entry and not orphaned_user:
            # Reclaim orphaned reservation — update it to point to the new user_id.
            await db[models.EMAIL_INDEX].update_one(
                {"_id": body.email},
                {"$set": {"user_id": new_user_id, "location": location}},
            )
            log.info("register: reclaimed orphaned email_index entry for email=%s", body.email)
        else:
            # Live user exists — constant-time dummy hash to prevent email enumeration.
            await async_verify_password(body.password, _DUMMY_HASH)
            raise HTTPException(status_code=409, detail="Email already registered")

    # Step 2 — create the user document on the correct location shard.
    user_doc = {
        "_id": new_user_id,
        "email": body.email,
        "password_hash": await async_hash_password(body.password),
        "full_name": body.full_name or "Parent",
        "role": "parent",
        "country_code": body.country_code,
        "location": location,
        "preferences": {"tts_enabled": True, "last_visited_path": None},
        "tokens_revoked_at": None,
        "is_being_deleted": False,
        "created_at": now,
        "updated_at": now,
    }
    try:
        await db[models.USERS].insert_one(user_doc)
    except Exception:
        # Compensating action — release the Step 1 reservation so the address can
        # be retried.  Mirrors the orphan-reclaim logic above (and in delete_account).
        try:
            await db[models.EMAIL_INDEX].delete_one({"_id": body.email})
        except Exception:
            log.exception(
                "register: failed to release email_index reservation after users insert "
                "failure for email=%s — orphaned entry will be reclaimed on next attempt",
                body.email,
            )
        log.exception("register: users insert failed; released email reservation for email=%s", body.email)
        raise HTTPException(status_code=500, detail="Registration failed — please try again")

    log.info("user.register id=%s location=%s", new_user_id, location)
    await _set_auth_cookies(response, new_user_id, location, db)
    return {"status": "ok"}


@router.post("/auth/login", status_code=200)
@limiter.limit("10/minute")
async def login(
    request: Request,
    body: LoginBody,
    response: Response,
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    # Two-phase lookup: resolve email → (user_id, location) via the global
    # email_index (unsharded), then fetch the full user document from the
    # correct shard using both fields.  This avoids a cross-shard scatter-
    # gather query that would otherwise hit every zone on an Atlas Global
    # Cluster.
    email_doc = await db[models.EMAIL_INDEX].find_one({"_id": body.email})
    user = None
    if email_doc:
        user = await db[models.USERS].find_one({
            "_id": email_doc["user_id"],
            "location": email_doc["location"],
        })

    if user and user.get("is_being_deleted"):
        await async_verify_password(body.password, _DUMMY_HASH)
        raise HTTPException(status_code=401, detail="Invalid email or password")

    # .get() guards against Google-only accounts that have no password_hash.
    target_hash = user.get("password_hash") or _DUMMY_HASH if user else _DUMMY_HASH
    password_ok = await async_verify_password(body.password, target_hash)

    if not user or not password_ok:
        log.warning("auth.login.failed email=%s", body.email)
        raise HTTPException(status_code=401, detail="Invalid email or password")

    location = user.get("location", settings.default_location)
    log.info("auth.login.ok id=%s location=%s", user["_id"], location)
    await _set_auth_cookies(response, user["_id"], location, db)
    return {"status": "ok"}


@router.post("/auth/refresh", status_code=200)
@user_limiter.limit("20/minute")
async def refresh_tokens(
    request: Request,
    response: Response,
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    refresh_token_val = request.cookies.get("refresh_token")
    if not refresh_token_val:
        raise HTTPException(status_code=401, detail="Missing refresh token")

    refresh_payload = decode_token_of_type(refresh_token_val, "refresh")
    if not refresh_payload:
        _clear_auth_cookies(response)
        log.warning("auth.refresh.failed reason=invalid_refresh_token")
        raise HTTPException(status_code=401, detail="Invalid token")

    # Access token is optional — the browser deletes it when it expires (max_age),
    # so it may be absent even when the refresh token is still valid. If present,
    # validate that both tokens belong to the same user as a defence-in-depth check.
    access_token = request.cookies.get("access_token")
    if access_token:
        access_payload = decode_access_token_ignore_exp(access_token)
        if access_payload and access_payload.get("sub") != refresh_payload.get("sub"):
            _clear_auth_cookies(response)
            log.warning("auth.refresh.failed reason=subject_mismatch sub=%s", refresh_payload.get("sub"))
            raise HTTPException(status_code=401, detail="Token mismatch")

    jti = refresh_payload.get("jti")
    if not jti:
        _clear_auth_cookies(response)
        raise HTTPException(status_code=401, detail="Invalid token")

    uid = refresh_payload.get("sub")
    # Derive location from the refresh token — the access token may be absent.
    raw_location = refresh_payload.get("location", settings.default_location)
    location = (
        raw_location
        if isinstance(raw_location, str) and LOCATION_RE.match(raw_location)
        else settings.default_location
    )

    session = await db[models.SESSIONS].find_one({"_id": jti, "user_id": uid, "location": location})
    if not session:
        _clear_auth_cookies(response)
        log.warning("auth.refresh.failed reason=jti_not_found sub=%s", uid)
        raise HTTPException(status_code=401, detail="Session expired or already logged out")

    expires_at = session["expires_at"]
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        await db[models.SESSIONS].delete_one({"_id": jti, "location": location})
        _clear_auth_cookies(response)
        log.warning("auth.refresh.failed reason=db_expiry sub=%s", uid)
        raise HTTPException(status_code=401, detail="Session expired")

    # Insert new session before deleting old: if the process crashes after the insert
    # but before the HTTP response is sent, the client retries with the old cookies
    # (old session still present) and succeeds. The orphaned new session expires naturally.
    await _set_auth_cookies(response, uid, location, db)
    await db[models.SESSIONS].delete_one({"_id": jti, "location": location})
    return {"status": "ok"}


@router.post("/auth/logout", status_code=204)
@user_limiter.limit("20/minute")
async def logout(
    request: Request,
    response: Response,
    db: AsyncIOMotorDatabase = Depends(get_db),
):
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
            raw_loc = refresh_payload.get("location", "")
            location = raw_loc if isinstance(raw_loc, str) and LOCATION_RE.match(raw_loc) else settings.default_location
            await db[models.SESSIONS].delete_one({"_id": jti, "location": location})
    _clear_auth_cookies(response)


@router.post("/auth/google", status_code=200)
@limiter.limit("5/minute")
async def google_auth(
    request: Request,
    body: GoogleAuthBody,
    response: Response,
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    info = _verify_google_token(body.id_token)

    raw_email = (info.get("email") or "").strip()
    if not raw_email:
        raise HTTPException(status_code=400, detail="Google did not return an email")
    if not info.get("email_verified"):
        raise HTTPException(status_code=400, detail="Google account email is not verified")
    try:
        email = _validate_email(raw_email, check_deliverability=False).normalized
    except EmailNotValidError:
        raise HTTPException(status_code=400, detail="Google did not return a valid email")

    # Two-phase lookup via email_index — same pattern as /auth/login.
    email_doc = await db[models.EMAIL_INDEX].find_one({"_id": email})
    existing = None
    if email_doc:
        existing = await db[models.USERS].find_one({
            "_id": email_doc["user_id"],
            "location": email_doc["location"],
        })

    if existing:
        if existing.get("is_being_deleted"):
            raise HTTPException(
                status_code=409,
                detail="This account is temporarily unavailable. Please try again shortly.",
            )
        location = existing.get("location", settings.default_location)
        await _set_auth_cookies(response, existing["_id"], location, db)
    else:
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

        location = resolve_region(body.country_code)
        now = datetime.now(timezone.utc)
        new_user_id = str(uuid.uuid4())
        raw_name = re.sub(r'[\x00-\x1f\x7f]', '', (info.get("name") or "").strip())
        full_name = (raw_name or email.split("@")[0])[:255]
        user_doc = {
            "_id": new_user_id,
            "email": email,
            "password_hash": await async_hash_password(secrets.token_urlsafe(32)),
            "full_name": full_name,
            "role": "parent",
            "country_code": body.country_code,
            "location": location,
            "preferences": {"tts_enabled": True, "last_visited_path": None},
            "tokens_revoked_at": None,
            "is_being_deleted": False,
            "created_at": now,
            "updated_at": now,
        }

        # Reserve the email globally before writing the user document.
        try:
            await db[models.EMAIL_INDEX].insert_one({
                "_id": email,
                "user_id": new_user_id,
                "location": location,
            })
        except DuplicateKeyError:
            race_doc = await db[models.EMAIL_INDEX].find_one({"_id": email})
            race_user = (
                await db[models.USERS].find_one({
                    "_id": race_doc["user_id"],
                    "location": race_doc["location"],
                })
                if race_doc else None
            )
            if not race_user:
                if race_doc:
                    # Orphaned reservation from a failed delete_account rollback.
                    # Reclaim the entry and continue registration.
                    await db[models.EMAIL_INDEX].update_one(
                        {"_id": email},
                        {"$set": {"user_id": new_user_id, "location": location}},
                    )
                    log.info(
                        "google_auth: reclaimed orphaned email_index entry for email=%s", email
                    )
                else:
                    # email_index entry exists but user doc not yet committed —
                    # extremely narrow window; ask the client to retry.
                    raise HTTPException(status_code=500, detail="Sign-in failed — please try again")
            else:
                if race_user.get("is_being_deleted"):
                    raise HTTPException(
                        status_code=409,
                        detail="This account is temporarily unavailable. Please try again shortly.",
                    )
                await _set_auth_cookies(response, race_user["_id"], race_user.get("location", settings.default_location), db)
                return {"status": "ok"}

        try:
            await db[models.USERS].insert_one(user_doc)
        except Exception:
            await db[models.EMAIL_INDEX].delete_one({"_id": email})
            log.exception("google_auth: users insert failed; rolled back email_index for email=%s", email)
            raise HTTPException(status_code=500, detail="Sign-in failed — please try again")

        log.info("google_auth.register id=%s location=%s", new_user_id, location)
        await _set_auth_cookies(response, new_user_id, location, db)

    return {"status": "ok"}


@router.get("/auth/me", response_model=MeResponse)
@user_limiter.limit("60/minute")
async def auth_me(request: Request, user: dict = Depends(get_current_user)):
    return MeResponse(
        id=user["_id"],
        email=user["email"],
        full_name=user["full_name"],
        role=user["role"],
    )


@router.delete("/user/me", status_code=204)
@user_limiter.limit("3/minute")
async def delete_account(
    request: Request,
    body: DeleteAccountBody,
    response: Response,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    if body.confirm_email.strip().lower() != user["email"]:
        raise HTTPException(status_code=400, detail="Email confirmation does not match")

    user_id = user["_id"]
    location = user.get("location", settings.default_location)
    now = datetime.now(timezone.utc)

    # All sharded collections share the same location value, so this
    # transaction touches only one zone shard — supported on all Atlas tiers
    # including M0.  email_index is intentionally kept outside the transaction:
    # it is an unsharded collection (primary shard) and including it would make
    # this a cross-shard transaction, which Atlas M0/M2/M5 does not support.
    # If the post-commit email_index delete fails, the orphaned entry is cleaned
    # up automatically the next time someone registers with the same address.
    async with await db.client.start_session() as mongo_session:
        async with mongo_session.start_transaction():
            # Step 1 — revoke all tokens and mark deletion in progress
            await db[models.USERS].update_one(
                {"_id": user_id, "location": location},
                {"$set": {"tokens_revoked_at": now, "is_being_deleted": True, "updated_at": now}},
                session=mongo_session,
            )
            await db[models.SESSIONS].delete_many(
                {"user_id": user_id, "location": location}, session=mongo_session
            )

            # Step 2 — delete all other owned collections
            await db[models.CHILDREN].delete_many(
                {"user_id": user_id, "location": location}, session=mongo_session
            )
            # goals/growth_areas are child-scoped and store user_id,
            # so delete_many by user_id covers every document in one pass.
            await db[models.GOALS].delete_many(
                {"user_id": user_id, "location": location}, session=mongo_session
            )
            await db[models.GROWTH_AREAS].delete_many(
                {"user_id": user_id, "location": location}, session=mongo_session
            )

            # Step 3 — delete the user document
            await db[models.USERS].delete_one(
                {"_id": user_id, "location": location}, session=mongo_session
            )

    # Step 4 — release the email (outside the transaction: email_index is
    # unsharded and must not be included in a single-zone shard transaction).
    # If this delete fails, the orphaned entry is reclaimed on the next
    # registration attempt for the same address (see /auth/register).
    try:
        await db[models.EMAIL_INDEX].delete_one({"_id": user["email"]})
    except Exception:
        log.exception(
            "delete_account: failed to remove email_index entry for user_id=%s — "
            "orphaned entry will be reclaimed on next registration attempt",
            user_id,
        )

    _clear_auth_cookies(response)
