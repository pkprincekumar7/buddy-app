"""auth's admin endpoints (build plan 3.4). The plan's checks:
- two admins demoting each other at once leave one admin;
- unlock keeps `tokens_revoked_at`;
- no email appears in any URL or log.
Plus the permission matrix, the last-admin counter rules and the audit rows."""

import asyncio
import dataclasses
import time
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

import httpx
import pytest
from auth_testkit import LOCATION, OLD_PEPPER, PEPPER, Running, claims, running
from fastapi.routing import APIRoute

from auth.app import admin, main
from auth.app.audit import AuditTrail
from auth.app.store import ADMIN_COUNT, ALLOWED_EMAILS, AUDIT, AUTH, SESSIONS
from common.audit import AuditEvent

API = "/api/v1/auth"


def live(mongo_uri: str, test: Callable[[Running], Awaitable[None]], **options: Any) -> None:
    async def go() -> None:
        async with running(mongo_uri, **options) as r:
            await test(r)

    asyncio.run(go())


def _code(response: httpx.Response) -> str:
    return response.json()["detail"]["code"]


async def _account(r: Running, email: str, *, role: str = "parent") -> dict[str, Any]:
    """A signed-up account; an admin is promoted in the database, as promote-admin does,
    and counted. Returns its id and a bearer header."""
    await r.allow(email)
    response = await r.register(email=email, ip=f"198.51.{uuid.uuid4().int % 250}.1")
    assert response.status_code == 201, response.text
    r.http.cookies.clear()
    user_id = claims(response.json()["access_token"])["sub"]
    if role == "admin":
        await r.db[AUTH].update_one({"_id": user_id}, {"$set": {"role": "admin"}})
        await r.db[ADMIN_COUNT].update_one({"_id": "admins"}, {"$inc": {"active": 1}}, upsert=True)
    return {
        "id": user_id,
        "headers": {"Authorization": f"Bearer {response.json()['access_token']}"},
        "refresh": response.json()["refresh_token"],
    }


async def _admins(r: Running) -> int:
    doc = await r.db[ADMIN_COUNT].find_one({"_id": "admins"})
    return int(doc["active"]) if doc else 0


# ── shape ──────────────────────────────────────────────────────────────────────


def test_no_route_takes_an_email_in_its_url():
    paths = [route.path for route in main.app.routes if isinstance(route, APIRoute)]
    assert not any("email}" in path for path in paths)
    for route in main.app.routes:
        if isinstance(route, APIRoute) and "search" in route.path:
            assert route.methods == {"POST"}


@pytest.mark.live_service
def test_every_admin_route_needs_its_permission(mongo_uri):
    async def test(r: Running) -> None:
        parent = await _account(r, "parent@example.com")
        key = "a" * 64
        calls = [
            ("GET", f"{API}/accounts", None),
            ("POST", f"{API}/accounts/search", {"email": "x@y.z"}),
            ("POST", f"{API}/accounts/{parent['id']}/lock?location={LOCATION}", None),
            ("POST", f"{API}/accounts/{parent['id']}/unlock?location={LOCATION}", None),
            ("PATCH", f"{API}/accounts/{parent['id']}/role?location={LOCATION}", {"role": "admin"}),
            ("GET", f"{API}/allowed-emails", None),
            ("POST", f"{API}/allowed-emails/search", {"email": "x@y.z"}),
            ("POST", f"{API}/allowed-emails", {"email": "x@y.z"}),
            ("DELETE", f"{API}/allowed-emails/{key}", None),
        ]
        for method, path, body in calls:
            denied = await r.http.request(method, path, json=body, headers=parent["headers"])
            assert denied.status_code == 403, (method, path)
            assert (await r.http.request(method, path, json=body)).status_code == 401
        account = await r.db[AUTH].find_one({"_id": parent["id"]})
        assert account is not None and account["role"] == "parent" and not account["is_locked"]
        # Every denial is in auth's audit collection, with the actor's location.
        await r.runtime.audit.flush()
        rows = await r.db[AUDIT].find({"outcome": "denied"}).to_list(None)
        assert len(rows) == len(calls)
        assert {row["location"] for row in rows} == {LOCATION}

    live(mongo_uri, test)


