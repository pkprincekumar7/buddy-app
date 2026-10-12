import asyncio
import logging
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

import app.main as main
from app.database import get_db
from app.main import app
from app.routing import COUNTRY_TO_REGION


@pytest.fixture
def client():
    # Not a context manager: the lifespan (Mongo, cleanup task) is tested separately.
    return TestClient(app)


# -- _git_info -------------------------------------------------------------------


def test_git_info_reads_build_metadata(monkeypatch):
    for k, v in {
        "GIT_SHA": "abc123",
        "GIT_BRANCH": "main",
        "GIT_COMMITTED_AT": "2026-10-01",
    }.items():
        monkeypatch.setenv(k, v)
    monkeypatch.setenv("GIT_TAG", "v1.2.3")
    assert main._git_info() == {
        "commit": "abc123",
        "branch": "main",
        "committed_at": "2026-10-01",
        "tag": "v1.2.3",
    }


def test_git_info_defaults_when_unset(monkeypatch):
    for k in ("GIT_SHA", "GIT_BRANCH", "GIT_COMMITTED_AT"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("GIT_TAG", "")  # empty tag → None
    assert main._git_info() == {
        "commit": "unknown",
        "branch": "unknown",
        "committed_at": "unknown",
        "tag": None,
    }


# -- health endpoints ------------------------------------------------------------


def test_liveness_probe(client):
    res = client.get("/health")
    assert (res.status_code, res.json()) == (200, {"status": "ok"})


def test_api_health_returns_build_metadata(client):
    main.limiter.reset()
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok", **main._GIT_INFO}


def test_api_health_is_rate_limited(client):
    main.limiter.reset()
    for _ in range(30):
        assert client.get("/api/health").status_code == 200
    assert client.get("/api/health").status_code == 429  # 30/minute, slowapi's handler
    main.limiter.reset()


# -- request-id / cache middleware -----------------------------------------------


def test_valid_client_request_id_is_echoed(client):
    rid = "abc-DEF_123"
    assert client.get("/health", headers={"X-Request-Id": rid}).headers["X-Request-Id"] == rid


@pytest.mark.parametrize("bad", ["", "has space", "x" * 65, "semi;colon"])
def test_invalid_request_id_is_replaced_with_a_uuid(client, bad):
    rid = client.get("/health", headers={"X-Request-Id": bad}).headers["X-Request-Id"]
    assert rid != bad
    uuid.UUID(rid)  # a freshly generated UUID


@pytest.mark.parametrize("rid", ["abc123\n", "abc\nX-Injected: 1", "x" * 64 + "\n"])
def test_request_id_pattern_rejects_newlines(rid):
    # HTTP can't carry a raw newline in a header, so this checks the pattern itself:
    # anchored with \Z — Python's $ would have accepted a trailing "\n".
    assert main._REQUEST_ID_RE.match(rid) is None
    assert main._REQUEST_ID_RE.match(rid.split("\n")[0][:64]) is not None


def test_api_responses_are_not_cacheable_but_health_is(client):
    main.limiter.reset()
    assert client.get("/api/v1/auth/me").headers["Cache-Control"] == "no-store"  # a 401
    assert "Cache-Control" not in client.get("/health").headers
    assert "Cache-Control" not in client.get("/api/health").headers


# -- CORS ------------------------------------------------------------------------


def test_cors_preflight_for_allowed_and_unknown_origins(client):
    headers = {"Access-Control-Request-Method": "POST"}
    unknown = client.options(
        "/api/v1/auth/register", headers={**headers, "Origin": "https://evil.example"}
    )
    assert "access-control-allow-origin" not in unknown.headers
    if not main._allow_origins:
        pytest.skip("CORS_ORIGINS not configured in this environment")
    origin = main._allow_origins[0]
    res = client.options(
        "/api/v1/auth/register",
        headers={
            **headers,
            "Origin": origin,
            "Access-Control-Request-Headers": "x-client-location",
        },
    )
    assert res.status_code == 200
    assert res.headers["access-control-allow-origin"] == origin
    assert res.headers["access-control-allow-credentials"] == "true"
    assert "x-client-location" in res.headers["access-control-allow-headers"].lower()


# -- exception handlers ----------------------------------------------------------


def test_validation_errors_return_422_with_details(client, caplog):
    main.limiter.reset()
    app.dependency_overrides[get_db] = lambda: None  # resolved before body validation
    try:
        with caplog.at_level(logging.WARNING, logger="app.main"):
            res = client.post("/api/v1/auth/login", json={"email": "a@example.com"})  # no password
    finally:
        app.dependency_overrides.pop(get_db, None)
    assert res.status_code == 422
    assert any(err["loc"][-1] == "password" for err in res.json()["detail"])
    assert "422 validation_error path=/api/v1/auth/login" in caplog.text


@pytest.mark.parametrize(
    ("body", "field", "message"),
    [
        ({"email": "a@example.com", "password": "password1", "country_code": "ZZ"},
         "country_code", "Unsupported country_code 'ZZ'"),
        ({"email": "not-an-email", "password": "password1", "country_code": "DE"},
         "email", "must have an @-sign"),
    ],
)  # fmt: skip
def test_custom_validator_errors_are_422_not_500(client, body, field, message):
    # A field_validator's ValueError rides along in ctx.error; it must still
    # serialize to a JSON 422 (regression: it used to crash into a 500).
    main.limiter.reset()
    app.dependency_overrides[get_db] = lambda: None
    try:
        res = client.post("/api/v1/auth/register", json=body)
    finally:
        app.dependency_overrides.pop(get_db, None)
    assert res.status_code == 422
    [error] = res.json()["detail"]
    assert error["loc"] == ["body", field]
    assert message in error["msg"]


def test_http_exceptions_keep_their_status_and_detail(client):
    res = client.get("/api/v1/auth/me")
    assert (res.status_code, res.json()) == (401, {"detail": "Not authenticated"})


def test_unhandled_errors_become_a_generic_500(caplog):
    request = Request({"type": "http", "method": "GET", "path": "/boom", "headers": []})
    with caplog.at_level(logging.ERROR, logger="app.main"):
        res = asyncio.run(main.unhandled_exception_handler(request, RuntimeError("secret detail")))
    assert res.status_code == 500
    assert res.body == b'{"detail":"Internal server error"}'  # no internals leaked
    assert "Unhandled error on GET /boom" in caplog.text


# -- session cleanup loop --------------------------------------------------------


class _StopLoop(Exception):
    """Raised by the fake sleep to end the otherwise-infinite loop."""


@pytest.fixture
def sleeps(monkeypatch):
    """Instant asyncio.sleep; ends the loop after `cycles` interval sleeps."""
    state = SimpleNamespace(calls=[], cycles=1)
    real_sleep = asyncio.sleep

    async def fake_sleep(seconds):
        state.calls.append(seconds)
        intervals = [s for s in state.calls if s == main._SESSION_CLEANUP_INTERVAL_SECONDS]
        if seconds == main._SESSION_CLEANUP_INTERVAL_SECONDS and len(intervals) > state.cycles:
            raise _StopLoop
        await real_sleep(0)

    monkeypatch.setattr(main.asyncio, "sleep", fake_sleep)
    return state


class _Redis:
    def __init__(self, *, acquire=True, delete_error=None):
        self.acquire, self.delete_error = acquire, delete_error
        self.set_calls, self.deleted = [], []

    def set(self, key, value, nx, ex):
        self.set_calls.append((key, value, nx, ex))
        return self.acquire

    def delete(self, key):
        if self.delete_error:
            raise self.delete_error
        self.deleted.append(key)


class _Sessions:
    def __init__(self, *, deleted_count=0, error=None, block=None):
        self.deleted_count, self.error, self.block = deleted_count, error, block
        self.queries = []

    async def delete_many(self, query):
        self.queries.append(query)
        if self.block:
            await self.block.wait()
        if self.error:
            raise self.error
        return SimpleNamespace(deleted_count=self.deleted_count)


def _run_cleanup(monkeypatch, redis, sessions):
    monkeypatch.setattr(main, "get_redis_client", lambda: redis)
    with pytest.raises(_StopLoop):
        asyncio.run(main._cleanup_expired_sessions({"sessions": sessions}))


def test_cleanup_with_redis_lock_deletes_expired_sessions_and_releases_lock(
    monkeypatch, sleeps, caplog
):
    redis, sessions = _Redis(acquire=True), _Sessions(deleted_count=4)
    with caplog.at_level(logging.INFO, logger="app.main"):
        _run_cleanup(monkeypatch, redis, sessions)
    assert redis.set_calls == [(main._CLEANUP_LOCK_KEY, "1", True, main._CLEANUP_LOCK_TTL)]
    [query] = sessions.queries
    assert set(query) == {"location", "expires_at"} and set(query["expires_at"]) == {"$lt"}
    # Every location a user can be assigned — so no expired session is missed.
    assert set(query["location"]["$in"]) == set(COUNTRY_TO_REGION.values())
    cutoff = query["expires_at"]["$lt"]
    # Must be "now" in UTC: Mongo stores UTC, so a naive local time would delete
    # the wrong sessions on any non-UTC host.
    assert cutoff.tzinfo is UTC
    assert abs((datetime.now(UTC) - cutoff).total_seconds()) < 5
    assert redis.deleted == [main._CLEANUP_LOCK_KEY]
    assert "removed 4 expired sessions" in caplog.text
    assert main._CLEANUP_LOCK_TTL < main._SESSION_CLEANUP_INTERVAL_SECONDS


def test_cleanup_skips_the_cycle_when_another_instance_holds_the_lock(monkeypatch, sleeps, caplog):
    sleeps.cycles = 2
    redis, sessions = _Redis(acquire=False), _Sessions()
    with caplog.at_level(logging.DEBUG, logger="app.main"):
        _run_cleanup(monkeypatch, redis, sessions)
    assert "lock held by another instance — skipping this cycle" in caplog.text
    assert len(redis.set_calls) == 2  # tried every cycle
    assert sessions.queries == [] and redis.deleted == []


def test_cleanup_without_redis_runs_with_jitter(monkeypatch, sleeps, caplog):
    sessions, bounds = _Sessions(deleted_count=0), []
    monkeypatch.setattr(main.random, "uniform", lambda a, b: bounds.append((a, b)) or 42.0)
    with caplog.at_level(logging.INFO, logger="app.main"):
        _run_cleanup(monkeypatch, None, sessions)
    assert bounds == [(0, 300)]  # up to 5 minutes of jitter per cycle
    assert 42.0 in sleeps.calls
    assert len(sessions.queries) == 1
    assert "removed" not in caplog.text  # nothing deleted → nothing logged
    # No lock was taken, so there is nothing to release (no warning, no error).
    assert not [r for r in caplog.records if r.name == "app.main" and r.levelno >= logging.WARNING]


def test_cleanup_error_is_logged_and_the_lock_still_released(monkeypatch, sleeps, caplog):
    redis = _Redis(acquire=True)
    with caplog.at_level(logging.ERROR, logger="app.main"):
        _run_cleanup(monkeypatch, redis, _Sessions(error=RuntimeError("mongo down")))
    assert "unexpected error — will retry next cycle" in caplog.text
    assert redis.deleted == [main._CLEANUP_LOCK_KEY]


def test_failed_lock_release_is_only_a_warning(monkeypatch, sleeps, caplog):
    redis = _Redis(acquire=True, delete_error=ConnectionError("redis gone"))
    with caplog.at_level(logging.WARNING, logger="app.main"):
        _run_cleanup(monkeypatch, redis, _Sessions())
    assert (
        f"failed to release Redis lock — will expire naturally in {main._CLEANUP_LOCK_TTL}s"
        in caplog.text
    )


def test_cancellation_mid_cleanup_propagates_and_leaves_the_lock_to_expire(monkeypatch, sleeps):
    redis = _Redis(acquire=True)
    monkeypatch.setattr(main, "get_redis_client", lambda: redis)

    async def scenario():
        block = asyncio.Event()  # never set: the delete hangs until cancelled
        sessions = _Sessions(block=block)
        task = asyncio.create_task(main._cleanup_expired_sessions({"sessions": sessions}))
        while not sessions.queries:
            await asyncio.sleep(0)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(scenario())
    # No executor call while cancelling; the lock's TTL cleans it up.
    assert redis.deleted == []


# -- lifespan --------------------------------------------------------------------


def test_lifespan_wires_up_and_tears_down(monkeypatch):
    events = []

    class FakeClient:
        def __init__(self, uri):
            events.append(("connect", uri))

        def __getitem__(self, name):
            return SimpleNamespace(name=name)

        def close(self):
            events.append(("close",))

    async def fake_init_indexes(db):
        events.append(("indexes", db.name))

    started = asyncio.Event()

    async def fake_cleanup(db):
        events.append(("cleanup-started", db.name))
        started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            events.append(("cleanup-cancelled",))
            raise

    async def fake_aclose():
        events.append(("llm-closed",))

    monkeypatch.setattr(main, "AsyncIOMotorClient", FakeClient)
    monkeypatch.setattr(main, "init_indexes", fake_init_indexes)
    monkeypatch.setattr(main, "_cleanup_expired_sessions", fake_cleanup)
    monkeypatch.setattr(main.llm_service, "aclose_clients", fake_aclose)
    test_app = FastAPI()

    async def scenario():
        async with main.lifespan(test_app):
            await asyncio.wait_for(started.wait(), timeout=5)  # never hang the suite
            assert test_app.state.db.name == main.settings.mongodb_db_name
            events.append(("serving",))

    asyncio.run(scenario())
    db = main.settings.mongodb_db_name
    assert events == [
        ("connect", main.settings.mongodb_uri),
        ("indexes", db),
        ("cleanup-started", db),
        ("serving",),
        ("cleanup-cancelled",),
        ("close",),
        ("llm-closed",),
    ]
