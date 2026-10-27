"""release's worker (build plan 5.5): the generation jobs, the copies and the deletions, and the
worker end to end on Moto (children's queue gets `release.completed`)."""

import asyncio
import json
import logging
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

import pytest
from release_testkit import (
    ANSWERS,
    LOCATION,
    OBSERVATIONS_ANSWER,
    OTHER,
    PARENT,
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
from common.events.testing import (
    assert_consumer_contract,
    example_event,
    seed_user_outbox,
    seeded_outbox_left,
    sns_envelope,
)
from common.generation import jobs
from common.generation.llm import LlmClient, LlmConfig
from common.models import CHILD_ACCESS, GROWTH_INPUTS, JOBS, ONBOARDING_INPUTS
from release import worker
from release.app import generation, lifecycle
from release.app.store import OBSERVATIONS


def live(mongo_uri: str, test: Callable[[Running], Awaitable[None]]) -> None:
    async def go() -> None:
        async with running(mongo_uri) as r:
            await test(r)

    asyncio.run(go())


def _path(child_id: str, rest: str = "") -> str:
    return f"/api/v1/children/{child_id}/observations{rest}"


async def _start(r: Running, child: str) -> dict[str, Any]:
    response = await r.http.post(_path(child, "/generation"), headers=auth_header())
    assert response.status_code == 202, response.text
    return await claim(r.db)


async def _claim_again(r: Running, job_id: str) -> dict[str, Any]:
    await r.db[JOBS].update_one(
        {"_id": job_id}, {"$set": {"retry_after": datetime(2000, 1, 1, tzinfo=UTC)}}
    )
    job = await claim(r.db)
    assert job["_id"] == job_id
    return job


# ── the generation ─────────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_unusable_answers_and_failures_are_retried_then_fail(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        empty = {
            "observations": [
                {"title": "No notes", "summary": "x", "notes": [], "sources": ["grow"]}
            ]
        }
        fake = FakeOpenAI(answers=[empty, TimeoutError(), empty])
        job = await _start(r, child)
        llm = llm_client(fake)
        assert await generation.process(r.runtime, llm, job) == "retry"
        assert (await r.db[JOBS].find_one({"_id": job["_id"]}))[
            "error"
        ] == "nothing in the answer could be shown"
        assert (
            await generation.process(r.runtime, llm, await _claim_again(r, job["_id"])) == "retry"
        )
        assert (
            await generation.process(r.runtime, llm, await _claim_again(r, job["_id"])) == "failed"
        )
        assert (await r.db[OBSERVATIONS].find_one({"_id": child}))["status"] == "failed"
        # The prompt held release's copies, as data.
        assert "Brushes her teeth alone" in fake.prompts[0] and '"curious"' in fake.prompts[0]
        unconfigured = LlmClient(LlmConfig(), circle="release")
        assert await generation.process(r.runtime, unconfigured, await _start(r, child)) == "failed"

    live(mongo_uri, test)


@pytest.mark.live_service
def test_missing_copies_and_evidence_and_a_deletion_meanwhile(mongo_uri, caplog):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        job = await _start(r, child)
        await r.db[CHILD_ACCESS].delete_many({})
        assert await generation.process(r.runtime, llm_client(), job) == "retry"
        await r.copy(child)
        await r.db[ONBOARDING_INPUTS].delete_many({})
        await r.db[GROWTH_INPUTS].delete_many({})
        # Nothing to read back: no point in retrying.
        assert (
            await generation.process(r.runtime, llm_client(), await _claim_again(r, job["_id"]))
            == "failed"
        )
        await r.answers(child)
        job = await _start(r, child)
        # Only the questionnaire now: an answer citing nothing else still stands.
        only_onboarding = {"observations": OBSERVATIONS_ANSWER["observations"][3:5]}
        assert (
            await generation.process(
                r.runtime, llm_client(FakeOpenAI(answers=[only_onboarding])), job
            )
            == "completed"
        )
        job = await _start(r, child)
        await r.db.tombstones.insert_one(
            {
                "_id": f"child:{child}",
                "location": LOCATION,
                "version": 4,
                "deleted_at": datetime.now(UTC),
            }
        )
        assert await generation.process(r.runtime, llm_client(), job) == "dropped"

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_block_no_card_cites_is_logged(mongo_uri, caplog):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        no_child = {
            "observations": [
                o for o in OBSERVATIONS_ANSWER["observations"] if "child" not in o["sources"]
            ]
        }
        assert (
            await generation.process(
                r.runtime, llm_client(FakeOpenAI(answers=[no_child])), await _start(r, child)
            )
            == "completed"
        )

    with caplog.at_level(logging.WARNING, logger="release.app.generation"):
        live(mongo_uri, test)
    assert "no observation cites: child" in caplog.text


