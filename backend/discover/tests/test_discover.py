"""The discover endpoints (build plan 5.2). The plan's checks:
- the automatic start and the endpoint racing create one job (test_discover_generation.py);
- `viewed` refused unless `ready`;
- `view_model` matches today's adapter output (test_personality.py).
Plus the circle rules, the generation endpoints, the internal routes and configuration."""

import asyncio
import json
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

import httpx
import pytest
from discover_testkit import (
    ADMIN,
    DISCOVER_PRIVATE,
    LLM_ANSWER,
    LOCATION,
    OTHER,
    PARENT,
    Running,
    auth_header,
    claim,
    llm_client,
    progress,
    running,
    service_header,
)
from fastapi.routing import APIRoute
from pymongo.errors import OperationFailure

from common.generation import jobs
from common.models import CHILD_ACCESS, JOBS, ONBOARDING_INPUTS
from common.routers import assert_every_route_has_a_policy
from discover.app import generation, main
from discover.app.personality import summary, view_model
from discover.app.runtime import Runtime
from discover.app.store import PERSONALITIES


def live(mongo_uri: str, test: Callable[[Running], Awaitable[None]], **options: Any) -> None:
    async def go() -> None:
        async with running(mongo_uri, **options) as r:
            await test(r)

    asyncio.run(go())


def _path(child_id: str, rest: str = "") -> str:
    return f"/api/v1/children/{child_id}/personality{rest}"


def _code(response: httpx.Response) -> str:
    return response.json()["detail"]["code"]


async def _generate(r: Running, child_id: str) -> None:
    """Start and run the personality's job, as the worker would."""
    await generation.start(
        r.runtime, child_id=child_id, user_id=PARENT, location=LOCATION, input_version=1
    )
    job = await claim(r.db)
    assert job is not None
    assert await generation.process(r.runtime, llm_client(), job) == "completed"


# ── shape ──────────────────────────────────────────────────────────────────────


def test_every_route_declares_a_policy_and_stays_on_its_app():
    assert_every_route_has_a_policy(main.app)
    assert_every_route_has_a_policy(main.internal_app)
    base = "/api/v1/children/{id}/personality"
    public = {r.path for r in main.app.routes if isinstance(r, APIRoute)}
    assert public == {
        "/health", base, f"{base}/generation", f"{base}/generation/{{job_id}}", f"{base}/viewed",
    }  # fmt: skip
    internal = {r.path for r in main.internal_app.routes if isinstance(r, APIRoute)}
    assert internal == {
        "/internal/ping",
        "/internal/discover/children/{id}/status",
        "/internal/discover/children/{id}/summary",
    }


def _public(method: str, path: str, **kwargs: Any) -> httpx.Response:
    async def go() -> httpx.Response:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app), base_url="http://d"
        ) as http:
            return await http.request(method, path, **kwargs)

    return asyncio.run(go())


def test_health_and_an_unconfigured_service():
    assert _public("GET", "/health").json() == {"status": "ok", "service": "discover"}
    assert _public("GET", _path(str(uuid.uuid4())), headers=auth_header()).status_code == 503


# ── the personality ────────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_a_personality_goes_from_not_started_to_ready(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        before = await r.http.get(_path(child), headers=auth_header())
        assert before.json() == {
            "status": "not_started", "view_model": None, "job_id": None,
            "finalised_at": None, "viewed_at": None,
        }  # fmt: skip
        started = await r.http.post(_path(child, "/generation"), headers=auth_header())
        assert started.status_code == 202 and started.json()["status"] == "pending"
        job_id = started.json()["job_id"]
        generating = (await r.http.get(_path(child), headers=auth_header())).json()
        assert generating["status"] == "generating" and generating["job_id"] == job_id
        job = await r.http.get(_path(child, f"/generation/{job_id}"), headers=auth_header())
        assert job.json()["kind"] == "personality" and job.json()["status"] == "pending"
        claimed = await claim(r.db)
        assert await generation.process(r.runtime, llm_client(), claimed) == "completed"
        ready = (await r.http.get(_path(child), headers=auth_header())).json()
        assert ready["status"] == "ready" and ready["job_id"] is None
        assert ready["view_model"] == json.loads(json.dumps(view_model(LLM_ANSWER, "Aarav")))
        assert ready["finalised_at"] is not None and ready["viewed_at"] is None
        done = await r.http.get(_path(child, f"/generation/{job_id}"), headers=auth_header())
        assert done.json()["status"] == "completed" and done.json()["completed_at"]
        # The raw answer is stored for support, never returned.
        doc = await r.db[PERSONALITIES].find_one({"_id": child})
        assert doc["analysis"] == LLM_ANSWER and "analysis" not in ready
        assert doc["version"] == 2
        row = await r.db.outbox.find_one({"event_type": "discover.personality_finalised"})
        assert row["version"] == 2 and row["payload"] == {
            "user_id": PARENT,
            **summary(doc["view_model"]),
        }

    live(mongo_uri, test)


