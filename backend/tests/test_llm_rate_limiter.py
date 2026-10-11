import logging
import os
import threading
import time
import uuid

import pytest
import redis
from fastapi import HTTPException

import app.llm_rate_limiter as rl
from app.settings import settings


@pytest.fixture(autouse=True)
def fresh_state(monkeypatch):
    """Module-level caches must not leak between tests (or into the app)."""
    monkeypatch.setattr(rl, "_mem_log", {})
    monkeypatch.setattr(rl, "_mem_sweep_counter", 0)
    monkeypatch.setattr(rl, "_redis_client", None)
    monkeypatch.setattr(rl, "_redis_init_attempted", False)
    monkeypatch.setattr(settings, "llm_hourly_limit", 3)


class _Clock:
    def __init__(self, start: float = 1_000_000.0):
        self.now = start

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def clock(monkeypatch):
    c = _Clock()
    monkeypatch.setattr(rl.time, "time", c)
    return c


def _assert_429(fn, *args):
    with pytest.raises(HTTPException) as exc:
        fn(*args)
    assert exc.value.status_code == 429
    assert exc.value.detail == "LLM rate limit exceeded: max 3 requests per hour."


def test_max_calls_comes_from_settings():
    assert rl._max_calls() == 3


# -- in-memory backend -----------------------------------------------------------


def test_memory_allows_up_to_the_limit_then_429(clock):
    for _ in range(3):
        rl._enforce_memory("u1")
    _assert_429(rl._enforce_memory, "u1")
    assert len(rl._mem_log["u1"]) == 3  # the rejected call isn't recorded
    rl._enforce_memory("u2")  # per-user buckets


def test_memory_window_slides(clock):
    for _ in range(3):
        rl._enforce_memory("u1")
    clock.now += rl._WINDOW_SECONDS + 1  # all three calls are now outside the window
    rl._enforce_memory("u1")
    assert len(rl._mem_log["u1"]) == 1


def test_memory_window_edge_matches_the_redis_backend(clock):
    # A call exactly _WINDOW_SECONDS old has left the window — Redis's
    # ZREMRANGEBYSCORE -inf cutoff is inclusive, so memory must agree.
    for _ in range(3):
        rl._enforce_memory("u1")
    clock.now += rl._WINDOW_SECONDS - 1
    _assert_429(rl._enforce_memory, "u1")  # still inside the window
    clock.now += 1  # exactly one window later
    rl._enforce_memory("u1")


def test_memory_sweep_evicts_users_exactly_one_window_idle(clock, monkeypatch):
    monkeypatch.setattr(rl, "_MEM_SWEEP_EVERY", 2)
    rl._enforce_memory("idle")
    clock.now += rl._WINDOW_SECONDS  # exactly at the edge counts as idle
    rl._enforce_memory("active")
    assert set(rl._mem_log) == {"active"}


def test_memory_sweep_evicts_inactive_users(clock, monkeypatch):
    monkeypatch.setattr(rl, "_MEM_SWEEP_EVERY", 3)
    rl._enforce_memory("idle")
    rl._mem_log["empty"] = rl.deque()
    clock.now += rl._WINDOW_SECONDS + 1
    rl._enforce_memory("active")  # 2nd call — no sweep yet
    assert "idle" in rl._mem_log
    rl._enforce_memory("active")  # 3rd call — sweep
    assert set(rl._mem_log) == {"active"}
    assert rl._mem_sweep_counter == 0


# -- Redis client setup -----------------------------------------------------------


class _FakeRedis:
    def __init__(self, *, ping_error: Exception | None = None, eval_result=1, eval_error=None):
        self.ping_error, self.eval_result, self.eval_error = ping_error, eval_result, eval_error
        self.eval_calls: list[tuple] = []

    def ping(self):
        if self.ping_error:
            raise self.ping_error
        return True

    def eval(self, *args):
        self.eval_calls.append(args)
        if self.eval_error:
            raise self.eval_error
        return self.eval_result


def test_no_redis_url_means_no_client(monkeypatch):
    monkeypatch.setattr(settings, "redis_url", None)
    assert rl._get_redis() is None
    assert rl._redis_init_attempted is True


@pytest.mark.parametrize(("token", "password"), [("s3cret", "s3cret"), ("", None)])
def test_redis_client_is_created_once_with_auth(monkeypatch, caplog, token, password):
    monkeypatch.setattr(settings, "redis_url", "redis://cache:6379")
    monkeypatch.setattr(settings, "redis_auth_token", token)
    fake, calls = _FakeRedis(), []

    def from_url(url, **kwargs):
        calls.append((url, kwargs))
        return fake

    monkeypatch.setattr(redis.Redis, "from_url", from_url)
    with caplog.at_level(logging.INFO, logger="app.llm_rate_limiter"):
        assert rl._get_redis() is fake
        assert rl.get_redis_client() is fake  # cached — no second connection
    assert len(calls) == 1
    url, kwargs = calls[0]
    assert url == "redis://cache:6379"
    assert kwargs["password"] == password
    assert kwargs["decode_responses"] is True
    # Bounded timeouts: an unreachable Redis must never hang a request.
    assert (kwargs["socket_connect_timeout"], kwargs["socket_timeout"]) == (2, 2)
    assert "Redis connected (redis://cache:6379)" in caplog.text


