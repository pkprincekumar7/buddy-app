"""The authz cache (build plan 3.3): `GET /internal/authz/{id}`, the change stream, the
reaper and the worker. Its three checks:
- a slow fill can't overwrite a lock;
- every authz-changing write increments `authz_version`;
- a Valkey outage falls back to the 30-second in-process cache.
"""

import asyncio
import json
import re
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import pytest
import redis.asyncio as aioredis
from auth_testkit import (
    AUTH_PRIVATE,
    LOCATION,
    USERS_PRIVATE,
    Running,
    authz_config,
    claims,
    key,
    running,
)
from pymongo.errors import OperationFailure, PyMongoError

from auth.app import authz_stream, main
from auth.app.authz_cache import entry_from_account, write_entry
from auth.app.authz_stream import AuthzStream
from auth.app.reaper import Reaper
from auth.app.store import AUTH, AUTHZ_FIELDS, EMAIL_INDEX, WORKER_STATE, authz_change
from common.authz import Authorizer, AuthzEntry
from common.internal_client import InternalClient, ServiceTokenSigner, authz_fill

APP_DIR = Path(__file__).resolve().parents[1] / "app"


def live(mongo_uri: str, test: Callable[[Running], Awaitable[None]], **options: Any) -> None:
    async def go() -> None:
        async with running(mongo_uri, **options) as r:
            await test(r)

    asyncio.run(go())


@asynccontextmanager
async def valkey(redis_url: str) -> AsyncIterator[Any]:
    cache = aioredis.Redis.from_url(redis_url)
    try:
        yield cache
    finally:
        await cache.aclose()


async def _user(r: Running) -> str:
    await r.allow()
    response = await r.register()
    assert response.status_code == 201
    r.http.cookies.clear()
    return str(claims(response.json()["access_token"])["sub"])


async def _cached(cache: Any, user_id: str) -> dict[str, Any] | None:
    raw = await cache.get(f"authz:{user_id}")
    return json.loads(raw) if raw is not None else None


def _caller(caller: str) -> dict[str, str]:
    keys = {"users": ("u1", USERS_PRIVATE), "auth": ("a1", AUTH_PRIVATE)}
    kid, private = keys[caller]
    token = ServiceTokenSigner(caller, kid, private).token_for("auth")
    return {"Authorization": f"Bearer {token}"}


def _internal() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.internal_app), base_url="http://a"
    )


# ── GET /internal/authz/{user_id} ──────────────────────────────────────────────


@pytest.mark.live_service
def test_the_fill_endpoint_answers_and_refills_the_cache(mongo_uri, redis_url):
    async def run() -> None:
        async with valkey(redis_url) as cache, running(mongo_uri, cache=cache) as r:
            user_id = await _user(r)
            await cache.delete(f"authz:{user_id}")
            async with _internal() as internal:
                response = await internal.get(
                    f"/internal/authz/{user_id}", headers=_caller("users")
                )
                assert response.status_code == 200
                assert response.json() == {
                    "ver": 1, "role": "parent", "locked": False, "deleting": False,
                    "revoked_at_ms": None,
                }  # fmt: skip
                assert await _cached(cache, user_id) == response.json()
                for unknown in (str(uuid.uuid4()), "not-a-uuid"):
                    missing = await internal.get(
                        f"/internal/authz/{unknown}", headers=_caller("users")
                    )
                    assert missing.status_code == 404
                # Only the services that verify tokens may ask; auth itself isn't one.
                refused = await internal.get(f"/internal/authz/{user_id}", headers=_caller("auth"))
                assert refused.status_code == 403
                assert (await internal.get(f"/internal/authz/{user_id}")).status_code == 401
            await cache.delete(f"authz:{user_id}")

    asyncio.run(run())


@pytest.mark.live_service
def test_common_authz_fill_reads_it_end_to_end(mongo_uri):
    # What every other service's Authorizer does on a miss (common.internal_client).
    async def test(r: Running) -> None:
        user_id = await _user(r)

        async def resolve(host: str, port: int) -> list[str]:
            return ["10.0.0.9"]

        client = InternalClient(
            ServiceTokenSigner("users", "u1", USERS_PRIVATE),
            resolver=resolve,
            transport=httpx.ASGITransport(app=main.internal_app),
        )
        fill = authz_fill(client)
        assert await fill(user_id) == AuthzEntry(ver=1, role="parent", locked=False, deleting=False)
        assert await fill(str(uuid.uuid4())) is None
        await client.aclose()

    live(mongo_uri, test)


