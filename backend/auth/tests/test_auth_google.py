"""Google sign-in: an existing account (whatever its provider), a new account through the
registration saga, and every refusal."""

import asyncio
import itertools
from collections.abc import Awaitable, Callable
from typing import Any

import httpx
import pytest
from auth_testkit import COUNTRY, EMAIL, LOCATION, Running, claims, google_token, running, viewer

from auth.app.store import AUTH
from auth.countries import BLOCKED_COUNTRIES

PATH = "/api/v1/auth/google"


def live(mongo_uri: str, test: Callable[[Running], Awaitable[None]], **options: Any) -> None:
    async def go() -> None:
        async with running(mongo_uri, **options) as r:
            await test(r)

    asyncio.run(go())


def _code(response: httpx.Response) -> str:
    return response.json()["detail"]["code"]


_ips = itertools.count(1)


async def _google(r: Running, token: str, country_code: str | None = COUNTRY) -> httpx.Response:
    """Each call from its own address: the 5-a-minute IP limit isn't what's tested here."""
    body: dict[str, Any] = {"id_token": token}
    if country_code is not None:
        body["country_code"] = country_code
    return await r.http.post(PATH, json=body, headers=viewer(f"198.18.0.{next(_ips) % 250}"))


@pytest.mark.live_service
def test_a_new_google_account_goes_through_the_saga(mongo_uri):
    async def test(r: Running) -> None:
        await r.allow()
        token = google_token(given_name="Ja\x00ne\n", family_name="D" * 150)
        response = await _google(r, token, country_code="in")
        assert response.status_code == 200
        user_id = claims(response.json()["access_token"])["sub"]
        account = await r.db[AUTH].find_one({"_id": user_id})
        assert account is not None
        assert (account["auth_provider"], account["location"]) == ("google", LOCATION)
        assert account["password_hash"].startswith("$2b$12$")  # unusable, but a real hash
        profile = r.users.profiles[user_id]
        assert profile["first_name"] == "Jane" and profile["last_name"] == "D" * 100
        assert "email" not in profile
        # Password login doesn't work for it: nobody knows that password.
        assert (await r.login()).status_code == 401

    live(mongo_uri, test)


@pytest.mark.live_service
def test_without_a_given_name_the_first_name_is_the_emails_local_part(mongo_uri):
    async def test(r: Running) -> None:
        await r.allow()
        response = await _google(r, google_token(given_name="  "))
        assert response.status_code == 200
        user_id = claims(response.json()["access_token"])["sub"]
        assert r.users.profiles[user_id]["first_name"] == "jane.doe"
        assert r.users.profiles[user_id]["last_name"] is None

    live(mongo_uri, test)


@pytest.mark.live_service
def test_an_existing_password_account_can_sign_in_with_google(mongo_uri):
    async def test(r: Running) -> None:
        await r.allow()
        registered = await r.register()
        response = await _google(r, google_token(email=EMAIL.upper()), country_code=None)
        assert response.status_code == 200
        assert (
            claims(response.json()["access_token"])["sub"]
            == claims(registered.json()["access_token"])["sub"]
        )
        account = await r.db[AUTH].find_one({})
        assert account is not None and account["auth_provider"] == "password"
        assert len(r.users.profiles) == 1  # no second profile

    live(mongo_uri, test)


@pytest.mark.live_service
@pytest.mark.parametrize(
    "flag,status,code",
    [("is_being_deleted", 401, "account_unavailable"), ("is_locked", 403, "account_locked")],
)
def test_an_existing_account_that_cant_sign_in(mongo_uri, flag, status, code):
    async def test(r: Running) -> None:
        await r.allow()
        await r.register()
        await r.db[AUTH].update_one({}, {"$set": {flag: True}})
        response = await _google(r, google_token())
        assert (response.status_code, _code(response)) == (status, code)

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_new_account_needs_the_allow_list_a_country_and_an_open_one(mongo_uri):
    async def test(r: Running) -> None:
        closed = await _google(r, google_token())
        assert (closed.status_code, _code(closed)) == (403, "registration_closed")
        await r.allow()
        no_country = await _google(r, google_token(), country_code=None)
        assert (no_country.status_code, _code(no_country)) == (422, "country_code_required")
        blocked = await _google(r, google_token(), country_code=sorted(BLOCKED_COUNTRIES)[0])
        assert (blocked.status_code, _code(blocked)) == (403, "country_not_supported")
        assert (await _google(r, google_token(), country_code="ZZ")).status_code == 422
        assert await r.db[AUTH].count_documents({}) == 0

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_bad_token_or_an_unverified_email_is_400(mongo_uri):
    async def test(r: Running) -> None:
        await r.allow()
        bad = await _google(r, "not-a-google-token")
        assert (bad.status_code, _code(bad)) == (400, "google_token_invalid")
        for extra in (
            {"email_verified": False},
            {"email_verified": "false"},
            {"email": None},
            {"email": "not-an-email"},
        ):
            response = await _google(r, google_token(**extra))
            assert (response.status_code, _code(response)) == (400, "google_email_unverified")
        # Older tokens carry the flag as a string.
        assert (await _google(r, google_token(email_verified="true"))).status_code == 200

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_new_account_with_users_down_is_503(mongo_uri):
    async def test(r: Running) -> None:
        await r.allow()
        r.users.put_status = "down"
        response = await _google(r, google_token())
        assert (response.status_code, _code(response)) == (503, "registration_unavailable")
        assert await r.db[AUTH].count_documents({}) == 0

    live(mongo_uri, test)


@pytest.mark.live_service
def test_google_sign_in_off_is_503(mongo_uri):
    async def test(r: Running) -> None:
        r.runtime.settings.google_client_id = ""
        response = await _google(r, google_token())
        assert (response.status_code, _code(response)) == (503, "google_unavailable")

    live(mongo_uri, test)