# ── accounts ───────────────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_admins_list_accounts_newest_first_with_filters(mongo_uri):
    async def test(r: Running) -> None:
        boss = await _account(r, "boss@example.com", role="admin")
        first = await _account(r, "first@example.com")
        second = await _account(r, "second@example.com")
        await r.db[AUTH].update_one({"_id": first["id"]}, {"$set": {"is_locked": True}})
        page = (await r.http.get(f"{API}/accounts", headers=boss["headers"])).json()
        assert [item["id"] for item in page["items"]] == [second["id"], first["id"], boss["id"]]
        assert (page["total"], page["skip"], page["limit"]) == (3, 0, 20)
        item = page["items"][0]
        assert set(item) == {"id", "email", "role", "auth_provider", "location", "locked",
                             "deleting", "created_at"}  # fmt: skip
        assert item["email"] == "second@example.com"
        get = r.http.get
        admins = (
            await get(f"{API}/accounts", params={"role": "admin"}, headers=boss["headers"])
        ).json()
        assert [i["id"] for i in admins["items"]] == [boss["id"]]
        locked = (
            await get(f"{API}/accounts", params={"locked": "true"}, headers=boss["headers"])
        ).json()
        assert [i["id"] for i in locked["items"]] == [first["id"]]
        unlocked = (
            await get(f"{API}/accounts", params={"locked": "false"}, headers=boss["headers"])
        ).json()
        assert unlocked["total"] == 2
        paged = (
            await get(f"{API}/accounts", params={"skip": 1, "limit": 1}, headers=boss["headers"])
        ).json()
        assert [i["id"] for i in paged["items"]] == [first["id"]] and paged["total"] == 3
        for bad in ({"limit": 0}, {"limit": 101}, {"skip": -1}, {"role": "owner"}):
            assert (
                await get(f"{API}/accounts", params=bad, headers=boss["headers"])
            ).status_code == 422
        await r.runtime.audit.flush()
        assert (
            await r.db[AUDIT].count_documents({"permission": "accounts:list", "privileged": True})
            >= 1
        )

    live(mongo_uri, test)


@pytest.mark.live_service
def test_admins_find_an_account_by_email_in_the_body(mongo_uri):
    async def test(r: Running) -> None:
        boss = await _account(r, "boss@example.com", role="admin")
        jane = await _account(r, "jane@example.com")
        path = f"{API}/accounts/search"
        found = await r.http.post(
            path, json={"email": "  JANE@example.com"}, headers=boss["headers"]
        )
        assert found.status_code == 200 and found.json()["id"] == jane["id"]
        missing = await r.http.post(
            path, json={"email": "nobody@example.com"}, headers=boss["headers"]
        )
        assert (missing.status_code, _code(missing)) == (404, "account_not_found")
        # A row whose account is gone (a registration being reaped) isn't an account.
        await r.db[AUTH].delete_one({"_id": jane["id"]})
        gone = await r.http.post(path, json={"email": "jane@example.com"}, headers=boss["headers"])
        assert gone.status_code == 404

    live(mongo_uri, test)


# ── lock and unlock ────────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_a_lock_signs_the_account_out_everywhere(mongo_uri):
    async def test(r: Running) -> None:
        boss = await _account(r, "boss@example.com", role="admin")
        jane = await _account(r, "jane@example.com")
        time.sleep(0.002)
        path = f"{API}/accounts/{jane['id']}/lock?location={LOCATION}"
        response = await r.http.post(path, headers=boss["headers"])
        assert response.status_code == 200 and response.json() == {"id": jane["id"], "locked": True}
        account = await r.db[AUTH].find_one({"_id": jane["id"]})
        assert account is not None and account["is_locked"] is True
        assert account["tokens_revoked_at"] is not None and account["authz_version"] == 2
        assert await r.db[SESSIONS].count_documents({"user_id": jane["id"]}) == 0
        assert (await r.login(email="jane@example.com")).status_code == 403
        # Locking again is the same answer and changes nothing.
        again = await r.http.post(path, headers=boss["headers"])
        assert again.json() == {"id": jane["id"], "locked": True}
        assert (await r.db[AUTH].find_one({"_id": jane["id"]}))["authz_version"] == 2
        # The change is audited with the field names only.
        await r.runtime.audit.flush()
        row = await r.db[AUDIT].find_one({"subject_id": jane["id"], "changed_fields": {"$ne": []}})
        assert row is not None
        assert row["changed_fields"] == ["is_locked", "tokens_revoked_at"]
        assert row["actor_id"] == boss["id"] and row["location"] == LOCATION

    live(mongo_uri, test)


