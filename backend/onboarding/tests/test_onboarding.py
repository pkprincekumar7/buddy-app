"""The onboarding endpoints (build plan 5.1). The plan's checks:
- the unlock via children's read-through (the exception to "don't overwrite");
- `conversation_completed` published once;
- identical answers publish nothing.
Plus ownership, validation, races, the internal routes and configuration."""

import asyncio
import json
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

import httpx
import pytest
from fastapi.routing import APIRoute
from onboarding_testkit import (
    ADMIN,
    ANSWERS,
    LOCATION,
    ONBOARDING_PRIVATE,
    OTHER,
    PARENT,
    Running,
    auth_header,
    progress,
    running,
    service_header,
)
from pymongo import MongoClient

from common.models import CHILD_ACCESS
from common.routers import assert_every_route_has_a_policy
from onboarding.app import main
from onboarding.app.runtime import Runtime
from onboarding.app.store import CONVERSATIONS


def live(mongo_uri: str, test: Callable[[Running], Awaitable[None]]) -> None:
    async def go() -> None:
        async with running(mongo_uri) as r:
            await test(r)

    asyncio.run(go())


def _path(child_id: str) -> str:
    return f"/api/v1/children/{child_id}/onboarding"


def _code(response: httpx.Response) -> str:
    return response.json()["detail"]["code"]


async def _events(r: Running, child_id: str) -> list[tuple[str, int]]:
    rows = await r.db.outbox.find({"aggregate_id": child_id}).sort("version", 1).to_list(None)
    return [(row["event_type"], row["version"]) for row in rows]


async def _put(r: Running, child_id: str, **changes: Any) -> httpx.Response:
    return await r.http.put(_path(child_id), json={**ANSWERS, **changes}, headers=auth_header())


# ── shape ──────────────────────────────────────────────────────────────────────


def test_every_route_declares_a_policy_and_stays_on_its_app():
    assert_every_route_has_a_policy(main.app)
    assert_every_route_has_a_policy(main.internal_app)
    public = {r.path for r in main.app.routes if isinstance(r, APIRoute)}
    assert public == {"/health", "/api/v1/children/{id}/onboarding"}
    internal = {r.path for r in main.internal_app.routes if isinstance(r, APIRoute)}
    assert internal == {
        "/internal/ping",
        "/internal/onboarding/children/{id}/status",
        "/internal/onboarding/children/{id}/answers",
    }


def _public(method: str, path: str, **kwargs: Any) -> httpx.Response:
    async def go() -> httpx.Response:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app), base_url="http://o"
        ) as http:
            return await http.request(method, path, **kwargs)

    return asyncio.run(go())


def test_health_and_an_unconfigured_service():
    assert _public("GET", "/health").json() == {"status": "ok", "service": "onboarding"}
    assert _public("GET", _path(str(uuid.uuid4())), headers=auth_header()).status_code == 503


# ── the conversation ───────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_the_first_save_completes_the_conversation_and_publishes_once(mongo_uri):
    async def test(r: Running) -> None:
        child = r.children.add()
        await r.copy(child)
        before = await r.http.get(_path(child), headers=auth_header())
        assert before.json() == {
            "status": "not_started", "child_name": "Aarav", "answers": {}, "completed_at": None,
        }  # fmt: skip
        saved = await _put(r, child)
        assert saved.status_code == 201
        body = saved.json()
        assert body["status"] == "completed" and body["answers"] == ANSWERS
        assert body["completed_at"] is not None
        assert (await r.http.get(_path(child), headers=auth_header())).json() == body
        assert await _events(r, child) == [("onboarding.conversation_completed", 1)]
        row = await r.db.outbox.find_one({"aggregate_id": child})
        assert row["payload"] == {"user_id": PARENT, **ANSWERS} and row["location"] == LOCATION
        doc = await r.db[CONVERSATIONS].find_one({"_id": child})
        assert (doc["user_id"], doc["child_id"], doc["version"]) == (PARENT, child, 1)
        assert r.children.calls == []  # the copy answered everything

    live(mongo_uri, test)


