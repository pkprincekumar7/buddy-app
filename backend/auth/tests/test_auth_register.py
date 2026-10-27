"""Registration (10.1): the happy path, the checks, and a failure at every saga step,
including the takeover of a stale reservation, the profile-undo call and a pepper rotation."""

import asyncio
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from auth_testkit import (
    COUNTRY,
    EMAIL,
    LOCATION,
    OLD_PEPPER,
    PEPPER,
    FakeUsers,
    Running,
    claims,
    key,
    running,
)
from fastapi.routing import APIRoute
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import PyMongoError

from auth.app import main
from auth.app.store import AUTH, EMAIL_INDEX, SESSIONS, new_credentials
from auth.countries import BLOCKED_COUNTRIES
from common.routers import assert_every_route_has_a_policy


def live(mongo_uri: str, test: Callable[[Running], Awaitable[None]], **options: Any) -> None:
    async def go() -> None:
        async with running(mongo_uri, **options) as r:
            await test(r)

    asyncio.run(go())


def _code(response: httpx.Response) -> str:
    return response.json()["detail"]["code"]


# ── shape ──────────────────────────────────────────────────────────────────────


def test_every_route_on_both_apps_declares_a_policy():
    assert_every_route_has_a_policy(main.app)
    assert_every_route_has_a_policy(main.internal_app)


def test_the_routes_and_the_apps_they_live_on():
    public = {r.path for r in main.app.routes if isinstance(r, APIRoute)}
    assert public == {
        "/health",
        *(f"/api/v1/auth/{p}" for p in ("register", "login", "google", "refresh", "logout")),
        "/api/v1/auth/logout-all",
        "/api/v1/auth/me",
        *(f"/api/v1/auth/{p}" for p in ("accounts", "accounts/search", "allowed-emails")),
        *(f"/api/v1/auth/accounts/{{id}}/{p}" for p in ("lock", "unlock", "role")),
        "/api/v1/auth/allowed-emails/search",
        "/api/v1/auth/allowed-emails/{key}",
        "/api/v1/auth/account",
    }
    internal = {r.path for r in main.internal_app.routes if isinstance(r, APIRoute)}
    assert internal == {
        "/internal/ping",
        "/internal/authz/{user_id}",
        "/internal/auth/users/{user_id}/email",
    }


def _public(method: str, path: str, **kwargs: Any) -> httpx.Response:
    async def go() -> httpx.Response:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app), base_url="http://a"
        ) as http:
            return await http.request(method, path, **kwargs)

    return asyncio.run(go())


def test_health_is_public_and_unconfigured_routes_answer_503():
    assert _public("GET", "/health").json() == {"status": "ok", "service": "auth"}
    for path in ("/docs", "/openapi.json"):
        assert _public("GET", path).status_code == 404
    assert _public("POST", "/api/v1/auth/logout").status_code == 503


def test_internal_ping():
    async def go() -> httpx.Response:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.internal_app), base_url="http://a"
        ) as http:
            return await http.get("/internal/ping")

    assert asyncio.run(go()).json() == {"status": "ok", "service": "auth"}