@pytest.mark.live_service
def test_lock_refusals(mongo_uri):
    async def test(r: Running) -> None:
        boss = await _account(r, "boss@example.com", role="admin")
        jane = await _account(r, "jane@example.com")
        own = await r.http.post(
            f"{API}/accounts/{boss['id']}/lock?location={LOCATION}", headers=boss["headers"]
        )
        assert (own.status_code, _code(own)) == (400, "cannot_lock_self")
        for user_id, location in ((str(uuid.uuid4()), LOCATION), (jane["id"], "us")):
            missing = await r.http.post(
                f"{API}/accounts/{user_id}/lock?location={location}", headers=boss["headers"]
            )
            assert (missing.status_code, _code(missing)) == (404, "account_not_found")
        no_location = await r.http.post(
            f"{API}/accounts/{jane['id']}/lock", headers=boss["headers"]
        )
        assert no_location.status_code == 422

    live(mongo_uri, test)


@pytest.mark.live_service
def test_unlock_keeps_tokens_revoked_at(mongo_uri):
    async def test(r: Running) -> None:
        boss = await _account(r, "boss@example.com", role="admin")
        jane = await _account(r, "jane@example.com")
        time.sleep(0.002)
        await r.http.post(
            f"{API}/accounts/{jane['id']}/lock?location={LOCATION}", headers=boss["headers"]
        )
        revoked = (await r.db[AUTH].find_one({"_id": jane["id"]}))["tokens_revoked_at"]
        response = await r.http.post(
            f"{API}/accounts/{jane['id']}/unlock?location={LOCATION}", headers=boss["headers"]
        )
        assert response.json() == {"id": jane["id"], "locked": False}
        account = await r.db[AUTH].find_one({"_id": jane["id"]})
        assert account is not None and account["is_locked"] is False
        assert account["tokens_revoked_at"] == revoked and account["authz_version"] == 3
        # Tokens from before the lock stay invalid: Jane signs in again, and that works.
        assert (await r.http.get(f"{API}/me", headers=jane["headers"])).status_code == 401
        fresh = await r.login(email="jane@example.com")
        assert fresh.status_code == 200
        r.http.cookies.clear()  # login left Jane's cookies, which would win over boss's header
        # Unlocking an unlocked account changes nothing.
        again = await r.http.post(
            f"{API}/accounts/{jane['id']}/unlock?location={LOCATION}", headers=boss["headers"]
        )
        assert again.status_code == 200
        assert (await r.db[AUTH].find_one({"_id": jane["id"]}))["authz_version"] == 3

    live(mongo_uri, test)


# ── the admin counter ──────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_the_counter_counts_unlocked_admins(mongo_uri):
    async def test(r: Running) -> None:
        boss = await _account(r, "boss@example.com", role="admin")
        other = await _account(r, "other@example.com", role="admin")
        assert await _admins(r) == 2
        lock = f"{API}/accounts/{other['id']}/lock?location={LOCATION}"
        assert (await r.http.post(lock, headers=boss["headers"])).status_code == 200
        assert await _admins(r) == 1
        # Demoting a locked admin doesn't touch the counter: they were taken off when locked.
        role = f"{API}/accounts/{other['id']}/role?location={LOCATION}"
        assert (
            await r.http.patch(role, json={"role": "parent"}, headers=boss["headers"])
        ).status_code == 200
        assert await _admins(r) == 1
        # Promoting a locked account doesn't count it either; unlocking it then does.
        assert (
            await r.http.patch(role, json={"role": "admin"}, headers=boss["headers"])
        ).status_code == 200
        assert await _admins(r) == 1
        unlock = f"{API}/accounts/{other['id']}/unlock?location={LOCATION}"
        assert (await r.http.post(unlock, headers=boss["headers"])).status_code == 200
        assert await _admins(r) == 2

    live(mongo_uri, test)


