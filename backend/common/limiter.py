"""Rate limits in Valkey, falling back to per task (docs/auth-users-split.md, 9.3, from today's app/limiter.py).

Limits are FastAPI dependencies, so an over-limit request is refused before the route's
own database work:

    limits = RateLimits(settings.redis_url, prefix="auth", behind_proxy=settings.behind_proxy)

    @router.post("/login", dependencies=[Depends(public()), Depends(limits.per_ip("10/minute"))])
    @router.patch("/{id}", dependencies=[Depends(limits.per_user("30/minute"))])

Buckets are per (route template, method, identity), so two routes with the same limit don't
share one. While Valkey is unreachable the limits are counted in process (per task, as
today); Valkey is retried after 30 s rather than abandoned for the life of the task.
Credentials, when Valkey needs them, go in the URL (`redis://user:token@host:6379`), as each
service's RBAC user will (2.3).
"""

from __future__ import annotations

import logging
import time
from collections.abc import Awaitable, Callable
from typing import Annotated

from fastapi import Depends, HTTPException, Request
from limits import RateLimitItem, parse
from limits.storage import MemoryStorage, RedisStorage, Storage
from limits.strategies import FixedWindowRateLimiter

from common.audit import route_template, source_ip
from common.authz import Caller, current_caller

RETRY_PRIMARY_AFTER_SECONDS = 30.0

_logger = logging.getLogger(__name__)


class RateLimits:
    def __init__(
        self,
        redis_url: str | None,
        *,
        prefix: str,
        behind_proxy: bool = False,
        primary: Storage | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.prefix = prefix
        self.behind_proxy = behind_proxy
        self.clock = clock
        if primary is None and redis_url:
            primary = RedisStorage(redis_url, socket_connect_timeout=2, socket_timeout=2)
        self._primary = FixedWindowRateLimiter(primary) if primary is not None else None
        self._memory = FixedWindowRateLimiter(MemoryStorage())
        self._primary_down_until = 0.0

    def hit(self, item: RateLimitItem, *identifiers: str) -> bool:
        """Count one request; False when it's over the limit."""
        if self._primary is not None and self.clock() >= self._primary_down_until:
            try:
                return self._primary.hit(item, self.prefix, *identifiers)
            except Exception as exc:
                self._primary_down_until = self.clock() + RETRY_PRIMARY_AFTER_SECONDS
                _logger.warning(
                    "rate limits: Valkey unreachable (%s); counting per task", type(exc).__name__
                )
        return self._memory.hit(item, self.prefix, *identifiers)

    def client_ip(self, request: Request) -> str:
        """The viewer's address: CloudFront's header behind the proxy, else the peer."""
        if self.behind_proxy:
            ip = source_ip(request)
            if ip:
                return ip
        return request.client.host if request.client else "unknown"

    def _check(self, request: Request, item: RateLimitItem, identity: str) -> None:
        if not self.hit(item, route_template(request), request.method, identity):
            raise HTTPException(
                status_code=429,
                detail="Too many requests",
                headers={"Retry-After": str(item.get_expiry())},
            )

    def per_ip(self, limit: str) -> Callable[..., Awaitable[None]]:
        """For routes anyone may call (login, register): counted per client address."""
        item = parse(limit)

        async def dependency(request: Request) -> None:
            self._check(request, item, f"ip:{self.client_ip(request)}")

        return dependency

    def per_user(self, limit: str) -> Callable[..., Awaitable[None]]:
        """For signed-in routes: counted per user, so rotating IPs doesn't help."""
        item = parse(limit)

        async def dependency(
            request: Request, caller: Annotated[Caller, Depends(current_caller)]
        ) -> None:
            self._check(request, item, f"user:{caller.user_id}")

        return dependency