@pytest.mark.live_service
def test_identical_answers_publish_nothing_and_a_change_publishes_an_update(mongo_uri):
    async def test(r: Running) -> None:
        child = r.children.add()
        await r.copy(child)
        first = await _put(r, child)
        again = await _put(r, child)
        assert again.status_code == 200 and again.json() == first.json()
        assert await _events(r, child) == [("onboarding.conversation_completed", 1)]
        changed = await _put(r, child, hobbies=["drawing", "football"])
        assert changed.status_code == 200
        assert changed.json()["answers"]["hobbies"] == ["drawing", "football"]
        # completed_at stays: the conversation was finished the first time.
        assert changed.json()["completed_at"] == first.json()["completed_at"]
        assert await _events(r, child) == [
            ("onboarding.conversation_completed", 1),
            ("onboarding.answers_updated", 2),
        ]
        update = await r.db.outbox.find_one({"event_type": "onboarding.answers_updated"})
        assert update["payload"]["hobbies"] == ["drawing", "football"]

    live(mongo_uri, test)


@pytest.mark.live_service
@pytest.mark.parametrize(
    "body",
    [
        {k: v for k, v in ANSWERS.items() if k != "energy_level"},  # missing
        {**ANSWERS, "energy_level": None},
        {**ANSWERS, "onboarding_phase": 3},  # unknown: the phase is gone
        {**ANSWERS, "strengths": []},
        {**ANSWERS, "strengths": ["x"] * 21},
        {**ANSWERS, "hobbies": ["x" * 201]},
        {**ANSWERS, "thinking_pattern": "x" * 501},
        {**ANSWERS, "thinking_pattern": "   "},
        {**ANSWERS, "energy_level": 3},  # strict: no coercion
    ],
)
def test_invalid_answers_are_422(mongo_uri, body):
    async def test(r: Running) -> None:
        child = r.children.add()
        await r.copy(child)
        response = await r.http.put(_path(child), json=body, headers=auth_header())
        assert response.status_code == 422
        assert await r.db[CONVERSATIONS].count_documents({}) == 0

    live(mongo_uri, test)


# ── access ─────────────────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_a_missing_copy_is_read_through_and_kept(mongo_uri):
    async def test(r: Running) -> None:
        child = r.children.add(version=4)
        assert (await r.http.get(_path(child), headers=auth_header())).status_code == 200
        copy = await r.db[CHILD_ACCESS].find_one({"_id": child})
        assert copy["version"] == 4 and copy["progress"]["profile"] is True
        assert copy["user_id"] == PARENT and copy["name"] == "Aarav"
        await r.http.get(_path(child), headers=auth_header())
        assert r.children.calls == [child]  # once: the copy answers from now on
        # A child children doesn't have is not found.
        missing = await r.http.get(_path(str(uuid.uuid4())), headers=auth_header())
        assert missing.status_code == 404 and _code(missing) == "child_not_found"

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_purged_child_is_not_found_without_asking(mongo_uri):
    async def test(r: Running) -> None:
        child = r.children.add()
        await r.db.tombstones.insert_one(
            {
                "_id": f"child:{child}",
                "location": LOCATION,
                "version": 3,
                "deleted_at": datetime.now(UTC),
            }
        )
        assert (await r.http.get(_path(child), headers=auth_header())).status_code == 404
        assert r.children.calls == []

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_locked_copy_is_confirmed_with_children_before_refusing(mongo_uri):
    async def test(r: Running) -> None:
        # The profile was just finished: children knows, the copy doesn't yet.
        child = r.children.add(version=2)
        await r.copy(child, progress=progress(profile=False))
        assert (await r.http.get(_path(child), headers=auth_header())).status_code == 200
        copy = await r.db[CHILD_ACCESS].find_one({"_id": child})
        # Stored as children's copy, with its version (12.4's exception), not a flag.
        assert copy["progress"]["profile"] is True and copy["version"] == 2
        assert "confirmed" not in copy
        # Really locked: children says no too.
        locked = r.children.add(profile=False)
        await r.copy(locked, progress=progress(profile=False))
        refused = await r.http.get(_path(locked), headers=auth_header())
        assert refused.status_code == 403 and _code(refused) == "circle_locked"
        put = await _put(r, locked)
        assert put.status_code == 403 and await r.db[CONVERSATIONS].count_documents({}) == 0

    live(mongo_uri, test)


@pytest.mark.live_service
def test_children_unreachable_is_503_never_a_wrong_answer(mongo_uri):
    async def test(r: Running) -> None:
        child = r.children.add()
        await r.copy(child, progress=progress(profile=False))
        unknown = r.children.add()
        for mode in ("down", "error"):
            r.children.mode = mode
            for target in (child, unknown):
                response = await r.http.get(_path(target), headers=auth_header())
                assert response.status_code == 503, (mode, target)
                assert response.headers["retry-after"] == "2"
                assert _code(response) == "children_unavailable"

    live(mongo_uri, test)