@pytest.mark.live_service
def test_the_last_active_admin_cant_be_locked_or_demoted(mongo_uri):
    async def test(r: Running) -> None:
        boss = await _account(r, "boss@example.com", role="admin")
        other = await _account(r, "other@example.com", role="admin")
        # Boss may demote themselves while another admin remains...
        own = f"{API}/accounts/{boss['id']}/role?location={LOCATION}"
        assert (
            await r.http.patch(own, json={"role": "parent"}, headers=boss["headers"])
        ).status_code == 200
        assert await _admins(r) == 1
        # ...but now the other is the last one.
        last = await r.login(email="other@example.com")
        headers = {"Authorization": f"Bearer {last.json()['access_token']}"}
        demote = await r.http.patch(
            f"{API}/accounts/{other['id']}/role?location={LOCATION}", json={"role": "parent"},
            headers=headers,
        )  # fmt: skip
        assert (demote.status_code, _code(demote)) == (409, "last_admin")
        account = await r.db[AUTH].find_one({"_id": other["id"]})
        assert account is not None and account["role"] == "admin" and await _admins(r) == 1

    live(mongo_uri, test)


@pytest.mark.live_service
def test_two_admins_demoting_each_other_at_once_leave_one(mongo_uri):
    async def test(r: Running) -> None:
        a = await _account(r, "a@example.com", role="admin")
        b = await _account(r, "b@example.com", role="admin")

        def demote(target: dict[str, Any], actor: dict[str, Any]) -> Awaitable[httpx.Response]:
            return r.http.patch(
                f"{API}/accounts/{target['id']}/role?location={LOCATION}",
                json={"role": "parent"},
                headers=actor["headers"],
            )

        results = await asyncio.gather(demote(b, a), demote(a, b))
        assert sorted(response.status_code for response in results) == [200, 409]
        roles = [doc["role"] for doc in await r.db[AUTH].find({}).to_list(None)]
        assert roles.count("admin") == 1 and await _admins(r) == 1

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_change_that_lost_a_race_is_retried_and_the_counter_put_back(mongo_uri, monkeypatch):
    async def test(r: Running) -> None:
        boss = await _account(r, "boss@example.com", role="admin")
        other = await _account(r, "other@example.com", role="admin")
        real = admin._apply
        misses = [1]

        async def changed_meanwhile(*args: Any, **kwargs: Any) -> Any:
            if misses[0]:
                misses[0] -= 1
                return None
            return await real(*args, **kwargs)

        monkeypatch.setattr(admin, "_apply", changed_meanwhile)
        lock = f"{API}/accounts/{other['id']}/lock?location={LOCATION}"
        assert (await r.http.post(lock, headers=boss["headers"])).status_code == 200
        assert await _admins(r) == 1  # taken out once, not twice
        # A change that keeps losing gives up, with the counter as it was.
        misses[0] = 99
        unlock = f"{API}/accounts/{other['id']}/unlock?location={LOCATION}"
        gave_up = await r.http.post(unlock, headers=boss["headers"])
        assert (gave_up.status_code, _code(gave_up)) == (409, "account_changed")
        assert await _admins(r) == 1

    live(mongo_uri, test)


@pytest.mark.live_service
def test_an_update_finds_nothing_when_the_account_changed_since_it_was_read(mongo_uri):
    async def test(r: Running) -> None:
        jane = await _account(r, "jane@example.com")
        read = await r.db[AUTH].find_one({"_id": jane["id"]})
        await r.db[AUTH].update_one({"_id": jane["id"]}, {"$set": {"role": "admin"}})
        assert read is not None
        assert await admin._apply(r.runtime, read, {"is_locked": True}, end_sessions=True) is None
        assert await r.db[SESSIONS].count_documents({"user_id": jane["id"]}) == 1  # untouched

    live(mongo_uri, test)


@pytest.mark.live_service
def test_an_account_being_deleted_cant_be_changed(mongo_uri):
    async def test(r: Running) -> None:
        boss = await _account(r, "boss@example.com", role="admin")
        jane = await _account(r, "jane@example.com")
        await r.db[AUTH].update_one({"_id": jane["id"]}, {"$set": {"is_being_deleted": True}})
        role = f"{API}/accounts/{jane['id']}/role?location={LOCATION}"
        response = await r.http.patch(role, json={"role": "admin"}, headers=boss["headers"])
        # Promoting it would count an admin the deletion will remove.
        assert response.status_code == 409 and _code(response) == "account_deleting"
        assert await _admins(r) == 1
        # And a change read before the deletion started finds nothing.
        read = await r.db[AUTH].find_one({"_id": jane["id"]})
        assert read is not None
        read["is_being_deleted"] = False
        assert await admin._apply(r.runtime, read, {"role": "admin"}, end_sessions=True) is None

    live(mongo_uri, test)


