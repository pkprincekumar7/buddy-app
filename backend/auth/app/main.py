"""The auth service's two apps, run by `python -m common.serve auth`.

`app` is public (port 8000, ALB rule 120, `/api/v1/auth/*`); `internal_app` is internal
(port 8001, Cloud Map only). Build plan 3.2: registration and sign-in. Each endpoint is in
docs/auth-users-split-api.md:

- `POST /register`, `/login`, `/google`: sign in, creating the account through the
  registration saga where needed (10.1);
- `POST /refresh`: rotation within a family, with reuse detection (9.1);
- `POST /logout`, `/logout-all`; `GET /me`.

Errors the clients tell apart carry `detail.code`. Logs carry `email_key=<16 hex>`, never
an email, and never names or addresses (6.3).
"""

from __future__ import annotations

import logging
import re
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field, field_validator
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from auth.app import admin, deletion
from auth.app.authz_cache import entry_from_account, write_entry
from auth.app.deps import Ready, check_user_limit, error, per_ip, per_user
from auth.app.registration import create_account
from auth.app.runtime import SERVICE, Runtime
from auth.app.sessions import (
    ACCESS_COOKIE,
    REFRESH_COOKIE,
    TokenResponse,
    clear_cookies,
    sign_in,
)
from auth.app.store import ALLOWED_EMAILS, AUTH, EMAIL_INDEX, SESSIONS, authz_change
from auth.app.tokens import (
    InvalidToken,
    access_subject,
    async_check_password,
    async_hash_password,
    decode_refresh,
    unusable_password_hash,
)
from auth.countries import BLOCKED_COUNTRIES, COUNTRY_TO_REGION, is_blocked, resolve_region
from auth.emails import is_valid_address, log_key, normalise
from common.audit import AuditEvent, route_template
from common.authz import Caller, mark_policy, signed_in
from common.internal_client import InvalidServiceToken, allow_callers, get_verifier
from common.routers import PolicyRouter, public

CONCURRENT_REFRESH_WINDOW = timedelta(seconds=30)
NAME_MAX = 100
ADDRESS_MAX = 200
_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")

_logger = logging.getLogger(__name__)
_runtime: Runtime | None = None
_users = 0


def configure(runtime: Runtime | None) -> None:
    """Attach (or detach) the runtime's resources to both apps."""
    global _runtime
    _runtime = runtime
    app.state.runtime = runtime
    internal_app.state.runtime = runtime
    if runtime is not None:
        app.state.authorizer = runtime.authorizer
        internal_app.state.service_tokens = runtime.verifier


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Both apps share one Runtime per process; the last one to stop closes it."""
    global _users
    import os

    if _runtime is None and os.environ.get("MONGODB_URI"):
        runtime = Runtime.from_env()
        await runtime.prepare()
        configure(runtime)
    _users += 1
    try:
        yield
    finally:
        _users -= 1
        if _users == 0 and _runtime is not None:
            await _runtime.aclose()
            configure(None)


# The same contact and servers as today's app (app/main.py), for the published spec.
app = FastAPI(
    title=SERVICE,
    description="Accounts: registration, sign-in, sessions and tokens.",
    contact={"name": "Superpower Engineering", "email": "prince.kumar@pearson.com"},
    servers=[{"url": "/", "description": "Current environment"}],
    openapi_tags=[
        {"name": "health", "description": "Service health"},
        {"name": "auth", "description": "Registration, sign-in and sessions"},
        {"name": "admin", "description": "Accounts and the allow-list, for admins"},
    ],
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)
internal_app = FastAPI(
    title=f"{SERVICE} (internal)",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)
configure(None)


# ── shared helpers ─────────────────────────────────────────────────────────────


def _rejected(runtime: Runtime, status: int, code: str, msg: str) -> JSONResponse:
    """An error that also clears both cookies. A raised HTTPException can't: its response is
    built fresh, so cookie deletions on the route's Response would be lost."""
    response = JSONResponse({"detail": {"code": code, "msg": msg}}, status_code=status)
    clear_cookies(runtime, response)
    return response


def _bearer(request: Request) -> str | None:
    scheme, _, value = request.headers.get("authorization", "").partition(" ")
    return value.strip() or None if scheme.lower() == "bearer" else None


