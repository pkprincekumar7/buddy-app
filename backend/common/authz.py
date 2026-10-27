"""Per-request authorization for every service (docs/auth-users-split.md, 9.2, 9.3, 11.2).

A valid token isn't enough: within its lifetime the account can be locked, deleted or signed
out everywhere, or its role changed. So every request:

1. verifies the access token (signature by `kid` from JWT_PUBLIC_KEYS, `iss`, `aud`, `exp`);
2. reads `authz:{sub}` from the region's Valkey, or on a miss asks auth (the fill), which also
   refills Valkey;
3. rejects `deleting` (401), `locked` (403), `revoked_at_ms >= iat_ms` (401, both in ms), and
   a permission the cached role doesn't grant (403, or 404 for someone else's data);
4. fails closed: no entry and no answer from auth is a 503.

When Valkey is unreachable, answers from auth are kept in process for 30 s, so a burst of
requests costs one internal call; a lock then takes effect within 30 s instead of at once.

A service sets `app.state.authorizer = Authorizer(...)` at startup and guards each route
with one of the policies: `signed_in()`, `require(...)`, `require_self_or(...)`, or
`common.routers.public()`.
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
from collections import OrderedDict
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from typing import Annotated, Any, Protocol

import jwt
from cryptography.hazmat.primitives.serialization import load_pem_public_key
from fastapi import Depends, HTTPException, Request
from fastapi.security import APIKeyCookie, HTTPAuthorizationCredentials, HTTPBearer
from jwt.exceptions import PyJWTError
from redis.exceptions import RedisError

from common import permissions
from common.audit import AuditEvent, AuditLog, route_template, source_ip
from common.regions import location_from_claims

ACCESS_COOKIE = "access_token"
CACHE_PREFIX = "authz:"
LOCAL_TTL_SECONDS = 30.0
LOCAL_MAX_ENTRIES = 10_000

# Marks a FastAPI dependency as an access policy; common.routers checks every route has one.
POLICY_ATTR = "__authz_policy__"

# `sub` is a UUIDv4 string (design section 3); anything else never reaches a cache key.
_USER_ID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
_REQUIRED_CLAIMS = ["exp", "iat", "iat_ms", "sub", "type", "iss", "aud"]

_logger = logging.getLogger(__name__)


# ── configuration ──────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class AuthzConfig:
    """How tokens are verified. `public_keys` maps `kid` → PEM public key."""

    public_keys: Mapping[str, str]
    issuer: str
    audience: str
    algorithm: str = "RS256"
    leeway_seconds: int = 30
    _keys: dict[str, Any] = field(init=False, repr=False, compare=False)

    def __post_init__(self) -> None:
        if not self.public_keys:
            raise ValueError("JWT_PUBLIC_KEYS is empty: no token could be verified")
        if not self.issuer or not self.audience:
            raise ValueError("JWT issuer and audience must both be set")
        keys: dict[str, Any] = {}
        for kid, pem in self.public_keys.items():
            try:
                keys[kid] = load_pem_public_key(pem.replace("\\n", "\n").encode())
            except Exception as exc:
                raise ValueError(f"JWT_PUBLIC_KEYS[{kid!r}] is not a valid PEM public key") from exc
        object.__setattr__(self, "_keys", keys)

    def key(self, kid: object) -> Any | None:
        return self._keys.get(kid) if isinstance(kid, str) else None

    @classmethod
    def from_env(cls, environ: Mapping[str, str] = os.environ) -> AuthzConfig:
        """From JWT_PUBLIC_KEYS (a JSON object), JWT_ISSUER, JWT_AUDIENCE, JWT_LEEWAY_SECONDS.

        The issuer and audience default to today's local values, so tokens from today's
        backend verify locally; deployed values come from Terraform.
        """
        try:
            keys = json.loads(environ.get("JWT_PUBLIC_KEYS", ""))
        except json.JSONDecodeError as exc:
            raise ValueError("JWT_PUBLIC_KEYS must be a JSON object of kid → PEM") from exc
        if not isinstance(keys, dict) or not all(
            isinstance(k, str) and isinstance(v, str) for k, v in keys.items()
        ):
            raise ValueError("JWT_PUBLIC_KEYS must be a JSON object of kid → PEM")
        return cls(
            public_keys=keys,
            issuer=environ.get("JWT_ISSUER", "superpower-local"),
            audience=environ.get("JWT_AUDIENCE", "superpower-api"),
            leeway_seconds=int(environ.get("JWT_LEEWAY_SECONDS", "30")),
        )


# ── the cached state ───────────────────────────────────────────────────────────


@dataclass(frozen=True)
class AuthzEntry:
    """`authz:{user_id}` in Valkey: what auth says about the account right now (9.3)."""

    ver: int
    role: str
    locked: bool
    deleting: bool
    revoked_at_ms: int | None = None

    @classmethod
    def from_json(cls, raw: str | bytes) -> AuthzEntry:
        try:
            data = json.loads(raw)
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise ValueError("authz entry isn't JSON") from exc
        if not isinstance(data, dict):
            raise ValueError("authz entry isn't an object")
        return cls.from_dict(data)

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> AuthzEntry:
        ver, role = data.get("ver"), data.get("role")
        locked, deleting = data.get("locked"), data.get("deleting")
        revoked = data.get("revoked_at_ms")
        # bool is an int subclass: a `true` version or timestamp is malformed, not 1.
        if not (isinstance(ver, int) and not isinstance(ver, bool) and ver >= 1):
            raise ValueError("authz entry: bad ver")
        if not isinstance(role, str) or not role:
            raise ValueError("authz entry: bad role")
        if not isinstance(locked, bool) or not isinstance(deleting, bool):
            raise ValueError("authz entry: locked and deleting must be booleans")
        if revoked is not None and not (isinstance(revoked, int) and not isinstance(revoked, bool)):
            raise ValueError("authz entry: bad revoked_at_ms")
        return cls(ver=ver, role=role, locked=locked, deleting=deleting, revoked_at_ms=revoked)


class AuthUnavailable(Exception):
    """auth couldn't be asked (unreachable, timed out, 5xx): the caller fails closed."""


