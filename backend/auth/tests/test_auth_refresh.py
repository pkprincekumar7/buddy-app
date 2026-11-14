"""Refresh (9.1): rotation in a family, the 30-second window for concurrent refreshes,
reuse detection (which logs the account out everywhere), and every refusal clearing the
cookies."""

import asyncio
import types
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any, cast

import httpx
import pytest
from auth_testkit import JWT_PRIVATE, KID, OTHER_PRIVATE, Running, claims, issuer, running
from fastapi import Request, Response
from pymongo import MongoClient

from auth.app import main
from auth.app.store import AUTH, SESSIONS
from auth.app.tokens import TokenIssuer

PATH = "/api/v1/auth/refresh"


def live(mongo_uri: str, test: Callable[[Running], Awaitable[None]], **options: Any) -> None:
    async def go() -> None:
        async with running(mongo_uri, **options) as r:
            await test(r)

    asyncio.run(go())


def _code(response: httpx.Response) -> str:
    return response.json()["detail"]["code"]


def _clears_cookies(response: httpx.Response) -> bool:
    cookies = response.headers.get_list("set-cookie")
    return all(
        any(c.startswith(f"{name}=") and "Max-Age=0" in c for c in cookies)
        for name in ("access_token", "refresh_token")
    )


async def _signed_in(r: Running) -> dict[str, str]:
    await r.allow()
    response = await r.register()
    assert response.status_code == 201
    r.http.cookies.clear()  # each test sends exactly the tokens it means to
    return response.json()


async def _refresh(r: Running, token: str, **headers: str) -> httpx.Response:
    r.http.cookies.clear()  # only the Bearer token: not cookies an earlier refresh set
    return await r.http.post(PATH, headers={"Authorization": f"Bearer {token}", **headers})


@pytest.mark.live_service
def test_a_refresh_rotates_within_the_family(mongo_uri):
    async def test(r: Running) -> None:
        tokens = await _signed_in(r)
        old = claims(tokens["refresh_token"])
        response = await _refresh(r, tokens["refresh_token"])
        assert response.status_code == 200
        new = claims(response.json()["refresh_token"])
        assert new["family_id"] == old["family_id"] and new["jti"] != old["jti"]
        rotated = await r.db[SESSIONS].find_one({"_id": old["jti"]})
        assert rotated is not None and rotated["replaced_by"] == new["jti"]
        assert rotated["rotated_at"] is not None
        assert await r.db[SESSIONS].find_one({"_id": new["jti"]}) is not None
        # The web app sends the cookie instead; the new pair works the same way.
        r.http.cookies.set("refresh_token", response.json()["refresh_token"])
        assert (await r.http.post(PATH)).status_code == 200

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_logout_all_during_a_refresh_leaves_no_session(mongo_uri, monkeypatch):
    async def test(r: Running) -> None:
        tokens = await _signed_in(r)
        user_id = claims(tokens["refresh_token"])["sub"]
        real = TokenIssuer.issue
        mongo: MongoClient[dict[str, Any]] = MongoClient(mongo_uri)

        def logout_all_meanwhile(self: TokenIssuer, *args: Any, **kwargs: Any) -> Any:
            # Another device's logout-all lands after the refresh read the account.
            mongo[r.db.name][AUTH].update_one(
                {"_id": user_id},
                {"$set": {"tokens_revoked_at": datetime.now(UTC)}, "$inc": {"authz_version": 1}},
            )
            return real(self, *args, **kwargs)

        monkeypatch.setattr(TokenIssuer, "issue", logout_all_meanwhile)
        response = await _refresh(r, tokens["refresh_token"])
        assert response.status_code == 401 and _code(response) == "session_revoked"
        new_sessions = await r.db[SESSIONS].count_documents(
            {"user_id": user_id, "_id": {"$ne": claims(tokens["refresh_token"])["jti"]}}
        )
        assert new_sessions == 0
        mongo.close()

    live(mongo_uri, test)


async def _live_sessions(r: Running, family: str) -> int:
    """Sessions of `family` that can still refresh (not yet rotated)."""
    return await r.db[SESSIONS].count_documents({"family_id": family, "rotated_at": None})


