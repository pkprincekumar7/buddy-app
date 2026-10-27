"""The grow endpoints (build plan 5.3). The plan's checks:
- today's area ids (`self_care`, `life_ambition`, …) are accepted;
- generated fields can't be PUT;
- `grow.area_updated` is published when AI recommendations arrive for a completed area
  (test_grow_worker.py).
Plus the area's whole journey, the circle rules, races, the internal routes and configuration."""

import asyncio
import json
import uuid
from collections.abc import Awaitable, Callable
from types import SimpleNamespace
from typing import Any

import httpx
import pytest
from fastapi.routing import APIRoute
from grow_testkit import (
    ADMIN,
    GROW_PRIVATE,
    LOCATION,
    OTHER,
    PARENT,
    RECOMMENDATIONS_ANSWER,
    ROUNDS_ANSWER,
    FakeOpenAI,
    Running,
    auth_header,
    claim,
    llm_client,
    progress,
    running,
    service_header,
)
from pymongo import MongoClient
from pymongo.errors import OperationFailure

from common.generation.jobs import TargetRefused
from common.models import CHILD_ACCESS, JOBS
from common.routers import assert_every_route_has_a_policy
from grow.app import generation, main
from grow.app.runtime import Runtime
from grow.app.store import GROWTH_AREAS, area_doc_id


def live(mongo_uri: str, test: Callable[[Running], Awaitable[None]], **options: Any) -> None:
    async def go() -> None:
        async with running(mongo_uri, **options) as r:
            await test(r)

    asyncio.run(go())


def _path(child_id: str, rest: str = "") -> str:
    return f"/api/v1/children/{child_id}/growth-areas{rest}"


def _code(response: httpx.Response) -> str:
    return response.json()["detail"]["code"]


def _area(**fields: Any) -> dict[str, Any]:
    return {"area_name": "Self Care", "status": "in_progress", "answers": {}, **fields}


async def _generate(r: Running, child: str, area: str, kind: str, answer: Any = None) -> str:
    """Start the kind for the area and run its job, as the worker would."""
    started = await r.http.post(
        _path(child, f"/{area}/generation"), json={"kind": kind}, headers=auth_header()
    )
    assert started.status_code == 202, started.text
    fake = FakeOpenAI(answers=[answer]) if answer is not None else FakeOpenAI()
    assert await generation.process(r.runtime, llm_client(fake), await claim(r.db)) == "completed"
    return str(started.json()["job_id"])


async def _events(r: Running) -> list[tuple[str, int]]:
    rows = await r.db.outbox.find({}).sort("created_at", 1).to_list(None)
    return [(row["event_type"], row["version"]) for row in rows]


# ── shape ──────────────────────────────────────────────────────────────────────


def test_every_route_declares_a_policy_and_stays_on_its_app():
    assert_every_route_has_a_policy(main.app)
    assert_every_route_has_a_policy(main.internal_app)
    base = "/api/v1/children/{id}/growth-areas"
    public = {r.path for r in main.app.routes if isinstance(r, APIRoute)}
    assert public == {
        "/health", base, f"{base}/{{area_id}}", f"{base}/{{area_id}}/generation",
        f"{base}/{{area_id}}/generation/{{job_id}}",
    }  # fmt: skip
    internal = {r.path for r in main.internal_app.routes if isinstance(r, APIRoute)}
    assert internal == {
        "/internal/ping",
        "/internal/grow/children/{id}/status",
        "/internal/grow/children/{id}/areas",
    }


def _public(method: str, path: str, **kwargs: Any) -> httpx.Response:
    async def go() -> httpx.Response:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app), base_url="http://g"
        ) as http:
            return await http.request(method, path, **kwargs)

    return asyncio.run(go())


def test_health_and_an_unconfigured_service():
    assert _public("GET", "/health").json() == {"status": "ok", "service": "grow"}
    assert _public("GET", _path(str(uuid.uuid4())), headers=auth_header()).status_code == 503