# ── check 1: a slow fill can't overwrite a lock ────────────────────────────────


@pytest.mark.live_service
def test_a_slow_fill_cant_overwrite_a_lock(mongo_uri, redis_url):
    async def run() -> None:
        async with valkey(redis_url) as cache, running(mongo_uri, cache=cache) as r:
            user_id = await _user(r)  # sign-in cached ver 1
            # A fill reads the account just before an admin locks it...
            before = await r.db[AUTH].find_one({"_id": user_id})
            assert before is not None
            stale = entry_from_account(before)
            stop = asyncio.Event()
            stream = AuthzStream(r.runtime, "ap-south-1", max_await_ms=100)
            task = asyncio.create_task(stream.run(stop))
            await asyncio.sleep(0.3)  # the stream is open
            await r.db[AUTH].update_one(
                {"_id": user_id}, authz_change({"is_locked": True}, datetime.now(UTC))
            )
            deadline = asyncio.get_running_loop().time() + 10
            while not ((await _cached(cache, user_id)) or {}).get("locked"):
                assert asyncio.get_running_loop().time() < deadline, (
                    "the stream didn't apply the lock"
                )
                await asyncio.sleep(0.05)
            # ...and only then writes what it read: refused, the lock stays.
            assert not await write_entry(cache, user_id, stale)
            assert await _cached(cache, user_id) == {
                "ver": 2, "role": "parent", "locked": True, "deleting": False,
                "revoked_at_ms": None,
            }  # fmt: skip
            # Every service now refuses the account.
            assert (await r.login()).status_code == 403
            stop.set()
            await asyncio.wait_for(task, 10)
            await cache.delete(f"authz:{user_id}")

    asyncio.run(run())


# ── check 2: every authz-changing write increments authz_version ───────────────


def test_authz_changes_always_bump_the_version():
    now = datetime.now(UTC)
    assert authz_change({"is_locked": True}, now) == {
        "$set": {"is_locked": True, "updated_at": now},
        "$inc": {"authz_version": 1},
    }
    for bad in ({}, {"email": "x"}, {"is_locked": True, "email": "x"}):
        with pytest.raises(ValueError):
            authz_change(bad, now)


def test_no_code_sets_an_authz_field_without_authz_change():
    # Any "$set" of role, lock, deletion or revocation outside store.authz_change would
    # change the account without a new version, and the cache could keep the old state.
    fields = "|".join(AUTHZ_FIELDS)
    pattern = re.compile(r'"\$set":\s*\{[^}]*"(' + fields + r')"', re.S)
    offenders = [
        path.name
        for path in APP_DIR.glob("*.py")
        if path.name != "store.py" and pattern.search(path.read_text())
    ]
    assert offenders == []
    assert "authz_change(" in (APP_DIR / "main.py").read_text()


# ── check 3: a Valkey outage falls back to the 30-second cache ────────────────


@pytest.mark.live_service
def test_with_valkey_down_answers_are_held_30_seconds(mongo_uri):
    async def run() -> None:
        dead = aioredis.Redis.from_url(
            "redis://localhost:6390", socket_connect_timeout=0.2, socket_timeout=0.2
        )
        async with running(mongo_uri, cache=dead) as r:
            # Registration and sign-in still work: the cache write is best effort.
            user_id = await _user(r)
            fills: list[str] = []
            now = [0.0]

            async def counting(uid: str) -> AuthzEntry | None:
                fills.append(uid)
                return await r.runtime.fill(uid)

            authorizer = Authorizer(authz_config(), cache=dead, fill=counting, clock=lambda: now[0])
            main.app.state.authorizer = authorizer
            login = await r.login()
            bearer = {"Authorization": f"Bearer {login.json()['access_token']}"}
            for _ in range(3):
                assert (await r.http.get("/api/v1/auth/me", headers=bearer)).status_code == 200
            assert fills == [user_id]  # one read of auth.auth for the burst
            # A lock takes effect once the 30 seconds are up.
            await r.db[AUTH].update_one(
                {"_id": user_id}, authz_change({"is_locked": True}, datetime.now(UTC))
            )
            assert (await r.http.get("/api/v1/auth/me", headers=bearer)).status_code == 200
            now[0] = 31.0
            assert (await r.http.get("/api/v1/auth/me", headers=bearer)).status_code == 403
            assert fills == [user_id, user_id]
        await dead.aclose()

    asyncio.run(run())