@pytest.mark.live_service
def test_a_second_refresh_within_30_seconds_replaces_the_first_ones_session(mongo_uri):
    # AUTH-02: a mobile retry after a lost response, or another tab. It gets a pair, but
    # the family keeps one branch: the first refresh's session can no longer refresh.
    async def test(r: Running) -> None:
        tokens = await _signed_in(r)
        first = await _refresh(r, tokens["refresh_token"])
        second = await _refresh(r, tokens["refresh_token"])
        assert first.status_code == second.status_code == 200
        family = claims(tokens["refresh_token"])["family_id"]
        assert claims(second.json()["refresh_token"])["family_id"] == family
        assert await _live_sessions(r, family) == 1
        lost = await _refresh(r, first.json()["refresh_token"])
        assert (lost.status_code, _code(lost)) == (401, "session_expired")
        assert (await _refresh(r, second.json()["refresh_token"])).status_code == 200
        account = await r.db[AUTH].find_one({})
        assert account is not None and account["tokens_revoked_at"] is None

    live(mongo_uri, test)


@pytest.mark.live_service
def test_parallel_refreshes_leave_exactly_one_branch(mongo_uri):
    async def test(r: Running) -> None:
        tokens = await _signed_in(r)
        token = tokens["refresh_token"]
        headers = {"Authorization": f"Bearer {token}"}
        replies = await asyncio.gather(*(r.http.post(PATH, headers=headers) for _ in range(6)))
        assert {reply.status_code for reply in replies} <= {200, 409}
        family = claims(token)["family_id"]
        assert await _live_sessions(r, family) == 1
        # Of the pairs handed out, exactly one can still refresh.
        pairs = [reply.json()["refresh_token"] for reply in replies if reply.status_code == 200]
        assert pairs
        still = [p for p in pairs if (await _refresh(r, p)).status_code == 200]
        assert len(still) == 1

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_refresh_after_its_successor_was_used_is_a_409_that_keeps_the_cookies(mongo_uri):
    async def test(r: Running) -> None:
        tokens = await _signed_in(r)
        first = await _refresh(r, tokens["refresh_token"])
        assert (await _refresh(r, first.json()["refresh_token"])).status_code == 200
        late = await _refresh(r, tokens["refresh_token"])  # a tab that slept through both
        assert (late.status_code, _code(late)) == (409, "refresh_superseded")
        assert late.headers.get_list("set-cookie") == []
        assert await _live_sessions(r, claims(tokens["refresh_token"])["family_id"]) == 1

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_claim_that_stopped_part_way_is_taken_over(mongo_uri, monkeypatch):
    monkeypatch.setattr(main, "SUCCESSOR_WAIT_SECONDS", 0.2)
    monkeypatch.setattr(main, "SUCCESSOR_POLL_SECONDS", 0.05)

    async def test(r: Running) -> None:
        tokens = await _signed_in(r)
        old = claims(tokens["refresh_token"])
        # Claimed (rotated) by a refresh that crashed before recording its successor.
        await r.db[SESSIONS].update_one(
            {"_id": old["jti"]}, {"$set": {"rotated_at": datetime.now(UTC) - timedelta(seconds=5)}}
        )
        retried = await _refresh(r, tokens["refresh_token"])
        assert retried.status_code == 200
        session = await r.db[SESSIONS].find_one({"_id": old["jti"]})
        assert session is not None
        assert session["replaced_by"] == claims(retried.json()["refresh_token"])["jti"]

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_refresh_that_loses_the_link_leaves_no_second_session(mongo_uri):
    async def test(r: Running) -> None:
        tokens = await _signed_in(r)
        old = claims(tokens["refresh_token"])
        account = await r.db[AUTH].find_one({"_id": old["sub"]})
        claim = main._Claim(
            r.runtime,
            Request({"type": "http", "headers": [], "method": "POST", "path": PATH}),
            Response(),
            account,
            old["jti"],
            old["location"],
            old["family_id"],
        )
        # Another refresh linked a successor first: this one's session is removed again.
        await r.db[SESSIONS].update_one({"_id": old["jti"]}, {"$set": {"replaced_by": "other"}})
        lost = await claim.mint(expected=None)
        assert lost.status_code == 409
        assert await r.db[SESSIONS].count_documents({"family_id": old["family_id"]}) == 1
        # And a token whose session is gone by now is superseded, not an error.
        await r.db[SESSIONS].delete_many({})
        assert (await claim.replace_successor()).status_code == 409

    live(mongo_uri, test)


