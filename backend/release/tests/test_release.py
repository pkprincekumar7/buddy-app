"""The release endpoints (build plan 5.5). The plan's checks:
- completion when `watching` first becomes non-empty;
- regeneration clears `watching` but keeps completion;
- at most 8 items (and the page's six).
Plus the generation rules, the circle rules, races, the internal route and configuration."""

import asyncio
import json
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

import httpx
import pytest
from fastapi.routing import APIRoute
from pymongo import MongoClient
from pymongo.errors import OperationFailure
from release_testkit import (
    ADMIN,
    CHOICE,
    LOCATION,
    OTHER,
    PARENT,
    RELEASE_PRIVATE,
    Running,
    auth_header,
    claim,
    llm_client,
    progress,
    running,
    service_header,
)

from common.models import CHILD_ACCESS, GROWTH_INPUTS, JOBS, ONBOARDING_INPUTS
from common.routers import assert_every_route_has_a_policy
from release.app import generation, main
from release.app.runtime import Runtime
from release.app.store import OBSERVATIONS


def live(mongo_uri: str, test: Callable[[Running], Awaitable[None]], **options: Any) -> None:
    async def go() -> None:
        async with running(mongo_uri, **options) as r:
            await test(r)

    asyncio.run(go())


def _path(child_id: str, rest: str = "") -> str:
    return f"/api/v1/children/{child_id}/observations{rest}"


def _code(response: httpx.Response) -> str:
    return response.json()["detail"]["code"]


async def _generate(r: Running, child: str) -> None:
    started = await r.http.post(_path(child, "/generation"), headers=auth_header())
    assert started.status_code == 202, started.text
    assert await generation.process(r.runtime, llm_client(), await claim(r.db)) == "completed"


async def _watch(
    r: Running, child: str, watching: list[str], span: str = "2 weeks"
) -> httpx.Response:
    return await r.http.patch(
        _path(child), json={"watching": watching, "span": span}, headers=auth_header()
    )


async def _events(r: Running) -> list[tuple[str, int]]:
    rows = await r.db.outbox.find({}).sort("created_at", 1).to_list(None)
    return [(row["event_type"], row["version"]) for row in rows]


# ── shape ──────────────────────────────────────────────────────────────────────


def test_every_route_declares_a_policy_and_stays_on_its_app():
    assert_every_route_has_a_policy(main.app)
    assert_every_route_has_a_policy(main.internal_app)
    base = "/api/v1/children/{id}/observations"
    public = {r.path for r in main.app.routes if isinstance(r, APIRoute)}
    assert public == {"/health", base, f"{base}/generation", f"{base}/generation/{{job_id}}"}
    internal = {r.path for r in main.internal_app.routes if isinstance(r, APIRoute)}
    assert internal == {"/internal/ping", "/internal/release/children/{id}/status"}


def _public(method: str, path: str, **kwargs: Any) -> httpx.Response:
    async def go() -> httpx.Response:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app), base_url="http://r"
        ) as http:
            return await http.request(method, path, **kwargs)

    return asyncio.run(go())


def test_health_and_an_unconfigured_service():
    assert _public("GET", "/health").json() == {"status": "ok", "service": "release"}
    assert _public("GET", _path(str(uuid.uuid4())), headers=auth_header()).status_code == 503


# ── patterns, watching and completion ──────────────────────────────────────────