# ── role ───────────────────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_a_role_change_ends_the_sessions_so_no_token_keeps_the_old_role(mongo_uri):
    async def test(r: Running) -> None:
        boss = await _account(r, "boss@example.com", role="admin")
        jane = await _account(r, "jane@example.com")
        time.sleep(0.002)
        role = f"{API}/accounts/{jane['id']}/role?location={LOCATION}"
        response = await r.http.patch(role, json={"role": "admin"}, headers=boss["headers"])
        assert response.json() == {"id": jane["id"], "role": "admin"}
        account = await r.db[AUTH].find_one({"_id": jane["id"]})
        assert account is not None and account["role"] == "admin" and account["tokens_revoked_at"]
        assert await r.db[SESSIONS].count_documents({"user_id": jane["id"]}) == 0
        assert await _admins(r) == 2
        fresh = await r.login(email="jane@example.com")
        assert claims(fresh.json()["access_token"])["role"] == "admin"
        # The same role again changes nothing; an unknown role is 422.
        again = await r.http.patch(role, json={"role": "admin"}, headers=boss["headers"])
        assert again.status_code == 200 and await _admins(r) == 2
        assert (
            await r.http.patch(role, json={"role": "owner"}, headers=boss["headers"])
        ).status_code == 422

    live(mongo_uri, test)


# ── the allow-list ─────────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_admins_manage_the_allow_list_by_key(mongo_uri):
    async def test(r: Running) -> None:
        boss = await _account(r, "boss@example.com", role="admin")
        added = await r.http.post(
            f"{API}/allowed-emails",
            json={"email": " New.Person@Example.com "},
            headers=boss["headers"],
        )
        assert added.status_code == 201
        entry = added.json()
        assert entry["key"] == r.runtime.peppers.key("new.person@example.com")
        assert (entry["email_hint"], entry["added_by"]) == ("n***@example.com", boss["id"])
        stored = await r.db[ALLOWED_EMAILS].find_one({"_id": entry["key"]})
        assert stored is not None and "new.person" not in str(stored)
        dup = await r.http.post(
            f"{API}/allowed-emails",
            json={"email": "new.person@example.com"},
            headers=boss["headers"],
        )
        assert (dup.status_code, _code(dup)) == (409, "already_allowed")
        bad = await r.http.post(
            f"{API}/allowed-emails", json={"email": "nope"}, headers=boss["headers"]
        )
        assert (bad.status_code, _code(bad)) == (422, "invalid_email")
        # Registration now works for it.
        assert (await r.register(email="new.person@example.com")).status_code == 201
        r.http.cookies.clear()  # the new account's cookies would win over boss's header

        page = (await r.http.get(f"{API}/allowed-emails", headers=boss["headers"])).json()
        assert page["items"][0]["key"] == entry["key"] and page["total"] == 2  # + boss's own
        assert "email" not in page["items"][0]
        one = (
            await r.http.get(
                f"{API}/allowed-emails", params={"limit": 1, "skip": 1}, headers=boss["headers"]
            )
        ).json()
        assert len(one["items"]) == 1
        search = f"{API}/allowed-emails/search"
        found = await r.http.post(
            search, json={"email": "NEW.PERSON@example.com"}, headers=boss["headers"]
        )
        assert found.json()["key"] == entry["key"]
        absent = await r.http.post(
            search, json={"email": "who@example.com"}, headers=boss["headers"]
        )
        assert (absent.status_code, _code(absent)) == (404, "not_allowed")

        remove = f"{API}/allowed-emails/{entry['key']}"
        assert (await r.http.delete(remove, headers=boss["headers"])).status_code == 204
        again = await r.http.delete(remove, headers=boss["headers"])
        assert (again.status_code, _code(again)) == (404, "not_allowed")
        for key in ("NOT-HEX", "a" * 63, "new.person@example.com"):
            assert (
                await r.http.delete(f"{API}/allowed-emails/{key}", headers=boss["headers"])
            ).status_code in (404, 422)
        # The account made while it was allowed isn't affected.
        assert (await r.login(email="new.person@example.com")).status_code == 200

    live(mongo_uri, test)


