"""Login failures per email key and IP (docs/auth-users-split.md, 9.1).

After 5 failed logins in 15 minutes for one email key from one IP, that IP's attempts for
that email are refused for the rest of the window, **before any lookup**. Counting per key
*and* IP means nobody can lock a known user out from elsewhere. Across all IPs, 10
failures in 15 minutes slow that email's logins to one a minute (ACCOUNT_FAILURES), so
spreading guesses over many addresses doesn't help either.

Counters are in Valkey, under the `auth` prefix its RBAC user may write
(`LIMITS:LIMITER/auth/*`, build plan 2.3). While Valkey is unreachable they're counted per
task, as the rate limits are, so a short outage weakens the throttle rather than blocking
logins. Counting is async (`limits.aio`), so a slow Valkey never blocks the event loop
(production-readiness review, APP-05).
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable, Mapping
from typing import Any

from limits import RateLimitItem, parse
from limits.aio.storage import MemoryStorage, RedisStorage, Storage
from limits.aio.strategies import FixedWindowRateLimiter

FAILURES = parse("5/15minutes")
# Across every IP (production-readiness review, AUTH-04): after this many failures for one
# email in the window, its logins slow to ACCOUNT_SLOWED, from any address, until the
# window ends. A slowdown and not a lockout, so nobody can lock the owner out by
# failing on purpose; a botnet still gets only one guess a minute per account.
ACCOUNT_FAILURES = parse("10/15minutes")
ACCOUNT_SLOWED = parse("1/minute")
RETRY_PRIMARY_AFTER_SECONDS = 30.0

_logger = logging.getLogger(__name__)


class LoginThrottle:
    def __init__(
        self,
        redis_url: str | None,
        *,
        prefix: str = "auth",
        primary: Storage | None = None,
        clock: Callable[[], float] = time.monotonic,
        redis_options: Mapping[str, Any] | None = None,
    ) -> None:
        self.prefix = prefix
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
        self._primary = FixedWindowRateLimiter(primary) if primary is not None else None
        self._memory = FixedWindowRateLimiter(MemoryStorage())
        self._primary_down_until = 0.0

    def _ids(self, kind: str, key: str, ip: str = "") -> tuple[str, ...]:
        # The email key's first 16 characters, as logs carry: enough to separate users.
        return (self.prefix, kind, key[:16], *((ip,) if ip else ()))

    async def _run(self, method: str, item: RateLimitItem, ids: tuple[str, ...]) -> bool:
        if self._primary is not None and self.clock() >= self._primary_down_until:
            try:
                return bool(await getattr(self._primary, method)(item, *ids))
            except Exception as exc:
                self._primary_down_until = self.clock() + RETRY_PRIMARY_AFTER_SECONDS
                _logger.warning(
                    "login throttle: Valkey unreachable (%s); counting per task",
                    type(exc).__name__,
                )
        return bool(await getattr(self._memory, method)(item, *ids))

    async def is_blocked(self, key: str, ip: str) -> bool:
        """True when this key and IP have used up their failures, or when the key has
        across all IPs and this minute's one attempt is already taken."""
        if not await self._run("test", FAILURES, self._ids("login-failures", key, ip)):
            return True
        if await self._run("test", ACCOUNT_FAILURES, self._ids("login-account", key)):
            return False
        # Slowed: one attempt a minute, whoever makes it.
        return not await self._run("hit", ACCOUNT_SLOWED, self._ids("login-slowed", key))

    async def failed(self, key: str, ip: str) -> None:
        await self._run("hit", FAILURES, self._ids("login-failures", key, ip))
        await self._run("hit", ACCOUNT_FAILURES, self._ids("login-account", key))

    async def succeeded(self, key: str, ip: str) -> None:
        """A correct password clears the counts."""
        await self._run("clear", FAILURES, self._ids("login-failures", key, ip))
        await self._run("clear", ACCOUNT_FAILURES, self._ids("login-account", key))