# Asks auth for an entry (GET /internal/authz/{user_id}, build plan 1.3). Returns None when
# the account doesn't exist; raises AuthUnavailable when auth can't answer.
AuthzFill = Callable[[str], Awaitable[AuthzEntry | None]]


class AuthzCache(Protocol):
    """The read side of Valkey that authorization needs; redis.asyncio.Redis has it."""

    async def get(self, name: str) -> bytes | str | None: ...


# ── the caller ─────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Caller:
    """The authenticated, authorized user of this request. `role` is the cached one."""

    user_id: str
    role: str
    location: str
    iat_ms: int
    permissions: frozenset[str]

    def has(self, permission: str) -> bool:
        return permission in self.permissions


@dataclass(frozen=True)
class Access:
    """What `require_self_or` allows: whose data, and whether only because of the role."""

    caller: Caller
    subject_id: str
    privileged: bool


def _unauthorized(detail: str = "Not authenticated") -> HTTPException:
    return HTTPException(status_code=401, detail=detail, headers={"WWW-Authenticate": "Bearer"})


def extract_token(request: Request) -> str | None:
    """The access token: the HttpOnly cookie (web), else `Authorization: Bearer` (mobile)."""
    token = request.cookies.get(ACCESS_COOKIE)
    if token:
        return token
    scheme, _, value = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer":
        return None
    return value.strip() or None


# ── the authorizer ─────────────────────────────────────────────────────────────


