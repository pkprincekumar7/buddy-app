"""The transform endpoints (build plan 5.4). The plan's checks:
- completion only with a plan **and** the event set;
- Life Pathway cleared on an `age` or `gender` change and on `grow.area_updated`
  (test_transform_worker.py);
- photos `{key, url}` round trip, with keys only under `…/ninety-day-plan/`.
Plus the generations' rules, PATCH validation, the circle rules, races, the internal route
and configuration."""

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
from transform_testkit import (
    ADMIN,
    BUCKET,
    LOCATION,
    OTHER,
    PARENT,
    PLAN_ANSWER,
    TRACKER_ANSWER,
    TRANSFORM_PRIVATE,
    FakeOpenAI,
    Running,
    auth_header,
    claim,
    llm_client,
    progress,
    running,
    service_header,
)

from common.models import CHILD_ACCESS, GROWTH_INPUTS, JOBS
from common.routers import assert_every_route_has_a_policy
from transform.app import generation, main
from transform.app.runtime import Runtime
from transform.app.store import PLANS


def live(mongo_uri: str, test: Callable[[Running], Awaitable[None]], **options: Any) -> None:
    async def go() -> None:
        async with running(mongo_uri, **options) as r:
            await test(r)

    asyncio.run(go())


def _path(child_id: str, rest: str = "") -> str:
    return f"/api/v1/children/{child_id}/transform{rest}"


def _code(response: httpx.Response) -> str:
    return response.json()["detail"]["code"]


async def _patch(r: Running, child: str, **body: Any) -> httpx.Response:
    return await r.http.patch(_path(child), json=body, headers=auth_header())


async def _start(r: Running, child: str, kind: str, **body: Any) -> httpx.Response:
    return await r.http.post(
        _path(child, "/generation"), json={"kind": kind, **body}, headers=auth_header()
    )


async def _generate(r: Running, child: str, kind: str, answer: Any, **body: Any) -> None:
    started = await _start(r, child, kind, **body)
    assert started.status_code == 202, started.text
    outcome = await generation.process(
        r.runtime, llm_client(FakeOpenAI(answers=[answer])), await claim(r.db)
    )
    assert outcome == "completed"


async def _events(r: Running) -> list[tuple[str, int]]:
    rows = await r.db.outbox.find({}).sort("created_at", 1).to_list(None)
    return [(row["event_type"], row["version"]) for row in rows]


def _put_photo(r: Running, key: str, *, size: int = 1024, content_type: str = "image/jpeg") -> None:
    assert r.runtime.uploads is not None
    r.runtime.uploads.client.put_object(
        Bucket=BUCKET, Key=key, Body=b"x" * size, ContentType=content_type
    )


# ── shape ──────────────────────────────────────────────────────────────────────


def test_every_route_declares_a_policy_and_stays_on_its_app():
    assert_every_route_has_a_policy(main.app)
    assert_every_route_has_a_policy(main.internal_app)
    base = "/api/v1/children/{id}/transform"
    public = {r.path for r in main.app.routes if isinstance(r, APIRoute)}
    assert public == {
        "/health", base, f"{base}/generation", f"{base}/generation/{{job_id}}",
        f"{base}/photos/presign",
    }  # fmt: skip
    internal = {r.path for r in main.internal_app.routes if isinstance(r, APIRoute)}
    assert internal == {"/internal/ping", "/internal/transform/children/{id}/status"}


def _public(method: str, path: str, **kwargs: Any) -> httpx.Response:
    async def go() -> httpx.Response:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app), base_url="http://t"
        ) as http:
            return await http.request(method, path, **kwargs)

    return asyncio.run(go())


def test_health_and_an_unconfigured_service():
    assert _public("GET", "/health").json() == {"status": "ok", "service": "transform"}
    assert _public("GET", _path(str(uuid.uuid4())), headers=auth_header()).status_code == 503