# ── the happy path ─────────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_register_creates_the_account_and_profile_and_signs_in(mongo_uri):
    async def test(r: Running) -> None:
        await r.allow()
        response = await r.register(
            email="  Jane.Doe@Example.COM ", middle_name="  ", address_line_one="1 High St"
        )
        assert response.status_code == 201, response.text
        body = response.json()
        access, refresh = claims(body["access_token"]), claims(body["refresh_token"])
        user_id = access["sub"]
        assert (access["type"], access["role"], access["location"]) == (
            "access",
            "parent",
            LOCATION,
        )
        assert access["iat_ms"] // 1000 == access["iat"]
        assert refresh["type"] == "refresh" and "role" not in refresh and refresh["sub"] == user_id
        assert "email" not in access and "first_name" not in access
        # Cookies: the access token everywhere, the refresh token on auth's paths only.
        cookies = response.headers.get_list("set-cookie")
        assert any(
            c.startswith("access_token=") and "Path=/;" in c and "HttpOnly" in c for c in cookies
        )
        assert any(c.startswith("refresh_token=") and "Path=/api/v1/auth/" in c for c in cookies)

        account = await r.db[AUTH].find_one({"_id": user_id})
        assert account is not None
        assert (account["email"], account["role"], account["auth_provider"]) == (
            "jane.doe@example.com",
            "parent",
            "password",
        )
        assert (account["country_code"], account["location"], account["authz_version"]) == (
            COUNTRY,
            LOCATION,
            1,
        )
        assert account["password_hash"].startswith("$2b$12$")
        # The email index is keyed by the HMAC, never the address, and is now active.
        row = await r.db[EMAIL_INDEX].find_one({"_id": key()})
        assert row is not None and (row["user_id"], row["status"]) == (user_id, "active")
        assert await r.db[EMAIL_INDEX].count_documents({"_id": {"$regex": "@"}}) == 0
        # users got names, location and address, and no email.
        assert r.users.profiles[user_id] == {
            "first_name": "Jane",
            "middle_name": None,
            "last_name": "Doe",
            "address_line_one": "1 High St",
            "address_line_two": None,
            "address_line_three": None,
            "location": LOCATION,
        }
        session = await r.db[SESSIONS].find_one({"_id": refresh["jti"]})
        assert session is not None and session["family_id"] == refresh["family_id"]

    live(mongo_uri, test)


# ── the checks before the saga ─────────────────────────────────────────────────


@pytest.mark.live_service
def test_only_allow_listed_emails_and_open_countries_register(mongo_uri):
    async def test(r: Running) -> None:
        closed = await r.register()
        assert (closed.status_code, _code(closed)) == (403, "registration_closed")
        await r.allow()
        blocked = await r.register(country_code=sorted(BLOCKED_COUNTRIES)[0].lower())
        assert (blocked.status_code, _code(blocked)) == (403, "country_not_supported")
        assert await r.db[EMAIL_INDEX].count_documents({}) == 0
        assert r.users.calls == []

    live(mongo_uri, test)


@pytest.mark.live_service
@pytest.mark.parametrize(
    "fields",
    [
        {"password": "short1"},
        {"password": "aaaaaaaa"},
        {"password": "onlyletters"},
        {"password": "12345678"},
        {"email": "not-an-email"},
        {"first_name": "  "},
        {"last_name": "x" * 101},
        {"address_line_two": "x" * 201},
        {"country_code": "ZZ"},
        {"full_name": "Jane Doe"},
    ],
)
def test_an_invalid_body_is_422(mongo_uri, fields):
    async def test(r: Running) -> None:
        await r.allow()
        assert (await r.register(**fields)).status_code == 422

    live(mongo_uri, test)


@pytest.mark.live_service
def test_registration_is_limited_to_5_a_minute_per_ip(mongo_uri):
    async def test(r: Running) -> None:
        statuses = [(await r.register(ip="198.51.100.9")).status_code for _ in range(6)]
        assert statuses == [403] * 5 + [429]
        assert (await r.register(ip="198.51.100.10")).status_code == 403

    live(mongo_uri, test)


# ── step 4: the reservation ────────────────────────────────────────────────────


@pytest.mark.live_service
def test_an_active_email_is_taken_whatever_its_case(mongo_uri):
    async def test(r: Running) -> None:
        await r.allow()
        assert (await r.register()).status_code == 201
        again = await r.register(email="JANE.DOE@example.com")
        assert (again.status_code, _code(again)) == (409, "email_taken")
        assert await r.db[AUTH].count_documents({}) == 1

    live(mongo_uri, test)


async def _reservation(r: Running, *, age: timedelta, location: str = LOCATION) -> str:
    """A reservation left by another attempt, with that attempt's credentials."""
    old_id = str(uuid.uuid4())
    await r.db[EMAIL_INDEX].insert_one(
        {
            "_id": key(),
            "key_version": 1,
            "user_id": old_id,
            "location": location,
            "status": "reserved",
            "reserved_at": datetime.now(UTC) - age,
        }
    )
    await r.db[AUTH].insert_one(
        new_credentials(
            user_id=old_id,
            email="jane.doe@example.com",
            password_hash="x",
            country_code=COUNTRY,
            location=location,
            auth_provider="password",
            now=datetime.now(UTC) - age,
        )
    )
    return old_id