# ── the change stream ──────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_the_stream_updates_only_held_entries_and_drops_deleted_ones(mongo_uri, redis_url):
    async def run() -> None:
        async with valkey(redis_url) as cache, running(mongo_uri, cache=cache) as r:
            held = await _user(r)
            await r.allow("sam@example.com")
            other = claims((await r.register(email="sam@example.com")).json()["access_token"])[
                "sub"
            ]
            await cache.delete(f"authz:{other}")  # this region doesn't hold sam
            stream = AuthzStream(r.runtime, "ap-south-1", max_await_ms=100)
            stop = asyncio.Event()
            task = asyncio.create_task(stream.run(stop))
            await asyncio.sleep(0.3)
            now = datetime.now(UTC)
            await r.db[AUTH].update_one({"_id": held}, authz_change({"role": "admin"}, now))
            await r.db[AUTH].update_one({"_id": other}, authz_change({"role": "admin"}, now))
            deadline = asyncio.get_running_loop().time() + 10
            while ((await _cached(cache, held)) or {}).get("role") != "admin":
                assert asyncio.get_running_loop().time() < deadline
                await asyncio.sleep(0.05)
            assert await _cached(cache, other) is None  # not filled in by the stream
            await r.db[AUTH].delete_one({"_id": held})
            while await _cached(cache, held) is not None:
                assert asyncio.get_running_loop().time() < deadline
                await asyncio.sleep(0.05)
            stop.set()
            await asyncio.wait_for(task, 10)

    asyncio.run(run())


@pytest.mark.live_service
def test_the_stream_resumes_where_it_stopped(mongo_uri, redis_url):
    async def run() -> None:
        async with valkey(redis_url) as cache, running(mongo_uri, cache=cache) as r:
            user_id = await _user(r)
            stream = AuthzStream(r.runtime, "eu-west-1", max_await_ms=100)
            stop = asyncio.Event()
            task = asyncio.create_task(stream.run(stop))
            await asyncio.sleep(0.3)
            stop.set()
            await asyncio.wait_for(task, 10)
            state = await r.db[WORKER_STATE].find_one({"_id": "authz-stream:eu-west-1"})
            assert state is not None and state["resume_token"] is not None
            # A change while no worker runs is applied when the next one starts.
            await r.db[AUTH].update_one(
                {"_id": user_id}, authz_change({"is_locked": True}, datetime.now(UTC))
            )
            stop = asyncio.Event()
            task = asyncio.create_task(stream.run(stop))
            deadline = asyncio.get_running_loop().time() + 10
            while not ((await _cached(cache, user_id)) or {}).get("locked"):
                assert asyncio.get_running_loop().time() < deadline
                await asyncio.sleep(0.05)
            stop.set()
            await asyncio.wait_for(task, 10)
            await cache.delete(f"authz:{user_id}")

    asyncio.run(run())


@pytest.mark.live_service
def test_a_lost_resume_token_restarts_the_stream_from_now(mongo_uri, monkeypatch):
    async def test(r: Running) -> None:
        stream = AuthzStream(r.runtime, "ap-south-1")
        await stream.save_token({"_data": "stale"})
        stop = asyncio.Event()
        failures = [OperationFailure("history lost", code=286), PyMongoError("network"),
                    OperationFailure("other", code=1)]  # fmt: skip

        async def follow(_: asyncio.Event) -> None:
            if failures:
                raise failures.pop(0)
            stop.set()

        monkeypatch.setattr(stream, "follow", follow)
        monkeypatch.setattr(authz_stream, "RETRY_SECONDS", 0.01)
        await stream.run(stop)
        assert await stream.load_token() is None
        # An update whose document is already gone again is skipped (its delete follows).
        await stream.apply({"operationType": "update", "documentKey": {"_id": "x"}})

    live(mongo_uri, test)


# ── the reaper ─────────────────────────────────────────────────────────────────


async def _stale(r: Running, email: str, *, location: str = LOCATION, minutes: int = 16) -> str:
    """What a registration that died after its credentials and profile left behind."""
    await r.allow(email)
    r.users.put_status = 201
    response = await r.register(email=email, country_code="US" if location == "us" else "IN")
    user_id = str(claims(response.json()["access_token"])["sub"])
    await r.db[EMAIL_INDEX].update_one(
        {"user_id": user_id},
        {
            "$set": {
                "status": "reserved",
                "reserved_at": datetime.now(UTC) - timedelta(minutes=minutes),
            }
        },
    )
    return user_id


