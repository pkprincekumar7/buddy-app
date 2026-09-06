import logging
from collections.abc import Awaitable, Callable
from typing import Any

import jwt
import limits as limits_pkg
from fastapi import HTTPException, Request
from slowapi import Limiter

from app.auth_utils import extract_token
from app.settings import settings

log = logging.getLogger(__name__)


def _get_client_ip(request: Request) -> str:
    if settings.behind_proxy:
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            # Use the leftmost entry — the client IP as seen by the proxy.
            # Standard proxies (AWS ALB, Nginx, GCP LB) prepend the client IP
            # so position [0] is the real client address.  Only use [-1] if your
            # specific proxy is configured to append rather than prepend (rare).
            return forwarded.split(",")[0].strip()
    if request.client is None:
        log.warning("rate_limit: request.client is None; using fallback bucket")
        return "__no_peer_address__"
    return request.client.host


def _get_user_id(request: Request) -> str:
    """
    Rate-limit key for authenticated endpoints: the user ID from the access
    token.  Falls back to IP so unauthenticated requests still get a bucket.

    Using the user ID prevents a single authenticated user from bypassing
    per-endpoint limits by rotating IPs (VPN, proxies, etc.). Reads the token
    from either the cookie (web) or Authorization header (mobile) so both
    client types are bucketed by user rather than only web falling back to IP.
    """
    token = extract_token(request, "access_token")
    if token:
        try:
            payload = jwt.decode(
                token,
                settings.jwt_public_key,
                algorithms=[settings.jwt_algorithm],
                options={"verify_exp": False},
            )
            sub = payload.get("sub")
            if sub and payload.get("type") == "access":
                return f"user:{sub}"
        except jwt.PyJWTError as exc:
            log.debug(
                "rate_limit: JWT decode failed (%s), falling back to IP bucket", type(exc).__name__
            )
    return f"ip:{_get_client_ip(request)}"


# Redis-backed so limits hold correctly across every API replica, not just
# per-process. storage_uri=None (REDIS_URL unset, e.g. local dev) falls back
# to slowapi's default in-memory storage automatically. in_memory_fallback_enabled
# additionally covers a *live* Redis outage: slowapi detects the storage error,
# logs it, and switches to an in-memory limiter inheriting the same per-route
# limits — degraded (per-process) but fails open to "still enforced", not to
# an unhandled exception. Mirrors the connection settings already used by
# app/llm_rate_limiter.py's Redis client.
_redis_storage_options: dict[str, Any] = {
    "socket_connect_timeout": 2,
    "socket_timeout": 2,
}
if settings.redis_auth_token:
    _redis_storage_options["password"] = settings.redis_auth_token

limiter = Limiter(
    key_func=_get_client_ip,
    storage_uri=settings.redis_url,
    storage_options=_redis_storage_options,
    in_memory_fallback_enabled=True,
    key_prefix="rl_ip",
)
user_limiter = Limiter(
    key_func=_get_user_id,
    storage_uri=settings.redis_url,
    storage_options=_redis_storage_options,
    in_memory_fallback_enabled=True,
    key_prefix="rl_user",
)


def _hit(scope: Limiter, item: limits_pkg.RateLimitItem, *identifiers: str) -> bool:
    """Consume one hit against scope's storage, degrading to its in-memory
    fallback on a live backend error. Mirrors slowapi's own
    in_memory_fallback_enabled behavior (see Limiter.limiter property in
    slowapi.extension) — needed here because rate_limit() below calls the
    strategy directly instead of going through slowapi's decorator/middleware
    check path, which is where that fallback normally gets applied.

    Deliberately does NOT use the `scope.limiter` property: that property
    re-selects primary-vs-fallback from `scope._storage_dead` on every
    access, and a naive "reset _storage_dead on any successful .hit()"
    would immediately un-latch it the moment a fallback call itself
    succeeds — causing every other request to retry the dead primary (and
    pay its connection timeout) instead of going straight to the fallback.
    Checking `_storage_dead` explicitly up front, and only ever setting it
    True (never resetting it False here), keeps it latched once tripped.
    """
    if not scope._storage_dead:
        try:
            return scope._limiter.hit(item, *identifiers)
        except Exception as exc:
            scope._storage_dead = True
            log.warning("rate_limit: storage error (%s), falling back to in-memory", exc)

    if scope._in_memory_fallback_enabled and scope._fallback_limiter is not None:
        return scope._fallback_limiter.hit(item, *identifiers)
    if scope._swallow_errors:
        log.exception("rate_limit: storage dead and no fallback, swallowing (failing open)")
        return True
    raise RuntimeError("rate limiter storage is unavailable and no fallback is configured")


def rate_limit(
    limit_value: str, *, scope: Limiter = user_limiter
) -> Callable[[Request], Awaitable[None]]:
    """
    FastAPI dependency enforcing `limit_value` (e.g. "30/minute") via `scope`'s
    Redis-backed (with in-memory fallback) storage — same storage, same key
    function, same fallback behavior as `scope`'s @scope.limit(...) decorator,
    just usable as a dependency instead of a route decorator.

    Declare this in a route's own `dependencies=[...]` (not the router's) so
    it resolves *before* any per-parameter dependency on that route —
    including CurrentUser/CurrentParent/CurrentAdmin's database lookup (see
    app/deps.py's get_token_claims / get_current_user split). An over-limit
    request is rejected before the database is ever touched.

    The bucket is scoped per (limiter instance, matched route template,
    HTTP method, identity) — two routes sharing the same limit_value string
    (e.g. two different "60/minute" routes) get independent buckets, the same
    isolation the decorator-based checks already have.
    """
    item = limits_pkg.parse(limit_value)

    async def _dependency(request: Request) -> None:
        key = scope._key_func(request)
        route = request.scope.get("route")
        route_scope = f"{request.method}:{getattr(route, 'path', request.url.path)}"
        identifiers = (
            [scope._key_prefix, key, route_scope]
            if scope._key_prefix
            else [
                key,
                route_scope,
            ]
        )
        if not _hit(scope, item, *identifiers):
            raise HTTPException(status_code=429, detail=f"Rate limit exceeded: {limit_value}")

    return _dependency