@pytest.mark.live_service
def test_the_job_loop_runs_until_stopped_and_survives_a_failure(mongo_uri, monkeypatch, caplog):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        await r.http.post(_path(child, "/generation"), headers=auth_header())
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
            doc = await r.db[OBSERVATIONS].find_one({"_id": child})
            if doc and doc["status"] == "ready":
                break
            await asyncio.sleep(0.01)
        stop.set()
        await asyncio.wait_for(task, 5)
        assert doc["status"] == "ready" and calls[0] >= 2

    with caplog.at_level(logging.ERROR, logger="release.app.generation"):
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
        await r.http.post(_path(child, "/generation"), headers=auth_header())
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


# ── copies and deletions ───────────────────────────────────────────────────────


def _changed(r: Running, child: str, version: int, user_id: str = PARENT) -> str:
    payload = {
        "user_id": user_id, "name": "Aarav", "age": 9, "gender": "boy", "is_deleted": False,
        "progress": progress(profile=True, transform=True),
    }  # fmt: skip
    event = example_event(
        "child.changed", aggregate_id=child, location=LOCATION, version=version, payload=payload
    )
    return sns_envelope(event, r.layout["topics"]["children"])


@pytest.mark.live_service
def test_every_copy_keeps_the_newest_and_needs_its_owner(mongo_uri):
    async def test(r: Running) -> None:
        consumer = worker.build_consumer(r.runtime)
        assert_consumer_contract(consumer)
        child = str(uuid.uuid4())
        answers = example_event(
            "onboarding.conversation_completed",
            aggregate_id=child,
            location=LOCATION,
            payload=dict(ANSWERS),
        )
        with pytest.raises(lifecycle.OwnerUnknown):
            await lifecycle.copy_inputs(
                r.runtime, consumer.check(sns_envelope(answers, r.layout["topics"]["onboarding"]))
            )
        await consumer.handle_body(_changed(r, child, 2))
        await consumer.handle_body(sns_envelope(answers, r.layout["topics"]["onboarding"]))
        assert (await r.db[ONBOARDING_INPUTS].find_one({"_id": child}))["user_id"] == PARENT
        area = example_event(
            "grow.area_completed",
            aggregate_id=child,
            location=LOCATION,
            version=3,
            payload=area_copy(),
        )
        await consumer.handle_body(sns_envelope(area, r.layout["topics"]["grow"]))
        copy = await r.db[GROWTH_INPUTS].find_one({"_id": f"{child}:self_care"})
        assert copy["child_choices"] == area_copy()["child_choices"] and copy["reflections"]
        await consumer.handle_body(_changed(r, child, 1, user_id=OTHER))
        assert (await r.db[CHILD_ACCESS].find_one({"_id": child}))["user_id"] == PARENT

    live(mongo_uri, test)


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


@pytest.mark.live_service
def test_a_purged_child_is_deleted_with_its_jobs(mongo_uri):
    async def test(r: Running) -> None:
        child, kept = await r.ready_child(), await r.ready_child()
        await r.http.post(_path(child, "/generation"), headers=auth_header())
        await seed_user_outbox(
            r.db, user_id=PARENT, child_id=child, other_user_id=OTHER, other_child_id=kept
        )
        consumer = worker.build_consumer(r.runtime)
        assert (await consumer.handle_body(_child_deleted(r, child, 7))).value == "handled"
        assert await seeded_outbox_left(r.db) == {"named", "other"}  # only the child's went
        for name in (OBSERVATIONS, CHILD_ACCESS, ONBOARDING_INPUTS):
            assert await r.db[name].find_one({"_id": child}) is None
        assert await r.db[GROWTH_INPUTS].count_documents({"child_id": child}) == 0
        assert await r.db[CHILD_ACCESS].find_one({"_id": kept}) is not None
        assert (await r.db[JOBS].find_one({"child_id": child}))["error"] == "cancelled"
        assert (await r.db.tombstones.find_one({"_id": f"child:{child}"}))["version"] == 7

    live(mongo_uri, test)


