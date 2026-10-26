"""transform's worker (build plan 5.4): the generation jobs, the copies, the clearing of Life
Pathway milestones, and the deletions. The plan's check here: the Life Pathway is cleared
on an `age` or `gender` change and on `grow.area_updated`. Plus the worker end to end on
Moto (children's queue gets `transform.completed`)."""

import asyncio
import json
import logging
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

import pytest
from transform_testkit import (
    ANSWERS,
    BUCKET,
    LOCATION,
    OTHER,
    PARENT,
    PLAN_ANSWER,
    SUMMARY,
    TRACKER_ANSWER,
    FakeOpenAI,
    Running,
    area_copy,
    auth_header,
    claim,
    llm_client,
    progress,
    running,
)

from common.events import Event, SnsPublisher
from common.events.testing import assert_consumer_contract, example_event, sns_envelope
from common.generation.llm import LlmClient, LlmConfig
from common.models import CHILD_ACCESS, GROWTH_INPUTS, JOBS, ONBOARDING_INPUTS, PERSONALITY_INPUTS
from transform import worker
from transform.app import generation, lifecycle
from transform.app.store import PLANS


def live(mongo_uri: str, test: Callable[[Running], Awaitable[None]]) -> None:
    async def go() -> None:
        async with running(mongo_uri) as r:
            await test(r)

    asyncio.run(go())


def _path(child_id: str, rest: str = "") -> str:
    return f"/api/v1/children/{child_id}/transform{rest}"


async def _start(r: Running, child: str, kind: str, **body: Any) -> dict[str, Any]:
    response = await r.http.post(
        _path(child, "/generation"), json={"kind": kind, **body}, headers=auth_header()
    )
    assert response.status_code == 202, response.text
    return await claim(r.db)


async def _claim_again(r: Running, job_id: str) -> dict[str, Any]:
    await r.db[JOBS].update_one(
        {"_id": job_id}, {"$set": {"retry_after": datetime(2000, 1, 1, tzinfo=UTC)}}
    )
    job = await claim(r.db)
    assert job["_id"] == job_id
    return job


async def _plan(r: Running, child: str) -> dict[str, Any]:
    doc = await r.db[PLANS].find_one({"_id": child})
    assert doc is not None
    return doc


# ── the generations ────────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_unusable_answers_and_failures_are_retried_then_fail(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        fake = FakeOpenAI(answers=[{"y1": {"title": "x"}}, TimeoutError(), {"y1": "no"}])
        job = await _start(r, child, "life_pathway", area_id="self_care")
        llm = llm_client(fake)
        assert await generation.process(r.runtime, llm, job) == "retry"
        assert (await r.db[JOBS].find_one({"_id": job["_id"]}))["error"] == (
            "the answer couldn't be used as life_pathway"
        )
        assert (
            await generation.process(r.runtime, llm, await _claim_again(r, job["_id"])) == "retry"
        )
        assert (
            await generation.process(r.runtime, llm, await _claim_again(r, job["_id"])) == "failed"
        )
        doc = await _plan(r, child)
        assert "life_pathway" not in doc and doc["active_jobs"] == {} and "status" not in doc
        # The prompt held the area's copy, as data.
        assert "Brushes her teeth alone" in fake.prompts[0]
        # The plan and the tracker are checked against their schemas.
        await r.http.patch(_path(child), json={"ask": "Skateboarding"}, headers=auth_header())
        plan_job = await _start(r, child, "plan")
        bad = llm_client(FakeOpenAI(answers=[{**PLAN_ANSWER, "acts": []}]))
        assert await generation.process(r.runtime, bad, plan_job) == "retry"
        assert (await r.db[JOBS].find_one({"_id": plan_job["_id"]}))["error"] == (
            "the answer didn't fit the schema at acts"
        )
        unconfigured = LlmClient(LlmConfig(), circle="transform")
        assert (
            await generation.process(
                r.runtime, unconfigured, await _claim_again(r, plan_job["_id"])
            )
            == "failed"
        )

    live(mongo_uri, test)


