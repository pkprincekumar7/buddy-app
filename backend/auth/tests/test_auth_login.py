"""Login (9.1), the per-key-and-IP throttle, `me`, logout and logout-all."""

import asyncio
import time
from collections.abc import Awaitable, Callable
from typing import Any

import httpx
import pytest
import redis.asyncio as aioredis
from auth_testkit import EMAIL, LOCATION, PASSWORD, Running, claims, running

from auth.app.store import AUTH, EMAIL_INDEX, SESSIONS


def live(mongo_uri: str, test: Callable[[Running], Awaitable[None]], **options: Any) -> None:
    async def go() -> None:
        async with running(mongo_uri, **options) as r:
            await test(r)

    asyncio.run(go())


def _code(response: httpx.Response) -> str:
    return response.json()["detail"]["code"]


async def _account(r: Running) -> str:
    await r.allow()
    response = await r.register()
    assert response.status_code == 201
    return str(claims(response.json()["access_token"])["sub"])


def _bearer(response: httpx.Response) -> dict[str, str]:
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


# ── login ──────────────────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_login_signs_in_with_a_new_family_each_time(mongo_uri):
    async def test(r: Running) -> None:
        user_id = await _account(r)
        first = await r.login(email="  JANE.doe@example.com ")
        second = await r.login()
        assert first.status_code == second.status_code == 200
        a, b = claims(first.json()["refresh_token"]), claims(second.json()["refresh_token"])
        assert a["sub"] == b["sub"] == user_id and a["family_id"] != b["family_id"]
        assert await r.db[SESSIONS].count_documents({"user_id": user_id}) == 3  # register + 2

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_wrong_password_or_unknown_email_is_the_same_401(mongo_uri):
    async def test(r: Running) -> None:
        await _account(r)
        wrong = await r.login(password="wrong-pass1")
        unknown = await r.login(email="nobody@example.com")
        for response in (wrong, unknown):
            assert (response.status_code, response.json()) == (
                401,
                {"detail": {"code": "invalid_credentials", "msg": "Invalid email or password."}},
            )

    live(mongo_uri, test)


@pytest.mark.live_service
def test_the_lock_is_revealed_only_to_the_right_password(mongo_uri):
    async def test(r: Running) -> None:
        user_id = await _account(r)
        await r.db[AUTH].update_one({"_id": user_id}, {"$set": {"is_locked": True}})
        assert _code(await r.login(password="wrong-pass1")) == "invalid_credentials"
        locked = await r.login()
        assert (locked.status_code, _code(locked)) == (403, "account_locked")
        await r.db[AUTH].update_one(
            {"_id": user_id}, {"$set": {"is_locked": False, "is_being_deleted": True}}
        )
        # Being deleted: even the right password gets the generic 401.
        assert _code(await r.login()) == "invalid_credentials"

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_reserved_row_cant_log_in(mongo_uri):
    async def test(r: Running) -> None:
        user_id = await _account(r)
        await r.db[EMAIL_INDEX].update_one({"user_id": user_id}, {"$set": {"status": "reserved"}})
        assert (await r.login()).status_code == 401

    live(mongo_uri, test)


@pytest.mark.live_service
def test_five_failures_block_that_email_from_that_ip_only(mongo_uri):
    async def test(r: Running) -> None:
        await _account(r)
        for _ in range(5):
            assert (await r.login(password="wrong-pass1", ip="192.0.2.1")).status_code == 401
        # Even the right password is refused now, from this IP, before any lookup.
        blocked = await r.login(ip="192.0.2.1")
        assert (blocked.status_code, _code(blocked)) == (429, "too_many_attempts")
        # Another IP isn't affected, so nobody can lock a user out from elsewhere.
        assert (await r.login(ip="192.0.2.2")).status_code == 200

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_successful_login_clears_the_failures(mongo_uri):
    async def test(r: Running) -> None:
        await _account(r)
        for _ in range(4):
            await r.login(password="wrong-pass1", ip="192.0.2.3")
        assert (await r.login(ip="192.0.2.3")).status_code == 200
        for _ in range(4):
            assert (await r.login(password="wrong-pass1", ip="192.0.2.3")).status_code == 401
        assert (await r.login(ip="192.0.2.3")).status_code == 200

    live(mongo_uri, test)


@pytest.mark.live_service
def test_login_is_limited_to_10_a_minute_per_ip(mongo_uri):
    async def test(r: Running) -> None:
        statuses = [
            (await r.login(email=f"u{i}@example.com", ip="192.0.2.9")).status_code
            for i in range(11)
        ]
        assert statuses == [401] * 10 + [429]

    live(mongo_uri, test)


# ── me ─────────────────────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_me_returns_the_account_without_names(mongo_uri):
    async def test(r: Running) -> None:
        await r.allow()
        response = await r.register()
        me = await r.http.get("/api/v1/auth/me", headers=_bearer(response))
        assert me.status_code == 200
        body = me.json()
        assert set(body) == {"id", "email", "role", "auth_provider", "location", "created_at"}
        assert (body["email"], body["role"], body["auth_provider"], body["location"]) == (
            "jane.doe@example.com",
            "parent",
            "password",
            LOCATION,
        )
        r.http.cookies.clear()  # the client kept register's cookies
        assert (await r.http.get("/api/v1/auth/me")).status_code == 401
        # The cookie works as well as the header.
        r.http.cookies.set("access_token", response.json()["access_token"])
        assert (await r.http.get("/api/v1/auth/me")).status_code == 200

    live(mongo_uri, test)