def _refresh_token(request: Request) -> str | None:
    """The `refresh_token` cookie (web), else `Authorization: Bearer` (mobile)."""
    return request.cookies.get(REFRESH_COOKIE) or _bearer(request)


def _mismatched_access(runtime: Runtime, request: Request, refresh: str, sub: str) -> bool:
    """A sent access token for another user than the refresh token's (defence in depth)."""
    access = request.cookies.get(ACCESS_COOKIE) or _bearer(request)
    if not access or access == refresh:
        return False
    other = access_subject(access, runtime.authz_config)
    return other is not None and other != sub


async def _is_allowed(runtime: Runtime, email: str) -> bool:
    """The email's key, under any pepper version, is on the allow-list (6.5)."""
    keys = [key for _, key in runtime.peppers.keys(email)]
    return await runtime.db[ALLOWED_EMAILS].find_one({"_id": {"$in": keys}}, {"_id": 1}) is not None


async def _active_account(runtime: Runtime, email: str) -> dict[str, Any] | None:
    """The account behind the email's `active` row (current pepper first), or None."""
    for _, key in runtime.peppers.keys(email):
        row = await runtime.db[EMAIL_INDEX].find_one({"_id": key})
        if row is not None:
            if row["status"] != "active":
                return None
            return await runtime.db[AUTH].find_one(
                {"_id": row["user_id"], "location": row["location"]}
            )
    return None


def _reject_blocked(country_code: str) -> None:
    if is_blocked(country_code):
        raise error(403, "country_not_supported", "This service is not available in your country.")


# ── models ─────────────────────────────────────────────────────────────────────


def _country(value: str) -> str:
    if value not in COUNTRY_TO_REGION and value not in BLOCKED_COUNTRIES:
        raise ValueError(f"unsupported country_code {value!r}")
    return value


def _upper(value: object) -> object:
    return value.strip().upper() if isinstance(value, str) else value


OptionalName = Annotated[str | None, Field(default=None, max_length=NAME_MAX)]
OptionalAddress = Annotated[str | None, Field(default=None, max_length=ADDRESS_MAX)]


