"""The per-user hourly LLM limit, shared by every circle (docs/auth-users-split.md, 8, 9.3).

A sliding window in Valkey keyed by `user_id`, so the limit applies across discover, grow,
transform and release rather than per service (today's `app/llm_rate_limiter.py`). While
Valkey is unreachable it's counted per task, and Valkey is retried after 30 s.
"""

from __future__ import annotations

import logging
import random
import time
from collections import deque
from collections.abc import Callable
from typing import Any

from fastapi import HTTPException

WINDOW_SECONDS = 3600
DEFAULT_LIMIT = 200  # today's LLM_HOURLY_LIMIT
RETRY_PRIMARY_AFTER_SECONDS = 30.0

_logger = logging.getLogger(__name__)

# Drop calls older than the window, refuse at the limit, else record this call.
_TAKE = """
local key, now, cutoff = KEYS[1], tonumber(ARGV[1]), tonumber(ARGV[2])
local limit, member, window = tonumber(ARGV[3]), ARGV[4], tonumber(ARGV[5])
redis.call('ZREMRANGEBYSCORE', key, '-inf', cutoff)
if redis.call('ZCARD', key) >= limit then
  return 0
end
redis.call('ZADD', key, now, member)
redis.call('EXPIRE', key, window)
return 1
"""


class LlmHourlyLimit:
    def __init__(
        self,
        redis: Any | None,
        *,
        limit: int = DEFAULT_LIMIT,
        window_seconds: int = WINDOW_SECONDS,
        clock: Callable[[], float] = time.time,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        if limit < 1:
            raise ValueError("the limit must be at least 1")
        self.redis = redis
        self.limit = limit
        self.window = window_seconds
        self.clock = clock
        self.monotonic = monotonic
        self._memory: dict[str, deque[float]] = {}
        self._primary_down_until = 0.0
        self._random = random.SystemRandom()

    @staticmethod
    def key(user_id: str) -> str:
        return f"llm:hourly:{user_id}"

    async def take(self, user_id: str) -> bool:
        """Count one LLM call for `user_id`; False when the hour's limit is reached."""
        now = self.clock()
        if self.redis is not None and self.monotonic() >= self._primary_down_until:
            member = f"{now:.6f}:{self._random.getrandbits(64)}"
            try:
                result = await self.redis.eval(
                    _TAKE,
                    1,
                    self.key(user_id),
                    now,
                    now - self.window,
                    self.limit,
                    member,
                    self.window,
                )
                return bool(int(result))
            except Exception as exc:
                self._primary_down_until = self.monotonic() + RETRY_PRIMARY_AFTER_SECONDS
                _logger.warning(
                    "LLM limit: Valkey unreachable (%s); counting per task", type(exc).__name__
                )
        calls = self._memory.setdefault(user_id, deque())
        while calls and calls[0] <= now - self.window:
            calls.popleft()
        if len(calls) >= self.limit:
            return False
        calls.append(now)
        return True

    async def enforce(self, user_id: str) -> None:
        """429 when the user has used the hour's LLM calls (for the HTTP start of a job)."""
        if not await self.take(user_id):
            raise HTTPException(
                status_code=429,
                detail=f"LLM rate limit exceeded: max {self.limit} requests per hour.",
                headers={"Retry-After": str(self.window)},
            )
