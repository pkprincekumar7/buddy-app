"""Integration tests against a real MongoDB — the parts where an in-memory fake
could disagree with the server: index creation (the server validates partial
filters and TTL options), datetime round-trips in the session-cleanup query,
and the admin $facet aggregations.

Runs only when MONGODB_TEST_URI is set (CI points it at its mongo:7 service).
Deliberately NOT MONGODB_URI, which locally names a real Atlas cluster. Each
test gets a throwaway database that is dropped afterwards.
"""

import asyncio
import os
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import httpx
import pytest
from motor.motor_asyncio import AsyncIOMotorClient

import app.main as main
from app import models
from app.auth_utils import create_access_token
from app.database import get_db, init_indexes
from app.limiter import user_limiter
from app.main import app
from tests.test_database import EXPECTED_INDEXES

MONGODB_TEST_URI = os.environ.get("MONGODB_TEST_URI")

pytestmark = [
    pytest.mark.live_service,
    pytest.mark.skipif(not MONGODB_TEST_URI, reason="MONGODB_TEST_URI not set"),
]


def run_with_db(test):
    """Run `await test(db)` against a fresh throwaway database, in one event loop
    (Motor binds to the loop it is used from)."""

    async def scenario():
        client = AsyncIOMotorClient(MONGODB_TEST_URI, serverSelectionTimeoutMS=3000)
        name = f"buddy_test_{uuid.uuid4().hex[:12]}"
        db = client[name]
        try:
            await client.admin.command("ping")
            return await test(db)
        finally:
            await client.drop_database(name)
            client.close()

    return asyncio.run(scenario())


async def api(db, method: str, path: str, *, user=None, **kwargs) -> httpx.Response:
    """Call the real app with the real database injected (same event loop)."""
    app.dependency_overrides[get_db] = lambda: db
    user_limiter.reset()
    headers = kwargs.pop("headers", {})
    if user:
        token = create_access_token(user["_id"], user["location"])
        headers["Authorization"] = f"Bearer {token}"
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.request(method, path, headers=headers, **kwargs)
    finally:
        app.dependency_overrides.pop(get_db, None)


ADMIN = {"_id": "admin1", "location": "in", "role": "admin", "email": "admin@example.com"}


# -- database.init_indexes -----------------------------------------------------------


def _key_spec(index: dict) -> list[tuple[str, int]]:
    return [(field, int(direction)) for field, direction in index["key"].items()]


def test_init_indexes_creates_the_contract_on_a_real_server_and_is_idempotent():
    async def test(db):
        await init_indexes(db)
        await init_indexes(db)  # startup runs it every time — must be a no-op
        actual = []
        for collection in sorted({c for c, _, _ in EXPECTED_INDEXES}):
            async for index in db[collection].list_indexes():
                if index["name"] == "_id_":
                    continue
                options = {
                    k: index[k]
                    for k in ("unique", "partialFilterExpression", "expireAfterSeconds")
                    if k in index
                }
                actual.append((collection, _key_spec(index), options))
        return actual

    actual = run_with_db(test)
    assert sorted(actual, key=repr) == sorted(EXPECTED_INDEXES, key=repr)


def test_unique_indexes_are_enforced_by_the_server():
    from pymongo.errors import DuplicateKeyError

    async def test(db):
        await init_indexes(db)
        await db[models.USERS].insert_one({"_id": "u1", "location": "eu", "email": "a@x.com"})
        with pytest.raises(DuplicateKeyError):  # (location, email) unique
            await db[models.USERS].insert_one({"_id": "u2", "location": "eu", "email": "a@x.com"})
        # Same email in another location is a different (location, email) key.
        await db[models.USERS].insert_one({"_id": "u3", "location": "us", "email": "a@x.com"})

    run_with_db(test)


# -- main._cleanup_expired_sessions ------------------------------------------------------


def test_session_cleanup_deletes_only_expired_sessions(monkeypatch):
    calls = []

    async def one_cycle_sleep(seconds):
        calls.append(seconds)
        if len(calls) > 1:
            raise asyncio.CancelledError  # stop after one cycle

    monkeypatch.setattr(main, "get_redis_client", lambda: SimpleNamespace(
        set=lambda *a, **k: True, delete=lambda *a: None))  # fmt: skip

    async def test(db):
        now = datetime.now(UTC)
        await db[models.SESSIONS].insert_many(
            [
                {"_id": "expired", "location": "eu", "expires_at": now - timedelta(minutes=1)},
                {"_id": "live", "location": "eu", "expires_at": now + timedelta(hours=1)},
            ]
        )
        monkeypatch.setattr(main.asyncio, "sleep", one_cycle_sleep)
        with pytest.raises(asyncio.CancelledError):
            await main._cleanup_expired_sessions(db)
        return [d["_id"] async for d in db[models.SESSIONS].find()]

    assert run_with_db(test) == ["live"]


# -- deps.get_current_user via a real route --------------------------------------