@pytest.mark.live_service
def test_me_for_an_account_that_is_gone_is_401(mongo_uri):
    async def test(r: Running) -> None:
        await r.allow()
        response = await r.register()
        await r.db[AUTH].delete_many({})
        # The authz fill finds no account (9.3), so the token no longer counts.
        assert (await r.http.get("/api/v1/auth/me", headers=_bearer(response))).status_code == 401

    live(mongo_uri, test)


@pytest.mark.live_service
def test_an_account_deleted_while_its_entry_is_still_held_is_401(mongo_uri):
    # Without Valkey, each task holds a fill for up to 30 s (9.3); the account read itself
    # still finds nothing.
    async def test(r: Running) -> None:
        await r.allow()
        response = await r.register()
        r.http.cookies.clear()
        assert (await r.http.get("/api/v1/auth/me", headers=_bearer(response))).status_code == 200
        await r.db[AUTH].delete_many({})
        assert (await r.http.get("/api/v1/auth/me", headers=_bearer(response))).status_code == 401
        out = await r.http.post("/api/v1/auth/logout-all", headers=_bearer(response))
        assert out.status_code == 204

    live(mongo_uri, test)


# ── logout ─────────────────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_logout_ends_this_session_and_clears_the_cookies(mongo_uri):
    async def test(r: Running) -> None:
        await r.allow()
        response = await r.register()
        other = await r.login()
        refresh = response.json()["refresh_token"]
        r.http.cookies.clear()  # the bearer token, not the cookies login left
        out = await r.http.post(
            "/api/v1/auth/logout", headers={"Authorization": f"Bearer {refresh}"}
        )
        assert out.status_code == 204
        assert any(
            "access_token=" in c and "Max-Age=0" in c for c in out.headers.get_list("set-cookie")
        )
        jti, other_jti = claims(refresh)["jti"], claims(other.json()["refresh_token"])["jti"]
        assert await r.db[SESSIONS].find_one({"_id": jti}) is None
        assert await r.db[SESSIONS].find_one({"_id": other_jti}) is not None
        # Without a token, or with a bad one, logout still succeeds.
        assert (await r.http.post("/api/v1/auth/logout")).status_code == 204
        bad = {"Authorization": "Bearer not-a-token"}
        assert (await r.http.post("/api/v1/auth/logout", headers=bad)).status_code == 204

    live(mongo_uri, test)


@pytest.mark.live_service
def test_logout_refuses_another_users_access_token(mongo_uri):
    async def test(r: Running) -> None:
        await r.allow()
        await r.allow("sam@example.com")
        jane = await r.register()
        sam = await r.register(email="sam@example.com")
        r.http.cookies.set("access_token", sam.json()["access_token"])
        r.http.cookies.set("refresh_token", jane.json()["refresh_token"])
        out = await r.http.post("/api/v1/auth/logout")
        assert (out.status_code, _code(out)) == (401, "token_mismatch")

    live(mongo_uri, test)


@pytest.mark.live_service
def test_logout_all_revokes_every_session_and_older_tokens(mongo_uri, redis_url):
    # With Valkey, as deployed: logout-all writes the new entry, so it applies at once.
    # (Without it, each task's in-process copy lasts up to 30 s, by design, 9.3.)
    async def test(r: Running) -> None:
        await r.allow()
        response = await r.register()
        await r.login()
        user_id = claims(response.json()["access_token"])["sub"]
        time.sleep(0.002)  # revocation compares milliseconds
        out = await r.http.post("/api/v1/auth/logout-all", headers=_bearer(response))
        assert out.status_code == 204
        account = await r.db[AUTH].find_one({"_id": user_id})
        assert account is not None
        assert account["authz_version"] == 2 and account["tokens_revoked_at"] is not None
        assert await r.db[SESSIONS].count_documents({"user_id": user_id}) == 0
        # The old access token is now refused everywhere; a new login works.
        assert (await r.http.get("/api/v1/auth/me", headers=_bearer(response))).status_code == 401
        fresh = await r.login()
        assert (await r.http.get("/api/v1/auth/me", headers=_bearer(fresh))).status_code == 200
        await cache.delete(f"authz:{user_id}")

    cache = aioredis.Redis.from_url(redis_url)
    try:
        live(mongo_uri, test, cache=cache)
    finally:
        asyncio.run(cache.aclose())


@pytest.mark.live_service
def test_logout_all_is_limited_to_3_a_minute(mongo_uri):
    async def test(r: Running) -> None:
        await r.allow()
        await r.register()
        statuses = []
        for _ in range(4):
            fresh = await r.login()
            time.sleep(0.002)
            statuses.append(
                (await r.http.post("/api/v1/auth/logout-all", headers=_bearer(fresh))).status_code
            )
        assert statuses == [204, 204, 204, 429]

    live(mongo_uri, test)


def test_the_password_constant_matches_the_policy():
    assert any(c.isdigit() for c in PASSWORD) and any(c.isalpha() for c in PASSWORD)
    assert EMAIL.lower() != EMAIL
