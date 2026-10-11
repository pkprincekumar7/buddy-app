import asyncio
import importlib
import logging
import os
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
import redis.client
from fastapi import HTTPException, Request
from slowapi import Limiter

import app.limiter as limiter_mod
from app.auth_utils import _encode, create_access_token, create_refresh_token
from app.limiter import _get_client_ip, _get_user_id, rate_limit
from app.settings import settings


def _request(
    *,
    headers: dict[str, str] | None = None,
    client: tuple[str, int] | None = ("203.0.113.9", 1234),
    method: str = "GET",
    path: str = "/api/v1/things",
    route_path: str | None = None,
) -> Request:
    scope = {
        "type": "http",
        "method": method,
        "path": path,
        "headers": [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()],
        "client": client,
        "query_string": b"",
        "server": ("testserver", 80),
        "scheme": "http",
    }
    if route_path is not None:
        scope["route"] = SimpleNamespace(path=route_path)
    return Request(scope)


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# -- _get_client_ip ----------------------------------------------------------------


def test_client_ip_uses_leftmost_forwarded_for_behind_proxy(monkeypatch):
    monkeypatch.setattr(settings, "behind_proxy", True)
    for header in ("198.51.100.7,10.0.0.1", " 198.51.100.7 , 10.0.0.1"):
        assert _get_client_ip(_request(headers={"X-Forwarded-For": header})) == "198.51.100.7"


def test_client_ip_behind_proxy_without_header_uses_peer(monkeypatch):
    monkeypatch.setattr(settings, "behind_proxy", True)
    assert _get_client_ip(_request()) == "203.0.113.9"


def test_client_ip_ignores_forwarded_for_when_not_behind_proxy(monkeypatch):
    # Otherwise any client could pick its own rate-limit bucket.
    monkeypatch.setattr(settings, "behind_proxy", False)
    req = _request(headers={"X-Forwarded-For": "198.51.100.7"})
    assert _get_client_ip(req) == "203.0.113.9"


def test_client_ip_without_peer_uses_fallback_bucket(monkeypatch, caplog):
    monkeypatch.setattr(settings, "behind_proxy", False)
    with caplog.at_level(logging.WARNING, logger="app.limiter"):
        assert _get_client_ip(_request(client=None)) == "__no_peer_address__"
    assert "request.client is None" in caplog.text


# -- _get_user_id ------------------------------------------------------------------


def test_user_key_from_access_token_cookie_or_bearer(monkeypatch):
    token = create_access_token("u1", "eu")
    assert _get_user_id(_request(headers={"Cookie": f"access_token={token}"})) == "user:u1"
    assert _get_user_id(_request(headers=_bearer(token))) == "user:u1"


def test_user_key_still_uses_an_expired_access_token():
    past = datetime.now(UTC) - timedelta(hours=2)
    expired = _encode(
        {"sub": "u1", "type": "access", "iat": past, "exp": past + timedelta(minutes=1)}
    )
    assert _get_user_id(_request(headers=_bearer(expired))) == "user:u1"


def test_user_key_falls_back_to_ip(monkeypatch, caplog):
    monkeypatch.setattr(settings, "behind_proxy", False)
    now = datetime.now(UTC)
    no_sub = _encode({"type": "access", "iat": now, "exp": now + timedelta(minutes=5)})
    refresh, _ = create_refresh_token("u1", "eu")
    for headers in ({}, _bearer(refresh), _bearer(no_sub)):
        assert _get_user_id(_request(headers=headers)) == "ip:203.0.113.9"
    with caplog.at_level(logging.DEBUG, logger="app.limiter"):
        assert _get_user_id(_request(headers=_bearer("not-a-jwt"))) == "ip:203.0.113.9"
    assert "JWT decode failed (DecodeError)" in caplog.text


# -- Redis storage options (module import time) -----------------------------------


@pytest.mark.parametrize(("token", "has_password"), [("s3cret", True), ("", False)])
def test_redis_password_only_when_auth_token_set(monkeypatch, token, has_password):
    monkeypatch.setattr(settings, "redis_auth_token", token)
    try:
        reloaded = importlib.reload(limiter_mod)
        assert ("password" in reloaded._redis_storage_options) is has_password
        if has_password:
            assert reloaded._redis_storage_options["password"] == token
        assert reloaded._redis_storage_options["socket_timeout"] == 2
    finally:
        monkeypatch.undo()
        importlib.reload(limiter_mod)


# -- storage failure handling (_hit), with real limiters ----------------------------

# Nothing listens on the discard port: every Redis call is a genuine refusal.
DEAD_REDIS = "redis://127.0.0.1:9"


@pytest.fixture
def redis_commands(monkeypatch):
    """Counts real Redis commands sent through redis-py's public client API."""
    sent: list[str] = []
    original = redis.client.Redis.execute_command

    def counting(self, *args, **kwargs):
        sent.append(args[0])
        return original(self, *args, **kwargs)

    monkeypatch.setattr(redis.client.Redis, "execute_command", counting)
    return sent


def _dead_redis_limiter(**kwargs) -> Limiter:
    return Limiter(
        key_func=lambda r: "user:t",
        storage_uri=DEAD_REDIS,
        storage_options={"socket_connect_timeout": 0.5},
        key_prefix="rl_test",
        **kwargs,
    )


def _call(dep, route="/things"):
    asyncio.run(dep(_request(route_path=route)))