# ── the plan and its completion ────────────────────────────────────────────────


@pytest.mark.live_service
def test_an_empty_transform_lists_the_completed_areas(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        body = (await r.http.get(_path(child), headers=auth_header())).json()
        assert body["areas"] == [{
            "area_id": "self_care", "area_name": "Self Care",
            "life_pathway_milestones": None, "life_pathway_generating": False,
        }]  # fmt: skip
        assert body["plan"] is None and body["event_set"] is False and body["generating"] == []
        assert body["applied"] == {} and body["photos"] == {} and body["completed_at"] is None

    live(mongo_uri, test)


@pytest.mark.live_service
def test_completion_needs_the_plan_and_the_event_whichever_comes_last(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        assert (await _patch(r, child, ask="She loves skateboarding")).status_code == 200
        started = await _start(r, child, "plan")
        assert started.status_code == 202
        again = await _start(r, child, "plan")
        assert again.status_code == 200 and again.json()["job_id"] == started.json()["job_id"]
        assert (await r.http.get(_path(child), headers=auth_header())).json()["generating"] == [
            "plan"
        ]
        await generation.process(
            r.runtime, llm_client(FakeOpenAI(answers=[PLAN_ANSWER])), await claim(r.db)
        )
        body = (await r.http.get(_path(child), headers=auth_header())).json()
        assert body["plan"] == PLAN_ANSWER and body["completed_at"] is None
        # The event without a date doesn't complete it; with one, it does.
        await _patch(r, child, event_name="Park show", event_set=True)
        assert await _events(r) == []
        done = await _patch(r, child, event_date="2027-01-20")
        assert done.json()["event_date"] == "2027-01-20" and done.json()["completed_at"]
        doc = await r.db[PLANS].find_one({"_id": child})
        assert await _events(r) == [("transform.completed", doc["version"])]
        # Clearing the event later doesn't undo it, and nothing is published again.
        undone = await _patch(r, child, event_set=False, event_date=None)
        assert undone.json()["completed_at"] == done.json()["completed_at"]
        assert len(await _events(r)) == 1

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_plan_finished_after_the_event_completes_transform_itself(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        await _patch(
            r,
            child,
            ask="Skateboarding",
            event_name="Show",
            event_date="2027-02-01",
            event_set=True,
        )
        assert await _events(r) == []  # no plan yet
        await _generate(r, child, "plan", PLAN_ANSWER)
        assert [event for event, _ in await _events(r)] == ["transform.completed"]
        # The tracker, for the event; a retargeted event clears it.
        await _generate(r, child, "event_tracker", TRACKER_ANSWER)
        assert (await r.http.get(_path(child), headers=auth_header())).json()[
            "track_steps"
        ] == TRACKER_ANSWER
        cleared = await _patch(r, child, event_name="New show", clear_track_steps=True)
        assert cleared.json()["track_steps"] is None and cleared.json()["event_name"] == "New show"

    live(mongo_uri, test)


@pytest.mark.live_service
def test_each_generation_needs_what_it_builds_on(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        no_ask = await _start(r, child, "plan")
        assert no_ask.status_code == 409 and _code(no_ask) == "needs_ask"
        no_plan = await _start(r, child, "event_tracker")
        assert no_plan.status_code == 409 and _code(no_plan) == "needs_plan"
        await _patch(r, child, ask="Skateboarding")
        await _generate(r, child, "plan", PLAN_ANSWER)
        no_event = await _start(r, child, "event_tracker")
        assert no_event.status_code == 409 and _code(no_event) == "needs_event"
        no_area = await _start(r, child, "life_pathway")
        assert no_area.status_code == 422 and _code(no_area) == "area_id_required"
        not_done = await _start(r, child, "life_pathway", area_id="creativity")
        assert not_done.status_code == 409 and _code(not_done) == "needs_completed_area"

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_life_pathway_per_area_with_a_read_through_of_new_areas(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        started = await _start(r, child, "life_pathway", area_id="self_care")
        assert started.status_code == 202
        (area,) = (await r.http.get(_path(child), headers=auth_header())).json()["areas"]
        assert area["life_pathway_generating"] is True
        await generation.process(r.runtime, llm_client(), await claim(r.db))
        (area,) = (await r.http.get(_path(child), headers=auth_header())).json()["areas"]
        assert set(area["life_pathway_milestones"]) == {"y1", "y2", "y3", "y5", "y8", "y10"}
        assert area["life_pathway_milestones"]["y1"]["title"] == "Year 0 title"
        # An area grow completed a moment ago, before its event reached transform.
        r.owners.complete_area(child, "creativity", version=3)
        fresh = await _start(r, child, "life_pathway", area_id="creativity")
        assert fresh.status_code == 202
        copy = await r.db[GROWTH_INPUTS].find_one({"area_id": "creativity"})
        assert (
            copy["version"] == 3
            and (await r.db[JOBS].find_one({"_id": fresh.json()["job_id"]}))["input_version"] == 3
        )
        # Someone else's area is never copied.
        r.owners.complete_area(child, "social_skills", user_id=OTHER)
        theirs = await _start(r, child, "life_pathway", area_id="social_skills")
        assert theirs.status_code == 409

    live(mongo_uri, test)


@pytest.mark.live_service
def test_starts_count_against_the_hourly_llm_limit_and_report_failures(mongo_uri, monkeypatch):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        await _patch(r, child, ask="Skateboarding")
        assert (await _start(r, child, "plan")).status_code == 202
        limited = await _start(r, child, "life_pathway", area_id="self_care")
        assert limited.status_code == 429 and _code(limited) == "llm_limit"

    live(mongo_uri, test, llm_hourly_limit=1)


@pytest.mark.live_service
def test_generation_failures_are_reported(mongo_uri, monkeypatch):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        await _patch(r, child, ask="Skateboarding")
        real = generation.start

        async def broken(*args: Any, **kwargs: Any) -> Any:
            raise OperationFailure("primary stepped down")

        monkeypatch.setattr(generation, "start", broken)
        down = await _start(r, child, "plan")
        assert down.status_code == 503 and _code(down) == "generation_unavailable"

        async def lost(*args: Any, **kwargs: Any) -> tuple[str, bool]:
            job_id, _ = await real(*args, **kwargs)
            return job_id, False  # another request's start got there first

        monkeypatch.setattr(generation, "start", lost)
        assert (await _start(r, child, "plan")).status_code == 200
        monkeypatch.setattr(generation, "start", real)
        deleted = await r.ready_child()
        await _patch(r, deleted, ask="x")
        await r.db.tombstones.insert_one(
            {
                "_id": f"user:{PARENT}",
                "location": LOCATION,
                "version": 2,
                "deleted_at": datetime.now(UTC),
            }
        )
        assert (await _start(r, deleted, "plan")).status_code == 404

    live(mongo_uri, test)


@pytest.mark.live_service
def test_another_childs_job_is_not_found(mongo_uri):
    async def test(r: Running) -> None:
        mine, other = await r.ready_child(), await r.ready_child()
        job = (await _start(r, other, "life_pathway", area_id="self_care")).json()
        response = await r.http.get(
            _path(mine, f"/generation/{job['job_id']}"), headers=auth_header()
        )
        assert response.status_code == 404 and _code(response) == "job_not_found"
        found = await r.http.get(
            _path(other, f"/generation/{job['job_id']}"), headers=auth_header()
        )
        assert found.json()["kind"] == "life_pathway" and found.json()["status"] == "pending"

    live(mongo_uri, test)


# ── PATCH ──────────────────────────────────────────────────────────────────────


@pytest.mark.live_service
@pytest.mark.parametrize(
    "body",
    [
        {"plan": {}},  # generated: transform's jobs only
        {"track_steps": {}},
        {"life_pathway": {}},
        {"applied": {"bad key!": True}},
        {"event_date": "next tuesday"},
        {"act_counts": {"a": "3"}},  # strict: no coercion
        {"ask": "x" * 2001},
        {"act_inputs": {f"k{n}": "x" * 1000 for n in range(70)}},  # over 64 KB
    ],
)
def test_invalid_patches_are_422(mongo_uri, body):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        assert (await _patch(r, child, **body)).status_code == 422
        assert await r.db[PLANS].count_documents({}) == 0

    live(mongo_uri, test)


@pytest.mark.live_service
def test_the_whole_plan_stays_under_64_kb(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        await _patch(r, child, act_inputs={f"a{n}": "x" * 1000 for n in range(40)})
        response = await _patch(r, child, track_inputs={f"t{n}": "y" * 1000 for n in range(40)})
        assert response.status_code == 422 and _code(response) == "plan_too_large"

    live(mongo_uri, test)


@pytest.mark.live_service
def test_photos_round_trip_as_keys_and_urls(mongo_uri, monkeypatch, caplog):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        presigned = await r.http.post(
            _path(child, "/photos/presign"),
            json={"field_key": "act:01:sketch", "content_type": "image/png"},
            headers=auth_header(),
        )
        key = presigned.json()["photo_key"]
        assert key.startswith(f"uploads/{LOCATION}/{child}/ninety-day-plan/") and key.endswith(
            ".png"
        )
        assert presigned.json()["upload_url"] and presigned.json()["photo_url"]
        not_yet = await _patch(r, child, photos={"act:01:sketch": [key]})
        assert not_yet.status_code == 422 and _code(not_yet) == "photo_not_uploaded"
        _put_photo(r, key, content_type="image/png")
        saved = await _patch(r, child, photos={"act:01:sketch": [key]}, applied={"tip-1": True})
        (photo,) = saved.json()["photos"]["act:01:sketch"]
        assert photo["key"] == key and "X-Amz" in photo["url"]
        # Another field's photo keeps the first; replacing a field's list deletes the old one.
        second = f"uploads/{LOCATION}/{child}/ninety-day-plan/{uuid.uuid4()}.jpg"
        _put_photo(r, second)
        await _patch(r, child, photos={"ideas": [second]})
        third = f"uploads/{LOCATION}/{child}/ninety-day-plan/{uuid.uuid4()}.jpg"
        _put_photo(r, third)
        replaced = await _patch(r, child, photos={"act:01:sketch": [third]})
        assert {f: [p["key"] for p in ps] for f, ps in replaced.json()["photos"].items()} == {
            "act:01:sketch": [third], "ideas": [second],
        }  # fmt: skip
        listed = r.runtime.uploads.client.list_objects_v2(Bucket=BUCKET)
        assert key not in {o["Key"] for o in listed["Contents"]}
        # Keys only under this child's plan-photo prefix, at most 5 MB.
        for bad in (
            f"uploads/{LOCATION}/{child}/avatar/{uuid.uuid4()}.jpg",
            f"uploads/{LOCATION}/{uuid.uuid4()}/ninety-day-plan/{uuid.uuid4()}.jpg",
            "https://example.com/x.jpg",
        ):
            refused = await _patch(r, child, photos={"x": [bad]})
            assert refused.status_code == 422 and _code(refused) == "invalid_photo_key"
        big = f"uploads/{LOCATION}/{child}/ninety-day-plan/{uuid.uuid4()}.jpg"
        _put_photo(r, big, size=5 * 1024 * 1024 + 1)
        assert _code(await _patch(r, child, photos={"x": [big]})) == "photo_too_large"
        # A failed delete of a replaced photo is logged, not raised.

        async def failing(key: str) -> None:
            raise RuntimeError("s3 down")

        monkeypatch.setattr(r.runtime.uploads, "delete", failing)
        assert (await _patch(r, child, photos={"ideas": []})).status_code == 200

    with caplog.at_level("WARNING", logger="transform.app.main"):
        live(mongo_uri, test)
    assert "an old photo wasn't deleted" in caplog.text


@pytest.mark.live_service
def test_presign_refusals(mongo_uri, monkeypatch):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        body = {"field_key": "ideas", "content_type": "image/png"}
        bad_type = await r.http.post(
            _path(child, "/photos/presign"), json={**body, "content_type": "image/svg+xml"},
            headers=auth_header(),
        )  # fmt: skip
        assert bad_type.status_code == 415 and _code(bad_type) == "unsupported_image_type"
        assert (
            await r.http.post(
                _path(child, "/photos/presign"),
                json={**body, "field_key": "../x"},
                headers=auth_header(),
            )
        ).status_code == 422

        async def failing(*args: Any) -> str:
            raise RuntimeError("s3 down")

        monkeypatch.setattr(r.runtime.uploads, "presign_put", failing)
        failed = await r.http.post(
            _path(child, "/photos/presign"), json=body, headers=auth_header()
        )
        assert failed.status_code == 502 and _code(failed) == "upload_url_failed"

    live(mongo_uri, test)


@pytest.mark.live_service
def test_without_an_uploads_bucket_photos_are_503(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        presign = await r.http.post(
            _path(child, "/photos/presign"), json={"field_key": "x", "content_type": "image/png"},
            headers=auth_header(),
        )  # fmt: skip
        assert presign.status_code == 503 and _code(presign) == "uploads_not_configured"
        key = f"uploads/{LOCATION}/{child}/ninety-day-plan/{uuid.uuid4()}.jpg"
        assert (await _patch(r, child, photos={"x": [key]})).status_code == 503
        assert (await _patch(r, child, photos={"x": []})).status_code == 200  # nothing to check
        await r.db[PLANS].update_one({"_id": child}, {"$set": {"photos": {"x": [key]}}})
        body = (await r.http.get(_path(child), headers=auth_header())).json()
        assert body["photos"] == {"x": [{"key": key, "url": None}]}

    live(mongo_uri, test, uploads=False)


# ── access ─────────────────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_a_locked_copy_is_confirmed_with_grow_before_refusing(mongo_uri):
    async def test(r: Running) -> None:
        child = r.owners.add_child()
        await r.copy(child, progress=progress(profile=True, conversation=True, discover=True))
        locked = await r.http.get(_path(child), headers=auth_header())
        assert locked.status_code == 403 and _code(locked) == "circle_locked"
        r.owners.complete_area(child)
        assert (await r.http.get(_path(child), headers=auth_header())).status_code == 200
        copy = await r.db[CHILD_ACCESS].find_one({"_id": child})
        assert copy["confirmed"] == {"grow": True}
        for kind in ("down", "broken"):
            other = r.owners.add_child()
            await r.copy(other, progress=progress(profile=True))
            getattr(r.owners, kind).add("grow")
            response = await r.http.get(_path(other), headers=auth_header())
            assert response.status_code == 503 and _code(response) == "grow_unavailable"
            getattr(r.owners, kind).discard("grow")

    live(mongo_uri, test)


@pytest.mark.live_service
def test_someone_elses_child_is_not_found_and_admins_only_read(mongo_uri):
    async def test(r: Running) -> None:
        theirs = r.owners.add_child(user_id=OTHER)
        await r.copy(theirs, user_id=OTHER)
        for method, rest, body in (
            ("GET", "", None), ("PATCH", "", {"ask": "x"}),
            ("POST", "/generation", {"kind": "plan"}),
            ("POST", "/photos/presign", {"field_key": "x", "content_type": "image/png"}),
        ):  # fmt: skip
            response = await r.http.request(
                method, _path(theirs, rest), json=body, headers=auth_header()
            )
            assert response.status_code == 404 and _code(response) == "child_not_found"
        unknown = await r.http.get(_path(str(uuid.uuid4())), headers=auth_header())
        assert unknown.status_code == 404
        child = await r.ready_child(progress=progress(profile=True))  # no unlock check for admins
        admin = auth_header(ADMIN)
        no_location = await r.http.get(_path(child), headers=admin)
        assert no_location.status_code == 422 and _code(no_location) == "location_required"
        read = await r.http.get(_path(child), params={"location": LOCATION}, headers=admin)
        assert read.status_code == 200 and read.json()["areas"][0]["area_id"] == "self_care"
        assert [(e.subject_id, e.outcome) for e in r.audit if e.privileged] == [(PARENT, "allowed")]
        assert (
            await r.http.patch(_path(child), json={"ask": "x"}, headers=admin)
        ).status_code == 404

    live(mongo_uri, test)


# ── races ──────────────────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_two_first_saves_at_once_make_one_plan(mongo_uri, monkeypatch):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        real = main.is_tombstoned
        mongo: MongoClient[dict[str, Any]] = MongoClient(mongo_uri)
        raced: list[bool] = []

        async def other_save_first(*args: Any, **kwargs: Any) -> bool:
            if not raced:
                raced.append(True)
                from transform.app.store import new_plan

                mongo[r.db.name][PLANS].insert_one(
                    new_plan(child, PARENT, LOCATION, datetime.now(UTC))
                )
            return await real(*args, **kwargs)

        monkeypatch.setattr(main, "is_tombstoned", other_save_first)
        saved = await _patch(r, child, ask="Skateboarding")
        mongo.close()
        assert saved.status_code == 200 and saved.json()["ask"] == "Skateboarding"
        assert (await r.db[PLANS].find_one({}))["version"] == 2

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_plan_that_keeps_changing_is_409_and_a_deletion_meanwhile_404(mongo_uri, monkeypatch):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        await _patch(r, child, ask="x")
        real = main.is_tombstoned

        async def changed_each_time(*args: Any, **kwargs: Any) -> bool:
            await r.db[PLANS].update_one({}, {"$inc": {"version": 1}})
            return await real(*args, **kwargs)

        monkeypatch.setattr(main, "is_tombstoned", changed_each_time)
        response = await _patch(r, child, ask="y")
        assert response.status_code == 409 and _code(response) == "plan_changed"

        async def deleted(*args: Any, **kwargs: Any) -> bool:
            return True

        monkeypatch.setattr(main, "is_tombstoned", deleted)
        assert (await _patch(r, child, ask="z")).status_code == 404

    live(mongo_uri, test)


# ── the internal route ─────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_release_confirms_transform(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        status = f"/internal/transform/children/{child}/status"
        params = {"location": LOCATION}
        assert (await r.internal.get(status, params=params, headers=service_header())).json() == {
            "completed": False
        }
        await _patch(r, child, ask="x", event_name="Show", event_date="2027-01-01", event_set=True)
        await _generate(r, child, "plan", PLAN_ANSWER)
        assert (await r.internal.get(status, params=params, headers=service_header())).json() == {
            "completed": True
        }
        assert (
            await r.internal.get(status, params=params, headers=service_header("grow"))
        ).status_code == 403
        assert (await r.internal.get(status, params=params)).status_code == 401
        assert (await r.internal.get("/internal/ping")).json()["service"] == "transform"

    live(mongo_uri, test)


# ── limits and configuration ───────────────────────────────────────────────────


@pytest.mark.live_service
def test_starting_is_limited_to_10_a_minute(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        statuses = [
            (await _start(r, child, "life_pathway", area_id="self_care")).status_code
            for _ in range(11)
        ]
        assert statuses[0] == 202 and statuses[-1] == 429 and statuses.count(429) == 1

    live(mongo_uri, test)


def test_no_cloudwatch_means_no_job_metrics():
    main._start_reporting(SimpleNamespace(cloudwatch=None))  # type: ignore[arg-type]
    assert main._reporting is None
    asyncio.run(main._stop_reporting())


def _env(**extra: str) -> dict[str, str]:
    from transform_testkit import JWT_PUBLIC, KID

    return {
        "MONGODB_DB_NAME": "x",
        "JWT_PUBLIC_KEYS": json.dumps({KID: JWT_PUBLIC}),
        "INTERNAL_SIGNING_KID": "t1",
        "INTERNAL_SIGNING_KEY": TRANSFORM_PRIVATE,
        "INTERNAL_PUBLIC_KEYS": "{}",
        **extra,
    }


def test_from_env_builds_every_part(fake_aws_credentials, monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    for name in ("REDIS_URL", "AWS_ENDPOINT_URL", "UPLOADS_BUCKET_NAME"):
        monkeypatch.delenv(name, raising=False)
    plain = Runtime.from_env(_env(MONGODB_URI="mongodb://x"))
    assert plain.settings.service_name == "transform" and plain.uploads is None
    assert plain.locations() is None  # local: every location
    asyncio.run(plain.aclose())
    deployed = Runtime.from_env(_env(MONGODB_URI="mongodb://x", APP_ENV="dev"))
    assert "in" in (deployed.locations() or [])
    asyncio.run(deployed.aclose())
    with_photos = Runtime.from_env(
        _env(
            MONGODB_URI="mongodb://x",
            UPLOADS_BUCKET_NAME=BUCKET,
            AWS_ENDPOINT_URL="http://localhost:5050",
        )
    )
    assert with_photos.uploads is not None and with_photos.uploads.config.bucket == BUCKET
    asyncio.run(with_photos.aclose())


@pytest.mark.live_service
def test_the_lifespan_shares_one_runtime_and_reports_job_metrics(
    mongo_uri, monkeypatch, fake_aws_credentials
):
    db_name = f"transform_env_{uuid.uuid4().hex[:8]}"
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
        assert {"plans", "jobs", "child_access", "personality_inputs", "growth_inputs"} <= set(
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
def test_missing_copies_are_read_through(mongo_uri):
    async def test(r: Running) -> None:
        # No child_access yet: children is asked once, and the answer kept.
        child = r.owners.add_child(version=4)
        r.owners.complete_area(child)
        assert (await r.http.get(_path(child), headers=auth_header())).status_code == 200
        assert (await r.db[CHILD_ACCESS].find_one({"_id": child}))["version"] == 4
        # A purged child is not found without asking.
        purged = r.owners.add_child()
        await r.db.tombstones.insert_one(
            {
                "_id": f"child:{purged}",
                "location": LOCATION,
                "version": 3,
                "deleted_at": datetime.now(UTC),
            }
        )
        calls = len(r.owners.calls)
        assert (await r.http.get(_path(purged), headers=auth_header())).status_code == 404
        assert len(r.owners.calls) == calls
        # The personality, read through from discover when a start needs it.
        await r.area(child)
        await r.http.patch(_path(child), json={"ask": "x"}, headers=auth_header())
        missing = await _start(r, child, "plan")
        assert missing.status_code == 503 and _code(missing) == "discover_unavailable"
        r.owners.personality(child, version=3)
        assert (await _start(r, child, "plan")).status_code == 202
        copy = await r.db["personality_inputs"].find_one({"_id": child})
        assert copy["version"] == 3 and copy["traits"]["dominant_style"] == "Thinker"
        theirs = r.owners.add_child()
        await r.copy(theirs)
        await r.area(theirs)
        await r.http.patch(_path(theirs), json={"ask": "x"}, headers=auth_header())
        r.owners.personality(theirs, user_id=OTHER)
        assert (await _start(r, theirs, "plan")).status_code == 503  # never someone else's

    live(mongo_uri, test)
