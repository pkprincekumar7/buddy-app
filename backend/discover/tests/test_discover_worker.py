"""discover's worker (build plan 5.2): the generation jobs, the automatic start, the copies and
the deletions. The plan's check here: the automatic start and the endpoint racing create
one job. Plus the worker end to end on Moto (grow's queue gets the finalised personality)."""

import asyncio
import json
import logging
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

import pytest
from discover_testkit import (
    LLM_ANSWER,
    LOCATION,
    OTHER,
    PARENT,
    FakeOpenAI,
    Running,
    auth_header,
    claim,
    llm_client,
    progress,
    running,
)

from common.events import Event, SnsPublisher
from common.events.testing import (
    assert_consumer_contract,
    assert_replay_safe,
    example_event,
    seed_user_outbox,
    seeded_outbox_left,
    sns_envelope,
)
from common.generation import jobs
from common.generation.llm import LlmClient, LlmConfig
from common.models import CHILD_ACCESS, JOBS, ONBOARDING_INPUTS
from discover import worker
from discover.app import generation, lifecycle
from discover.app.store import PERSONALITIES


def live(mongo_uri: str, test: Callable[[Running], Awaitable[None]]) -> None:
    async def go() -> None:
        async with running(mongo_uri) as r:
            await test(r)

    asyncio.run(go())


def _completed_event(child_id: str, *, user_id: str | None = PARENT, version: int = 1) -> Event:
    payload = dict(example_event("onboarding.conversation_completed").payload)
    payload.pop("user_id", None)
    if user_id is not None:
        payload["user_id"] = user_id
    return example_event(
        "onboarding.conversation_completed",
        aggregate_id=child_id, location=LOCATION, version=version, payload=payload,
    )  # fmt: skip


def _completed(r: Running, child_id: str, **fields: Any) -> str:
    return sns_envelope(_completed_event(child_id, **fields), r.layout["topics"]["onboarding"])


def _changed(r: Running, child_id: str, version: int, user_id: str = PARENT) -> str:
    payload = {
        "user_id": user_id, "name": "Aarav", "age": 9, "gender": "boy", "is_deleted": False,
        "progress": progress(profile=True, conversation=True),
    }  # fmt: skip
    event = example_event(
        "child.changed", aggregate_id=child_id, location=LOCATION, version=version, payload=payload
    )
    return sns_envelope(event, r.layout["topics"]["children"])


def _child_deleted(r: Running, child_id: str, version: int) -> str:
    event = example_event(
        "child.deleted", aggregate_id=child_id, location=LOCATION, version=version,
        payload={"user_id": PARENT},
    )  # fmt: skip
    return sns_envelope(event, r.layout["topics"]["children"])


def _deletion(r: Running, user_id: str = PARENT, version: int = 2) -> str:
    event = Event.new(
        "user.deletion_requested", producer="auth", aggregate_id=user_id,
        location=LOCATION, version=version, region="ap-south-1",
    )  # fmt: skip
    return sns_envelope(event, r.layout["topics"]["auth"])


async def _start(r: Running, child_id: str, user_id: str = PARENT) -> dict[str, Any]:
    await generation.start(
        r.runtime, child_id=child_id, user_id=user_id, location=LOCATION, input_version=1
    )
    job = await claim(r.db)
    assert job is not None
    return job


async def _claim_again(r: Running, job_id: str) -> dict[str, Any]:
    """The retried job, due now instead of after its backoff."""
    await r.db[JOBS].update_one(
        {"_id": job_id}, {"$set": {"retry_after": datetime(2000, 1, 1, tzinfo=UTC)}}
    )
    job = await claim(r.db)
    assert job is not None and job["_id"] == job_id
    return job


# ── generation ─────────────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_a_failing_llm_is_retried_then_fails_the_personality(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        fake = FakeOpenAI(answers=[TimeoutError(), "not json", {"dominant_style": "Wizard"}])
        llm = llm_client(fake)
        job = await _start(r, child)
        assert await generation.process(r.runtime, llm, job) == "retry"
        stored = await r.db[JOBS].find_one({"_id": job["_id"]})
        assert stored["error"] == "the LLM call failed (TimeoutError)"
        assert (
            await generation.process(r.runtime, llm, await _claim_again(r, job["_id"])) == "retry"
        )
        assert (await r.db[JOBS].find_one({"_id": job["_id"]}))["error"] == (
            "the LLM call failed (LlmResponseError)"
        )
        last = await _claim_again(r, job["_id"])
        assert await generation.process(r.runtime, llm, last) == "failed"
        error = (await r.db[JOBS].find_one({"_id": job["_id"]}))["error"]
        assert error.startswith("the answer didn't fit the schema at (root), dominant_style")
        assert "Wizard" not in error  # paths only, never the text
        personality = await r.db[PERSONALITIES].find_one({"_id": child})
        assert personality["status"] == "failed" and "active_job_id" not in personality
        # The prompt held the child's copies, as data.
        assert '"name": "Aarav"' in fake.prompts[0] and '"curious"' in fake.prompts[0]

    live(mongo_uri, test)