@pytest.mark.live_service
def test_account_deletion_removes_everything_and_always_confirms(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        await r.http.post(_path(child, "/generation"), headers=auth_header())
        theirs = r.owners.add_child(user_id=OTHER)
        await r.copy(theirs, user_id=OTHER)
        await seed_user_outbox(
            r.db, user_id=PARENT, child_id=child, other_user_id=OTHER, other_child_id=theirs
        )
        consumer = worker.build_consumer(r.runtime)
        assert (await consumer.handle_body(_deletion(r))).value == "handled"
        assert await seeded_outbox_left(r.db) == {"other"}
        for name in (OBSERVATIONS, GROWTH_INPUTS, CHILD_ACCESS, ONBOARDING_INPUTS):
            assert await r.db[name].count_documents({"user_id": PARENT}) == 0
        assert await r.db[CHILD_ACCESS].count_documents({"user_id": OTHER}) == 1
        await consumer.handle_body(_deletion(r))
        await consumer.handle_body(_deletion(r, str(uuid.uuid4())))
        assert await r.db.outbox.count_documents({"event_type": "user.data_deleted"}) == 3

    live(mongo_uri, test)


# ── the worker ─────────────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_the_worker_generates_and_publishes_until_stopped(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        await r.http.post(_path(child, "/generation"), headers=auth_header())
        # grow's relay publishes; SNS delivers to release's queue.
        await SnsPublisher(r.runtime.sns, r.layout["topics"]["grow"]).publish(
            example_event("grow.area_completed", aggregate_id=child, location=LOCATION, version=3,
                          payload=area_copy("creativity"))
        )  # fmt: skip
        stop = asyncio.Event()
        task = asyncio.create_task(
            worker.run(r.runtime, llm_client(), stop, wait_seconds=0, poll=0.05)
        )
        loop = asyncio.get_running_loop()
        deadline = loop.time() + 20
        watched = False
        while True:
            doc = await r.db[OBSERVATIONS].find_one({"_id": child})
            if doc and doc["status"] == "ready" and not watched:
                await r.http.patch(
                    _path(child), json={"watching": [doc["items"][0]["id"]], "span": "2 weeks"},
                    headers=auth_header(),
                )  # fmt: skip
                watched = True
            copied = await r.db[GROWTH_INPUTS].count_documents({}) == 2
            published = await r.db.outbox.count_documents({"published_at": None}) == 0
            if watched and copied and published and await r.db.outbox.count_documents({}) == 1:
                break
            assert loop.time() < deadline, "the worker didn't generate, copy and relay"
            await asyncio.sleep(0.1)
        stop.set()
        await asyncio.wait_for(task, 15)
        messages = r.runtime.sqs.receive_message(
            QueueUrl=r.layout["queues"]["children"], MaxNumberOfMessages=10, WaitTimeSeconds=0
        ).get("Messages", [])
        types = {json.loads(json.loads(m["Body"])["Message"])["event_type"] for m in messages}
        assert "release.completed" in types

    live(mongo_uri, test)


@pytest.mark.live_service
def test_the_worker_needs_its_queue(mongo_uri):
    async def test(r: Running) -> None:
        r.runtime.settings.events_queue_url = None
        with pytest.raises(RuntimeError, match="EVENTS_QUEUE_URL"):
            await worker.run(r.runtime, llm_client(), asyncio.Event())

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_job_that_crashes_or_stalls_too_often_is_failed(mongo_uri, monkeypatch):
    # Found by the Phase 5-6 review: such a job stayed `processing` with its lock held, and
    # was retaken every 10 minutes for ever.
    async def test(r: Running) -> None:
        stalled = await _start(r, await r.ready_child())
        retaken = {**stalled, "llm_attempt": stalled["max_llm_attempts"] + 1}
        assert await generation.process(r.runtime, object(), retaken) == "failed"  # type: ignore[arg-type]
        ended = await r.db[JOBS].find_one({"_id": stalled["_id"]})
        assert (ended["status"], ended["error"]) == ("failed", jobs.EXHAUSTED)
        # A crash ends the job at once instead of waiting for a retake.
        crashed = await _start(r, await r.ready_child())
        await r.db[JOBS].update_one({"_id": crashed["_id"]}, {"$set": {"status": "pending"}})

        async def boom(*args: Any) -> Any:
            raise RuntimeError("a bug")

        monkeypatch.setattr(generation, "process", boom)
        stop = asyncio.Event()
        task = asyncio.create_task(generation.run_jobs(r.runtime, object(), stop, poll=0.01))  # type: ignore[arg-type]
        for _ in range(300):
            doc = await r.db[JOBS].find_one({"_id": crashed["_id"]})
            if doc["status"] == "failed":
                break
            await asyncio.sleep(0.01)
        stop.set()
        await asyncio.wait_for(task, 5)
        assert doc["error"] == "crashed (RuntimeError)"

    live(mongo_uri, test)