@pytest.mark.live_service
def test_the_tracker_prompt_carries_the_event(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        await r.http.patch(
            _path(child),
            json={
                "ask": "Skateboarding",
                "event_name": "Park show",
                "event_date": "2027-03-04",
                "event_set": True,
            },
            headers=auth_header(),
        )
        plan_job = await _start(r, child, "plan")
        await generation.process(r.runtime, llm_client(FakeOpenAI(answers=[PLAN_ANSWER])), plan_job)
        fake = FakeOpenAI(answers=[TRACKER_ANSWER])
        tracker_job = await _start(r, child, "event_tracker")
        assert await generation.process(r.runtime, llm_client(fake), tracker_job) == "completed"
        assert '"date": "2027-03-04"' in fake.prompts[0] and '"Park show"' in fake.prompts[0]
        assert (await _plan(r, child))["track_steps"] == TRACKER_ANSWER

    live(mongo_uri, test)


@pytest.mark.live_service
def test_missing_copies_are_retried_and_a_deletion_drops_the_result(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        job = await _start(r, child, "life_pathway", area_id="self_care")
        await r.db[GROWTH_INPUTS].delete_many({})
        assert await generation.process(r.runtime, llm_client(), job) == "retry"
        assert (await r.db[JOBS].find_one({"_id": job["_id"]}))[
            "error"
        ] == "the area's copy isn't there yet"
        await r.area(child)
        await r.db[CHILD_ACCESS].delete_many({})
        job = await _claim_again(r, job["_id"])
        assert await generation.process(r.runtime, llm_client(), job) == "retry"
        await r.copy(child)
        job = await _claim_again(r, job["_id"])
        await r.db.tombstones.insert_one(
            {
                "_id": f"child:{child}",
                "location": LOCATION,
                "version": 4,
                "deleted_at": datetime.now(UTC),
            }
        )
        assert await generation.process(r.runtime, llm_client(), job) == "dropped"
        assert "life_pathway" not in await _plan(r, child)
        assert (
            generation.job_area({"target": {"lock": "active_jobs.generate_ninety_day_plan"}})
            is None
        )

    live(mongo_uri, test)


@pytest.mark.live_service
def test_the_job_loop_runs_until_stopped_and_survives_a_failure(mongo_uri, monkeypatch, caplog):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        await r.http.post(
            _path(child, "/generation"), json={"kind": "life_pathway", "area_id": "self_care"},
            headers=auth_header(),
        )  # fmt: skip
        real = generation.jobs.claim_next
        calls = [0]

        async def flaky(*args: Any, **kwargs: Any) -> Any:
            calls[0] += 1
            if calls[0] == 1:
                raise RuntimeError("primary stepped down")
            return await real(*args, **kwargs)

        monkeypatch.setattr(generation.jobs, "claim_next", flaky)
        stop = asyncio.Event()
        task = asyncio.create_task(generation.run_jobs(r.runtime, llm_client(), stop, poll=0.01))
        for _ in range(500):
            if (await _plan(r, child)).get("life_pathway"):
                break
            await asyncio.sleep(0.01)
        stop.set()
        await asyncio.wait_for(task, 5)
        assert (await _plan(r, child))["life_pathway"]["self_care"] and calls[0] >= 2

    with caplog.at_level(logging.ERROR, logger="transform.app.generation"):
        live(mongo_uri, test)
    assert "a job failed unexpectedly" in caplog.text


class FakeMetrics:
    def __init__(self) -> None:
        self.points: list[tuple[str, float]] = []
        self.flushes = 0

    def put(self, name: str, value: float) -> None:
        self.points.append((name, value))

    async def flush(self) -> int:
        self.flushes += 1
        if self.flushes == 1:
            raise RuntimeError("cloudwatch down")
        return 1


class NotLeader:
    async def set(self, *args: Any, **kwargs: Any) -> None:
        return None

    async def eval(self, *args: Any) -> int:
        return 0


@pytest.mark.live_service
def test_only_the_leader_reports_the_job_metrics(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        await r.http.post(
            _path(child, "/generation"), json={"kind": "life_pathway", "area_id": "self_care"},
            headers=auth_header(),
        )  # fmt: skip
        metrics = FakeMetrics()
        stop = asyncio.Event()
        task = asyncio.create_task(generation.report_jobs(r.runtime, metrics, stop, interval=0.01))
        for _ in range(500):
            if metrics.flushes >= 2:
                break
            await asyncio.sleep(0.01)
        stop.set()
        await asyncio.wait_for(task, 5)
        assert ("PendingJobCount", 1) in metrics.points
        r.runtime.cache = NotLeader()
        quiet = FakeMetrics()
        stop = asyncio.Event()
        task = asyncio.create_task(generation.report_jobs(r.runtime, quiet, stop, interval=0.01))
        await asyncio.sleep(0.05)
        stop.set()
        await asyncio.wait_for(task, 5)
        r.runtime.cache = None
        assert quiet.points == []

    live(mongo_uri, test)


# ── copies and clearing ────────────────────────────────────────────────────────


def _changed(r: Running, child: str, version: int, user_id: str = PARENT, **fields: Any) -> str:
    payload = {
        "user_id": user_id, "name": "Aarav", "age": 9, "gender": "boy", "is_deleted": False,
        "progress": progress(profile=True, conversation=True, discover=True, grow=True), **fields,
    }  # fmt: skip
    event = example_event(
        "child.changed", aggregate_id=child, location=LOCATION, version=version, payload=payload
    )
    return sns_envelope(event, r.layout["topics"]["children"])


def _grow(r: Running, event_type: str, child: str, version: int, area_id: str = "self_care") -> str:
    event = example_event(
        event_type,
        aggregate_id=child,
        location=LOCATION,
        version=version,
        payload=area_copy(area_id),
    )
    return sns_envelope(event, r.layout["topics"]["grow"])


async def _with_milestones(r: Running) -> str:
    """A child with Life Pathway milestones for two areas."""
    child = await r.ready_child()
    await r.area(child, "creativity")
    for area_id in ("self_care", "creativity"):
        await generation.process(
            r.runtime, llm_client(), await _start(r, child, "life_pathway", area_id=area_id)
        )
    assert set((await _plan(r, child))["life_pathway"]) == {"self_care", "creativity"}
    return child


@pytest.mark.live_service
def test_an_age_or_gender_change_clears_every_milestone(mongo_uri):
    async def test(r: Running) -> None:
        child = await _with_milestones(r)
        consumer = worker.build_consumer(r.runtime)
        await consumer.handle_body(_changed(r, child, 2, name="Aarav K"))  # a name isn't an input
        assert set((await _plan(r, child))["life_pathway"]) == {"self_care", "creativity"}
        await consumer.handle_body(_changed(r, child, 3, age=10))
        assert "life_pathway" not in await _plan(r, child)
        child = await _with_milestones(r)
        await consumer.handle_body(_changed(r, child, 2, gender="girl"))
        assert "life_pathway" not in await _plan(r, child)
        # An older snapshot, arriving late, clears nothing.
        child = await _with_milestones(r)
        await r.db[CHILD_ACCESS].update_one({"_id": child}, {"$set": {"version": 5}})
        await consumer.handle_body(_changed(r, child, 4, age=12))
        assert "life_pathway" in await _plan(r, child)

    live(mongo_uri, test)


@pytest.mark.live_service
def test_an_area_update_clears_that_areas_milestones(mongo_uri):
    async def test(r: Running) -> None:
        child = await _with_milestones(r)
        consumer = worker.build_consumer(r.runtime)
        assert (
            await consumer.handle_body(_grow(r, "grow.area_updated", child, 3))
        ).value == "handled"
        assert set((await _plan(r, child))["life_pathway"]) == {"creativity"}
        copy = await r.db[GROWTH_INPUTS].find_one({"_id": f"{child}:self_care"})
        assert copy["version"] == 3
        # A duplicate or older update clears nothing more; a completion clears nothing.
        await consumer.handle_body(_grow(r, "grow.area_updated", child, 2, "creativity"))
        await consumer.handle_body(_grow(r, "grow.area_completed", child, 9, "creativity"))
        assert set((await _plan(r, child))["life_pathway"]) == {"creativity"}

    live(mongo_uri, test)


@pytest.mark.live_service
def test_every_copy_keeps_the_newest_and_needs_its_owner(mongo_uri):
    async def test(r: Running) -> None:
        consumer = worker.build_consumer(r.runtime)
        assert_consumer_contract(consumer)
        child = str(uuid.uuid4())
        with pytest.raises(lifecycle.OwnerUnknown):
            await lifecycle.copy_inputs(
                r.runtime,
                consumer.check(sns_envelope(
                    example_event("onboarding.conversation_completed", aggregate_id=child,
                                  location=LOCATION, payload=dict(ANSWERS)),
                    r.layout["topics"]["onboarding"],
                )),
            )  # fmt: skip
        await consumer.handle_body(_changed(r, child, 1))
        onboarding = example_event(
            "onboarding.conversation_completed",
            aggregate_id=child,
            location=LOCATION,
            payload=dict(ANSWERS),
        )
        await consumer.handle_body(sns_envelope(onboarding, r.layout["topics"]["onboarding"]))
        assert (await r.db[ONBOARDING_INPUTS].find_one({"_id": child}))["user_id"] == PARENT
        summary = example_event(
            "discover.personality_finalised", aggregate_id=child, location=LOCATION,
            payload={"user_id": PARENT, **SUMMARY},
        )  # fmt: skip
        await consumer.handle_body(sns_envelope(summary, r.layout["topics"]["discover"]))
        assert (await r.db[PERSONALITY_INPUTS].find_one({"_id": child}))["strengths"] == SUMMARY[
            "strengths"
        ]
        await consumer.handle_body(_grow(r, "grow.area_completed", child, 2))
        assert (await r.db[GROWTH_INPUTS].find_one({"_id": f"{child}:self_care"}))[
            "area_name"
        ] == "Self Care"
        await consumer.handle_body(_changed(r, child, 0 + 1, user_id=OTHER))  # a duplicate version
        assert (await r.db[CHILD_ACCESS].find_one({"_id": child}))["user_id"] == PARENT

    live(mongo_uri, test)


# ── deletions ──────────────────────────────────────────────────────────────────


def _child_deleted(r: Running, child: str, version: int) -> str:
    event = example_event(
        "child.deleted",
        aggregate_id=child,
        location=LOCATION,
        version=version,
        payload={"user_id": PARENT},
    )
    return sns_envelope(event, r.layout["topics"]["children"])


def _deletion(r: Running, user_id: str = PARENT, version: int = 2) -> str:
    event = Event.new(
        "user.deletion_requested", producer="auth", aggregate_id=user_id,
        location=LOCATION, version=version, region="ap-south-1",
    )  # fmt: skip
    return sns_envelope(event, r.layout["topics"]["auth"])


def _photo(r: Running, child: str) -> str:
    key = f"uploads/{LOCATION}/{child}/ninety-day-plan/{uuid.uuid4()}.jpg"
    assert r.runtime.uploads is not None
    r.runtime.uploads.client.put_object(Bucket=BUCKET, Key=key, Body=b"x", ContentType="image/jpeg")
    return key


def _keys(r: Running) -> set[str]:
    assert r.runtime.uploads is not None
    listed = r.runtime.uploads.client.list_objects_v2(Bucket=BUCKET)
    return {o["Key"] for o in listed.get("Contents", [])}


@pytest.mark.live_service
def test_a_purged_child_is_deleted_with_its_plan_photos_and_jobs(mongo_uri):
    async def test(r: Running) -> None:
        child, kept = await r.ready_child(), await r.ready_child()
        gone, stays = _photo(r, child), _photo(r, kept)
        await r.http.patch(_path(child), json={"photos": {"x": [gone]}}, headers=auth_header())
        await r.http.post(
            _path(child, "/generation"), json={"kind": "life_pathway", "area_id": "self_care"},
            headers=auth_header(),
        )  # fmt: skip
        await r.http.patch(_path(kept), json={"ask": "x"}, headers=auth_header())
        consumer = worker.build_consumer(r.runtime)
        assert (await consumer.handle_body(_child_deleted(r, child, 7))).value == "handled"
        for name in (PLANS, CHILD_ACCESS, PERSONALITY_INPUTS):
            assert await r.db[name].find_one({"_id": child}) is None
        assert await r.db[GROWTH_INPUTS].count_documents({"child_id": child}) == 0
        assert await r.db[PLANS].find_one({"_id": kept}) is not None
        assert _keys(r) == {stays}
        assert (await r.db[JOBS].find_one({"child_id": child}))["error"] == "cancelled"
        assert (await r.db.tombstones.find_one({"_id": f"child:{child}"}))["version"] == 7

    live(mongo_uri, test)


@pytest.mark.live_service
def test_account_deletion_removes_everything_and_always_confirms(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        await r.http.patch(
            _path(child), json={"photos": {"x": [_photo(r, child)]}}, headers=auth_header()
        )
        theirs = r.owners.add_child(user_id=OTHER)
        await r.copy(theirs, user_id=OTHER)
        consumer = worker.build_consumer(r.runtime)
        assert (await consumer.handle_body(_deletion(r))).value == "handled"
        for name in (PLANS, GROWTH_INPUTS, CHILD_ACCESS, PERSONALITY_INPUTS):
            assert await r.db[name].count_documents({"user_id": PARENT}) == 0
        assert await r.db[CHILD_ACCESS].count_documents({"user_id": OTHER}) == 1
        assert _keys(r) == set()
        await consumer.handle_body(_deletion(r))
        await consumer.handle_body(_deletion(r, str(uuid.uuid4())))
        assert await r.db.outbox.count_documents({"event_type": "user.data_deleted"}) == 3

    live(mongo_uri, test)


@pytest.mark.live_service
def test_deletions_without_an_uploads_bucket(mongo_uri):
    async def test(r: Running) -> None:
        r.runtime.uploads = None
        child = await r.ready_child()
        consumer = worker.build_consumer(r.runtime)
        await consumer.handle_body(_child_deleted(r, child, 3))
        await consumer.handle_body(_deletion(r))
        assert await r.db.outbox.count_documents({"event_type": "user.data_deleted"}) == 1

    live(mongo_uri, test)


# ── the worker ─────────────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_the_worker_generates_completes_and_publishes_until_stopped(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        await r.http.patch(
            _path(child),
            json={
                "ask": "Skateboarding",
                "event_name": "Show",
                "event_date": "2027-01-01",
                "event_set": True,
            },
            headers=auth_header(),
        )
        await r.http.post(_path(child, "/generation"), json={"kind": "plan"}, headers=auth_header())
        # grow's relay publishes; SNS delivers to transform's queue.
        await SnsPublisher(r.runtime.sns, r.layout["topics"]["grow"]).publish(
            example_event("grow.area_completed", aggregate_id=child, location=LOCATION, version=3,
                          payload=area_copy("creativity"))
        )  # fmt: skip
        stop = asyncio.Event()
        fake = FakeOpenAI(answers=[PLAN_ANSWER])
        task = asyncio.create_task(
            worker.run(r.runtime, llm_client(fake), stop, wait_seconds=0, poll=0.05)
        )
        loop = asyncio.get_running_loop()
        deadline = loop.time() + 20
        while True:
            doc = await _plan(r, child)
            copied = await r.db[GROWTH_INPUTS].count_documents({}) == 2
            published = await r.db.outbox.count_documents({"published_at": None}) == 0
            if doc.get("completed_at") and copied and published:
                break
            assert loop.time() < deadline, "the worker didn't generate, copy and relay"
            await asyncio.sleep(0.1)
        stop.set()
        await asyncio.wait_for(task, 15)
        messages = r.runtime.sqs.receive_message(
            QueueUrl=r.layout["queues"]["children"], MaxNumberOfMessages=10, WaitTimeSeconds=0
        ).get("Messages", [])
        types = {json.loads(json.loads(m["Body"])["Message"])["event_type"] for m in messages}
        assert "transform.completed" in types

    live(mongo_uri, test)


@pytest.mark.live_service
def test_the_worker_needs_its_queue(mongo_uri):
    async def test(r: Running) -> None:
        r.runtime.settings.events_queue_url = None
        with pytest.raises(RuntimeError, match="EVENTS_QUEUE_URL"):
            await worker.run(r.runtime, llm_client(), asyncio.Event())

    live(mongo_uri, test)
