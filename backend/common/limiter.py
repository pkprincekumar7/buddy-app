"""Rate limits in Valkey, falling back to per task (docs/auth-users-split.md, 9.3).

Limits are FastAPI dependencies, so an over-limit request is refused before the route's
own database work:

    limits = RateLimits(settings.redis_url, prefix="auth", behind_proxy=settings.behind_proxy)

    @router.post("/login", dependencies=[Depends(public()), Depends(limits.per_ip("10/minute"))])
    @router.patch("/{id}", dependencies=[Depends(limits.per_user("30/minute"))])

Buckets are per (route template, method, identity), so two routes with the same limit don't
share one. Each is a moving window (the last N seconds, not the current clock minute), so a
client can't spend a limit twice across a window edge (production-readiness review,
APP-11 b). An IPv6 client is counted per /64, the block one host or home network is
usually given, so rotating addresses inside it doesn't reset its limits (APP-01). While Valkey is unreachable the limits are counted in process (per task, as
today); Valkey is retried after 30 s rather than abandoned for the life of the task.
Counting is async (redis-py's asyncio client, through `limits.aio`): a slow or unreachable
Valkey holds up only the request being counted, never the event loop and every other
request on the task (production-readiness review, APP-05).
In AWS, pass `redis_options=settings.valkey_options()`: the service signs in as its own
RBAC user with an IAM token (common.valkey, build plan 2.3).
"""

from __future__ import annotations

import ipaddress
import logging
import time
from collections.abc import Awaitable, Callable, Mapping
from typing import Annotated, Any

from fastapi import Depends, HTTPException, Request
from limits import RateLimitItem, parse
from limits.aio.storage import MemoryStorage, RedisStorage, Storage
from limits.aio.strategies import MovingWindowRateLimiter

from common.audit import route_template, source_ip
from common.authz import Caller, current_caller
from common.valkey import degraded

RETRY_PRIMARY_AFTER_SECONDS = 30.0
# The IPv6 prefix counted as one client (APP-01).
IPV6_CLIENT_PREFIX = 64

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
        redis_options: Mapping[str, Any] | None = None,
    ) -> None:
        self.prefix = prefix
        self.behind_proxy = behind_proxy
        self.clock = clock
        if primary is None and redis_url:
            # redis_options: the IAM token provider in AWS (common.valkey).
            primary = RedisStorage(
                redis_url,
                implementation="redispy",
                socket_connect_timeout=2,
                socket_timeout=2,
                **(redis_options or {}),
            )
        self._primary = MovingWindowRateLimiter(primary) if primary is not None else None
        self._memory = MovingWindowRateLimiter(MemoryStorage())
        self._primary_down_until = 0.0

    async def allow(self, item: RateLimitItem, *identifiers: str) -> bool:
        """Count one request; False when it's over the limit."""
        if self._primary is not None and self.clock() >= self._primary_down_until:
            try:
                return await self._primary.hit(item, self.prefix, *identifiers)
            except Exception as exc:
                self._primary_down_until = self.clock() + RETRY_PRIMARY_AFTER_SECONDS
                _logger.warning(
                    "rate limits: Valkey unreachable (%s); counting per task",
                    type(exc).__name__,
                    extra=degraded("rate_limits"),
                )
        return await self._memory.hit(item, self.prefix, *identifiers)

    def client_ip(self, request: Request) -> str:
        """The client to count: the viewer's address (CloudFront's header behind the proxy,
        else the peer), an IPv6 one as its /64. For limits only; the audit log keeps the
        full address (common.audit.source_ip)."""
        ip = source_ip(request) if self.behind_proxy else None
        if not ip:
            ip = request.client.host if request.client else "unknown"
        return client_key(ip)

    async def _check(self, request: Request, item: RateLimitItem, identity: str) -> None:
        if not await self.allow(item, route_template(request), request.method, identity):
            raise HTTPException(
                status_code=429,
                detail="Too many requests",
                headers={"Retry-After": str(item.get_expiry())},
            )

    def per_ip(self, limit: str) -> Callable[..., Awaitable[None]]:
        """For routes anyone may call (login, register): counted per client address."""
        item = parse(limit)

        async def dependency(request: Request) -> None:
            await self._check(request, item, f"ip:{self.client_ip(request)}")

        return dependency

    def per_user(self, limit: str) -> Callable[..., Awaitable[None]]:
        """For signed-in routes: counted per user, so rotating IPs doesn't help."""
        item = parse(limit)

        async def dependency(
            request: Request, caller: Annotated[Caller, Depends(current_caller)]
        ) -> None:
            await self._check(request, item, f"user:{caller.user_id}")

        return dependency


def client_key(ip: str) -> str:
    """IPv4 as it is; IPv6 as its /64 network (`2001:db8:1:2::/64`); anything else as given."""
    try:
        address = ipaddress.ip_address(ip)
    except ValueError:
        return ip
    if isinstance(address, ipaddress.IPv6Address):
        if address.ipv4_mapped is not None:
            return str(address.ipv4_mapped)
        return str(ipaddress.ip_network(f"{address}/{IPV6_CLIENT_PREFIX}", strict=False))
    return str(address)