@pytest.mark.live_service
def test_the_reaper_removes_stale_reservations_and_their_leftovers(mongo_uri):
    async def test(r: Running) -> None:
        stale = await _stale(r, "stale@example.com")
        fresh = await _stale(r, "fresh@example.com", minutes=5)
        active = await _user(r)
        elsewhere = await _stale(r, "us@example.com", location="us")
        r.users.calls.clear()
        assert await Reaper(r.runtime, ["in"]).sweep() == 1
        assert r.users.deleted() == [stale]
        assert await r.db[AUTH].find_one({"_id": stale}) is None
        assert await r.db[EMAIL_INDEX].find_one({"user_id": stale}) is None
        for kept in (fresh, active, elsewhere):  # too new, active, another region's
            assert await r.db[AUTH].find_one({"_id": kept}) is not None
        # The email can be registered again at once.
        assert (await r.register(email="stale@example.com")).status_code == 201
        # Locally one worker handles every location.
        assert await Reaper(r.runtime, None).sweep() == 1

    live(mongo_uri, test)


@pytest.mark.live_service
def test_with_users_down_the_reaper_puts_the_row_back_and_retries(mongo_uri):
    async def test(r: Running) -> None:
        stale = await _stale(r, "stale@example.com")
        r.users.delete_status = "down"
        assert await Reaper(r.runtime, None).sweep() == 0
        row = await r.db[EMAIL_INDEX].find_one({"user_id": stale})
        assert row is not None and row["status"] == "reserved"
        assert await r.db[AUTH].find_one({"_id": stale}) is not None
        r.users.delete_status = 204
        assert await Reaper(r.runtime, None).sweep() == 1

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_row_that_changed_meanwhile_isnt_reaped(mongo_uri, monkeypatch):
    async def test(r: Running) -> None:
        stale = await _stale(r, "stale@example.com")
        real_find = type(r.db[EMAIL_INDEX]).find

        def activated_meanwhile(self, *args, **kwargs):
            cursor = real_find(self, *args, **kwargs)
            monkeypatch.setattr(type(self), "find", real_find)
            # The saga activates it between the reaper's read and its claim.
            return _Then(
                cursor, self.update_one({"user_id": stale}, {"$set": {"status": "active"}})
            )

        monkeypatch.setattr(type(r.db[EMAIL_INDEX]), "find", activated_meanwhile)
        assert await Reaper(r.runtime, None).sweep() == 0
        assert await r.db[AUTH].find_one({"_id": stale}) is not None

    live(mongo_uri, test)


class _Then:
    """A cursor whose results are read first, then `effect` runs (a concurrent write)."""

    def __init__(self, cursor: Any, effect: Awaitable[Any]) -> None:
        self.cursor, self.effect = cursor, effect

    def limit(self, n: int) -> "_Then":
        self.cursor = self.cursor.limit(n)
        return self

    async def to_list(self, length: Any) -> list[Any]:
        rows = await self.cursor.to_list(length)
        await self.effect
        return list(rows)


@pytest.mark.live_service
def test_a_row_put_back_after_a_new_registration_took_the_key_is_dropped(mongo_uri):
    async def test(r: Running) -> None:
        await _stale(r, "stale@example.com")
        r.users.delete_status = "down"

        async def new_registration(*args: Any, **kwargs: Any) -> bool:
            row = {"_id": key("stale@example.com"), "key_version": 1, "user_id": str(uuid.uuid4()),
                   "location": LOCATION, "status": "reserved", "reserved_at": datetime.now(UTC)}  # fmt: skip
            await r.db[EMAIL_INDEX].insert_one(row)
            return False

        import auth.app.reaper as reaper_module

        original = reaper_module.delete_profile
        reaper_module.delete_profile = new_registration
        try:
            assert await Reaper(r.runtime, None).sweep() == 0  # no DuplicateKeyError raised
        finally:
            reaper_module.delete_profile = original

    live(mongo_uri, test)


@pytest.mark.live_service
def test_the_reaper_keeps_running_after_a_failed_sweep(mongo_uri, monkeypatch):
    async def test(r: Running) -> None:
        reaper = Reaper(r.runtime, None, interval=0.01)
        stop = asyncio.Event()
        sweeps = [0]

        async def sweep() -> int:
            sweeps[0] += 1
            if sweeps[0] == 1:
                raise PyMongoError("network")
            stop.set()
            return 0

        monkeypatch.setattr(reaper, "sweep", sweep)
        await asyncio.wait_for(reaper.run(stop), 5)
        assert sweeps[0] == 2

    live(mongo_uri, test)