@pytest.mark.live_service
def test_someone_elses_or_a_deleted_child_is_not_found(mongo_uri):
    async def test(r: Running) -> None:
        theirs = r.children.add(user_id=OTHER)
        await r.copy(theirs, user_id=OTHER)
        deleted = r.children.add()
        await r.copy(deleted, is_deleted=True)
        for child in (theirs, deleted):
            assert (await r.http.get(_path(child), headers=auth_header())).status_code == 404
            assert (await _put(r, child)).status_code == 404
        # Deleted (or purged) while the copy still said "locked".
        gone = r.children.add(is_deleted=True)
        await r.copy(gone, progress=progress(profile=False))
        assert (await r.http.get(_path(gone), headers=auth_header())).status_code == 404
        purged = str(uuid.uuid4())
        await r.copy(purged, progress=progress(profile=False))
        assert (await r.http.get(_path(purged), headers=auth_header())).status_code == 404
        # Read through to another parent's child.
        other = r.children.add(user_id=OTHER)
        assert (await r.http.get(_path(other), headers=auth_header())).status_code == 404

    live(mongo_uri, test)


@pytest.mark.live_service
def test_admins_read_with_the_owners_location_and_never_write(mongo_uri):
    async def test(r: Running) -> None:
        child = r.children.add()
        await r.copy(child, progress=progress(profile=False))  # no unlock check for admins
        admin = auth_header(ADMIN)
        no_location = await r.http.get(_path(child), headers=admin)
        assert no_location.status_code == 422 and _code(no_location) == "location_required"
        read = await r.http.get(_path(child), params={"location": LOCATION}, headers=admin)
        assert read.status_code == 200 and read.json()["status"] == "not_started"
        assert [(e.subject_id, e.outcome) for e in r.audit if e.privileged] == [(PARENT, "allowed")]
        assert (
            await r.http.put(_path(child), json=ANSWERS, headers=admin)
        ).status_code == 404  # not theirs

    live(mongo_uri, test)


# ── races ──────────────────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_two_first_saves_at_once_make_one_conversation(mongo_uri, monkeypatch):
    async def test(r: Running) -> None:
        child = r.children.add()
        await r.copy(child)
        real = main.is_tombstoned
        mongo: MongoClient[dict[str, Any]] = MongoClient(mongo_uri)
        raced: list[bool] = []

        async def other_save_first(*args: Any, **kwargs: Any) -> bool:
            if not raced:  # another tab's save commits between our read and our insert
                raced.append(True)
                from onboarding.app.store import new_conversation

                mongo[r.db.name][CONVERSATIONS].insert_one(
                    new_conversation(child, PARENT, LOCATION, ANSWERS, datetime.now(UTC))
                )
            return await real(*args, **kwargs)

        monkeypatch.setattr(main, "is_tombstoned", other_save_first)
        response = await _put(r, child, energy_level="calm")
        mongo.close()
        # Decided again against the other save: an update of it, not a second conversation.
        assert response.status_code == 200 and response.json()["answers"]["energy_level"] == "calm"
        assert await r.db[CONVERSATIONS].count_documents({}) == 1
        assert ("onboarding.answers_updated", 2) in await _events(r, child)

    live(mongo_uri, test)


@pytest.mark.live_service
def test_answers_that_keep_changing_are_409_and_a_deletion_meanwhile_404(mongo_uri, monkeypatch):
    async def test(r: Running) -> None:
        child = r.children.add()
        await r.copy(child)
        await _put(r, child)
        real = main.is_tombstoned

        async def changed_each_time(*args: Any, **kwargs: Any) -> bool:
            await r.db[CONVERSATIONS].update_one({"_id": child}, {"$inc": {"version": 1}})
            return await real(*args, **kwargs)

        monkeypatch.setattr(main, "is_tombstoned", changed_each_time)
        response = await _put(r, child, energy_level="calm")
        assert response.status_code == 409 and _code(response) == "conversation_changed"

        async def deleted(*args: Any, **kwargs: Any) -> bool:
            return True

        monkeypatch.setattr(main, "is_tombstoned", deleted)
        assert (await _put(r, child, energy_level="calm")).status_code == 404

    live(mongo_uri, test)