def test_unreachable_redis_falls_back_to_none(monkeypatch, caplog):
    monkeypatch.setattr(settings, "redis_url", "redis://cache:6379")
    monkeypatch.setattr(
        redis.Redis,
        "from_url",
        lambda url, **kw: _FakeRedis(ping_error=ConnectionError("cache refused")),
    )
    with caplog.at_level(logging.WARNING, logger="app.llm_rate_limiter"):
        assert rl._get_redis() is None
    assert "Redis unavailable — falling back to in-memory. error=cache refused" in caplog.text
    assert rl._redis_init_attempted is True  # not retried on every request


def test_concurrent_first_calls_connect_exactly_once(monkeypatch):
    # Real threads racing on first use. The test holds the init lock while they
    # start, so every thread passes the unlocked fast-path check and queues on
    # the lock; once released, the first initialises and the rest must take the
    # re-check-after-locking path instead of connecting again.
    monkeypatch.setattr(settings, "redis_url", "redis://cache:6379")
    fake, connects = _FakeRedis(), []

    def from_url(url, **kwargs):
        connects.append(url)
        time.sleep(0.05)  # widen the window a second connection would need
        return fake

    monkeypatch.setattr(redis.Redis, "from_url", from_url)
    results: list = []
    threads = [threading.Thread(target=lambda: results.append(rl._get_redis())) for _ in range(8)]
    with rl._redis_init_lock:
        for t in threads:
            t.start()
        deadline = time.monotonic() + 5
        while sum(t.is_alive() for t in threads) < len(threads) and time.monotonic() < deadline:
            time.sleep(0.01)  # all threads alive = all blocked on the lock
    for t in threads:
        t.join(timeout=5)
    assert connects == ["redis://cache:6379"]  # exactly one connection
    assert results == [fake] * 8


# -- Redis backend ----------------------------------------------------------------


def test_redis_enforce_passes_the_window_arguments(clock):
    fake = _FakeRedis(eval_result=1)
    rl._enforce_redis(fake, "u1")
    [(script, numkeys, key, now, cutoff, limit, member, window)] = fake.eval_calls
    assert (script, numkeys, key) == (rl._ENFORCE_LUA, 1, "llm_rate:u1")
    assert (float(now), float(cutoff)) == (clock.now, clock.now - rl._WINDOW_SECONDS)
    assert (limit, window) == ("3", str(rl._WINDOW_SECONDS))
    assert member.startswith(f"{clock.now:.6f}:")


def test_redis_enforce_rejects_when_script_says_no():
    _assert_429(rl._enforce_redis, _FakeRedis(eval_result=0), "u1")


# -- enforce() --------------------------------------------------------------------


def test_enforce_uses_memory_without_redis(monkeypatch, clock):
    monkeypatch.setattr(settings, "redis_url", None)
    rl.enforce("u1")
    assert len(rl._mem_log["u1"]) == 1


def test_enforce_uses_redis_when_available(monkeypatch):
    fake = _FakeRedis(eval_result=1)
    monkeypatch.setattr(rl, "_get_redis", lambda: fake)
    rl.enforce("u1")
    [call] = fake.eval_calls
    assert call[2] == "llm_rate:u1"  # bucketed by this user
    assert rl._mem_log == {}  # memory backend untouched


def test_enforce_propagates_redis_429_without_memory_fallback(monkeypatch):
    monkeypatch.setattr(rl, "_get_redis", lambda: _FakeRedis(eval_result=0))
    _assert_429(rl.enforce, "u1")
    assert rl._mem_log == {}


def test_enforce_falls_back_to_memory_on_redis_error(monkeypatch, caplog, clock):
    monkeypatch.setattr(rl, "_get_redis", lambda: _FakeRedis(eval_error=TimeoutError("slow")))
    with caplog.at_level(logging.WARNING, logger="app.llm_rate_limiter"):
        rl.enforce("u1")
    assert "Redis error, falling back to in-memory. error=slow" in caplog.text
    assert len(rl._mem_log["u1"]) == 1


# -- the real Lua script, when a Redis is reachable (CI provides one) --------------


def _live_redis():
    url = os.environ.get("REDIS_URL")
    if not url:
        return None
    try:
        client = redis.Redis.from_url(url, decode_responses=True, socket_connect_timeout=1)
        client.ping()
        return client
    except redis.RedisError:
        return None


@pytest.mark.live_service
@pytest.mark.skipif(_live_redis() is None, reason="no reachable Redis (REDIS_URL)")
def test_lua_sliding_window_against_real_redis():
    client = _live_redis()
    user = f"test-{uuid.uuid4()}"
    try:
        for _ in range(3):
            rl._enforce_redis(client, user)
        _assert_429(rl._enforce_redis, client, user)
        assert client.zcard(f"llm_rate:{user}") == 3
        assert 0 < client.ttl(f"llm_rate:{user}") <= rl._WINDOW_SECONDS
    finally:
        client.delete(f"llm_rate:{user}")
