"""Every token and user record carries a valid `location`; there is no
DEFAULT_LOCATION fallback. A token without one is invalid — never treated as
some default location."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.auth_utils import _encode
from app.database import get_db
from app.main import app
from app.routing import location_from_claims, resolve_region


class _Collection:
    """Records calls; finds nothing."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []

    async def find_one(self, query, *args, **kwargs):  # always "not found"
        self.calls.append(("find_one", query))

    async def delete_one(self, query, *args, **kwargs):
        self.calls.append(("delete_one", query))


class _Db(dict):
    def __missing__(self, name):
        self[name] = _Collection()
        return self[name]


@pytest.fixture
def api():
    db = _Db()
    app.dependency_overrides[get_db] = lambda: db
    try:
        # Not used as a context manager, so the lifespan (Mongo/Redis) never starts.
        yield TestClient(app), db
    finally:
        app.dependency_overrides.pop(get_db, None)


def _token(token_type: str, **claims) -> str:
    now = datetime.now(UTC)
    payload = {"sub": "u1", "iat": now, "exp": now + timedelta(minutes=30), "type": token_type}
    if token_type == "refresh":
        payload["jti"] = str(uuid.uuid4())
    return _encode({**payload, **claims})


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# -- helpers ------------------------------------------------------------------


@pytest.mark.parametrize(("code", "location"), [("DE", "eu"), (" in ", "in"), ("us", "us")])
def test_resolve_region_maps_known_codes(code, location):
    assert resolve_region(code) == location


@pytest.mark.parametrize("code", ["", "ZZ", "IR"])  # empty, unknown, blocked (never mapped)
def test_resolve_region_has_no_fallback(code):
    with pytest.raises(ValueError):
        resolve_region(code)


@pytest.mark.parametrize(
    ("claims", "expected"),
    [
        ({"location": "eu"}, "eu"),
        ({}, None),
        ({"location": ""}, None),
        ({"location": 7}, None),
        ({"location": "EU; drop"}, None),
    ],
)
def test_location_from_claims(claims, expected):
    assert location_from_claims(claims) == expected


# -- routes -------------------------------------------------------------------


def test_authenticated_call_without_location_is_401_without_a_lookup(api):
    client, db = api
    res = client.get("/api/v1/auth/me", headers=_bearer(_token("access")))
    assert res.status_code == 401
    assert res.json()["detail"] == "Invalid token"
    assert db["users"].calls == []  # not looked up under a guessed location


def test_authenticated_call_looks_the_user_up_under_the_tokens_location(api):
    client, db = api
    res = client.get("/api/v1/auth/me", headers=_bearer(_token("access", location="eu")))
    assert res.status_code == 401  # the fake DB has no such user
    assert db["users"].calls == [("find_one", {"_id": "u1", "location": "eu"})]


def test_refresh_without_location_is_401_without_a_session_lookup(api):
    client, db = api
    res = client.post("/api/v1/auth/refresh", headers=_bearer(_token("refresh")))
    assert res.status_code == 401
    assert res.json()["detail"] == "Invalid token"
    assert db["sessions"].calls == []


def test_logout_without_location_still_succeeds(api):
    client, db = api
    res = client.post("/api/v1/auth/logout", headers=_bearer(_token("refresh")))
    assert res.status_code == 204
    assert db["sessions"].calls == []  # can't name the session, nothing deleted


def test_logout_with_location_deletes_that_session(api):
    client, db = api
    token = _token("refresh", location="eu", jti="j1")
    res = client.post("/api/v1/auth/logout", headers=_bearer(token))
    assert res.status_code == 204
    assert db["sessions"].calls == [("delete_one", {"_id": "j1", "location": "eu"})]