@pytest.mark.live_service
def test_saving_is_limited_to_10_a_minute(mongo_uri):
    async def test(r: Running) -> None:
        child = r.children.add()
        await r.copy(child)
        statuses = [(await _put(r, child)).status_code for _ in range(11)]
        assert statuses[-1] == 429 and statuses.count(429) == 1

    live(mongo_uri, test)


# ── internal routes ────────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_discover_confirms_completion_and_circles_read_the_answers(mongo_uri):
    async def test(r: Running) -> None:
        child = r.children.add()
        await r.copy(child)
        status = f"/internal/onboarding/children/{child}/status"
        answers = f"/internal/onboarding/children/{child}/answers"
        params = {"location": LOCATION}
        before = await r.internal.get(status, params=params, headers=service_header())
        assert before.json() == {"completed": False}
        assert (
            await r.internal.get(answers, params=params, headers=service_header("grow"))
        ).status_code == 404
        await _put(r, child)
        assert (await r.internal.get(status, params=params, headers=service_header())).json() == {
            "completed": True
        }
        copy = await r.internal.get(answers, params=params, headers=service_header("grow"))
        assert copy.json() == {
            "child_id": child, "user_id": PARENT, "location": LOCATION, **ANSWERS, "version": 1,
        }  # fmt: skip
        other_zone = await r.internal.get(
            status, params={"location": "us"}, headers=service_header()
        )
        assert other_zone.json() == {"completed": False}
        # Only discover confirms; children reads neither; a token is required.
        assert (
            await r.internal.get(status, params=params, headers=service_header("grow"))
        ).status_code == 403
        assert (
            await r.internal.get(answers, params=params, headers=service_header("children"))
        ).status_code == 403
        assert (await r.internal.get(status, params=params)).status_code == 401
        assert (await r.internal.get("/internal/ping")).json()["service"] == "onboarding"

    live(mongo_uri, test)


# ── configuration ──────────────────────────────────────────────────────────────


def _env(**extra: str) -> dict[str, str]:
    from onboarding_testkit import JWT_PUBLIC, KID

    return {
        "MONGODB_DB_NAME": "x",
        "JWT_PUBLIC_KEYS": json.dumps({KID: JWT_PUBLIC}),
        "INTERNAL_SIGNING_KID": "o1",
        "INTERNAL_SIGNING_KEY": ONBOARDING_PRIVATE,
        "INTERNAL_PUBLIC_KEYS": "{}",
        **extra,
    }


def test_from_env_builds_every_part(fake_aws_credentials, monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    for name in ("REDIS_URL", "AWS_ENDPOINT_URL"):
        monkeypatch.delenv(name, raising=False)
    plain = Runtime.from_env(_env(MONGODB_URI="mongodb://x"))
    assert plain.settings.service_name == "onboarding" and plain.cache is None
    asyncio.run(plain.aclose())
    local = Runtime.from_env(
        _env(MONGODB_URI="mongodb://x", AWS_ENDPOINT_URL="http://localhost:5050")
    )
    assert local.sns.meta.endpoint_url == "http://localhost:5050"
    asyncio.run(local.aclose())


@pytest.mark.live_service
def test_the_lifespan_shares_one_runtime(mongo_uri, monkeypatch, fake_aws_credentials):
    db_name = f"onboarding_env_{uuid.uuid4().hex[:8]}"
    for key, value in _env(MONGODB_URI=mongo_uri, MONGODB_DB_NAME=db_name).items():
        monkeypatch.setenv(key, value)

    async def run() -> None:
        async with (
            main.app.router.lifespan_context(main.app),
            main.internal_app.router.lifespan_context(main.internal_app),
        ):
            assert main.app.state.runtime is main.internal_app.state.runtime is not None
        assert main.app.state.runtime is None
        from pymongo import AsyncMongoClient

        client: AsyncMongoClient[dict[str, Any]] = AsyncMongoClient(mongo_uri)
        assert {"conversations", "child_access", "outbox", "tombstones"} <= set(
            await client[db_name].list_collection_names()
        )
        await client.drop_database(db_name)
        await client.close()

    asyncio.run(run())
    monkeypatch.delenv("MONGODB_URI")

    async def unconfigured() -> None:
        async with main.app.router.lifespan_context(main.app):
            assert main.app.state.runtime is None

    asyncio.run(unconfigured())