def test_redis_outage_falls_back_to_memory_and_still_enforces(redis_commands, caplog):
    dep = rate_limit("2/minute", scope=_dead_redis_limiter(in_memory_fallback_enabled=True))
    with caplog.at_level(logging.WARNING, logger="app.limiter"):
        _call(dep)
        _call(dep)
        with pytest.raises(HTTPException) as exc:
            _call(dep)
    assert exc.value.status_code == 429  # the limit holds during the outage
    assert "storage error (" in caplog.text and "127.0.0.1:9" in caplog.text  # error detail kept
    assert "falling back to in-memory" in caplog.text
    # Latched: one failed command, then never retried (no connect timeout per request).
    assert len(redis_commands) == 1


def test_redis_outage_keeps_buckets_separate_per_identity_and_route(redis_commands):
    # The in-memory fallback must bucket like the primary, not lump everyone together.
    limiter = Limiter(
        key_func=lambda r: r.headers.get("x-user", "anon"),
        storage_uri=DEAD_REDIS,
        storage_options={"socket_connect_timeout": 0.5},
        in_memory_fallback_enabled=True,
        key_prefix="rl_test",
    )
    dep = rate_limit("1/minute", scope=limiter)
    asyncio.run(dep(_request(route_path="/a", headers={"X-User": "u1"})))
    asyncio.run(dep(_request(route_path="/a", headers={"X-User": "u2"})))  # other user
    asyncio.run(dep(_request(route_path="/b", headers={"X-User": "u1"})))  # other route
    with pytest.raises(HTTPException):
        asyncio.run(dep(_request(route_path="/a", headers={"X-User": "u1"})))


def test_redis_outage_without_fallback_can_fail_open(redis_commands, caplog):
    dep = rate_limit("1/minute", scope=_dead_redis_limiter(swallow_errors=True))
    with caplog.at_level(logging.ERROR, logger="app.limiter"):
        for _ in range(3):  # never limited — failing open by configuration
            _call(dep)
    assert "failing open" in caplog.text
    assert len(redis_commands) == 1


def test_redis_outage_without_fallback_or_swallowing_raises(redis_commands):
    dep = rate_limit("1/minute", scope=_dead_redis_limiter())
    with pytest.raises(RuntimeError, match="no fallback"):
        _call(dep)


# -- rate_limit buckets, with a real in-memory limiter ------------------------------


def _memory_limiter(key_func=lambda r: "user:u1") -> Limiter:
    return Limiter(key_func=key_func, storage_uri="memory://", key_prefix="rl_test")


def _over_limit(dep, **request_kwargs) -> bool:
    try:
        asyncio.run(dep(_request(**request_kwargs)))
    except HTTPException as exc:
        assert (exc.status_code, exc.detail) == (429, "Rate limit exceeded: 1/minute")
        return True
    return False


def test_rate_limit_allows_then_rejects():
    dep = rate_limit("1/minute", scope=_memory_limiter())
    route = f"/r/{uuid.uuid4()}"
    assert _over_limit(dep, route_path=route) is False
    assert _over_limit(dep, route_path=route) is True


def test_buckets_are_per_route_template_not_per_url():
    # /children/c1 and /children/c2 share the template, so they share a bucket.
    dep = rate_limit("1/minute", scope=_memory_limiter())
    template = f"/children/{uuid.uuid4()}/{{child_id}}"
    assert _over_limit(dep, path="/children/c1", route_path=template) is False
    assert _over_limit(dep, path="/children/c2", route_path=template) is True


def test_buckets_are_per_http_method():
    dep = rate_limit("1/minute", scope=_memory_limiter())
    route = f"/r/{uuid.uuid4()}"
    assert _over_limit(dep, method="GET", route_path=route) is False
    assert _over_limit(dep, method="POST", route_path=route) is False


def test_buckets_are_per_identity():
    route = f"/r/{uuid.uuid4()}"
    # One limiter (one storage), keyed by a per-request identity.
    dep = rate_limit("1/minute", scope=_memory_limiter(lambda r: r.headers.get("x-user", "anon")))
    assert _over_limit(dep, route_path=route, headers={"X-User": "a"}) is False
    assert _over_limit(dep, route_path=route, headers={"X-User": "b"}) is False
    assert _over_limit(dep, route_path=route, headers={"X-User": "a"}) is True


def test_without_a_matched_route_the_url_path_is_the_bucket():
    dep = rate_limit("1/minute", scope=_memory_limiter())
    base = f"/raw/{uuid.uuid4()}"
    assert _over_limit(dep, path=f"{base}/a") is False
    assert _over_limit(dep, path=f"{base}/b") is False  # different path, different bucket
    assert _over_limit(dep, path=f"{base}/a") is True


# -- key prefixes on a shared Redis (production: limiter + user_limiter, one Redis) --


def _live_redis_url():
    url = os.environ.get("REDIS_URL")
    if not url:
        return None
    try:
        redis.Redis.from_url(url, socket_connect_timeout=1).ping()
        return url
    except redis.RedisError:
        return None


@pytest.mark.live_service
@pytest.mark.skipif(_live_redis_url() is None, reason="no reachable Redis (REDIS_URL)")
def test_key_prefix_keeps_limiters_sharing_one_redis_apart():
    url, key = _live_redis_url(), f"same-key-{uuid.uuid4()}"
    first = Limiter(key_func=lambda r: key, storage_uri=url, key_prefix="rl_a")
    second = Limiter(key_func=lambda r: key, storage_uri=url, key_prefix="rl_b")
    try:
        _call(rate_limit("1/minute", scope=first))
        _call(rate_limit("1/minute", scope=second))  # same key, other prefix: own bucket
        with pytest.raises(HTTPException):
            _call(rate_limit("1/minute", scope=first))
    finally:
        first.reset()
        second.reset()