@pytest.mark.live_service
def test_reuse_after_30_seconds_revokes_the_family_and_every_token(mongo_uri, caplog):
    async def test(r: Running) -> None:
        tokens = await _signed_in(r)
        other_device = await r.login()
        r.http.cookies.clear()
        rotated = await _refresh(r, tokens["refresh_token"])
        old = claims(tokens["refresh_token"])
        await r.db[SESSIONS].update_one(
            {"_id": old["jti"]}, {"$set": {"rotated_at": datetime.now(UTC) - timedelta(seconds=31)}}
        )
        with caplog.at_level("WARNING", logger="auth.app.main"):
            stolen = await _refresh(r, tokens["refresh_token"])
        assert (stolen.status_code, _code(stolen)) == (401, "session_revoked")
        assert _clears_cookies(stolen)
        # A security event the backend stack counts and alarms on (AUTH-02).
        assert [getattr(x, "security_event", None) for x in caplog.records] == [
            "refresh_token_reuse"
        ]
        # The whole family is gone, including the pair the reuse would have been after.
        assert await r.db[SESSIONS].count_documents({"family_id": old["family_id"]}) == 0
        assert (await _refresh(r, rotated.json()["refresh_token"])).status_code == 401
        # Logged out everywhere: another family's token was issued before the revocation.
        account = await r.db[AUTH].find_one({"_id": old["sub"]})
        assert account is not None and account["authz_version"] == 2
        assert account["tokens_revoked_at"] is not None
        refused = await _refresh(r, other_device.json()["refresh_token"])
        assert (refused.status_code, _code(refused)) == (401, "session_revoked")

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_crash_during_the_reuse_revocation_leaves_it_whole_to_happen_again(
    mongo_uri, monkeypatch
):
    # The family's sessions and the account's revocation commit together: a crash between
    # them used to leave the family gone but every other device still signed in (review).
    async def test(r: Running) -> None:
        tokens = await _signed_in(r)
        await _refresh(r, tokens["refresh_token"])
        old = claims(tokens["refresh_token"])
        await r.db[SESSIONS].update_one(
            {"_id": old["jti"]}, {"$set": {"rotated_at": datetime.now(UTC) - timedelta(seconds=31)}}
        )
        real = main.authz_change

        def crash(*args: Any, **kwargs: Any) -> Any:
            raise RuntimeError("the task died")

        monkeypatch.setattr(main, "authz_change", crash)
        with pytest.raises(RuntimeError):
            await _refresh(r, tokens["refresh_token"])
        # Nothing committed: the family is still there, so the next reuse revokes it all.
        assert await r.db[SESSIONS].count_documents({"family_id": old["family_id"]}) == 2
        monkeypatch.setattr(main, "authz_change", real)
        stolen = await _refresh(r, tokens["refresh_token"])
        assert (stolen.status_code, _code(stolen)) == (401, "session_revoked")
        assert await r.db[SESSIONS].count_documents({"family_id": old["family_id"]}) == 0
        account = await r.db[AUTH].find_one({"_id": old["sub"]})
        assert account is not None and account["tokens_revoked_at"] is not None

    live(mongo_uri, test)


@pytest.mark.live_service
def test_reuse_for_an_account_that_is_gone_still_ends_the_family(mongo_uri):
    async def test(r: Running) -> None:
        tokens = await _signed_in(r)
        await _refresh(r, tokens["refresh_token"])
        old = claims(tokens["refresh_token"])
        await r.db[SESSIONS].update_one(
            {"_id": old["jti"]}, {"$set": {"rotated_at": datetime.now(UTC) - timedelta(seconds=31)}}
        )
        await r.db[AUTH].delete_many({})
        stolen = await _refresh(r, tokens["refresh_token"])
        assert (stolen.status_code, _code(stolen)) == (401, "session_revoked")
        assert await r.db[SESSIONS].count_documents({"family_id": old["family_id"]}) == 0

    live(mongo_uri, test)


@pytest.mark.live_service
def test_bad_or_missing_tokens_are_refused_and_clear_the_cookies(mongo_uri):
    async def test(r: Running) -> None:
        tokens = await _signed_in(r)
        missing = await r.http.post(PATH)
        assert (missing.status_code, _code(missing)) == (401, "missing_token")
        assert _clears_cookies(missing)
        for token in (
            "not-a-token",
            tokens["access_token"],  # an access token isn't a refresh token
            TokenIssuer(OTHER_PRIVATE, KID, issuer="superpower-local", audience="superpower-api")
            .issue(claims(tokens["access_token"])["sub"], "in", "parent")
            .refresh_token,  # signed by a key JWT_PUBLIC_KEYS doesn't hold
            TokenIssuer(
                JWT_PRIVATE, "unknown", issuer="superpower-local", audience="superpower-api"
            )
            .issue(claims(tokens["access_token"])["sub"], "in", "parent")
            .refresh_token,
        ):
            response = await _refresh(r, token)
            assert (response.status_code, _code(response)) == (401, "invalid_token")
            assert _clears_cookies(response)

    live(mongo_uri, test)