@pytest.mark.live_service
def test_starting_returns_the_running_job_and_never_regenerates(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        first = await r.http.post(_path(child, "/generation"), headers=auth_header())
        again = await r.http.post(_path(child, "/generation"), headers=auth_header())
        assert again.status_code == 200 and again.json()["job_id"] == first.json()["job_id"]
        assert await r.db[JOBS].count_documents({}) == 1
        claimed = await claim(r.db)
        assert (await r.http.post(_path(child, "/generation"), headers=auth_header())).json()[
            "status"
        ] == "processing"
        await generation.process(r.runtime, llm_client(), claimed)
        refused = await r.http.post(_path(child, "/generation"), headers=auth_header())
        assert refused.status_code == 409 and _code(refused) == "already_generated"

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_failed_personality_can_be_started_again(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        await generation.start(
            r.runtime, child_id=child, user_id=PARENT, location=LOCATION, input_version=1
        )
        job = await claim(r.db)
        await jobs.fail_or_retry(r.db, r.runtime.client, job, "boom", permanent=True)
        failed = (await r.http.get(_path(child), headers=auth_header())).json()
        assert failed["status"] == "failed" and failed["job_id"] is None
        retry = await r.http.post(_path(child, "/generation"), headers=auth_header())
        assert retry.status_code == 202 and retry.json()["job_id"] != job["_id"]
        failed_job = await r.http.get(
            _path(child, f"/generation/{job['_id']}"), headers=auth_header()
        )
        assert failed_job.json()["status"] == "failed" and failed_job.json()["error"] == "boom"

    live(mongo_uri, test)


@pytest.mark.live_service
def test_starts_count_against_the_hourly_llm_limit(mongo_uri):
    async def test(r: Running) -> None:
        first, second = await r.ready_child(), await r.ready_child()
        assert (
            await r.http.post(_path(first, "/generation"), headers=auth_header())
        ).status_code == 202
        # The running job comes back without counting again.
        assert (
            await r.http.post(_path(first, "/generation"), headers=auth_header())
        ).status_code == 200
        limited = await r.http.post(_path(second, "/generation"), headers=auth_header())
        assert limited.status_code == 429 and _code(limited) == "llm_limit"
        assert limited.headers["retry-after"] == "3600"

    live(mongo_uri, test, llm_hourly_limit=1)


@pytest.mark.live_service
def test_a_start_reads_the_answers_through_and_reports_failures(mongo_uri, monkeypatch):
    async def test(r: Running) -> None:
        child = r.owners.add_child()
        await r.copy(child)  # the answers haven't arrived yet
        missing = await r.http.post(_path(child, "/generation"), headers=auth_header())
        assert missing.status_code == 503 and _code(missing) == "onboarding_unavailable"
        r.owners.complete(child, version=3)
        started = await r.http.post(_path(child, "/generation"), headers=auth_header())
        assert started.status_code == 202
        copied = await r.db[ONBOARDING_INPUTS].find_one({"_id": child})
        assert copied["version"] == 3 and copied["strengths"] == ["curious", "kind"]
        job = await r.db[JOBS].find_one({"_id": started.json()["job_id"]})
        assert job["input_version"] == 3
        # Someone else's answers are never copied.
        theirs = r.owners.add_child()
        await r.copy(theirs)
        r.owners.complete(theirs, user_id=OTHER)
        assert (
            await r.http.post(_path(theirs, "/generation"), headers=auth_header())
        ).status_code == 503
        # A deleted account refuses; a database failure is 503, not 500.
        deleted = await r.ready_child()
        await r.db.tombstones.insert_one(
            {
                "_id": f"user:{PARENT}",
                "location": LOCATION,
                "version": 2,
                "deleted_at": copied["updated_at"],
            }
        )
        assert (
            await r.http.post(_path(deleted, "/generation"), headers=auth_header())
        ).status_code == 404
        await r.db.tombstones.delete_many({})

        async def broken(*args: Any, **kwargs: Any) -> Any:
            raise OperationFailure("primary stepped down")

        monkeypatch.setattr(generation, "start", broken)
        down = await r.http.post(_path(deleted, "/generation"), headers=auth_header())
        assert down.status_code == 503 and _code(down) == "generation_unavailable"

        async def ready_meanwhile(*args: Any, **kwargs: Any) -> Any:
            raise generation.AlreadyGenerated(deleted)

        monkeypatch.setattr(generation, "start", ready_meanwhile)
        raced = await r.http.post(_path(deleted, "/generation"), headers=auth_header())
        assert raced.status_code == 409 and _code(raced) == "already_generated"

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

    live(mongo_uri, test)


# ── the reveal ─────────────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_viewed_is_refused_until_ready_and_publishes_once(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        early = await r.http.post(_path(child, "/viewed"), headers=auth_header())
        assert early.status_code == 409 and _code(early) == "personality_not_ready"
        await r.http.post(_path(child, "/generation"), headers=auth_header())
        generating = await r.http.post(_path(child, "/viewed"), headers=auth_header())
        assert generating.status_code == 409
        await generation.process(r.runtime, llm_client(), await claim(r.db))
        viewed = await r.http.post(_path(child, "/viewed"), headers=auth_header())
        assert viewed.status_code == 200 and viewed.json()["viewed_at"] is not None
        again = await r.http.post(_path(child, "/viewed"), headers=auth_header())
        assert again.json()["viewed_at"] == viewed.json()["viewed_at"]
        completed = await r.db.outbox.find({"event_type": "discover.completed"}).to_list(None)
        assert [(row["aggregate_id"], row["version"]) for row in completed] == [(child, 3)]

    live(mongo_uri, test)


# ── access ─────────────────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_a_locked_copy_is_confirmed_with_onboarding_before_refusing(mongo_uri):
    async def test(r: Running) -> None:
        child = r.owners.add_child()
        await r.copy(child, progress=progress(profile=True))
        locked = await r.http.get(_path(child), headers=auth_header())
        assert locked.status_code == 403 and _code(locked) == "circle_locked"
        r.owners.complete(child)  # finished a moment ago: the copy is behind
        assert (await r.http.get(_path(child), headers=auth_header())).status_code == 200
        copy = await r.db[CHILD_ACCESS].find_one({"_id": child})
        # Recorded as confirmed; progress and version stay children's.
        assert copy["confirmed"] == {"conversation": True}
        assert copy["progress"]["conversation"] is False and copy["version"] == 1
        calls = len(r.owners.calls)
        await r.http.get(_path(child), headers=auth_header())
        assert len(r.owners.calls) == calls  # confirmed once, not asked again

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_missing_copy_is_read_through_and_owners_down_are_503(mongo_uri):
    async def test(r: Running) -> None:
        child = r.owners.add_child(version=5)
        assert (await r.http.get(_path(child), headers=auth_header())).status_code == 200
        copy = await r.db[CHILD_ACCESS].find_one({"_id": child})
        assert copy["version"] == 5 and copy["progress"]["conversation"] is True
        assert (
            await r.http.get(_path(str(uuid.uuid4())), headers=auth_header())
        ).status_code == 404
        purged = r.owners.add_child()
        await r.db.tombstones.insert_one(
            {
                "_id": f"child:{purged}",
                "location": LOCATION,
                "version": 3,
                "deleted_at": copy["updated_at"],
            }
        )
        calls = len(r.owners.calls)
        assert (await r.http.get(_path(purged), headers=auth_header())).status_code == 404
        assert len(r.owners.calls) == calls
        locked = r.owners.add_child(progress=progress(profile=True))
        unknown = r.owners.add_child()
        for kind in ("down", "broken"):
            for owner, target, code in (
                ("children", unknown, "children_unavailable"),
                ("onboarding", locked, "onboarding_unavailable"),
            ):
                getattr(r.owners, kind).add(owner)
                if owner == "onboarding":
                    await r.db[CHILD_ACCESS].delete_many({"_id": locked})
                    await r.copy(locked, progress=progress(profile=True))
                response = await r.http.get(_path(target), headers=auth_header())
                assert response.status_code == 503 and _code(response) == code, (kind, owner)
                assert response.headers["retry-after"] == "2"
                getattr(r.owners, kind).discard(owner)

    live(mongo_uri, test)


@pytest.mark.live_service
def test_someone_elses_or_a_deleted_child_is_not_found(mongo_uri):
    async def test(r: Running) -> None:
        theirs = r.owners.add_child(user_id=OTHER)
        await r.copy(theirs, user_id=OTHER)
        deleted = r.owners.add_child()
        await r.copy(deleted, is_deleted=True)
        for child in (theirs, deleted):
            for method, rest in (("GET", ""), ("POST", "/generation"), ("POST", "/viewed")):
                response = await r.http.request(method, _path(child, rest), headers=auth_header())
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
        assert [(e.subject_id, e.outcome) for e in r.audit if e.privileged] == [(PARENT, "allowed")]
        assert (await r.http.post(_path(child, "/generation"), headers=admin)).status_code == 404

    live(mongo_uri, test)


# ── internal routes ────────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_grow_confirms_discover_and_circles_read_the_summary(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        status = f"/internal/discover/children/{child}/status"
        summary_path = f"/internal/discover/children/{child}/summary"
        params = {"location": LOCATION}

        async def completed() -> bool:
            response = await r.internal.get(status, params=params, headers=service_header())
            return bool(response.json()["completed"])

        assert await completed() is False
        assert (
            await r.internal.get(summary_path, params=params, headers=service_header("transform"))
        ).status_code == 404
        await _generate(r, child)
        assert await completed() is False  # ready, but the reveal isn't passed yet
        copy = await r.internal.get(
            summary_path, params=params, headers=service_header("transform")
        )
        doc = await r.db[PERSONALITIES].find_one({"_id": child})
        assert copy.json() == {
            "child_id": child, "user_id": PARENT, "location": LOCATION,
            **summary(doc["view_model"]), "version": 2,
        }  # fmt: skip
        await r.http.post(_path(child, "/viewed"), headers=auth_header())
        assert await completed() is True
        # Only grow confirms; release reads neither; a token is required.
        assert (
            await r.internal.get(status, params=params, headers=service_header("transform"))
        ).status_code == 403
        assert (
            await r.internal.get(summary_path, params=params, headers=service_header("release"))
        ).status_code == 403
        assert (await r.internal.get(status, params=params)).status_code == 401
        assert (await r.internal.get("/internal/ping")).json()["service"] == "discover"

    live(mongo_uri, test)


# ── configuration ──────────────────────────────────────────────────────────────


def _env(**extra: str) -> dict[str, str]:
    from discover_testkit import JWT_PUBLIC, KID

    return {
        "MONGODB_DB_NAME": "x",
        "JWT_PUBLIC_KEYS": json.dumps({KID: JWT_PUBLIC}),
        "INTERNAL_SIGNING_KID": "d1",
        "INTERNAL_SIGNING_KEY": DISCOVER_PRIVATE,
        "INTERNAL_PUBLIC_KEYS": "{}",
        **extra,
    }


def test_from_env_builds_every_part(fake_aws_credentials, monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    for name in ("REDIS_URL", "AWS_ENDPOINT_URL", "LLM_HOURLY_LIMIT"):
        monkeypatch.delenv(name, raising=False)
    plain = Runtime.from_env(_env(MONGODB_URI="mongodb://x"))
    assert plain.settings.service_name == "discover" and plain.llm_limit.limit == 200
    assert plain.locations() is None  # local: every location
    asyncio.run(plain.aclose())
    deployed = Runtime.from_env(
        _env(
            MONGODB_URI="mongodb://x",
            AWS_ENDPOINT_URL="http://localhost:5050",
            LLM_HOURLY_LIMIT="50",
            APP_ENV="dev",
        )
    )
    assert deployed.llm_limit.limit == 50 and "in" in (deployed.locations() or [])
    asyncio.run(deployed.aclose())


@pytest.mark.live_service
def test_the_lifespan_shares_one_runtime_and_reports_job_metrics(
    mongo_uri, monkeypatch, fake_aws_credentials
):
    db_name = f"discover_env_{uuid.uuid4().hex[:8]}"
    # An endpoint nothing listens on: the metrics' flush fails fast and is only logged.
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
        assert {"personalities", "jobs", "child_access", "onboarding_inputs", "outbox"} <= set(
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


@pytest.mark.live_service
def test_a_personality_left_generating_without_a_job_starts_again(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        first = (await r.http.post(_path(child, "/generation"), headers=auth_header())).json()
        # Its job ended some other way (cancelled) while the document still says generating.
        await r.db[JOBS].update_one({"_id": first["job_id"]}, {"$set": {"status": "failed"}})
        again = await r.http.post(_path(child, "/generation"), headers=auth_header())
        assert again.status_code == 202 and again.json()["job_id"] != first["job_id"]

    live(mongo_uri, test)


@pytest.mark.live_service
def test_starting_is_limited_to_10_a_minute(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        statuses = [
            (await r.http.post(_path(child, "/generation"), headers=auth_header())).status_code
            for _ in range(11)
        ]
        assert statuses[0] == 202 and statuses[-1] == 429 and statuses.count(429) == 1

    live(mongo_uri, test)


def test_no_cloudwatch_means_no_job_metrics():
    from types import SimpleNamespace

    main._start_reporting(SimpleNamespace(cloudwatch=None))  # type: ignore[arg-type]
    assert main._reporting is None
    asyncio.run(main._stop_reporting())  # nothing to stop