@pytest.mark.live_service
def test_during_a_rotation_an_old_versions_entry_counts(mongo_uri):
    rotating = f'{{"2": "{PEPPER}", "1": "{OLD_PEPPER}"}}'

    async def test(r: Running) -> None:
        boss = await _account(r, "boss@example.com", role="admin")
        await r.allow("old@example.com", version=1)
        dup = await r.http.post(
            f"{API}/allowed-emails", json={"email": "old@example.com"}, headers=boss["headers"]
        )
        assert dup.status_code == 409
        found = await r.http.post(
            f"{API}/allowed-emails/search",
            json={"email": "old@example.com"},
            headers=boss["headers"],
        )
        assert found.json()["key"] == r.runtime.peppers.key("old@example.com", 1)

    live(mongo_uri, test, peppers=rotating)


@pytest.mark.live_service
def test_two_admins_adding_the_same_email_at_once(mongo_uri, monkeypatch):
    async def test(r: Running) -> None:
        boss = await _account(r, "boss@example.com", role="admin")
        real = type(r.db[ALLOWED_EMAILS]).find_one

        async def not_yet(self, *args, **kwargs):
            result = await real(self, *args, **kwargs)
            if self.name == ALLOWED_EMAILS:
                await r.allow("race@example.com")  # the other admin's insert lands now
            return result

        monkeypatch.setattr(type(r.db[ALLOWED_EMAILS]), "find_one", not_yet)
        response = await r.http.post(
            f"{API}/allowed-emails", json={"email": "race@example.com"}, headers=boss["headers"]
        )
        assert (response.status_code, _code(response)) == (409, "already_allowed")

    live(mongo_uri, test)


# ── no email in any log or audit row ───────────────────────────────────────────


@pytest.mark.live_service
def test_no_email_is_logged_or_audited(mongo_uri, caplog):
    async def test(r: Running) -> None:
        boss = await _account(r, "boss@example.com", role="admin")
        jane = await _account(r, "jane@example.com")
        headers = boss["headers"]
        with caplog.at_level("INFO"):
            await r.http.post(
                f"{API}/accounts/search", json={"email": "jane@example.com"}, headers=headers
            )
            await r.http.post(
                f"{API}/accounts/{jane['id']}/lock?location={LOCATION}", headers=headers
            )
            await r.http.patch(
                f"{API}/accounts/{jane['id']}/role?location={LOCATION}",
                json={"role": "admin"},
                headers=headers,
            )
            await r.http.post(
                f"{API}/allowed-emails", json={"email": "someone@example.com"}, headers=headers
            )
            await r.http.post(
                f"{API}/allowed-emails/search",
                json={"email": "someone@example.com"},
                headers=headers,
            )
        await r.runtime.audit.flush()
        rows = await r.db[AUDIT].find({}).to_list(None)
        assert rows and "@" not in str(rows)
        # The services' own logs, at the INFO level they run at (pymongo's DEBUG command
        # logging echoes documents, and is never on in a deployment).
        ours = [rec.getMessage() for rec in caplog.records if not rec.name.startswith("pymongo")]
        assert ours and not any("@" in message for message in ours)
        assert any("audit.role_changed" in message for message in ours)

    live(mongo_uri, test)


def test_a_failed_audit_insert_is_logged_not_raised(caplog):
    class Broken:
        def __getitem__(self, name: str) -> Any:
            return self

        async def insert_one(self, row: Any) -> None:
            raise RuntimeError("primary down")

    async def run() -> None:
        trail = AuditTrail(Broken())  # type: ignore[arg-type]
        event = AuditEvent(
            actor_id="a", actor_role="admin", permission="accounts:lock", subject_id="s",
            privileged=True, outcome="allowed", status=200, method="POST", route="/x",
            request_id=None, source_ip=None,
        )  # fmt: skip
        trail.record(event, LOCATION)
        await trail.flush()
        # A parent reading their own data isn't audited at all.
        trail.record(dataclasses.replace(event, privileged=False), LOCATION)
        await trail.flush()  # nothing pending: returns at once

    asyncio.run(run())
    assert "audit row not saved" in caplog.text