@pytest.mark.live_service
def test_a_registration_in_progress_holds_the_email(mongo_uri):
    async def test(r: Running) -> None:
        await r.allow()
        await _reservation(r, age=timedelta(minutes=5))
        response = await r.register()
        assert (response.status_code, _code(response)) == (409, "email_taken")

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_stale_reservation_is_taken_over_after_cleaning_up(mongo_uri):
    async def test(r: Running) -> None:
        await r.allow()
        old_id = await _reservation(r, age=timedelta(minutes=16))
        response = await r.register()
        assert response.status_code == 201
        new_id = claims(response.json()["access_token"])["sub"]
        # The old attempt's profile and credentials went first.
        assert r.users.deleted() == [old_id]
        assert await r.db[AUTH].find_one({"_id": old_id}) is None
        row = await r.db[EMAIL_INDEX].find_one({"_id": key()})
        assert row is not None and (row["user_id"], row["status"]) == (new_id, "active")

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_takeover_that_cant_clean_up_restores_the_stale_row(mongo_uri):
    async def test(r: Running) -> None:
        await r.allow()
        old_id = await _reservation(r, age=timedelta(minutes=16))
        r.users.delete_status = "down"
        response = await r.register()
        assert (response.status_code, _code(response)) == (503, "registration_unavailable")
        assert response.headers["retry-after"] == "5"
        # The reaper can still find the old attempt from its row.
        row = await r.db[EMAIL_INDEX].find_one({"_id": key()})
        assert row is not None and (row["user_id"], row["status"]) == (old_id, "reserved")
        assert await r.db[AUTH].find_one({"_id": old_id}) is not None

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_takeover_lost_to_another_attempt_is_409(mongo_uri, monkeypatch):
    async def test(r: Running) -> None:
        await r.allow()
        await _reservation(r, age=timedelta(minutes=16))
        real = AsyncCollection.update_one

        async def another_attempt_wins(self, selector, update, *args, **kwargs):
            if self.name == EMAIL_INDEX and "reserved_at" in selector:
                await real(self, {"_id": selector["_id"]}, {"$set": {"user_id": str(uuid.uuid4())}})
            return await real(self, selector, update, *args, **kwargs)

        monkeypatch.setattr(AsyncCollection, "update_one", another_attempt_wins)
        response = await r.register()
        assert (response.status_code, _code(response)) == (409, "email_taken")
        assert r.users.calls == []

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_row_removed_under_us_is_treated_as_taken(mongo_uri, monkeypatch):
    # The duplicate came from a row the reaper then deleted: the client may retry.
    async def test(r: Running) -> None:
        await r.allow()
        await _reservation(r, age=timedelta(minutes=16))
        real = AsyncCollection.find_one

        async def reaped(self, *args, **kwargs):
            if self.name == EMAIL_INDEX:
                await self.delete_many({})
            return await real(self, *args, **kwargs)

        monkeypatch.setattr(AsyncCollection, "find_one", reaped)
        response = await r.register()
        assert (response.status_code, _code(response)) == (409, "email_taken")

    live(mongo_uri, test)


@pytest.mark.live_service
def test_during_a_pepper_rotation_an_old_versions_row_still_counts(mongo_uri):
    rotating = f'{{"2": "{PEPPER}", "1": "{OLD_PEPPER}"}}'

    async def test(r: Running) -> None:
        # Allow-listed and registered under v1, before the rotation began.
        await r.allow(version=1)
        await r.db[EMAIL_INDEX].insert_one(
            {
                "_id": r.runtime.peppers.key(EMAIL, 1),
                "key_version": 1,
                "user_id": str(uuid.uuid4()),
                "location": LOCATION,
                "status": "active",
                "reserved_at": datetime.now(UTC),
            }
        )
        response = await r.register()
        assert (response.status_code, _code(response)) == (409, "email_taken")
        assert await r.db[EMAIL_INDEX].count_documents({}) == 1
        # A v1-only allow-list entry still lets a new email register, under v2.
        await r.allow("new@example.com", version=1)
        created = await r.register(email="new@example.com")
        assert created.status_code == 201
        row = await r.db[EMAIL_INDEX].find_one({"_id": r.runtime.peppers.key("new@example.com")})
        assert row is not None and row["key_version"] == 2

    live(mongo_uri, test, peppers=rotating)