@pytest.mark.live_service
def test_patterns_watching_completion_and_regeneration(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        before = (await r.http.get(_path(child), headers=auth_header())).json()
        assert before == {
            "status": "not_started", "source": None, "items": [], "watching": [], "span": None,
            "started_at": None, "job_id": None, "completed_at": None,
        }  # fmt: skip
        started = await r.http.post(_path(child, "/generation"), headers=auth_header())
        assert started.status_code == 202
        again = await r.http.post(_path(child, "/generation"), headers=auth_header())
        assert again.status_code == 200 and again.json()["job_id"] == started.json()["job_id"]
        generating = (await r.http.get(_path(child), headers=auth_header())).json()
        assert (
            generating["status"] == "generating"
            and generating["job_id"] == started.json()["job_id"]
        )
        await generation.process(r.runtime, llm_client(), await claim(r.db))
        ready = (await r.http.get(_path(child), headers=auth_header())).json()
        assert ready["status"] == "ready" and ready["source"] == "llm" and ready["job_id"] is None
        items = ready["items"]
        # The page's six, every offered block cited by one; the invented choice line dropped.
        assert len(items) == 6 and {s for i in items for s in i["sources"]} == {
            "onboarding",
            "grow",
            "child",
        }
        picks = next(i for i in items if i["sources"] == ["child"])
        assert picks["notes"] == [CHOICE] and picks["icon"] == "sense"
        # Nothing watched: not done. The first pattern watched: done, once.
        assert (await _watch(r, child, [])).json()["completed_at"] is None
        watched = await _watch(r, child, [items[0]["id"], items[0]["id"], items[1]["id"]])
        body = watched.json()
        assert body["watching"] == [items[0]["id"], items[1]["id"]] and body["span"] == "2 weeks"
        assert body["started_at"] and body["completed_at"]
        doc = await r.db[OBSERVATIONS].find_one({"_id": child})
        assert await _events(r) == [("release.completed", doc["version"])]
        await _watch(r, child, [items[2]["id"]], span="1 month")
        assert len(await _events(r)) == 1
        # A new set clears the ticks (they meant the old cards) but Release stays done.
        await _generate(r, child)
        regenerated = (await r.http.get(_path(child), headers=auth_header())).json()
        assert regenerated["watching"] == [] and regenerated["completed_at"] == body["completed_at"]
        unwatched = await _watch(r, child, [])
        assert (
            unwatched.json()["completed_at"] == body["completed_at"] and len(await _events(r)) == 1
        )

    live(mongo_uri, test)


@pytest.mark.live_service
@pytest.mark.parametrize(
    ("body", "code"),
    [
        ({"watching": ["made_up"], "span": "2 weeks"}, "unknown_pattern"),
        ({"watching": [], "span": ""}, None),
        ({"watching": [], "span": "x" * 51}, None),
        ({"watching": ["a"] * 9, "span": "2 weeks"}, None),
        ({"watching": [], "span": "2 weeks", "items": []}, None),  # jobs only
        ({"watching": [], "span": "2 weeks", "started_at": "2026-01-01"}, None),  # the server's
        ({"watching": "a", "span": "2 weeks"}, None),
    ],
)
def test_invalid_watching_is_422(mongo_uri, body, code):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        response = await r.http.patch(_path(child), json=body, headers=auth_header())
        assert response.status_code == 422
        if code:
            assert _code(response) == code

    live(mongo_uri, test)


@pytest.mark.live_service
def test_generation_needs_evidence_and_reads_it_through(mongo_uri, monkeypatch):
    async def test(r: Running) -> None:
        child = r.owners.add_child()
        await r.copy(child)  # no copies of the answers or areas yet
        nothing = await r.http.post(_path(child, "/generation"), headers=auth_header())
        assert nothing.status_code == 409 and _code(nothing) == "needs_evidence"
        # grow answers with a malformed area: unavailable, never a 500 (review).
        r.owners.odd.add("grow")
        odd = await r.http.post(_path(child, "/generation"), headers=auth_header())
        assert odd.status_code == 503 and _code(odd) == "grow_unavailable"
        r.owners.odd.discard("grow")
        r.owners.complete(child, version=2)
        r.owners.complete_area(child, version=3)
        assert (
            await r.http.post(_path(child, "/generation"), headers=auth_header())
        ).status_code == 202
        assert (await r.db[ONBOARDING_INPUTS].find_one({"_id": child}))["version"] == 2
        assert (await r.db[GROWTH_INPUTS].find_one({"child_id": child}))["version"] == 3
        # Someone else's are never copied.
        theirs = r.owners.add_child()
        await r.copy(theirs)
        r.owners.complete(theirs, user_id=OTHER)
        r.owners.complete_area(theirs, user_id=OTHER)
        assert (
            await r.http.post(_path(theirs, "/generation"), headers=auth_header())
        ).status_code == 409

    live(mongo_uri, test)


@pytest.mark.live_service
def test_starts_count_against_the_llm_limit_and_report_failures(mongo_uri, monkeypatch):
    async def test(r: Running) -> None:
        first, second = await r.ready_child(), await r.ready_child()
        assert (
            await r.http.post(_path(first, "/generation"), headers=auth_header())
        ).status_code == 202
        limited = await r.http.post(_path(second, "/generation"), headers=auth_header())
        assert limited.status_code == 429 and _code(limited) == "llm_limit"

    live(mongo_uri, test, llm_hourly_limit=1)


@pytest.mark.live_service
def test_generation_failures_are_reported(mongo_uri, monkeypatch):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        real = generation.start

        async def broken(*args: Any, **kwargs: Any) -> Any:
            raise OperationFailure("primary stepped down")

        monkeypatch.setattr(generation, "start", broken)
        down = await r.http.post(_path(child, "/generation"), headers=auth_header())
        assert down.status_code == 503 and _code(down) == "generation_unavailable"

        async def lost(*args: Any, **kwargs: Any) -> tuple[str, bool]:
            job_id, _ = await real(*args, **kwargs)
            return job_id, False

        monkeypatch.setattr(generation, "start", lost)
        assert (
            await r.http.post(_path(child, "/generation"), headers=auth_header())
        ).status_code == 200
        monkeypatch.setattr(generation, "start", real)
        deleted = await r.ready_child()
        await r.db.tombstones.insert_one(
            {
                "_id": f"user:{PARENT}",
                "location": LOCATION,
                "version": 2,
                "deleted_at": datetime.now(UTC),
            }
        )
        assert (
            await r.http.post(_path(deleted, "/generation"), headers=auth_header())
        ).status_code == 404

    live(mongo_uri, test)


@pytest.mark.live_service
def test_another_childs_job_is_not_found(mongo_uri):
    async def test(r: Running) -> None:
        mine, other = await r.ready_child(), await r.ready_child()
        job = (await r.http.post(_path(other, "/generation"), headers=auth_header())).json()
        response = await r.http.get(
            _path(mine, f"/generation/{job['job_id']}"), headers=auth_header()
        )
        assert response.status_code == 404 and _code(response) == "job_not_found"
        found = await r.http.get(
            _path(other, f"/generation/{job['job_id']}"), headers=auth_header()
        )
        assert found.json()["kind"] == "observations" and found.json()["status"] == "pending"

    live(mongo_uri, test)


# ── access ─────────────────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_a_locked_copy_is_confirmed_with_transform_before_refusing(mongo_uri):
    async def test(r: Running) -> None:
        child = r.owners.add_child()
        await r.copy(
            child, progress=progress(profile=True, conversation=True, discover=True, grow=True)
        )
        locked = await r.http.get(_path(child), headers=auth_header())
        assert locked.status_code == 403 and _code(locked) == "circle_locked"
        r.owners.done.add(child)
        assert (await r.http.get(_path(child), headers=auth_header())).status_code == 200
        assert (await r.db[CHILD_ACCESS].find_one({"_id": child}))["confirmed"] == {
            "transform": True
        }
        for kind in ("down", "broken", "odd"):
            other = r.owners.add_child()
            await r.copy(other, progress=progress(profile=True))
            getattr(r.owners, kind).add("transform")
            response = await r.http.get(_path(other), headers=auth_header())
            assert response.status_code == 503 and _code(response) == "transform_unavailable"
            getattr(r.owners, kind).discard("transform")

    live(mongo_uri, test)


@pytest.mark.live_service
def test_missing_copies_are_read_through_and_others_children_not_found(mongo_uri):
    async def test(r: Running) -> None:
        child = r.owners.add_child(version=4)
        assert (await r.http.get(_path(child), headers=auth_header())).status_code == 200
        assert (await r.db[CHILD_ACCESS].find_one({"_id": child}))["version"] == 4
        purged = r.owners.add_child()
        await r.db.tombstones.insert_one(
            {
                "_id": f"child:{purged}",
                "location": LOCATION,
                "version": 3,
                "deleted_at": datetime.now(UTC),
            }
        )
        assert (await r.http.get(_path(purged), headers=auth_header())).status_code == 404
        assert (
            await r.http.get(_path(str(uuid.uuid4())), headers=auth_header())
        ).status_code == 404
        theirs = r.owners.add_child(user_id=OTHER)
        await r.copy(theirs, user_id=OTHER)
        for method, body in (
            ("GET", None),
            ("PATCH", {"watching": [], "span": "x"}),
            ("POST", None),
        ):
            rest = "/generation" if method == "POST" else ""
            response = await r.http.request(
                method, _path(theirs, rest), json=body, headers=auth_header()
            )
            assert response.status_code == 404 and _code(response) == "child_not_found"

    live(mongo_uri, test)


@pytest.mark.live_service
def test_admins_read_with_the_owners_location_and_never_write(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child(progress=progress(profile=True))  # no unlock check for admins
        admin = auth_header(ADMIN)
        no_location = await r.http.get(_path(child), headers=admin)
        assert no_location.status_code == 422 and _code(no_location) == "location_required"
        read = await r.http.get(_path(child), params={"location": LOCATION}, headers=admin)
        assert read.status_code == 200 and read.json()["status"] == "not_started"
        unknown = _path(str(uuid.uuid4()))
        missing = await r.http.get(unknown, params={"location": LOCATION}, headers=admin)
        assert missing.status_code == 404
        # Refused reads are audited too: a probe for ids or locations leaves a trace.
        audited = [(e.subject_id, e.outcome, e.status) for e in r.audit if e.privileged]
        assert audited == [(None, "denied", 422), (PARENT, "allowed", 200), (None, "denied", 404)]
        assert (
            await r.http.patch(_path(child), json={"watching": [], "span": "x"}, headers=admin)
        ).status_code == 404

    live(mongo_uri, test)


# ── races ──────────────────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_two_first_saves_at_once_make_one_document(mongo_uri, monkeypatch):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        real = main.is_tombstoned
        mongo: MongoClient[dict[str, Any]] = MongoClient(mongo_uri)
        raced: list[bool] = []

        async def other_save_first(*args: Any, **kwargs: Any) -> bool:
            if not raced:
                raced.append(True)
                now = datetime.now(UTC)
                mongo[r.db.name][OBSERVATIONS].insert_one(
                    {
                        "_id": child,
                        "user_id": PARENT,
                        "child_id": child,
                        "location": LOCATION,
                        "status": "not_started",
                        "version": 1,
                        "created_at": now,
                        "updated_at": now,
                        "schema_version": 1,
                    }  # fmt: skip
                )
            return await real(*args, **kwargs)

        monkeypatch.setattr(main, "is_tombstoned", other_save_first)
        saved = await _watch(r, child, [], span="1 week")
        mongo.close()
        assert saved.status_code == 200 and saved.json()["span"] == "1 week"
        assert (await r.db[OBSERVATIONS].find_one({}))["version"] == 2

    live(mongo_uri, test)


@pytest.mark.live_service
def test_observations_that_keep_changing_are_409_and_a_deletion_meanwhile_404(
    mongo_uri, monkeypatch
):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        await _watch(r, child, [])
        real = main.is_tombstoned

        async def changed_each_time(*args: Any, **kwargs: Any) -> bool:
            await r.db[OBSERVATIONS].update_one({}, {"$inc": {"version": 1}})
            return await real(*args, **kwargs)

        monkeypatch.setattr(main, "is_tombstoned", changed_each_time)
        response = await _watch(r, child, [])
        assert response.status_code == 409 and _code(response) == "observations_changed"

        async def deleted(*args: Any, **kwargs: Any) -> bool:
            return True

        monkeypatch.setattr(main, "is_tombstoned", deleted)
        assert (await _watch(r, child, [])).status_code == 404

    live(mongo_uri, test)


# ── the internal route ─────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_the_connect_visit_confirms_release(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        status = f"/internal/release/children/{child}/status"
        params = {"location": LOCATION}
        assert (await r.internal.get(status, params=params, headers=service_header())).json() == {
            "completed": False
        }
        await _generate(r, child)
        items = (await r.http.get(_path(child), headers=auth_header())).json()["items"]
        await _watch(r, child, [items[0]["id"]])
        assert (await r.internal.get(status, params=params, headers=service_header())).json() == {
            "completed": True
        }
        assert (
            await r.internal.get(status, params=params, headers=service_header("grow"))
        ).status_code == 403
        assert (await r.internal.get(status, params=params)).status_code == 401
        assert (await r.internal.get("/internal/ping")).json()["service"] == "release"

    live(mongo_uri, test)


# ── limits and configuration ───────────────────────────────────────────────────


@pytest.mark.live_service
def test_watching_is_limited_to_20_a_minute(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        statuses = [(await _watch(r, child, [])).status_code for _ in range(21)]
        assert statuses.count(429) == 1 and statuses[-1] == 429

    live(mongo_uri, test)


def test_no_cloudwatch_means_no_job_metrics():
    main._start_reporting(SimpleNamespace(cloudwatch=None))  # type: ignore[arg-type]
    assert main._reporting is None
    asyncio.run(main._stop_reporting())


def _env(**extra: str) -> dict[str, str]:
    from release_testkit import JWT_PUBLIC, KID

    return {
        "MONGODB_DB_NAME": "x",
        "JWT_PUBLIC_KEYS": json.dumps({KID: JWT_PUBLIC}),
        "INTERNAL_SIGNING_KID": "r1",
        "INTERNAL_SIGNING_KEY": RELEASE_PRIVATE,
        "INTERNAL_PUBLIC_KEYS": "{}",
        **extra,
    }


def test_from_env_builds_every_part(fake_aws_credentials, monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    for name in ("REDIS_URL", "AWS_ENDPOINT_URL"):
        monkeypatch.delenv(name, raising=False)
    plain = Runtime.from_env(_env(MONGODB_URI="mongodb://x"))
    assert plain.settings.service_name == "release" and plain.locations() is None
    asyncio.run(plain.aclose())
    deployed = Runtime.from_env(
        _env(MONGODB_URI="mongodb://x", APP_ENV="dev", AWS_ENDPOINT_URL="http://localhost:5050")
    )
    assert "in" in (deployed.locations() or [])
    asyncio.run(deployed.aclose())


@pytest.mark.live_service
def test_the_lifespan_shares_one_runtime_and_reports_job_metrics(
    mongo_uri, monkeypatch, fake_aws_credentials
):
    db_name = f"release_env_{uuid.uuid4().hex[:8]}"
    env = _env(
        MONGODB_URI=mongo_uri, MONGODB_DB_NAME=db_name, AWS_ENDPOINT_URL="http://127.0.0.1:9"
    )
    for key, value in env.items():
        monkeypatch.setenv(key, value)

    async def run() -> None:
        async with (
            main.app.router.lifespan_context(main.app),
            main.internal_app.router.lifespan_context(main.internal_app),
        ):
            assert main.app.state.runtime is main.internal_app.state.runtime is not None
            assert main._reporting is not None
        assert main.app.state.runtime is None and main._reporting is None
        from pymongo import AsyncMongoClient

        client: AsyncMongoClient[dict[str, Any]] = AsyncMongoClient(mongo_uri)
        assert {
            "observations",
            "jobs",
            "child_access",
            "onboarding_inputs",
            "growth_inputs",
        } <= set(await client[db_name].list_collection_names())
        await client.drop_database(db_name)
        await client.close()

    asyncio.run(run())
    monkeypatch.delenv("MONGODB_URI")

    async def unconfigured() -> None:
        async with main.app.router.lifespan_context(main.app):
            assert main.app.state.runtime is None

    asyncio.run(unconfigured())


@pytest.mark.live_service
def test_a_job_counts_for_the_jobs_collection(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        await r.http.post(_path(child, "/generation"), headers=auth_header())
        assert await r.db[JOBS].count_documents({"type": "generate_observations"}) == 1

    live(mongo_uri, test)


@pytest.mark.live_service
@pytest.mark.parametrize("bad", ["abc%3Flocation%3Devil%26x%3D", "abc%23", "not-a-uuid"])
def test_a_child_id_must_be_a_uuid(mongo_uri, bad):
    # Found by the Phase 5-6 review: `%3F` decodes into the id, which went into the
    # internal call's URL and could rewrite its query.
    async def test(r: Running) -> None:
        response = await r.http.get(_path(bad), headers=auth_header())
        assert response.status_code == 422

    live(mongo_uri, test)