# ── an area's journey ──────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_an_area_from_its_questions_to_completion(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        assert (await r.http.get(_path(child), headers=auth_header())).json() == {"areas": []}
        # The questions first: they create the area.
        started = await r.http.post(
            _path(child, "/life_ambition/generation"),
            json={"kind": "parent_questions"},
            headers=auth_header(),
        )
        assert started.status_code == 202
        (area,) = (await r.http.get(_path(child), headers=auth_header())).json()["areas"]
        assert (area["area_id"], area["area_name"], area["status"]) == (
            "life_ambition", "Life Ambition", "in_progress",
        )  # fmt: skip
        assert area["generating"] == ["parent_questions"] and area["parent_questions"] is None
        await generation.process(r.runtime, llm_client(), await claim(r.db))
        (area,) = (await r.http.get(_path(child), headers=auth_header())).json()["areas"]
        questions = area["parent_questions"]["questions"]
        assert [q["id"] for q in questions] == [f"life_ambition_gq{n}" for n in range(1, 6)]
        assert area["generating"] == []
        again = await r.http.post(
            _path(child, "/life_ambition/generation"),
            json={"kind": "parent_questions"},
            headers=auth_header(),
        )
        assert again.status_code == 409 and _code(again) == "already_generated"
        # The parent answers, by question id.
        answers = {
            "life_ambition_gq1": "She brushes her teeth alone.",
            "life_ambition_gq2": "Most days.",
        }
        saved = await r.http.put(
            _path(child, "/life_ambition"),
            json=_area(area_name="Life Ambition", answers=answers, step="q2"),
            headers=auth_header(),
        )
        assert saved.status_code == 200 and saved.json()["answers"] == answers
        assert saved.json()["step"] == "q2"
        # The child's rounds, grounded in those answers; then the child plays.
        await _generate(r, child, "life_ambition", "child_rounds", ROUNDS_ANSWER)
        picks = ["life_ambition_gr1a", "life_ambition_gr2b"]
        await r.http.put(
            _path(child, "/life_ambition"),
            json=_area(
                area_name="Life Ambition", answers=answers, child_activity={"selections": picks}
            ),
            headers=auth_header(),
        )
        await _generate(r, child, "life_ambition", "recommendations", RECOMMENDATIONS_ANSWER)
        (area,) = (await r.http.get(_path(child), headers=auth_header())).json()["areas"]
        recs = area["ai_three_month_recommendations"]
        assert recs[0] == {
            "title": "Start a bedtime routine",
            "detail": "Every night at eight, read together for ten minutes.",
        }
        assert area["status"] == "in_progress"  # jobs never change the parent's status
        assert await _events(r) == []  # nothing published before completion
        done = await r.http.put(
            _path(child, "/life_ambition"),
            json=_area(area_name="Life Ambition", answers=answers, status="completed", step="summary",
                       child_activity={"selections": picks}),
            headers=auth_header(),
        )  # fmt: skip
        body = done.json()
        assert body["status"] == "completed" and body["step"] is None and body["completed_at"]
        doc = await r.db[GROWTH_AREAS].find_one({"_id": area_doc_id(child, "life_ambition")})
        assert await _events(r) == [
            ("grow.area_completed", doc["version"]),
            ("grow.completed", doc["version"]),
        ]
        row = await r.db.outbox.find_one({"event_type": "grow.area_completed"})
        assert row["aggregate_id"] == child and row["payload"]["area_id"] == "life_ambition"
        assert row["payload"]["ai_three_month_recommendations"] == recs
        assert row["payload"]["user_id"] == PARENT
        # What release's observations read: the questions with the answers, and the picks.
        assert [pair["answer"] for pair in row["payload"]["reflections"]] == list(answers.values())
        assert (
            row["payload"]["reflections"][0]["question"]
            == "What does Aarav do when question 1 happens?"
        )
        assert row["payload"]["child_choices"] == [
            "Chose “Build a thing number 0” over “Tell a story number 0”",
            "Chose “Tell a story number 1” over “Build a thing number 1”",
        ]

    live(mongo_uri, test)


