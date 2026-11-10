"""The first-admin command (build plan 3.6). The plan's check: a second run refuses."""

import asyncio
import io
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from auth_testkit import PEPPER, Running, claims, running

from auth import promote_admin
from auth.app.store import ADMIN_COUNT, AUDIT, AUTH, SESSIONS


def live(mongo_uri: str, test: Callable[[Running], Awaitable[None]]) -> None:
    async def go() -> None:
        async with running(mongo_uri) as r:
            await test(r)

    asyncio.run(go())


def _env(r: Running, mongo_uri: str) -> dict[str, str]:
    return {
        "MONGODB_URI": mongo_uri,
        "MONGODB_DB_NAME": r.runtime.settings.mongodb_db_name,
        "EMAIL_HMAC_PEPPER": PEPPER,
    }


async def _signed_up(r: Running, email: str) -> str:
    await r.allow(email)
    response = await r.register(email=email, ip=f"198.51.{uuid.uuid4().int % 250}.3")
    assert response.status_code == 201
    r.http.cookies.clear()
    return str(claims(response.json()["access_token"])["sub"])


async def _run(r: Running, mongo_uri: str, *argv: str, stdin: str = "") -> int:
    # main() runs its own event loop, so it runs in a thread here.
    return await asyncio.to_thread(
        promote_admin.main, list(argv), _env(r, mongo_uri), io.StringIO(stdin)
    )


@pytest.mark.live_service
def test_the_first_admin_is_promoted_and_a_second_run_refuses(mongo_uri, capsys, caplog):
    async def test(r: Running) -> None:
        jane = await _signed_up(r, "jane@example.com")
        sam = await _signed_up(r, "sam@example.com")
        assert await _run(r, mongo_uri, "--user-id", jane) == 0
        account = await r.db[AUTH].find_one({"_id": jane})
        assert account is not None and account["role"] == "admin"
        assert account["authz_version"] == 2 and account["tokens_revoked_at"] is not None
        assert await r.db[SESSIONS].count_documents({"user_id": jane}) == 0
        assert (await r.db[ADMIN_COUNT].find_one({"_id": "admins"}))["active"] == 1
        row = await r.db[AUDIT].find_one({"actor_id": "promote-admin"})
        assert row is not None and (row["subject_id"], row["permission"]) == (jane, "accounts:role")
        # Jane signs in again with the admin role, and the admin screen works for her.
        login = await r.login(email="jane@example.com")
        assert claims(login.json()["access_token"])["role"] == "admin"
        r.http.cookies.clear()
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        assert (await r.http.get("/api/v1/auth/accounts", headers=headers)).status_code == 200
        # The second run refuses, and changes nothing.
        assert await _run(r, mongo_uri, "--user-id", sam) == 1
        assert (await r.db[AUTH].find_one({"_id": sam}))["role"] == "parent"
        assert (await r.db[ADMIN_COUNT].find_one({"_id": "admins"}))["active"] == 1

    with caplog.at_level("INFO"):
        live(mongo_uri, test)
    out = capsys.readouterr()
    assert "is now an admin" in out.out and "an admin already exists" in out.err
    assert "audit.role_changed" in caplog.text and "@" not in out.out + out.err


@pytest.mark.live_service
def test_locally_the_email_can_come_on_stdin(mongo_uri):
    async def test(r: Running) -> None:
        jane = await _signed_up(r, "jane@example.com")
        assert await _run(r, mongo_uri, "--email-stdin", stdin=" JANE@example.com\n") == 0
        assert (await r.db[AUTH].find_one({"_id": jane}))["role"] == "admin"

    live(mongo_uri, test)


@pytest.mark.live_service
def test_it_refuses_an_account_that_cant_be_promoted(mongo_uri, capsys):
    async def test(r: Running) -> None:
        jane = await _signed_up(r, "jane@example.com")
        assert await _run(r, mongo_uri, "--user-id", str(uuid.uuid4())) == 1
        assert await _run(r, mongo_uri, "--email-stdin", stdin="nobody@example.com\n") == 1
        for flag in ("is_locked", "is_being_deleted"):
            await r.db[AUTH].update_one({"_id": jane}, {"$set": {flag: True}})
            assert await _run(r, mongo_uri, "--user-id", jane) == 1
            await r.db[AUTH].update_one({"_id": jane}, {"$set": {flag: False}})
        await r.db[AUTH].update_one({"_id": jane}, {"$set": {"role": "admin"}})
        assert await _run(r, mongo_uri, "--user-id", jane) == 1
        assert await r.db[ADMIN_COUNT].count_documents({}) == 0

    live(mongo_uri, test)
    err = capsys.readouterr().err
    assert (
        "no such account" in err and "locked or being deleted" in err and "already an admin" in err
    )


@pytest.mark.live_service
def test_the_counter_is_the_gate(mongo_uri):
    async def test(r: Running) -> None:
        jane = await _signed_up(r, "jane@example.com")
        # A counter left at 0 (say, by a failed run) is claimed.
        await r.db[ADMIN_COUNT].insert_one({"_id": "admins", "active": 0})
        assert await _run(r, mongo_uri, "--user-id", jane) == 0
        # A counter that says an admin exists refuses, even with no admin account to see.
        await r.db[AUTH].update_one({"_id": jane}, {"$set": {"role": "parent"}})
        sam = await _signed_up(r, "sam@example.com")
        assert await _run(r, mongo_uri, "--user-id", sam) == 1

    live(mongo_uri, test)


@pytest.mark.live_service
def test_two_runs_at_once_make_one_admin(mongo_uri):
    async def test(r: Running) -> None:
        jane = await _signed_up(r, "jane@example.com")
        sam = await _signed_up(r, "sam@example.com")
        results = await asyncio.gather(
            _run(r, mongo_uri, "--user-id", jane), _run(r, mongo_uri, "--user-id", sam)
        )
        assert sorted(results) == [0, 1]
        assert await r.db[AUTH].count_documents({"role": "admin"}) == 1

    live(mongo_uri, test)


@pytest.mark.live_service
def test_an_account_changed_meanwhile_gives_the_counter_back(mongo_uri, monkeypatch):
    async def test(r: Running) -> None:
        jane = await _signed_up(r, "jane@example.com")
        real = promote_admin._claim_first_admin

        async def locked_meanwhile(db: Any) -> None:
            await db[AUTH].update_one({"_id": jane}, {"$set": {"is_locked": True}})
            await real(db)

        monkeypatch.setattr(promote_admin, "_claim_first_admin", locked_meanwhile)
        assert await _run(r, mongo_uri, "--user-id", jane) == 1
        assert (await r.db[ADMIN_COUNT].find_one({"_id": "admins"}))["active"] == 0

    live(mongo_uri, test)


def test_it_needs_auths_settings(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)  # no .env here
    assert promote_admin.main(["--user-id", "x"], {}, io.StringIO()) == 1
    assert "set MONGODB_URI, MONGODB_DB_NAME, EMAIL_HMAC_PEPPER" in capsys.readouterr().err
    with pytest.raises(SystemExit):
        promote_admin.main([], {}, io.StringIO())  # who to promote is required
