"""
Per-user LLM rate limiter — sliding window, LLM_HOURLY_LIMIT requests per hour (default 200).

Two backends:
  - Redis  (when REDIS_URL is set): correct under multi-pod / multi-region
  - In-memory (fallback):           single-process only; fine for local dev

Both backends share the same public interface: enforce(user_id).
Raises HTTPException(429) when the limit is exceeded.
"""

import logging
import random
import time
from collections import deque
from threading import Lock
from typing import TYPE_CHECKING

from fastapi import HTTPException

if TYPE_CHECKING:
    import redis as _redis_type

log = logging.getLogger(__name__)

_WINDOW_SECONDS = 3600  # 1 hour


def _max_calls() -> int:
    from app.settings import settings

    return settings.llm_hourly_limit


# ---------------------------------------------------------------------------
# In-memory fallback
# ---------------------------------------------------------------------------
_mem_log: dict[str, deque] = {}
_mem_lock = Lock()
_mem_sweep_counter = 0
_MEM_SWEEP_EVERY = 500  # sweep stale keys every N enforce calls


def _enforce_memory(user_id: str) -> None:
    global _mem_sweep_counter
    limit = _max_calls()
    # Use time.time() (wall clock) to match the Redis backend's semantics.
    # time.monotonic() is process-local and resets on restart, which would
    # let users bypass their hourly quota after a process restart.
    now = time.time()
    cutoff = now - _WINDOW_SECONDS
    with _mem_lock:
        # Periodically evict keys whose most recent request is outside the window
        # so inactive-user entries don't accumulate indefinitely.
        _mem_sweep_counter += 1
        if _mem_sweep_counter >= _MEM_SWEEP_EVERY:
            _mem_sweep_counter = 0
            stale = [k for k, dq in _mem_log.items() if not dq or dq[-1] < cutoff]
            for k in stale:
                del _mem_log[k]

        dq = _mem_log.pop(user_id, deque())
        while dq and dq[0] < cutoff:
            dq.popleft()
        if len(dq) >= limit:
            _mem_log[user_id] = dq
            raise HTTPException(
                status_code=429,
                detail=f"LLM rate limit exceeded: max {limit} requests per hour.",
            )
        dq.append(now)
        _mem_log[user_id] = dq


# ---------------------------------------------------------------------------
# Redis sliding-window backend
# ---------------------------------------------------------------------------
_redis_client: "_redis_type.Redis | None" = None
_redis_init_attempted = False
_redis_init_lock = Lock()


def _get_redis() -> "_redis_type.Redis | None":
    global _redis_client, _redis_init_attempted
    if _redis_init_attempted:
        return _redis_client
    with _redis_init_lock:
        if _redis_init_attempted:  # re-check after acquiring lock
            return _redis_client
        _redis_init_attempted = True
        from app.settings import settings

        if not settings.redis_url:
            return None
        try:
            import redis

            client = redis.Redis.from_url(
                settings.redis_url,
                decode_responses=True,
                socket_connect_timeout=2,
                socket_timeout=2,
            )
            client.ping()
            _redis_client = client
            log.info("llm_rate_limiter: Redis connected (%s)", settings.redis_url)
        except Exception as exc:
            log.warning(
                "llm_rate_limiter: Redis unavailable — falling back to in-memory. error=%s", exc
            )
            _redis_client = None
        return _redis_client


# Lua script that atomically removes expired entries, checks the count, and
# records the new call in a single round-trip.  Eliminates the TOCTOU race
# present in the two-pipeline approach (check then add).
# Returns 1 if the call is allowed, 0 if the limit is exceeded.
_ENFORCE_LUA = """\
local key     = KEYS[1]
local now     = tonumber(ARGV[1])
local cutoff  = tonumber(ARGV[2])
local limit   = tonumber(ARGV[3])
local member  = ARGV[4]
local window  = tonumber(ARGV[5])
redis.call('ZREMRANGEBYSCORE', key, '-inf', cutoff)
local count = redis.call('ZCARD', key)
if count >= limit then
    return 0
end
redis.call('ZADD', key, now, member)
redis.call('EXPIRE', key, window)
return 1
"""


def _enforce_redis(r: "_redis_type.Redis", user_id: str) -> None:
    limit = _max_calls()
    key = f"llm_rate:{user_id}"
    now = time.time()
    cutoff = now - _WINDOW_SECONDS
    member = f"{now:.6f}:{random.getrandbits(64)}"  # nosec B311
    allowed = r.eval(
        _ENFORCE_LUA, 1, key, str(now), str(cutoff), str(limit), member, str(_WINDOW_SECONDS)
    )
    if not int(allowed):  # type: ignore[arg-type]  # redis eval returns ResponseT which includes Awaitable
        raise HTTPException(
            status_code=429,
            detail=f"LLM rate limit exceeded: max {limit} requests per hour.",
        )


# ---------------------------------------------------------------------------
# Public entry points
# ---------------------------------------------------------------------------


def get_redis_client() -> "_redis_type.Redis | None":
    """Return the shared Redis client, or None if Redis is unavailable."""
    return _get_redis()


def enforce(user_id: str) -> None:
    """Raise HTTPException(429) if the user has exceeded the hourly LLM limit."""
    r = _get_redis()
    if r is not None:
        try:
            _enforce_redis(r, user_id)
            return
        except HTTPException:
            raise
        except Exception as exc:
            # Redis error mid-request — log and fall through to in-memory so the
            # request still completes rather than 500-ing.
            log.warning("llm_rate_limiter: Redis error, falling back to in-memory. error=%s", exc)
    _enforce_memory(user_id)