# ── steps 5–7: credentials, profile, activation ───────────────────────────────


@pytest.mark.live_service
def test_unsaved_credentials_release_the_reservation(mongo_uri, monkeypatch):
    async def test(r: Running) -> None:
        await r.allow()
        real = AsyncCollection.insert_one

        async def failing(self, document, *args, **kwargs):
            if self.name == AUTH:
                raise PyMongoError("primary stepped down")
            return await real(self, document, *args, **kwargs)

        monkeypatch.setattr(AsyncCollection, "insert_one", failing)
        response = await r.register()
        assert (response.status_code, _code(response)) == (500, "registration_failed")
        assert await r.db[EMAIL_INDEX].count_documents({}) == 0
        assert r.users.calls == []

    live(mongo_uri, test)


@pytest.mark.live_service
@pytest.mark.parametrize("failure", ["down", 500])
def test_an_unreachable_users_service_undoes_everything(mongo_uri, failure):
    async def test(r: Running) -> None:
        await r.allow()
        r.users.put_status = failure
        response = await r.register()
        assert (response.status_code, _code(response)) == (503, "registration_unavailable")
        assert response.headers["retry-after"] == "5"
        # The profile may exist anyway, so it's deleted too; then credentials, reservation.
        put_id = r.users.calls[0][1].rsplit("/", 1)[-1]
        assert r.users.deleted() == [put_id]
        assert await r.db[AUTH].count_documents({}) == 0
        assert await r.db[EMAIL_INDEX].count_documents({}) == 0
        assert await r.db[SESSIONS].count_documents({}) == 0

    live(mongo_uri, test)


@pytest.mark.live_service
def test_when_the_undo_fails_too_the_reaper_gets_the_leftovers(mongo_uri):
    async def test(r: Running) -> None:
        await r.allow()
        r.users.put_status = "down"
        r.users.delete_status = 500
        response = await r.register()
        assert response.status_code == 503
        row = await r.db[EMAIL_INDEX].find_one({"_id": key()})
        assert row is not None and row["status"] == "reserved"  # login can't use it
        assert await r.db[AUTH].count_documents({}) == 1
        assert (await r.login()).status_code == 401

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_profile_users_refuses_is_a_500_after_the_undo(mongo_uri):
    async def test(r: Running) -> None:
        await r.allow()
        r.users.put_status = 409
        response = await r.register()
        assert (response.status_code, _code(response)) == (500, "registration_failed")
        assert await r.db[AUTH].count_documents({}) == 0

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_reservation_reaped_before_activation_undoes_the_account(mongo_uri, monkeypatch):
    async def test(r: Running) -> None:
        await r.allow()
        real = AsyncCollection.update_one

        async def reaper_first(self, selector, update, *args, **kwargs):
            if self.name == EMAIL_INDEX and selector.get("status") == "reserved":
                await self.delete_one({"_id": selector["_id"]})
            return await real(self, selector, update, *args, **kwargs)

        monkeypatch.setattr(AsyncCollection, "update_one", reaper_first)
        response = await r.register()
        assert (response.status_code, _code(response)) == (503, "registration_unavailable")
        assert len(r.users.deleted()) == 1
        assert await r.db[AUTH].count_documents({}) == 0

    live(mongo_uri, test)


@pytest.mark.live_service
def test_the_logs_never_carry_the_email(mongo_uri, caplog):
    async def test(r: Running) -> None:
        await r.allow()
        r.users.put_status = "down"
        await r.register()
        await r.login(password="wrong-pass1")
        text = caplog.text.lower()
        assert "jane.doe" not in text and "example.com" not in text
        assert f"email_key={key()[:16]}" in caplog.text

    with caplog.at_level("INFO"):
        live(mongo_uri, test, users=FakeUsers())