class RegisterBody(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    email: str = Field(max_length=255)
    password: str = Field(min_length=8, max_length=128)
    first_name: str = Field(min_length=1, max_length=NAME_MAX)
    middle_name: OptionalName
    last_name: OptionalName
    country_code: str = Field(
        min_length=2, max_length=2, description="ISO 3166-1 alpha-2, e.g. 'IN', 'US', 'DE'"
    )
    address_line_one: OptionalAddress
    address_line_two: OptionalAddress
    address_line_three: OptionalAddress

    @field_validator("email")
    @classmethod
    def _email(cls, value: str) -> str:
        if not is_valid_address(value):
            raise ValueError("not a valid email address")
        return normalise(value)

    @field_validator("password")
    @classmethod
    def _password(cls, value: str) -> str:
        if len(set(value)) == 1:
            raise ValueError("Password must not consist of a single repeated character")
        if not any(c.isdigit() for c in value):
            raise ValueError("Password must contain at least one digit")
        if not any(c.isalpha() for c in value):
            raise ValueError("Password must contain at least one letter")
        return value

    _upper_country = field_validator("country_code", mode="before")(_upper)

    @field_validator("country_code")
    @classmethod
    def _check_country(cls, value: str) -> str:
        return _country(value)

    def profile(self) -> dict[str, str | None]:
        """What users stores: names and address, never the email (5.3)."""
        fields = ("first_name", "middle_name", "last_name") + tuple(
            f"address_line_{n}" for n in ("one", "two", "three")
        )
        return {name: getattr(self, name) or None for name in fields}


class LoginBody(BaseModel):
    email: str = Field(max_length=255)
    password: str = Field(max_length=128)


class GoogleBody(BaseModel):
    id_token: str = Field(max_length=4096)
    country_code: str | None = Field(
        default=None,
        min_length=2,
        max_length=2,
        description="ISO 3166-1 alpha-2; required for a new account",
    )

    _upper_country = field_validator("country_code", mode="before")(_upper)

    @field_validator("country_code")
    @classmethod
    def _check_country(cls, value: str | None) -> str | None:
        return _country(value) if value is not None else value


class MeResponse(BaseModel):
    id: str
    email: str
    role: str
    auth_provider: Literal["password", "google"]
    location: str
    created_at: datetime


def _google_name(value: object) -> str | None:
    """A Google name part: control characters stripped, cut to 100 (10.1)."""
    if not isinstance(value, str):
        return None
    cleaned = _CONTROL_CHARS.sub("", value).strip()[:NAME_MAX]
    return cleaned or None


# ── routes ─────────────────────────────────────────────────────────────────────

health_router = PolicyRouter()
router = PolicyRouter(prefix="/api/v1/auth", tags=["auth"])


@health_router.get(
    "/health",
    tags=["health"],
    dependencies=[Depends(public())],
    description="Liveness check for the load balancer.",
)
def health() -> dict[str, str]:
    return {"status": "ok", "service": SERVICE}


@router.post(
    "/register",
    status_code=201,
    dependencies=[Depends(public()), Depends(per_ip("5/minute"))],
    description="Create a parent account (allow-listed emails only) and its profile, and "
    "sign in. Sets the access and refresh token cookies.",
)
async def register(body: RegisterBody, response: Response, runtime: Ready) -> TokenResponse:
    if not await _is_allowed(runtime, body.email):
        raise error(403, "registration_closed", "Registration is not open for this email.")
    _reject_blocked(body.country_code)
    account = await create_account(
        runtime,
        email=body.email,
        password_hash=await async_hash_password(body.password),
        country_code=body.country_code,
        location=resolve_region(body.country_code),
        auth_provider="password",
        profile=body.profile(),
    )
    return (await sign_in(runtime, response, account)).body


@router.post(
    "/login",
    dependencies=[Depends(public()), Depends(per_ip("10/minute"))],
    description="Sign in with email and password. Sets the access and refresh token cookies.",
)
async def login(
    request: Request, body: LoginBody, response: Response, runtime: Ready
) -> TokenResponse:
    email = normalise(body.email)
    key = runtime.peppers.key(email)
    ip = runtime.limits.client_ip(request)
    # Before any lookup, so a blocked attempt costs nothing and reveals nothing (9.1).
    if runtime.throttle.blocked(key, ip):
        raise error(429, "too_many_attempts", "Too many failed attempts. Try again later.")
    account = await _active_account(runtime, email)
    usable = account if account is not None and not account.get("is_being_deleted") else None
    # The dummy hash when there's no usable account, so timing doesn't tell them apart.
    hashed = usable["password_hash"] if usable is not None else None
    if not await async_check_password(body.password, hashed) or usable is None:
        runtime.throttle.failed(key, ip)
        _logger.warning("auth.login.failed email_key=%s", log_key(key))
        raise error(401, "invalid_credentials", "Invalid email or password.")
    account = usable
    # Only with the right password: the lock isn't revealed to someone without it.
    if account.get("is_locked"):
        raise error(403, "account_locked", "Your account has been locked. Please contact support.")
    runtime.throttle.succeeded(key, ip)
    _logger.info("auth.login.ok id=%s location=%s", account["_id"], account["location"])
    return (await sign_in(runtime, response, account)).body


@router.post(
    "/google",
    dependencies=[Depends(public()), Depends(per_ip("5/minute"))],
    description="Sign in with a Google ID token, creating the account on first use "
    "(allow-listed emails only). Sets the access and refresh token cookies.",
)
async def google(body: GoogleBody, response: Response, runtime: Ready) -> TokenResponse:
    client_id = runtime.settings.google_client_id
    if not client_id:
        raise error(503, "google_unavailable", "Google sign-in isn't configured.")
    try:
        claims = await runtime.google(body.id_token, client_id)
    except Exception as exc:  # google-auth raises several types for a bad token
        _logger.warning("auth.google.invalid_token %s", type(exc).__name__)
        raise error(400, "google_token_invalid", "Invalid Google credential.") from exc
    raw = claims.get("email")
    verified = claims.get("email_verified") in (True, "true")
    if not isinstance(raw, str) or not verified or not is_valid_address(raw):
        raise error(400, "google_email_unverified", "Google didn't return a verified email.")
    email = normalise(raw)

    existing = await _active_account(runtime, email)
    if existing is not None:
        # A verified Google email proves ownership, whatever the account's auth_provider.
        if existing.get("is_being_deleted"):
            raise error(401, "account_unavailable", "This account is unavailable.")
        if existing.get("is_locked"):
            raise error(
                403, "account_locked", "Your account has been locked. Please contact support."
            )
        return (await sign_in(runtime, response, existing)).body

    if not await _is_allowed(runtime, email):
        raise error(403, "registration_closed", "Registration is not open for this email.")
    if body.country_code is None:
        raise error(
            422,
            "country_code_required",
            "country_code is required for a new account: ask for the country and retry.",
        )
    _reject_blocked(body.country_code)
    first = _google_name(claims.get("given_name")) or _google_name(email.split("@")[0]) or "Parent"
    account = await create_account(
        runtime,
        email=email,
        password_hash=await unusable_password_hash(),
        country_code=body.country_code,
        location=resolve_region(body.country_code),
        auth_provider="google",
        profile={"first_name": first, "last_name": _google_name(claims.get("family_name"))},
    )
    return (await sign_in(runtime, response, account)).body


async def _revoke(runtime: Runtime, user_id: str, location: str) -> None:
    """Log the account out everywhere: `tokens_revoked_at = now`, a new authz_version."""
    now = datetime.now(UTC)
    account = await runtime.db[AUTH].find_one_and_update(
        {"_id": user_id, "location": location},
        authz_change({"tokens_revoked_at": now}, now),
        return_document=ReturnDocument.AFTER,
    )
    if account is not None:
        await write_entry(runtime.cache, user_id, entry_from_account(account))


def _refuse_refresh(
    runtime: Runtime, account: dict[str, Any] | None, iat_ms: int
) -> JSONResponse | None:
    """Why this account can't refresh any more, as the response to send; None if it can."""
    if account is None or account.get("is_being_deleted"):
        return _rejected(runtime, 401, "session_revoked", "Session revoked.")
    if account.get("is_locked"):
        return _rejected(
            runtime, 403, "account_locked", "Your account has been locked. Please contact support."
        )
    revoked = entry_from_account(account).revoked_at_ms
    if revoked is not None and revoked >= iat_ms:  # both in milliseconds (9.3)
        return _rejected(runtime, 401, "session_revoked", "Session revoked.")
    return None


@router.post(
    "/refresh",
    dependencies=[Depends(public())],
    description="Exchange a refresh token (cookie, or Bearer on mobile) for a new pair in "
    "the same family. Reusing a rotated token after 30 s logs the account out everywhere.",
    responses={
        401: {"description": "Missing, invalid, expired or revoked; clears the cookies"},
        403: {"description": "The account is locked; clears the cookies"},
    },
)
async def refresh(request: Request, response: Response, runtime: Ready) -> Any:
    token = _refresh_token(request)
    if not token:
        return _rejected(runtime, 401, "missing_token", "No refresh token.")
    try:
        claims = decode_refresh(token, runtime.authz_config)
    except InvalidToken:
        _logger.warning("auth.refresh.failed reason=invalid_token")
        return _rejected(runtime, 401, "invalid_token", "Invalid token.")
    user_id, jti, location = claims["sub"], claims["jti"], claims["location"]
    if _mismatched_access(runtime, request, token, user_id):
        _logger.warning("auth.refresh.failed reason=subject_mismatch sub=%s", user_id)
        return _rejected(runtime, 401, "invalid_token", "Token mismatch.")
    check_user_limit(runtime, request, "20/minute", user_id)

    sessions = runtime.db[SESSIONS]
    session = await sessions.find_one({"_id": jti, "user_id": user_id, "location": location})
    now = datetime.now(UTC)
    if session is None or session["expires_at"] <= now:
        if session is not None:
            await sessions.delete_one({"_id": jti, "location": location})
        return _rejected(runtime, 401, "session_expired", "Session expired or logged out.")
    rotated_at = session.get("rotated_at")
    if rotated_at is not None and now - rotated_at > CONCURRENT_REFRESH_WINDOW:
        # A rotated token used again later: treat it as stolen (9.1).
        await sessions.delete_many({"location": location, "family_id": session["family_id"]})
        await _revoke(runtime, user_id, location)
        _logger.warning("auth.refresh.reuse sub=%s family revoked", user_id)
        return _rejected(runtime, 401, "session_revoked", "Session revoked.")

    account = await runtime.db[AUTH].find_one({"_id": user_id, "location": location})
    refused = _refuse_refresh(runtime, account, claims["iat_ms"])
    if refused is not None or account is None:
        await sessions.delete_one({"_id": jti, "location": location})
        return refused or _rejected(runtime, 401, "session_revoked", "Session revoked.")

    # The new session first: a crash in between leaves the old token usable.
    signed = await sign_in(runtime, response, account, family_id=session["family_id"])
    if rotated_at is None:
        await sessions.update_one(
            {"_id": jti, "location": location, "rotated_at": None},
            {"$set": {"rotated_at": now, "replaced_by": signed.jti}},
        )
    return signed.body


@router.post(
    "/logout",
    status_code=204,
    response_model=None,
    dependencies=[Depends(public())],
    description="End this session (the refresh token's) and clear the cookies. Always "
    "succeeds unless the access and refresh tokens belong to different users.",
)
async def logout(request: Request, response: Response, runtime: Ready) -> Any:
    token = _refresh_token(request)
    if token:
        try:
            claims = decode_refresh(token, runtime.authz_config)
        except InvalidToken:
            claims = None
        if claims is not None:
            if _mismatched_access(runtime, request, token, claims["sub"]):
                return _rejected(runtime, 401, "token_mismatch", "Token mismatch.")
            check_user_limit(runtime, request, "20/minute", claims["sub"])
            await runtime.db[SESSIONS].delete_one(
                {"_id": claims["jti"], "location": claims["location"]}
            )
    clear_cookies(runtime, response)
    response.status_code = 204
    return response


@router.post(
    "/logout-all",
    status_code=204,
    response_model=None,
    dependencies=[Depends(per_user("3/minute"))],
    description="End every session of the signed-in user, on every device.",
)
async def logout_all(
    response: Response,
    runtime: Ready,
    caller: Annotated[Caller, Depends(signed_in())],
) -> Any:
    now = datetime.now(UTC)
    found: dict[str, Any] = {}

    async def write(session: AsyncClientSession) -> None:
        account = await runtime.db[AUTH].find_one_and_update(
            {"_id": caller.user_id, "location": caller.location},
            authz_change({"tokens_revoked_at": now}, now),
            return_document=ReturnDocument.AFTER,
            session=session,
        )
        await runtime.db[SESSIONS].delete_many(
            {"location": caller.location, "user_id": caller.user_id}, session=session
        )
        found["account"] = account

    async with runtime.client.start_session() as session:
        await session.with_transaction(write)
    if found["account"] is not None:
        # Every service rejects older tokens at once in this region (the change stream
        # would do it too, build plan 3.3).
        await write_entry(runtime.cache, caller.user_id, entry_from_account(found["account"]))
    clear_cookies(runtime, response)
    response.status_code = 204
    return response


@router.get(
    "/me",
    dependencies=[Depends(per_user("60/minute"))],
    description="The signed-in account: id, email, role, provider, location. Names are in "
    "the users service (`GET /api/v1/users/me/profile`).",
)
async def me(runtime: Ready, caller: Annotated[Caller, Depends(signed_in())]) -> MeResponse:
    account = await runtime.db[AUTH].find_one({"_id": caller.user_id, "location": caller.location})
    if account is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return MeResponse(
        id=account["_id"],
        email=account["email"],
        role=account["role"],
        auth_provider=account["auth_provider"],
        location=account["location"],
        created_at=account["created_at"],
    )


class DeleteAccountBody(BaseModel):
    confirm_email: str = Field(max_length=255)


@router.delete(
    "/account",
    status_code=202,
    dependencies=[Depends(per_user("3/minute"))],
    description="Delete your account and all your data, through the deletion saga. Signs "
    "you out everywhere at once; the data goes as each service confirms.",
)
async def delete_account(
    body: DeleteAccountBody,
    response: Response,
    runtime: Ready,
    caller: Annotated[Caller, Depends(signed_in())],
) -> dict[str, str]:
    account = await runtime.db[AUTH].find_one({"_id": caller.user_id, "location": caller.location})
    if account is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if normalise(body.confirm_email) != account["email"]:
        raise error(400, "confirmation_mismatch", "The email doesn't match your account.")
    # A locked admin was taken off the counter when locked (10.3).
    counted_admin = account["role"] == "admin" and not account.get("is_locked")
    if counted_admin:
        await admin.take_admin_out(runtime)

    async def undo() -> None:
        await admin.put_admin_back(runtime)

    try:
        await deletion.start(runtime, account, undo=undo if counted_admin else None)
    except deletion.AlreadyDeleting:
        # A second request that a task's 30-second cached entry let through (9.3).
        raise HTTPException(status_code=401, detail="Not authenticated") from None
    except deletion.AccountChanged:
        raise error(409, "account_changed", "Your account changed meanwhile; try again.") from None
    clear_cookies(runtime, response)
    return {"status": "deleting"}


app.include_router(health_router)
app.include_router(router)
app.include_router(admin.router)


# ── internal routes (port 8001) ────────────────────────────────────────────────

internal_router = PolicyRouter(prefix="/internal")


@internal_router.get(
    "/ping",
    tags=["internal"],
    dependencies=[Depends(public())],
    description="Reachability check for internal callers (port 8001, inside the VPC only).",
)
def ping() -> dict[str, str]:
    return {"status": "ok", "service": SERVICE}


# Who may read a user's email (a future notification sender, say). Nobody yet: a service
# that needs it is added here, reviewed, and every call is audited.
EMAIL_CALLERS: frozenset[str] = frozenset()
_service_bearer = HTTPBearer(auto_error=False)


def email_callers() -> Callable[..., Awaitable[str]]:
    """Like allow_callers, but for a list that may be empty: 401 without a valid service
    token, 403 for any caller not on EMAIL_CALLERS."""

    async def dependency(
        request: Request,
        credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_service_bearer)],
    ) -> str:
        if credentials is None:
            raise HTTPException(status_code=401, detail="Service token required")
        try:
            caller = get_verifier(request).verify(credentials.credentials)
        except InvalidServiceToken as exc:
            raise HTTPException(status_code=401, detail="Invalid service token") from exc
        if caller not in EMAIL_CALLERS:
            _logger.warning("service %s may not read emails", caller)
            raise HTTPException(status_code=403, detail="Forbidden")
        return caller

    return mark_policy("internal:emails", dependency)