@pytest.mark.live_service
def test_completions_edits_and_identical_saves(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        for area_id in ("life_ambition", "self_care"):
            response = await r.http.put(
                _path(child, f"/{area_id}"), json=_area(area_name="X", status="completed"),
                headers=auth_header(),
            )  # fmt: skip
            assert response.status_code == 200
        kinds = [event for event, _ in await _events(r)]
        # Only the first completed area completes Grow.
        assert kinds == ["grow.area_completed", "grow.completed", "grow.area_completed"]
        same = await r.http.put(
            _path(child, "/self_care"), json=_area(area_name="X", status="completed"),
            headers=auth_header(),
        )  # fmt: skip
        assert same.status_code == 200 and len(await _events(r)) == 3
        edited = await r.http.put(
            _path(child, "/self_care"),
            json=_area(area_name="X", status="completed", feedback="More outdoor ideas"),
            headers=auth_header(),
        )
        assert edited.json()["feedback"] == "More outdoor ideas"
        assert (await _events(r))[-1] == ("grow.area_updated", 2)
        back = await r.http.put(
            _path(child, "/self_care"), json=_area(area_name="X"), headers=auth_header()
        )
        assert back.status_code == 422 and _code(back) == "area_completed"
        # A child's areas come back in the order they were started.
        listed = (await r.http.get(_path(child), headers=auth_header())).json()["areas"]
        assert [a["area_id"] for a in listed] == ["life_ambition", "self_care"]

    live(mongo_uri, test)


@pytest.mark.live_service
@pytest.mark.parametrize(
    ("body", "code"),
    [
        (_area(parent_questions={"questions": []}), None),  # generated: grow's jobs only
        (_area(child_rounds={}), None),
        (_area(ai_three_month_recommendations=[]), None),
        (_area(selected_activity="x"), None),  # a dropped wizard field
        (_area(answers={"made_up": "x"}), "unknown_question"),
        (_area(status="done"), None),
        (_area(area_name=""), None),
        (_area(answers={"q": 3}), None),  # strict: no coercion
        (_area(child_activity={"selections": ["x" * 1000] * 50},
               recommendations=["y" * 1000] * 50), "area_too_large"),
    ],
)  # fmt: skip
def test_invalid_saves_are_422(mongo_uri, body, code):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        response = await r.http.put(_path(child, "/self_care"), json=body, headers=auth_header())
        assert response.status_code == 422
        if code:
            assert _code(response) == code
        assert await r.db[GROWTH_AREAS].count_documents({}) == 0

    live(mongo_uri, test)


@pytest.mark.live_service
def test_area_ids(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        for area_id in ("self_care", "life_ambition", "critical_thinking", "my_own"):
            saved = await r.http.put(
                _path(child, f"/{area_id}"), json=_area(), headers=auth_header()
            )
            assert saved.status_code == 200, area_id
        for area_id in ("onboarding_x", "personality2", "transform", "connect-x"):
            refused = await r.http.put(
                _path(child, f"/{area_id}"), json=_area(), headers=auth_header()
            )
            assert refused.status_code == 422 and _code(refused) == "invalid_area_id"
        assert (
            await r.http.put(_path(child, "/Self"), json=_area(), headers=auth_header())
        ).status_code == 422
        # Generation is for the six areas the apps show.
        custom = await r.http.post(
            _path(child, "/my_own/generation"),
            json={"kind": "parent_questions"},
            headers=auth_header(),
        )
        assert custom.status_code == 422 and _code(custom) == "unknown_area"
        assert (
            await r.http.post(
                _path(child, "/transform/generation"),
                json={"kind": "child_rounds"},
                headers=auth_header(),
            )
        ).status_code == 422

    live(mongo_uri, test)


# ── generation rules ───────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_generation_needs_its_area_and_answers_and_returns_the_running_job(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()

        async def start(area: str, kind: str, **extra: Any) -> httpx.Response:
            return await r.http.post(
                _path(child, f"/{area}/generation"),
                json={"kind": kind, **extra},
                headers=auth_header(),
            )

        missing = await start("creativity", "child_rounds")
        assert missing.status_code == 404 and _code(missing) == "area_not_found"
        named = await start("creativity", "parent_questions", area_name="Making things")
        assert named.status_code == 202
        doc = await r.db[GROWTH_AREAS].find_one({"_id": area_doc_id(child, "creativity")})
        assert doc["area_name"] == "Making things" and doc["version"] == 1
        running = await start("creativity", "parent_questions")
        assert running.status_code == 200 and running.json()["job_id"] == named.json()["job_id"]
        needs = await start("creativity", "recommendations")
        assert needs.status_code == 409 and _code(needs) == "needs_answers"
        # Each kind has its own lock: the rounds start while the questions run.
        rounds = await start("creativity", "child_rounds")
        assert rounds.status_code == 202 and await r.db[JOBS].count_documents({}) == 2
        job = await r.http.get(
            _path(child, f"/creativity/generation/{rounds.json()['job_id']}"), headers=auth_header()
        )
        assert job.json()["kind"] == "child_rounds" and job.json()["status"] == "pending"
        wrong_area = await r.http.get(
            _path(child, f"/self_care/generation/{rounds.json()['job_id']}"), headers=auth_header()
        )
        assert wrong_area.status_code == 404 and _code(wrong_area) == "job_not_found"

    live(mongo_uri, test)


@pytest.mark.live_service
def test_starts_count_against_the_hourly_llm_limit(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        first = await r.http.post(
            _path(child, "/self_care/generation"),
            json={"kind": "parent_questions"},
            headers=auth_header(),
        )
        assert first.status_code == 202
        limited = await r.http.post(
            _path(child, "/creativity/generation"),
            json={"kind": "parent_questions"},
            headers=auth_header(),
        )
        assert limited.status_code == 429 and _code(limited) == "llm_limit"

    live(mongo_uri, test, llm_hourly_limit=1)


@pytest.mark.live_service
def test_a_start_reads_the_copies_through_and_reports_failures(mongo_uri, monkeypatch):
    async def test(r: Running) -> None:
        child = r.owners.add_child()
        await r.copy(child)  # neither the answers nor the personality copied yet
        start = {"json": {"kind": "parent_questions"}, "headers": auth_header()}
        missing = await r.http.post(_path(child, "/self_care/generation"), **start)
        assert missing.status_code == 503 and _code(missing) == "onboarding_unavailable"
        r.owners.complete(child, version=4)
        no_personality = await r.http.post(_path(child, "/self_care/generation"), **start)
        assert no_personality.status_code == 503 and _code(no_personality) == "discover_unavailable"
        r.owners.personality(child, version=3)
        assert (
            await r.http.post(_path(child, "/self_care/generation"), **start)
        ).status_code == 202
        copy = await r.db["personality_inputs"].find_one({"_id": child})
        assert copy["version"] == 3 and copy["traits"]["dominant_style"] == "Thinker"
        assert (await r.db[JOBS].find_one({}))["input_version"] == 4
        # Someone else's personality is never copied.
        theirs = r.owners.add_child()
        await r.copy(theirs)
        await r.answers(theirs)
        r.owners.personality(theirs, user_id=OTHER)
        assert (
            await r.http.post(_path(theirs, "/self_care/generation"), **start)
        ).status_code == 503
        # A deleted account refuses; a database failure is 503, not 500.
        other = await r.ready_child()
        await r.db.tombstones.insert_one(
            {
                "_id": f"user:{PARENT}",
                "location": LOCATION,
                "version": 2,
                "deleted_at": copy["updated_at"],
            }
        )
        assert (
            await r.http.post(_path(other, "/self_care/generation"), **start)
        ).status_code == 404
        await r.db.tombstones.delete_many({})

        async def broken(*args: Any, **kwargs: Any) -> Any:
            raise OperationFailure("primary stepped down")

        monkeypatch.setattr(generation, "start", broken)
        down = await r.http.post(_path(other, "/self_care/generation"), **start)
        assert down.status_code == 503 and _code(down) == "generation_unavailable"

    live(mongo_uri, test)


# ── access ─────────────────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_a_locked_copy_is_confirmed_with_discover_before_refusing(mongo_uri):
    async def test(r: Running) -> None:
        child = r.owners.add_child()
        await r.copy(child, progress=progress(profile=True, conversation=True))
        r.owners.personality(child, done=False)  # ready, but the reveal isn't passed
        locked = await r.http.get(_path(child), headers=auth_header())
        assert locked.status_code == 403 and _code(locked) == "circle_locked"
        r.owners.personality(child)
        assert (await r.http.get(_path(child), headers=auth_header())).status_code == 200
        copy = await r.db[CHILD_ACCESS].find_one({"_id": child})
        assert copy["confirmed"] == {"discover": True} and copy["progress"]["discover"] is False

    live(mongo_uri, test)


@pytest.mark.live_service
def test_owners_down_are_503_and_missing_copies_read_through(mongo_uri):
    async def test(r: Running) -> None:
        child = r.owners.add_child(version=6)
        assert (await r.http.get(_path(child), headers=auth_header())).status_code == 200
        assert (await r.db[CHILD_ACCESS].find_one({"_id": child}))["version"] == 6
        locked = r.owners.add_child(progress=progress(profile=True, conversation=True))
        await r.copy(locked, progress=progress(profile=True, conversation=True))
        for kind in ("down", "broken", "odd"):
            getattr(r.owners, kind).add("discover")
            response = await r.http.get(_path(locked), headers=auth_header())
            assert response.status_code == 503 and _code(response) == "discover_unavailable"
            getattr(r.owners, kind).discard("discover")

    live(mongo_uri, test)


@pytest.mark.live_service
def test_someone_elses_child_is_not_found_and_admins_only_read(mongo_uri):
    async def test(r: Running) -> None:
        theirs = r.owners.add_child(user_id=OTHER)
        await r.copy(theirs, user_id=OTHER)
        for method, rest, body in (
            ("GET", "", None), ("PUT", "/self_care", _area()),
            ("POST", "/self_care/generation", {"kind": "parent_questions"}),
        ):  # fmt: skip
            response = await r.http.request(
                method, _path(theirs, rest), json=body, headers=auth_header()
            )
            assert response.status_code == 404 and _code(response) == "child_not_found"
        child = await r.ready_child(progress=progress(profile=True))  # no unlock check for admins
        admin = auth_header(ADMIN)
        no_location = await r.http.get(_path(child), headers=admin)
        assert no_location.status_code == 422 and _code(no_location) == "location_required"
        read = await r.http.get(_path(child), params={"location": LOCATION}, headers=admin)
        assert read.status_code == 200 and read.json() == {"areas": []}
        unknown = _path(str(uuid.uuid4()))
        missing = await r.http.get(unknown, params={"location": LOCATION}, headers=admin)
        assert missing.status_code == 404
        # Refused reads are audited too: a probe for ids or locations leaves a trace.
        audited = [(e.subject_id, e.outcome, e.status) for e in r.audit if e.privileged]
        assert audited == [(None, "denied", 422), (PARENT, "allowed", 200), (None, "denied", 404)]
        assert (
            await r.http.put(_path(child, "/self_care"), json=_area(), headers=admin)
        ).status_code == 404

    live(mongo_uri, test)


# ── races ──────────────────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_two_first_saves_at_once_make_one_area(mongo_uri, monkeypatch):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        real = main.is_tombstoned
        mongo: MongoClient[dict[str, Any]] = MongoClient(mongo_uri)
        raced: list[bool] = []

        async def other_save_first(*args: Any, **kwargs: Any) -> bool:
            if not raced:  # another tab's first save commits between our read and our insert
                raced.append(True)
                from datetime import UTC, datetime

                now = datetime.now(UTC)
                mongo[r.db.name][GROWTH_AREAS].insert_one(
                    {
                        "_id": area_doc_id(child, "self_care"),
                        "user_id": PARENT,
                        "child_id": child,
                        "location": LOCATION,
                        "area_id": "self_care",
                        "area_name": "Self Care",
                        "status": "in_progress",
                        "answers": {},
                        "version": 1,
                        "created_at": now,
                        "updated_at": now,
                        "schema_version": 1,
                    }  # fmt: skip
                )
            return await real(*args, **kwargs)

        monkeypatch.setattr(main, "is_tombstoned", other_save_first)
        saved = await r.http.put(
            _path(child, "/self_care"), json=_area(step="q1"), headers=auth_header()
        )
        mongo.close()
        assert saved.status_code == 200 and saved.json()["step"] == "q1"
        doc = await r.db[GROWTH_AREAS].find_one({})
        assert doc["version"] == 2 and await r.db[GROWTH_AREAS].count_documents({}) == 1

    live(mongo_uri, test)


@pytest.mark.live_service
def test_an_area_that_keeps_changing_is_409_and_a_deletion_meanwhile_404(mongo_uri, monkeypatch):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        await r.http.put(_path(child, "/self_care"), json=_area(), headers=auth_header())
        real = main.is_tombstoned

        async def changed_each_time(*args: Any, **kwargs: Any) -> bool:
            await r.db[GROWTH_AREAS].update_one({}, {"$inc": {"version": 1}})
            return await real(*args, **kwargs)

        monkeypatch.setattr(main, "is_tombstoned", changed_each_time)
        response = await r.http.put(
            _path(child, "/self_care"), json=_area(step="x"), headers=auth_header()
        )
        assert response.status_code == 409 and _code(response) == "area_changed"

        async def deleted(*args: Any, **kwargs: Any) -> bool:
            return True

        monkeypatch.setattr(main, "is_tombstoned", deleted)
        assert (
            await r.http.put(
                _path(child, "/self_care"), json=_area(step="y"), headers=auth_header()
            )
        ).status_code == 404

    live(mongo_uri, test)


# ── internal routes ────────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_transform_confirms_grow_and_circles_read_the_completed_areas(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        status = f"/internal/grow/children/{child}/status"
        areas = f"/internal/grow/children/{child}/areas"
        params = {"location": LOCATION}
        assert (await r.internal.get(status, params=params, headers=service_header())).json() == {
            "completed": False
        }
        await r.http.put(_path(child, "/self_care"), json=_area(), headers=auth_header())
        empty = await r.internal.get(areas, params=params, headers=service_header("release"))
        assert empty.json() == {"areas": []}  # in progress isn't copied
        await r.http.put(
            _path(child, "/self_care"),
            json=_area(status="completed", child_activity={"results": {"summary": "Loves rest"}}),
            headers=auth_header(),
        )
        assert (await r.internal.get(status, params=params, headers=service_header())).json() == {
            "completed": True
        }
        copies = (
            await r.internal.get(areas, params=params, headers=service_header("release"))
        ).json()
        assert copies == {
            "areas": [{
                "child_id": child, "user_id": PARENT, "location": LOCATION, "area_id": "self_care",
                "area_name": "Self Care", "answers": {},
                "child_activity_results": {"summary": "Loves rest", "strengths": None,
                                           "suggested_activities": None},
                "recommendations": None, "ai_three_month_recommendations": None,
                "reflections": [], "child_choices": [], "version": 2,
            }]
        }  # fmt: skip
        # Only transform confirms; children reads neither; a token is required.
        assert (
            await r.internal.get(status, params=params, headers=service_header("release"))
        ).status_code == 403
        assert (
            await r.internal.get(areas, params=params, headers=service_header("children"))
        ).status_code == 403
        assert (await r.internal.get(status, params=params)).status_code == 401
        assert (await r.internal.get("/internal/ping")).json()["service"] == "grow"

    live(mongo_uri, test)


# ── limits and configuration ───────────────────────────────────────────────────


@pytest.mark.live_service
def test_starting_is_limited_to_10_a_minute(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        statuses = [
            (
                await r.http.post(
                    _path(child, "/self_care/generation"),
                    json={"kind": "parent_questions"},
                    headers=auth_header(),
                )
            ).status_code
            for _ in range(11)
        ]
        assert statuses[0] == 202 and statuses[-1] == 429 and statuses.count(429) == 1

    live(mongo_uri, test)


def test_no_cloudwatch_means_no_job_metrics():
    main._start_reporting(SimpleNamespace(cloudwatch=None))  # type: ignore[arg-type]
    assert main._reporting is None
    asyncio.run(main._stop_reporting())


def _env(**extra: str) -> dict[str, str]:
    from grow_testkit import JWT_PUBLIC, KID

    return {
        "MONGODB_DB_NAME": "x",
        "JWT_PUBLIC_KEYS": json.dumps({KID: JWT_PUBLIC}),
        "INTERNAL_SIGNING_KID": "g1",
        "INTERNAL_SIGNING_KEY": GROW_PRIVATE,
        "INTERNAL_PUBLIC_KEYS": "{}",
        **extra,
    }


def test_from_env_builds_every_part(fake_aws_credentials, monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    for name in ("REDIS_URL", "AWS_ENDPOINT_URL", "LLM_HOURLY_LIMIT"):
        monkeypatch.delenv(name, raising=False)
    plain = Runtime.from_env(_env(MONGODB_URI="mongodb://x"))
    assert plain.settings.service_name == "grow" and plain.locations() is None
    asyncio.run(plain.aclose())
    deployed = Runtime.from_env(
        _env(MONGODB_URI="mongodb://x", AWS_ENDPOINT_URL="http://localhost:5050", APP_ENV="dev")
    )
    assert "in" in (deployed.locations() or [])
    asyncio.run(deployed.aclose())


@pytest.mark.live_service
def test_the_lifespan_shares_one_runtime_and_reports_job_metrics(
    mongo_uri, monkeypatch, fake_aws_credentials
):
    db_name = f"grow_env_{uuid.uuid4().hex[:8]}"
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
            "growth_areas",
            "jobs",
            "child_access",
            "onboarding_inputs",
            "personality_inputs",
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
def test_purged_or_unknown_children_are_not_found(mongo_uri):
    async def test(r: Running) -> None:
        unknown = str(uuid.uuid4())
        assert (await r.http.get(_path(unknown), headers=auth_header())).status_code == 404
        purged = r.owners.add_child()
        await r.db.tombstones.insert_one(
            {"_id": f"child:{purged}", "location": LOCATION, "version": 3,
             "deleted_at": datetime_now()}
        )  # fmt: skip
        calls = len(r.owners.calls)
        assert (await r.http.get(_path(purged), headers=auth_header())).status_code == 404
        assert len(r.owners.calls) == calls  # not asked

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_start_that_lost_the_race_returns_the_winners_job(mongo_uri, monkeypatch):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        real = generation.start

        async def lost(*args: Any, **kwargs: Any) -> tuple[str, bool]:
            job_id, _ = await real(*args, **kwargs)
            return job_id, False  # another request's start got there first

        monkeypatch.setattr(generation, "start", lost)
        response = await r.http.post(
            _path(child, "/self_care/generation"),
            json={"kind": "parent_questions"},
            headers=auth_header(),
        )
        assert response.status_code == 200 and response.json()["status"] == "pending"

    live(mongo_uri, test)


def datetime_now() -> Any:
    from datetime import UTC, datetime

    return datetime.now(UTC)


def test_reflections_keep_answers_whose_questions_are_gone():
    doc = {"answers": {"old_q1": " Brushes alone ", "old_q2": " "}, "parent_questions": None}
    assert generation.reflections(doc) == [{"question": "", "answer": "Brushes alone"}]
    assert generation.child_choices({"child_rounds": {"rounds": [
        {"a": {"id": "a1", "text": "A"}, "b": {"id": "b1", "text": "B"}},
    ]}, "child_activity": {"selections": ["nope"]}}) == []  # fmt: skip


@pytest.mark.live_service
@pytest.mark.parametrize("bad", ["abc%3Flocation%3Devil%26x%3D", "abc%23", "not-a-uuid"])
def test_a_child_id_must_be_a_uuid(mongo_uri, bad):
    # Found by the Phase 5-6 review: `%3F` decodes into the id, which went into the
    # internal call's URL and could rewrite its query.
    async def test(r: Running) -> None:
        response = await r.http.get(_path(bad), headers=auth_header())
        assert response.status_code == 422

    live(mongo_uri, test)


@pytest.mark.live_service
def test_generated_once_is_checked_again_in_the_start_and_refunded(mongo_uri, monkeypatch):
    # Found by the Phase 5-6 review: a job finishing between the route's check and the start
    # could be followed by a second one, rewriting the questions under the parent's answers.
    async def test(r: Running) -> None:
        child = await r.ready_child()

        async def refused(*args: Any, **kwargs: Any) -> Any:
            raise TargetRefused("area")

        monkeypatch.setattr(generation, "start", refused)
        response = await r.http.post(
            f"/api/v1/children/{child}/growth-areas/self_care/generation",
            json={"kind": "parent_questions"},
            headers=auth_header(),
        )
        assert response.status_code == 409 and _code(response) == "already_generated"
        assert not r.runtime.llm_limit._memory.get(PARENT)

    live(mongo_uri, test)
