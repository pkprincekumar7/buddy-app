"""users' internal API (port 8001): `PUT` and `DELETE /internal/users/{id}`, auth only
(docs/auth-users-split-api.md, registration saga 10.1)."""

import asyncio
import uuid
from collections.abc import Awaitable, Callable

import pytest
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import DuplicateKeyError
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
def test_a_concurrent_create_is_answered_as_already_existing(mongo_uri, monkeypatch):
    async def test(r: Running) -> None:
        real = main.is_tombstoned

        async def another_retry_wins(db, keys):
            # The other request inserts between this one's read and its insert.
            monkeypatch.setattr(main, "is_tombstoned", real)
            assert (await create_profile(r)).status_code == 201
            return await real(db, keys)

        monkeypatch.setattr(main, "is_tombstoned", another_retry_wins)
        response = await create_profile(r)
        assert response.status_code == 200
        assert await r.runtime.db[USERS].count_documents({"_id": PARENT}) == 1

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_profile_created_and_deleted_concurrently_asks_for_a_retry(mongo_uri, monkeypatch):
    async def test(r: Running) -> None:
        async def duplicate(*args, **kwargs):
            # Another request inserted it, and a DELETE removed it, before this re-read.
            raise DuplicateKeyError("E11000 duplicate key")

        monkeypatch.setattr(AsyncCollection, "insert_one", duplicate)
        response = await create_profile(r)
        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "profile_conflict"

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
        # Undoing a registration isn't an account deletion: no tombstone, no event.
        assert await r.runtime.db.tombstones.count_documents({}) == 0
        assert await r.runtime.db.outbox.count_documents({}) == 0
        assert (await r.internal.delete(path, headers=service_header())).status_code == 422
        bad = await r.internal.delete(
            f"/internal/users/{uuid.uuid4().hex}",
            params={"location": LOCATION},
            headers=service_header(),
        )
        assert bad.status_code == 422

    live(mongo_uri, test)