class Authorizer:
    def __init__(
        self,
        config: AuthzConfig,
        *,
        cache: AuthzCache | None,
        fill: AuthzFill,
        audit: AuditLog | None = None,
        local_ttl: float = LOCAL_TTL_SECONDS,
        local_max: int = LOCAL_MAX_ENTRIES,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.config = config
        self.cache = cache
        self.fill = fill
        self.audit = audit if audit is not None else AuditLog()
        self.local_ttl = local_ttl
        self.local_max = local_max
        self.clock = clock
        # user_id → (stored at, entry); used only while Valkey is unreachable (or absent).
        self._local: OrderedDict[str, tuple[float, AuthzEntry]] = OrderedDict()

    # 1. the token

    def verify(self, token: str) -> dict[str, Any]:
        """The access token's claims, or a 401. The key is chosen by `kid`, never defaulted."""
        try:
            key = self.config.key(jwt.get_unverified_header(token).get("kid"))
            if key is None:
                raise _unauthorized()
            claims: dict[str, Any] = jwt.decode(
                token,
                key,
                algorithms=[self.config.algorithm],
                leeway=self.config.leeway_seconds,
                issuer=self.config.issuer,
                audience=self.config.audience,
                options={"require": _REQUIRED_CLAIMS},
            )
        except PyJWTError as exc:
            raise _unauthorized() from exc
        iat_ms = claims.get("iat_ms")
        if (
            claims.get("type") != "access"
            or not isinstance(claims.get("sub"), str)
            or not _USER_ID_RE.fullmatch(claims["sub"])
            or not isinstance(iat_ms, int)
            or isinstance(iat_ms, bool)
            or iat_ms <= 0
        ):
            raise _unauthorized()
        return claims

    # 2. the entry

    async def entry(self, user_id: str) -> AuthzEntry:
        """The account's authz entry: Valkey, else auth; 401 if it's gone, 503 if no one knows."""
        if self.cache is None:
            return await self._entry_without_cache(user_id)
        try:
            raw = await self.cache.get(CACHE_PREFIX + user_id)
        except (RedisError, OSError, TimeoutError):
            _logger.warning("authz cache unreachable; asking auth directly", exc_info=True)
            return await self._entry_without_cache(user_id)
        if raw is not None:
            try:
                return AuthzEntry.from_json(raw)
            except ValueError:
                # Treated as a miss: auth's answer replaces it.
                _logger.warning("malformed authz entry for %s; refilling", user_id)
        return await self._fill(user_id)

    async def _entry_without_cache(self, user_id: str) -> AuthzEntry:
        now = self.clock()
        held = self._local.get(user_id)
        if held is not None and now - held[0] < self.local_ttl:
            return held[1]
        entry = await self._fill(user_id)
        self._local[user_id] = (now, entry)
        self._local.move_to_end(user_id)
        while len(self._local) > self.local_max:
            self._local.popitem(last=False)
        return entry

    async def _fill(self, user_id: str) -> AuthzEntry:
        try:
            entry = await self.fill(user_id)
        except AuthUnavailable as exc:
            # Fail closed (9.3): no entry and no answer from auth.
            raise HTTPException(
                status_code=503,
                detail="Authorization is temporarily unavailable",
                headers={"Retry-After": "5"},
            ) from exc
        if entry is None:
            raise _unauthorized()
        return entry

    # 3. the checks

    async def authenticate(self, request: Request) -> Caller:
        token = extract_token(request)
        if not token:
            raise _unauthorized()
        claims = self.verify(token)
        location = location_from_claims(claims)
        if location is None:
            raise _unauthorized()
        user_id, iat_ms = claims["sub"], claims["iat_ms"]
        entry = await self.entry(user_id)
        caller = Caller(
            user_id=user_id,
            role=entry.role,
            location=location,
            iat_ms=iat_ms,
            permissions=permissions.permissions_for(entry.role),
        )
        denial: HTTPException | None = None
        if entry.deleting:
            denial = _unauthorized()
        elif entry.locked:
            denial = HTTPException(
                status_code=403, detail="Your account has been locked. Please contact support."
            )
        elif entry.revoked_at_ms is not None and entry.revoked_at_ms >= iat_ms:
            denial = _unauthorized("Session revoked")
        if denial is not None:
            self.record(
                request, caller, "signed_in", user_id, privileged=False, status=denial.status_code
            )
            raise denial
        return caller

    def record(
        self,
        request: Request,
        caller: Caller,
        permission: str,
        subject_id: str | None,
        *,
        privileged: bool,
        status: int | None = None,
    ) -> None:
        """An audit event for this check; `status` set means it was denied with that code."""
        self.audit.record(
            AuditEvent(
                actor_id=caller.user_id,
                actor_role=caller.role,
                permission=permission,
                subject_id=subject_id,
                privileged=privileged,
                outcome="allowed" if status is None else "denied",
                status=status if status is not None else 200,
                method=request.method,
                route=route_template(request),
                request_id=request.headers.get("x-request-id"),
                source_ip=source_ip(request),
            )
        )


# ── FastAPI dependencies ───────────────────────────────────────────────────────

# Declared so the OpenAPI spec shows how to authenticate (Spectral requires security on
# every operation); the token itself is read by extract_token.
_cookie_scheme = APIKeyCookie(name=ACCESS_COOKIE, auto_error=False)
_bearer_scheme = HTTPBearer(auto_error=False)


def get_authorizer(request: Request) -> Authorizer:
    authorizer = getattr(request.app.state, "authorizer", None)
    if not isinstance(authorizer, Authorizer):
        raise RuntimeError("app.state.authorizer isn't set: create an Authorizer at startup")
    return authorizer


async def current_caller(
    request: Request,
    _cookie: Annotated[str | None, Depends(_cookie_scheme)] = None,
    _bearer: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer_scheme)] = None,
) -> Caller:
    """Authenticates once per request; every policy below depends on it."""
    return await get_authorizer(request).authenticate(request)


