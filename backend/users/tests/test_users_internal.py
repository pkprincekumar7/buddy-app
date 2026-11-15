"""users' internal API (port 8001): `PUT` and `DELETE /internal/users/{id}`, auth only
(docs/auth-users-split-api.md, registration saga 10.1)."""

import asyncio
import uuid
from collections.abc import Awaitable, Callable

import pytest
from users_testkit import (
    LOCATION,
    PARENT,
    Running,
    create_profile,
    running,
    service_header,
)

from common.events import tombstone_key, write_tombstone
from users.app import main
from users.app.store import USERS


def live(mongo_uri: str, test: Callable[[Running], Awaitable[None]]) -> None:
    async def go() -> None:
        async with running(mongo_uri) as r:
            await test(r)

    asyncio.run(go())


@pytest.mark.live_service
def test_a_put_creates_the_profile_with_default_preferences(mongo_uri):
    async def test(r: Running) -> None:
        response = await create_profile(r, middle_name="  ", address_line_three="Town")
        assert response.status_code == 201
        assert response.json()["middle_name"] is None
        doc = await r.runtime.db[USERS].find_one({"_id": PARENT})
        assert doc is not None
        assert (doc["location"], doc["version"], doc["schema_version"]) == (LOCATION, 1, 1)
        assert doc["preferences"] == {"tts_enabled": True}
        assert doc["address_line_three"] == "Town" and doc["middle_name"] is None
        assert "email" not in doc and "full_name" not in doc

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_retry_changes_nothing_and_a_new_body_replaces_the_profile(mongo_uri):
    async def test(r: Running) -> None:
        assert (await create_profile(r)).status_code == 201
        retry = await create_profile(r)
        assert retry.status_code == 200
        doc = await r.runtime.db[USERS].find_one({"_id": PARENT})
        assert doc is not None and doc["version"] == 1
        replaced = await create_profile(r, first_name="Janet", last_name=None)
        assert replaced.status_code == 200
        assert (replaced.json()["first_name"], replaced.json()["last_name"]) == ("Janet", None)
        doc = await r.runtime.db[USERS].find_one({"_id": PARENT})
        assert doc is not None and doc["version"] == 2
        assert doc["preferences"] == {"tts_enabled": True}  # untouched by a replace

    live(mongo_uri, test)


@pytest.mark.live_service
def test_the_location_never_changes(mongo_uri):
    async def test(r: Running) -> None:
        await create_profile(r)
        response = await create_profile(r, location="us")
        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "location_mismatch"
        doc = await r.runtime.db[USERS].find_one({"_id": PARENT})
        assert doc is not None and doc["location"] == LOCATION

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_deleted_accounts_profile_cant_come_back(mongo_uri):
    async def test(r: Running) -> None:
        await write_tombstone(
            r.runtime.db, tombstone_key("user", PARENT), location=LOCATION, version=3
        )
        response = await create_profile(r)
        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "profile_deleted"
        assert await r.runtime.db[USERS].find_one({"_id": PARENT}) is None

    live(mongo_uri, test)


@pytest.mark.live_service
def test_concurrent_creates_make_one_profile(mongo_uri):
    async def test(r: Running) -> None:
        # Both touch the user's guard in their transaction: one runs again and finds the
        # other's profile.
        first, second = await asyncio.gather(create_profile(r), create_profile(r))
        assert sorted([first.status_code, second.status_code]) == [200, 201]
        assert await r.runtime.db[USERS].count_documents({"_id": PARENT}) == 1

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_put_after_the_undo_delete_is_refused(mongo_uri):
    # Auth timed out on its PUT and undid the registration (DELETE, 204); the PUT, still
    # running in users, must not create the profile afterwards (review).
    async def test(r: Running) -> None:
        path = f"/internal/users/{PARENT}"
        undo = await r.internal.delete(
            path, params={"location": LOCATION}, headers=service_header()
        )
        assert undo.status_code == 204
        late = await create_profile(r)
        assert (late.status_code, late.json()["detail"]["code"]) == (409, "profile_deleted")
        assert await r.runtime.db[USERS].find_one({"_id": PARENT}) is None

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_delete_during_a_slow_put_leaves_no_profile(mongo_uri, monkeypatch):
    # The PUT holds the guard (written, not committed); the DELETE's tombstone touches it
    # too, so the DELETE conflicts and runs again once the PUT commits, then removes it.
    async def test(r: Running) -> None:
        real_check, real_stone = main.is_tombstoned, main.write_tombstone
        path = f"/internal/users/{PARENT}"
        undo: dict[str, asyncio.Task] = {}
        stone_tries: list[int] = []

        async def slow(db, keys, session=None, **kwargs):
            # The check inside the PUT's transaction, right after write_guards.
            if session is not None and not undo:
                undo["task"] = asyncio.create_task(
                    r.internal.delete(path, params={"location": LOCATION}, headers=service_header())
                )
                await asyncio.sleep(0.3)
            return await real_check(db, keys, session, **kwargs)

        async def counted(*args, **kwargs):
            stone_tries.append(0)
            return await real_stone(*args, **kwargs)

        monkeypatch.setattr(main, "is_tombstoned", slow)
        monkeypatch.setattr(main, "write_tombstone", counted)
        put = await create_profile(r)
        deleted = await undo["task"]
        # The PUT went first and created the profile; the DELETE answered after it.
        assert (put.status_code, deleted.status_code) == (201, 204)
        assert len(stone_tries) >= 2, "the DELETE didn't conflict with the PUT's guard"
        assert await r.runtime.db[USERS].find_one({"_id": PARENT}) is None
        assert await r.runtime.db.tombstones.find_one({"_id": f"user:{PARENT}"}) is not None
        monkeypatch.setattr(main, "is_tombstoned", real_check)
        assert (await create_profile(r)).status_code == 409

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_put_during_a_slow_delete_is_refused(mongo_uri, monkeypatch):
    # The other order: the DELETE holds the guard with its tombstone (not committed); the
    # PUT passed its read before the transaction, conflicts on the guard, and run again
    # sees the tombstone.
    async def test(r: Running) -> None:
        real_stone, real_guards = main.write_tombstone, main.write_guards
        put: dict[str, asyncio.Task] = {}
        guard_tries: list[int] = []

        async def slow(*args, **kwargs):
            await real_stone(*args, **kwargs)
            if not put:
                put["task"] = asyncio.create_task(create_profile(r))
                await asyncio.sleep(0.3)

        async def counted(*args, **kwargs):
            guard_tries.append(0)
            return await real_guards(*args, **kwargs)

        monkeypatch.setattr(main, "write_tombstone", slow)
        monkeypatch.setattr(main, "write_guards", counted)
        deleted = await r.internal.delete(
            f"/internal/users/{PARENT}", params={"location": LOCATION}, headers=service_header()
        )
        late = await put["task"]
        assert deleted.status_code == 204
        assert (late.status_code, late.json()["detail"]["code"]) == (409, "profile_deleted")
        assert len(guard_tries) >= 2, "the PUT didn't conflict with the DELETE's guard"
        assert await r.runtime.db[USERS].find_one({"_id": PARENT}) is None

    live(mongo_uri, test)