class EmailOut(BaseModel):
    email: str


@internal_router.get(
    "/auth/users/{user_id}/email",
    tags=["internal"],
    description="A user's email, for a service that must contact them; it uses it for one "
    "message and doesn't store it. No service may call it yet. Every call is audited.",
)
async def internal_email(
    request: Request,
    user_id: str,
    location: Annotated[str, Query(pattern=r"^[a-z0-9_-]{1,16}$")],
    runtime: Ready,
    caller: Annotated[str, Depends(email_callers())],
) -> EmailOut:
    account = await runtime.db[AUTH].find_one({"_id": user_id, "location": location})
    if account is None:
        raise HTTPException(status_code=404, detail="Not Found")
    runtime.audit.record(
        AuditEvent(
            actor_id=caller,
            actor_role="service",
            permission="emails:read",
            subject_id=user_id,
            privileged=True,
            outcome="allowed",
            status=200,
            method=request.method,
            route=route_template(request),
            request_id=request.headers.get("x-request-id"),
            source_ip=None,
        ),
        location,
    )
    return EmailOut(email=account["email"])


# Every service that verifies users' tokens asks auth on a cache miss (9.3).
AUTHZ_CALLERS = (
    "users", "children", "onboarding", "discover", "grow", "transform", "release",
    "shared", "hello",
)  # fmt: skip
_UUID4_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")


class AuthzEntryOut(BaseModel):
    ver: int
    role: str
    locked: bool
    deleting: bool
    revoked_at_ms: int | None


@internal_router.get(
    "/authz/{user_id}",
    tags=["internal"],
    description="The account's authz entry, read from auth.auth, refilling this region's "
    "cache through the versioned write (9.3). 404: no such account.",
)
async def internal_authz(
    user_id: str,
    runtime: Ready,
    _caller: Annotated[str, Depends(allow_callers(*AUTHZ_CALLERS))],
) -> AuthzEntryOut:
    entry = await runtime.fill(user_id) if _UUID4_RE.fullmatch(user_id) else None
    if entry is None:
        raise HTTPException(status_code=404, detail="Not Found")
    return AuthzEntryOut(
        ver=entry.ver,
        role=entry.role,
        locked=entry.locked,
        deleting=entry.deleting,
        revoked_at_ms=entry.revoked_at_ms,
    )


internal_app.include_router(internal_router)