def mark_policy[F](name: str, dependency: F) -> F:
    setattr(dependency, POLICY_ATTR, name)
    return dependency


def signed_in() -> Callable[..., Awaitable[Caller]]:
    """Any signed-in account in good standing (not locked, deleting or revoked)."""

    async def dependency(caller: Annotated[Caller, Depends(current_caller)]) -> Caller:
        return caller

    return mark_policy("signed_in", dependency)


def require(permission: str) -> Callable[..., Awaitable[Caller]]:
    """The caller's cached role must grant `permission`, else 403 (11.2)."""
    permissions.check_known(permission)
    privileged = permissions.is_admin_only(permission)

    async def dependency(
        request: Request, caller: Annotated[Caller, Depends(current_caller)]
    ) -> Caller:
        authorizer = get_authorizer(request)
        if not caller.has(permission):
            authorizer.record(request, caller, permission, None, privileged=privileged, status=403)
            raise HTTPException(status_code=403, detail="Forbidden")
        authorizer.record(request, caller, permission, None, privileged=privileged)
        return caller

    return mark_policy(f"require:{permission}", dependency)


def require_self_or(permission: str, param: str = "user_id") -> Callable[..., Awaitable[Access]]:
    """The owner of `{param}` (or `me`) with the `:self` permission, or a holder of `permission`.

    Anyone else gets 404, not 403, so ids can't be probed (11.2).
    """
    permissions.check_known(permission)
    own = permissions.check_known(permissions.self_variant(permission))

    async def dependency(
        request: Request, caller: Annotated[Caller, Depends(current_caller)]
    ) -> Access:
        authorizer = get_authorizer(request)
        raw = request.path_params.get(param)
        if not isinstance(raw, str):
            raise RuntimeError(f"route {route_template(request)} has no {{{param}}} path parameter")
        subject = caller.user_id if raw == "me" else raw
        if subject == caller.user_id:
            if caller.has(own):
                return Access(caller, subject, privileged=False)
            authorizer.record(request, caller, own, subject, privileged=False, status=403)
            raise HTTPException(status_code=403, detail="Forbidden")
        if caller.has(permission):
            authorizer.record(request, caller, permission, subject, privileged=True)
            return Access(caller, subject, privileged=True)
        authorizer.record(request, caller, permission, subject, privileged=True, status=404)
        raise HTTPException(status_code=404, detail="Not Found")

    return mark_policy(f"require_self_or:{permission}", dependency)
