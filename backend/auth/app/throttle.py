"""Login failures per email key and IP (docs/auth-users-split.md, 9.1).

After 5 failed logins in 15 minutes for one email key from one IP, that IP's attempts for
that email are refused for the rest of the window, **before any lookup**. Counting per key
*and* IP means nobody can lock a known user out from elsewhere.

Counters are in Valkey, under the `auth` prefix its RBAC user may write
(`LIMITS:LIMITER/auth/*`, build plan 2.3). While Valkey is unreachable they're counted per
task, as the rate limits are, so a short outage weakens the throttle rather than blocking
logins.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable, Mapping
from typing import Any

from limits import parse
from limits.storage import MemoryStorage, RedisStorage, Storage
from limits.strategies import FixedWindowRateLimiter

FAILURES = parse("5/15minutes")
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
                redis_url, socket_connect_timeout=2, socket_timeout=2, **(redis_options or {})
            )
        self._primary = FixedWindowRateLimiter(primary) if primary is not None else None
        self._memory = FixedWindowRateLimiter(MemoryStorage())
        self._primary_down_until = 0.0

    def _ids(self, key: str, ip: str) -> tuple[str, ...]:
        # The email key's first 16 characters, as logs carry: enough to separate users.
        return (self.prefix, "login-failures", key[:16], ip)

    def _run(self, method: str, key: str, ip: str) -> bool:
        if self._primary is not None and self.clock() >= self._primary_down_until:
            try:
                return bool(getattr(self._primary, method)(FAILURES, *self._ids(key, ip)))
            except Exception as exc:
                self._primary_down_until = self.clock() + RETRY_PRIMARY_AFTER_SECONDS
                _logger.warning(
                    "login throttle: Valkey unreachable (%s); counting per task",
                    type(exc).__name__,
                )
        return bool(getattr(self._memory, method)(FAILURES, *self._ids(key, ip)))

    def blocked(self, key: str, ip: str) -> bool:
        """True when this key and IP have used up their failures."""
        return not self._run("test", key, ip)

    def failed(self, key: str, ip: str) -> None:
        self._run("hit", key, ip)

    def succeeded(self, key: str, ip: str) -> None:
        """A correct password clears the count."""
        self._run("clear", key, ip)