@pytest.mark.live_service
def test_only_auth_may_call(mongo_uri):
    async def test(r: Running) -> None:
        path = f"/internal/users/{PARENT}"
        body = {"first_name": "Jane", "location": LOCATION}
        grow = service_header("grow")
        assert (await r.internal.put(path, json=body, headers=grow)).status_code == 403
        assert (await r.internal.put(path, json=body)).status_code == 401
        assert (
            await r.internal.delete(path, params={"location": LOCATION}, headers=grow)
        ).status_code == 403
        assert await r.runtime.db[USERS].count_documents({}) == 0
        assert (await r.internal.get("/internal/ping")).json() == {
            "status": "ok",
            "service": "users",
        }

    live(mongo_uri, test)


@pytest.mark.live_service
@pytest.mark.parametrize(
    "path_id,body",
    [
        ("not-a-uuid", {"first_name": "Jane", "location": LOCATION}),
        (None, {"location": LOCATION}),
        (None, {"first_name": "", "location": LOCATION}),
        (None, {"first_name": "Jane"}),
        (None, {"first_name": "Jane", "location": "Bad Zone"}),
        (None, {"first_name": "Jane", "location": LOCATION, "email": "a@b.c"}),
        (None, {"first_name": "Jane", "location": LOCATION, "address_line_one": "x" * 201}),
    ],
)
def test_an_invalid_put_is_422(mongo_uri, path_id, body):
    async def test(r: Running) -> None:
        user_id = path_id or PARENT
        response = await r.internal.put(
            f"/internal/users/{user_id}", json=body, headers=service_header()
        )
        assert response.status_code == 422
        assert await r.runtime.db[USERS].count_documents({}) == 0

    live(mongo_uri, test)


@pytest.mark.live_service
def test_delete_removes_the_profile_and_is_safe_to_repeat(mongo_uri):
    async def test(r: Running) -> None:
        await create_profile(r)
        path = f"/internal/users/{PARENT}"
        # The wrong zone deletes nothing.
        wrong = await r.internal.delete(path, params={"location": "us"}, headers=service_header())
        assert wrong.status_code == 204
        assert await r.runtime.db[USERS].count_documents({"_id": PARENT}) == 1
        for _ in range(2):
            response = await r.internal.delete(
                path, params={"location": LOCATION}, headers=service_header()
            )
            assert response.status_code == 204 and response.content == b""
        assert await r.runtime.db[USERS].count_documents({"_id": PARENT}) == 0
        # A tombstone (ids only) so a late PUT can't bring it back; but it isn't an account
        # deletion: no event.
        stone = await r.runtime.db.tombstones.find_one({"_id": f"user:{PARENT}"})
        assert stone is not None and stone["location"] == LOCATION and stone["version"] == 2
        assert await r.runtime.db.outbox.count_documents({}) == 0
        assert (await r.internal.delete(path, headers=service_header())).status_code == 422
        bad = await r.internal.delete(
            f"/internal/users/{uuid.uuid4().hex}",
            params={"location": LOCATION},
            headers=service_header(),
        )
        assert bad.status_code == 422

    live(mongo_uri, test)