@pytest.mark.live_service
def test_no_llm_configured_fails_at_once(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        unconfigured = LlmClient(LlmConfig(), circle="discover")
        assert await generation.process(r.runtime, unconfigured, await _start(r, child)) == "failed"
        stored = await r.db[JOBS].find_one({"child_id": child})
        assert stored["llm_attempt"] == 1 and "no LLM provider" in stored["error"]

    live(mongo_uri, test)


@pytest.mark.live_service
def test_missing_copies_are_retried_and_a_deletion_drops_the_result(mongo_uri):
    async def test(r: Running) -> None:
        child = r.owners.add_child()
        await r.copy(child)  # no onboarding_inputs yet
        job = await _start(r, child)
        assert await generation.process(r.runtime, llm_client(), job) == "retry"
        assert (await r.db[JOBS].find_one({"_id": job["_id"]}))["error"] == (
            "the child's copies haven't arrived yet"
        )
        await r.answers(child)
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
        assert (await r.db[PERSONALITIES].find_one({"_id": child})).get("view_model") is None
        assert await r.db.outbox.count_documents({}) == 0

    live(mongo_uri, test)


@pytest.mark.live_service
def test_the_job_loop_runs_until_stopped_and_survives_a_failure(mongo_uri, monkeypatch, caplog):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        await generation.start(
            r.runtime, child_id=child, user_id=PARENT, location=LOCATION, input_version=1
        )
        real = jobs.claim_next
        calls = [0]

        async def flaky(*args: Any, **kwargs: Any) -> Any:
            calls[0] += 1
            if calls[0] == 1:
                raise RuntimeError("primary stepped down")
            return await real(*args, **kwargs)

        monkeypatch.setattr(jobs, "claim_next", flaky)
        stop = asyncio.Event()
        task = asyncio.create_task(generation.run_jobs(r.runtime, llm_client(), stop, poll=0.01))
        for _ in range(500):
            doc = await r.db[PERSONALITIES].find_one({"_id": child})
            if doc["status"] == "ready":
                break
            await asyncio.sleep(0.01)
        stop.set()
        await asyncio.wait_for(task, 5)
        assert doc["status"] == "ready" and calls[0] >= 2

    with caplog.at_level(logging.ERROR, logger="discover.app.generation"):
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
            raise RuntimeError("cloudwatch down")  # logged; the next round still reports
        return 1


@pytest.mark.live_service
def test_the_leader_reports_the_job_metrics(mongo_uri):
    async def test(r: Running) -> None:
        await generation.start(
            r.runtime, child_id=await r.ready_child(), user_id=PARENT, location=LOCATION,
            input_version=1,
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
        assert ("OldestRunningJobAgeSeconds", 0.0) in metrics.points

    live(mongo_uri, test)


# ── the automatic start ────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_the_conversation_completing_starts_the_personality_once(mongo_uri):
    async def test(r: Running) -> None:
        child = r.owners.add_child()
        consumer = worker.build_consumer(r.runtime)
        assert (await consumer.handle_body(_completed(r, child))).value == "handled"
        copy = await r.db[ONBOARDING_INPUTS].find_one({"_id": child})
        assert copy["user_id"] == PARENT and copy["hobbies"] == ["drawing"]
        personality = await r.db[PERSONALITIES].find_one({"_id": child})
        assert personality["status"] == "generating" and personality["user_id"] == PARENT
        # A redelivery starts nothing more.
        body = _completed(r, child)

        async def handle() -> None:
            await consumer.handle_body(body)

        async def state() -> Any:
            return await r.db[JOBS].count_documents({})

        await assert_replay_safe(handle, state)
        assert await r.db[JOBS].count_documents({}) == 1
        # Once ready, a late copy of the event regenerates nothing.
        await r.copy(child)
        await generation.process(r.runtime, llm_client(), await claim(r.db))
        assert await lifecycle.conversation_completed(r.runtime, consumer.check(body)) is False
        assert await r.db[JOBS].count_documents({}) == 1

    live(mongo_uri, test)


@pytest.mark.live_service
def test_the_owner_comes_from_the_copy_or_the_message_is_retried(mongo_uri):
    async def test(r: Running) -> None:
        consumer = worker.build_consumer(r.runtime)
        child = r.owners.add_child()
        with pytest.raises(lifecycle.OwnerUnknown):
            await lifecycle.conversation_completed(
                r.runtime, consumer.check(_completed(r, child, user_id=None))
            )
        await r.copy(child)
        assert await lifecycle.conversation_completed(
            r.runtime, consumer.check(_completed(r, child, user_id=None))
        )
        # A deleted child starts nothing.
        gone = str(uuid.uuid4())
        await r.db.tombstones.insert_one(
            {
                "_id": f"child:{gone}",
                "location": LOCATION,
                "version": 2,
                "deleted_at": datetime.now(UTC),
            }
        )
        assert (
            await lifecycle.conversation_completed(r.runtime, consumer.check(_completed(r, gone)))
            is False
        )

    live(mongo_uri, test)


@pytest.mark.live_service
def test_the_automatic_start_and_the_endpoint_racing_create_one_job(mongo_uri):
    async def test(r: Running) -> None:
        for _ in range(5):
            child = await r.ready_child()
            consumer = worker.build_consumer(r.runtime)
            outcome, response = await asyncio.gather(
                consumer.handle_body(_completed(r, child)),
                r.http.post(
                    f"/api/v1/children/{child}/personality/generation", headers=auth_header()
                ),
            )
            assert outcome.value == "handled" and response.status_code in (200, 202)
            assert await r.db[JOBS].count_documents({"child_id": child}) == 1
            personality = await r.db[PERSONALITIES].find_one({"_id": child})
            assert personality["active_job_id"] == response.json()["job_id"]

    live(mongo_uri, test)


# ── copies and deletions ───────────────────────────────────────────────────────


@pytest.mark.live_service
def test_every_subscribed_event_has_a_handler_and_copies_keep_the_newest(mongo_uri):
    async def test(r: Running) -> None:
        consumer = worker.build_consumer(r.runtime)
        assert_consumer_contract(consumer)
        child = str(uuid.uuid4())
        await consumer.handle_body(_changed(r, child, 3))
        await consumer.handle_body(_changed(r, child, 2, user_id=OTHER))
        copy = await r.db[CHILD_ACCESS].find_one({"_id": child})
        assert (copy["version"], copy["user_id"]) == (3, PARENT)

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_purged_child_is_deleted_with_its_jobs(mongo_uri):
    async def test(r: Running) -> None:
        child, kept = await r.ready_child(), await r.ready_child()
        await generation.start(
            r.runtime, child_id=child, user_id=PARENT, location=LOCATION, input_version=1
        )
        await generation.start(
            r.runtime, child_id=kept, user_id=PARENT, location=LOCATION, input_version=1
        )
        await seed_user_outbox(
            r.db, user_id=PARENT, child_id=child, other_user_id=OTHER, other_child_id=kept
        )
        consumer = worker.build_consumer(r.runtime)
        assert (await consumer.handle_body(_child_deleted(r, child, 6))).value == "handled"
        assert await seeded_outbox_left(r.db) == {"named", "other"}  # only the child's went
        for name in (PERSONALITIES, CHILD_ACCESS, ONBOARDING_INPUTS):
            assert await r.db[name].find_one({"_id": child}) is None
            assert await r.db[name].find_one({"_id": kept}) is not None
        job = await r.db[JOBS].find_one({"child_id": child})
        assert (job["status"], job["error"]) == ("failed", "cancelled")
        assert (await r.db[JOBS].find_one({"child_id": kept}))["status"] == "pending"
        assert (await r.db.tombstones.find_one({"_id": f"child:{child}"}))["version"] == 6
        await consumer.handle_body(_changed(r, child, 7))  # too late: stays deleted
        assert await r.db[CHILD_ACCESS].find_one({"_id": child}) is None

    live(mongo_uri, test)


@pytest.mark.live_service
def test_account_deletion_removes_everything_and_always_confirms(mongo_uri):
    async def test(r: Running) -> None:
        a = await r.ready_child()
        await generation.start(
            r.runtime, child_id=a, user_id=PARENT, location=LOCATION, input_version=1
        )
        theirs = r.owners.add_child(user_id=OTHER)
        await r.copy(theirs, user_id=OTHER)
        await seed_user_outbox(
            r.db, user_id=PARENT, child_id=a, other_user_id=OTHER, other_child_id=theirs
        )
        consumer = worker.build_consumer(r.runtime)
        assert (await consumer.handle_body(_deletion(r))).value == "handled"
        assert await seeded_outbox_left(r.db) == {"other"}
        for name in (PERSONALITIES, CHILD_ACCESS, ONBOARDING_INPUTS):
            assert await r.db[name].count_documents({"user_id": PARENT}) == 0
        assert await r.db[CHILD_ACCESS].count_documents({"user_id": OTHER}) == 1
        assert (await r.db[JOBS].find_one({"child_id": a}))["error"] == "cancelled"
        confirmations = await r.db.outbox.find({"event_type": "user.data_deleted"}).to_list(None)
        assert [(c["aggregate_id"], c["version"]) for c in confirmations] == [(PARENT, 2)]
        await consumer.handle_body(_deletion(r))
        await consumer.handle_body(_deletion(r, str(uuid.uuid4())))
        assert await r.db.outbox.count_documents({"event_type": "user.data_deleted"}) == 3

    live(mongo_uri, test)


# ── the worker ─────────────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_the_worker_starts_generates_and_publishes_until_stopped(mongo_uri):
    async def test(r: Running) -> None:
        child = r.owners.add_child()
        await r.copy(child)
        # onboarding's relay publishes; SNS delivers to discover's queue.
        await SnsPublisher(r.runtime.sns, r.layout["topics"]["onboarding"]).publish(
            _completed_event(child)
        )
        stop = asyncio.Event()
        task = asyncio.create_task(
            worker.run(r.runtime, llm_client(), stop, wait_seconds=0, poll=0.05)
        )
        loop = asyncio.get_running_loop()
        deadline = loop.time() + 20
        while True:
            doc = await r.db[PERSONALITIES].find_one({"_id": child})
            published = await r.db.outbox.count_documents({"published_at": None}) == 0
            if doc and doc["status"] == "ready" and published:
                break
            assert loop.time() < deadline, "the worker didn't start, generate and relay"
            await asyncio.sleep(0.1)
        stop.set()
        await asyncio.wait_for(task, 15)
        messages = r.runtime.sqs.receive_message(
            QueueUrl=r.layout["queues"]["grow"], MaxNumberOfMessages=10, WaitTimeSeconds=0
        ).get("Messages", [])
        bodies = [json.loads(json.loads(m["Body"])["Message"]) for m in messages]
        finalised = [b for b in bodies if b["event_type"] == "discover.personality_finalised"]
        assert (
            finalised
            and finalised[0]["payload"]["strengths"] == LLM_ANSWER["strength_summary_bullets"]
        )

    live(mongo_uri, test)


@pytest.mark.live_service
def test_the_worker_needs_its_queue(mongo_uri):
    async def test(r: Running) -> None:
        r.runtime.settings.events_queue_url = None
        with pytest.raises(RuntimeError, match="EVENTS_QUEUE_URL"):
            await worker.run(r.runtime, llm_client(), asyncio.Event())

    live(mongo_uri, test)


class NotLeader:
    """A Valkey where another task holds the leader lock."""

    async def set(self, *args: Any, **kwargs: Any) -> None:
        return None

    async def eval(self, *args: Any) -> int:
        return 0


@pytest.mark.live_service
def test_only_the_leader_reports(mongo_uri):
    async def test(r: Running) -> None:
        r.runtime.cache = NotLeader()
        metrics = FakeMetrics()
        stop = asyncio.Event()
        task = asyncio.create_task(generation.report_jobs(r.runtime, metrics, stop, interval=0.01))
        await asyncio.sleep(0.1)
        stop.set()
        await asyncio.wait_for(task, 5)
        r.runtime.cache = None
        assert metrics.points == [] and metrics.flushes == 0

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


@pytest.mark.live_service
def test_an_over_long_text_is_clipped_not_failed(mongo_uri):
    # Found by the e2e full journey: providers don't enforce maxLength, and failing the job
    # for a few characters lost a good answer.
    async def test(r: Running) -> None:
        child = await r.ready_child()
        long = {**LLM_ANSWER, "child_quote": "I love building tall towers. " * 20}
        job = await _start(r, child)
        llm = llm_client(FakeOpenAI(answers=[long]))
        assert await generation.process(r.runtime, llm, job) == "completed"
        personality = await r.db[PERSONALITIES].find_one({"_id": child})
        quote = personality["analysis"]["child_quote"]
        assert len(quote) <= 120 and quote.endswith("…")

    live(mongo_uri, test)