def test_current_user_is_found_under_its_location_and_revocation_round_trips():
    async def test(db):
        await db[models.USERS].insert_one(
            {**ADMIN, "full_name": "A", "tokens_revoked_at": datetime.now(UTC) - timedelta(hours=1)}
        )
        ok = await api(db, "GET", "/api/v1/auth/me", user=ADMIN)
        wrong_location = await api(db, "GET", "/api/v1/auth/me", user={**ADMIN, "location": "eu"})
        # Revoke now: Mongo returns the stored time naive — must still compare as UTC.
        await db[models.USERS].update_one(
            {"_id": "admin1"},
            {"$set": {"tokens_revoked_at": datetime.now(UTC) + timedelta(seconds=5)}},
        )
        revoked = await api(db, "GET", "/api/v1/auth/me", user=ADMIN)
        return ok, wrong_location, revoked

    ok, wrong_location, revoked = run_with_db(test)
    assert ok.status_code == 200 and ok.json()["id"] == "admin1"
    assert (wrong_location.status_code, wrong_location.json()["detail"]) == (401, "User not found")
    assert (revoked.status_code, revoked.json()["detail"]) == (401, "Session revoked")


# -- routers.admin ---------------------------------------------------------------


def test_admin_user_listing_sorts_paginates_and_hides_secrets():
    t0 = datetime(2026, 1, 1, tzinfo=UTC)

    async def test(db):
        await init_indexes(db)
        await db[models.USERS].insert_many(
            [
                {**ADMIN, "created_at": t0},
                {"_id": "u1", "location": "eu", "created_at": t0 + timedelta(days=2),
                 "password_hash": "$2b$secret", "is_locked": True},
                {"_id": "u2", "location": "us", "created_at": t0 + timedelta(days=1),
                 "password_hash": "$2b$secret"},
            ]
        )  # fmt: skip
        page1 = await api(db, "GET", "/api/v1/admin/users?limit=2", user=ADMIN)
        page2 = await api(db, "GET", "/api/v1/admin/users?skip=2&limit=2", user=ADMIN)
        return page1, page2

    page1, page2 = run_with_db(test)
    assert [u["id"] for u in page1.json()["items"]] == ["u1", "u2"]  # newest first
    assert page1.json()["items"][0]["locked"] is True
    assert page1.json()["total"] == 3
    assert [u["id"] for u in page2.json()["items"]] == ["admin1"]
    assert "password_hash" not in page1.text + page2.text


def test_admin_allowlist_on_an_empty_collection_and_round_trip():
    async def test(db):
        await db[models.USERS].insert_one(ADMIN)
        empty = await api(db, "GET", "/api/v1/admin/allowed-emails", user=ADMIN)
        added = await api(
            db, "POST", "/api/v1/admin/allowed-emails", user=ADMIN, json={"email": "New@X.com"}
        )
        duplicate = await api(
            db, "POST", "/api/v1/admin/allowed-emails", user=ADMIN, json={"email": "new@x.com"}
        )
        listed = await api(db, "GET", "/api/v1/admin/allowed-emails", user=ADMIN)
        removed = await api(db, "DELETE", "/api/v1/admin/allowed-emails/new@x.com", user=ADMIN)
        return empty, added, duplicate, listed, removed

    empty, added, duplicate, listed, removed = run_with_db(test)
    # Real $facet over an empty collection: total is 0, not an error.
    assert empty.json() == {"items": [], "total": 0, "skip": 0, "limit": 20}
    assert added.status_code == 201 and added.json()["email"] == "new@x.com"
    assert duplicate.status_code == 409
    assert [i["email"] for i in listed.json()["items"]] == ["new@x.com"]
    assert removed.status_code == 204


def test_admin_lookup_lock_and_unlock_persist():
    async def test(db):
        await db[models.USERS].insert_many(
            [ADMIN, {"_id": "p1", "location": "eu", "role": "parent", "email": "p@x.com"}]
        )
        await db[models.EMAIL_INDEX].insert_one(
            {"_id": "p@x.com", "user_id": "p1", "location": "eu"}
        )
        found = await api(db, "GET", "/api/v1/admin/users/by-email/P@X.com", user=ADMIN)
        locked = await api(db, "PATCH", "/api/v1/admin/users/p1/lock?location=eu", user=ADMIN)
        after_lock = await db[models.USERS].find_one({"_id": "p1"})
        unlocked = await api(db, "PATCH", "/api/v1/admin/users/p1/unlock?location=eu", user=ADMIN)
        after_unlock = await db[models.USERS].find_one({"_id": "p1"})
        return found, locked, after_lock, unlocked, after_unlock

    found, locked, after_lock, unlocked, after_unlock = run_with_db(test)
    assert found.json()["id"] == "p1"
    assert locked.status_code == 200
    assert after_lock["is_locked"] is True and after_lock["tokens_revoked_at"] is not None
    assert unlocked.status_code == 200
    assert after_unlock["is_locked"] is False and after_unlock["tokens_revoked_at"] is None