@pytest.mark.live_service
def test_another_users_access_token_is_a_mismatch(mongo_uri):
    async def test(r: Running) -> None:
        tokens = await _signed_in(r)
        await r.allow("sam@example.com")
        sam = await r.register(email="sam@example.com")
        r.http.cookies.clear()
        r.http.cookies.set("access_token", sam.json()["access_token"])
        r.http.cookies.set("refresh_token", tokens["refresh_token"])
        response = await r.http.post(PATH)
        assert (response.status_code, _code(response)) == (401, "invalid_token")
        # The same user's (even expired) access token is fine.
        r.http.cookies.set("access_token", tokens["access_token"])
        assert (await r.http.post(PATH)).status_code == 200

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_gone_or_expired_session_is_session_expired(mongo_uri):
    async def test(r: Running) -> None:
        tokens = await _signed_in(r)
        jti = claims(tokens["refresh_token"])["jti"]
        await r.db[SESSIONS].update_one(
            {"_id": jti}, {"$set": {"expires_at": datetime.now(UTC) - timedelta(seconds=1)}}
        )
        expired = await _refresh(r, tokens["refresh_token"])
        assert (expired.status_code, _code(expired)) == (401, "session_expired")
        assert await r.db[SESSIONS].find_one({"_id": jti}) is None
        gone = await _refresh(r, tokens["refresh_token"])
        assert (gone.status_code, _code(gone)) == (401, "session_expired")

    live(mongo_uri, test)


@pytest.mark.live_service
@pytest.mark.parametrize(
    "change,status,code",
    [
        ({"$set": {"is_locked": True}}, 403, "account_locked"),
        ({"$set": {"is_being_deleted": True}}, 401, "session_revoked"),
        ("revoked", 401, "session_revoked"),  # tokens_revoked_at after the token's iat_ms
        (None, 401, "session_revoked"),  # the account itself is gone
    ],
)
def test_the_account_state_is_checked_and_the_session_ended(mongo_uri, change, status, code):
    async def test(r: Running) -> None:
        tokens = await _signed_in(r)
        if change is None:
            await r.db[AUTH].delete_many({})
        elif change == "revoked":
            later = datetime.now(UTC) + timedelta(seconds=5)
            await r.db[AUTH].update_one({}, {"$set": {"tokens_revoked_at": later}})
        else:
            await r.db[AUTH].update_one({}, change)
        response = await _refresh(r, tokens["refresh_token"])
        assert (response.status_code, _code(response)) == (status, code)
        assert _clears_cookies(response)
        assert (
            await r.db[SESSIONS].find_one({"_id": claims(tokens["refresh_token"])["jti"]}) is None
        )

    live(mongo_uri, test)


@pytest.mark.live_service
def test_refresh_is_limited_to_20_a_minute_per_user(mongo_uri):
    async def test(r: Running) -> None:
        tokens = await _signed_in(r)
        token = tokens["refresh_token"]
        statuses = []
        for _ in range(21):
            response = await _refresh(r, token)
            statuses.append(response.status_code)
            if response.status_code == 200:
                token = response.json()["refresh_token"]
        assert statuses == [200] * 20 + [429]

    live(mongo_uri, test)


def test_tokens_last_30_minutes_and_24_hours():
    issued = issuer().issue("6f1c2a9e-1111-4222-8333-444455556666", "in", "parent")
    access, refresh = claims(issued.access_token), claims(issued.refresh_token)
    assert access["exp"] - access["iat"] == 30 * 60
    assert refresh["exp"] - refresh["iat"] == 24 * 3600


def test_two_takeovers_of_a_stopped_claim_only_one_wins(monkeypatch):
    monkeypatch.setattr(main, "SUCCESSOR_WAIT_SECONDS", 0.0)

    class Sessions:
        """The claimed token, re-claimed by another takeover between this one's read and
        its own claim: the conditional update matches nothing."""

        async def find_one(self, query: Any) -> dict[str, Any]:
            return {"_id": "j", "rotated_at": datetime.now(UTC), "replaced_by": None}

        async def find_one_and_update(self, query: Any, update: Any) -> None:
            return None

    runtime = types.SimpleNamespace(db={SESSIONS: Sessions()})
    claim = main._Claim(
        cast(Any, runtime),
        Request({"type": "http", "headers": [], "method": "POST", "path": PATH}),
        Response(),
        {"_id": "u"},
        "j",
        "in",
        "f",
    )
    assert asyncio.run(claim.replace_successor()).status_code == 409
