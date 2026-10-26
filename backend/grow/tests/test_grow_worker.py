"""grow's worker (build plan 5.3): the generation jobs, the copies and the deletions. The plan's
check here: `grow.area_updated` is published when AI recommendations arrive for a completed
area. Plus the worker end to end on Moto (transform's queue gets the completed area)."""

import asyncio
import json
import logging
import re
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

import pytest
from grow_testkit import (
    LOCATION,
    OTHER,
    PARENT,
    RECOMMENDATIONS_ANSWER,
    ROUNDS_ANSWER,
    SUMMARY,
    FakeOpenAI,
    Running,
    auth_header,
    claim,
    llm_client,
    progress,
    running,
)

from common.events import Event, SnsPublisher
from common.events.testing import assert_consumer_contract, example_event, sns_envelope
from common.generation.llm import LlmClient, LlmConfig
from common.models import CHILD_ACCESS, JOBS, ONBOARDING_INPUTS, PERSONALITY_INPUTS
from grow import worker
from grow.app import generation, lifecycle
from grow.app.store import GROWTH_AREAS, area_doc_id

AREA = "life_ambition"
BLOCK = re.compile(r"\[DATA (\w+)\]\n(.*?)\n\[END DATA\]", flags=re.S)


def live(mongo_uri: str, test: Callable[[Running], Awaitable[None]]) -> None:
    async def go() -> None:
        async with running(mongo_uri) as r:
            await test(r)

    asyncio.run(go())


def _path(child_id: str, rest: str = "") -> str:
    return f"/api/v1/children/{child_id}/growth-areas{rest}"


async def _start(r: Running, child: str, kind: str, area: str = AREA) -> dict[str, Any]:
    response = await r.http.post(
        _path(child, f"/{area}/generation"), json={"kind": kind}, headers=auth_header()
    )
    assert response.status_code == 202, response.text
    return await claim(r.db)


async def _area(r: Running, child: str, area: str = AREA) -> dict[str, Any]:
    doc = await r.db[GROWTH_AREAS].find_one({"_id": area_doc_id(child, area)})
    assert doc is not None
    return doc


async def _claim_again(r: Running, job_id: str) -> dict[str, Any]:
    """The retried job, due now instead of after its backoff."""
    await r.db[JOBS].update_one(
        {"_id": job_id}, {"$set": {"retry_after": datetime(2000, 1, 1, tzinfo=UTC)}}
    )
    job = await claim(r.db)
    assert job["_id"] == job_id
    return job


async def _with_questions(r: Running) -> str:
    """A child whose area has its questions and two answers."""
    child = await r.ready_child()
    await generation.process(r.runtime, llm_client(), await _start(r, child, "parent_questions"))
    answers = {f"{AREA}_gq1": "Builds Lego towers", f"{AREA}_gq3": "Asks how bridges work"}
    saved = await r.http.put(
        _path(child, f"/{AREA}"),
        json={"area_name": "Life Ambition", "status": "in_progress", "answers": answers},
        headers=auth_header(),
    )
    assert saved.status_code == 200
    return child


# ── the generations ────────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_each_kind_builds_its_prompt_from_the_area_and_the_copies(mongo_uri):
    async def test(r: Running) -> None:
        child = await _with_questions(r)
        fake = FakeOpenAI(answers=[ROUNDS_ANSWER])
        assert (
            await generation.process(
                r.runtime, llm_client(fake), await _start(r, child, "child_rounds")
            )
            == "completed"
        )
        rounds_prompt = dict(BLOCK.findall(fake.prompts[0]))
        reflections = json.loads(rounds_prompt["reflections"])
        assert [pair["answer"] for pair in reflections] == [
            "Builds Lego towers",
            "Asks how bridges work",
        ]
        assert json.loads(rounds_prompt["profile"])["personality_archetype"] == "The Thinker"
        rounds = (await _area(r, child))["child_rounds"]["rounds"]
        assert rounds[0]["a"]["id"] == f"{AREA}_gr1a" and rounds[0]["b"]["icon"] == "spark"
        # The child plays, then the recommendations use the picks and their archetype.
        picks = [f"{AREA}_gr1a", f"{AREA}_gr2a", f"{AREA}_gr3a"]
        await r.http.put(
            _path(child, f"/{AREA}"),
            json={"area_name": "Life Ambition", "status": "in_progress",
                  "answers": (await _area(r, child))["answers"],
                  "child_activity": {"selections": picks}, "feedback": "Less screen time"},
            headers=auth_header(),
        )  # fmt: skip
        fake = FakeOpenAI(answers=[RECOMMENDATIONS_ANSWER])
        before = (await _area(r, child))["version"]
        assert (
            await generation.process(
                r.runtime, llm_client(fake), await _start(r, child, "recommendations")
            )
            == "completed"
        )
        blocks = dict(BLOCK.findall(fake.prompts[0]))
        choices = json.loads(blocks["choices"])
        assert choices["choices"] == [
            "Build a thing number 0", "Build a thing number 1", "Build a thing number 2",
        ]  # fmt: skip
        assert choices["pattern"]["title"] == "The Builder"
        assert "Aarav" in choices["pattern"]["line"] and "{name}" not in choices["pattern"]["line"]
        assert json.loads(blocks["feedback"]) == "Less screen time"
        assert json.loads(blocks["reflections"])[0]["hint"]
        area = await _area(r, child)
        assert len(area["ai_three_month_recommendations"]) == 5 and area["version"] == before + 1
        # In progress: no other service hears of it yet.
        assert await r.db.outbox.count_documents({}) == 0

    live(mongo_uri, test)


@pytest.mark.live_service
def test_recommendations_for_a_completed_area_publish_an_update(mongo_uri):
    async def test(r: Running) -> None:
        child = await _with_questions(r)
        completed = await r.http.put(
            _path(child, f"/{AREA}"),
            json={"area_name": "Life Ambition", "status": "completed",
                  "answers": (await _area(r, child))["answers"]},
            headers=auth_header(),
        )  # fmt: skip
        assert completed.status_code == 200
        job = await _start(r, child, "recommendations")
        fake = FakeOpenAI(answers=[RECOMMENDATIONS_ANSWER])
        assert await generation.process(r.runtime, llm_client(fake), job) == "completed"
        area = await _area(r, child)
        update = await r.db.outbox.find_one({"event_type": "grow.area_updated"})
        assert update["version"] == area["version"] and update["aggregate_id"] == child
        assert (
            update["payload"]["ai_three_month_recommendations"]
            == area["ai_three_month_recommendations"]
        )
        assert area["status"] == "completed"
        # The question sets publish nothing: no other service uses them.
        await r.db[GROWTH_AREAS].update_one({"_id": area["_id"]}, {"$unset": {"child_rounds": ""}})
        await generation.process(
            r.runtime,
            llm_client(FakeOpenAI(answers=[ROUNDS_ANSWER])),
            await _start(r, child, "child_rounds"),
        )
        assert await r.db.outbox.count_documents({"event_type": "grow.area_updated"}) == 1

    live(mongo_uri, test)


@pytest.mark.live_service
def test_unusable_answers_and_failures_are_retried_then_fail_the_job_only(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        fake = FakeOpenAI(answers=[{"questions": []}, TimeoutError(), {"questions": "no"}])
        llm = llm_client(fake)
        job = await _start(r, child, "parent_questions")
        assert await generation.process(r.runtime, llm, job) == "retry"
        assert (await r.db[JOBS].find_one({"_id": job["_id"]}))["error"] == (
            "the answer couldn't be used as parent_questions"
        )
        assert (
            await generation.process(r.runtime, llm, await _claim_again(r, job["_id"])) == "retry"
        )
        assert (
            await generation.process(r.runtime, llm, await _claim_again(r, job["_id"])) == "failed"
        )
        area = await _area(r, child)
        # The area keeps its own status, and is free to start again.
        assert area["status"] == "in_progress" and area["active_jobs"] == {}
        assert "parent_questions" not in area
        unconfigured = LlmClient(LlmConfig(), circle="grow")
        again = await _start(r, child, "parent_questions")
        assert await generation.process(r.runtime, unconfigured, again) == "failed"
        # A rejected recommendations answer stores nothing either.
        assert generation._normalised("recommendations", AREA, {"recommendations": []}) is None
        assert generation._normalised("recommendations", AREA, "no") is None
        assert generation._normalised("child_rounds", AREA, {"rounds": []}) is None

    live(mongo_uri, test)


@pytest.mark.live_service
def test_missing_copies_are_retried_and_a_deletion_drops_the_result(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        job = await _start(r, child, "parent_questions")
        await r.db[CHILD_ACCESS].delete_many({})
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
        assert "parent_questions" not in await _area(r, child)

    live(mongo_uri, test)


@pytest.mark.live_service
def test_an_area_without_a_known_description_uses_its_own_name(mongo_uri):
    async def test(r: Running) -> None:
        assert generation.area_info("my_own", "My area") == {
            "id": "my_own", "name": "My area", "description": "",
        }  # fmt: skip
        assert generation.area_info(AREA, "ignored")["name"] == "Life Ambition"

    live(mongo_uri, test)


@pytest.mark.live_service
def test_the_job_loop_runs_until_stopped_and_survives_a_failure(mongo_uri, monkeypatch, caplog):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        await r.http.post(
            _path(child, f"/{AREA}/generation"),
            json={"kind": "parent_questions"},
            headers=auth_header(),
        )
        from common.generation import jobs

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
            if (await _area(r, child)).get("parent_questions"):
                break
            await asyncio.sleep(0.01)
        stop.set()
        await asyncio.wait_for(task, 5)
        assert (await _area(r, child))["parent_questions"] and calls[0] >= 2

    with caplog.at_level(logging.ERROR, logger="grow.app.generation"):
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
            _path(child, f"/{AREA}/generation"),
            json={"kind": "parent_questions"},
            headers=auth_header(),
        )
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


def _event(r: Running, event_type: str, child: str, version: int, payload: dict[str, Any]) -> str:
    event = example_event(
        event_type, aggregate_id=child, location=LOCATION, version=version, payload=payload
    )
    return sns_envelope(
        event,
        r.layout["topics"][
            event_type.split(".")[0] if event_type != "child.changed" else "children"
        ],
    )


def _changed(r: Running, child: str, version: int, user_id: str = PARENT) -> str:
    payload = {
        "user_id": user_id, "name": "Aarav", "age": 9, "gender": "boy", "is_deleted": False,
        "progress": progress(profile=True, conversation=True, discover=True),
    }  # fmt: skip
    event = example_event(
        "child.changed", aggregate_id=child, location=LOCATION, version=version, payload=payload
    )
    return sns_envelope(event, r.layout["topics"]["children"])


@pytest.mark.live_service
def test_the_copies_keep_the_newest_and_need_their_owner(mongo_uri):
    async def test(r: Running) -> None:
        consumer = worker.build_consumer(r.runtime)
        assert_consumer_contract(consumer)
        child = str(uuid.uuid4())
        answers = dict(example_event("onboarding.conversation_completed").payload)
        answers.pop("user_id")
        # No user_id and no child_access yet: retried (the handler raises).
        with pytest.raises(lifecycle.OwnerUnknown):
            await lifecycle.copy_inputs(
                r.runtime,
                consumer.check(_event(r, "onboarding.conversation_completed", child, 1, answers)),
            )
        await consumer.handle_body(_changed(r, child, 2))
        for event_type, version in (
            ("onboarding.conversation_completed", 1), ("onboarding.answers_updated", 3),
            ("onboarding.answers_updated", 2),
        ):  # fmt: skip
            outcome = await consumer.handle_body(_event(r, event_type, child, version, answers))
            assert outcome.value == "handled"
        assert (await r.db[ONBOARDING_INPUTS].find_one({"_id": child}))["version"] == 3
        summary = {"user_id": PARENT, **SUMMARY}
        await consumer.handle_body(_event(r, "discover.personality_finalised", child, 2, summary))
        copy = await r.db[PERSONALITY_INPUTS].find_one({"_id": child})
        assert copy["traits"] == SUMMARY["traits"] and copy["user_id"] == PARENT
        await consumer.handle_body(_changed(r, child, 1, user_id=OTHER))  # older: ignored
        assert (await r.db[CHILD_ACCESS].find_one({"_id": child}))["user_id"] == PARENT

    live(mongo_uri, test)


def _child_deleted(r: Running, child: str, version: int) -> str:
    event = example_event(
        "child.deleted", aggregate_id=child, location=LOCATION, version=version,
        payload={"user_id": PARENT},
    )  # fmt: skip
    return sns_envelope(event, r.layout["topics"]["children"])


def _deletion(r: Running, user_id: str = PARENT, version: int = 2) -> str:
    event = Event.new(
        "user.deletion_requested", producer="auth", aggregate_id=user_id,
        location=LOCATION, version=version, region="ap-south-1",
    )  # fmt: skip
    return sns_envelope(event, r.layout["topics"]["auth"])


@pytest.mark.live_service
def test_a_purged_child_is_deleted_with_its_areas_and_jobs(mongo_uri):
    async def test(r: Running) -> None:
        child, kept = await r.ready_child(), await r.ready_child()
        for target in (child, kept):
            await r.http.post(
                _path(target, f"/{AREA}/generation"), json={"kind": "parent_questions"},
                headers=auth_header(),
            )  # fmt: skip
        consumer = worker.build_consumer(r.runtime)
        assert (await consumer.handle_body(_child_deleted(r, child, 7))).value == "handled"
        assert await r.db[GROWTH_AREAS].count_documents({"child_id": child}) == 0
        assert await r.db[GROWTH_AREAS].count_documents({"child_id": kept}) == 1
        for name in (CHILD_ACCESS, ONBOARDING_INPUTS, PERSONALITY_INPUTS):
            assert await r.db[name].find_one({"_id": child}) is None
        assert (await r.db[JOBS].find_one({"child_id": child}))["error"] == "cancelled"
        assert (await r.db.tombstones.find_one({"_id": f"child:{child}"}))["version"] == 7
        await consumer.handle_body(_changed(r, child, 8))
        assert await r.db[CHILD_ACCESS].find_one({"_id": child}) is None

    live(mongo_uri, test)


@pytest.mark.live_service
def test_account_deletion_removes_everything_and_always_confirms(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        await r.http.post(
            _path(child, f"/{AREA}/generation"),
            json={"kind": "parent_questions"},
            headers=auth_header(),
        )
        theirs = r.owners.add_child(user_id=OTHER)
        await r.copy(theirs, user_id=OTHER)
        consumer = worker.build_consumer(r.runtime)
        assert (await consumer.handle_body(_deletion(r))).value == "handled"
        for name in (GROWTH_AREAS, CHILD_ACCESS, ONBOARDING_INPUTS, PERSONALITY_INPUTS):
            assert await r.db[name].count_documents({"user_id": PARENT}) == 0
        assert await r.db[CHILD_ACCESS].count_documents({"user_id": OTHER}) == 1
        assert (await r.db[JOBS].find_one({}))["error"] == "cancelled"
        await consumer.handle_body(_deletion(r))
        await consumer.handle_body(_deletion(r, str(uuid.uuid4())))
        confirmations = await r.db.outbox.find({"event_type": "user.data_deleted"}).to_list(None)
        assert len(confirmations) == 3 and confirmations[0]["version"] == 2

    live(mongo_uri, test)


# ── the worker ─────────────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_the_worker_generates_and_publishes_until_stopped(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        await r.http.post(
            _path(child, f"/{AREA}/generation"),
            json={"kind": "parent_questions"},
            headers=auth_header(),
        )
        await r.http.put(
            _path(child, "/self_care"),
            json={"area_name": "Self Care", "status": "completed", "answers": {}},
            headers=auth_header(),
        )
        # discover's relay publishes; SNS delivers to grow's queue.
        await SnsPublisher(r.runtime.sns, r.layout["topics"]["discover"]).publish(
            example_event(
                "discover.personality_finalised", aggregate_id=str(uuid.uuid4()), location=LOCATION,
                payload={"user_id": PARENT, **SUMMARY},
            )
        )  # fmt: skip
        stop = asyncio.Event()
        task = asyncio.create_task(
            worker.run(r.runtime, llm_client(), stop, wait_seconds=0, poll=0.05)
        )
        loop = asyncio.get_running_loop()
        deadline = loop.time() + 20
        while True:
            generated = (await _area(r, child)).get("parent_questions")
            copied = await r.db[PERSONALITY_INPUTS].count_documents({}) == 2
            published = await r.db.outbox.count_documents({"published_at": None}) == 0
            if generated and copied and published:
                break
            assert loop.time() < deadline, "the worker didn't generate, copy and relay"
            await asyncio.sleep(0.1)
        stop.set()
        await asyncio.wait_for(task, 15)
        for queue, expected in (
            ("transform", "grow.area_completed"),
            ("children", "grow.completed"),
        ):
            messages = r.runtime.sqs.receive_message(
                QueueUrl=r.layout["queues"][queue], MaxNumberOfMessages=10, WaitTimeSeconds=0
            ).get("Messages", [])
            types = {json.loads(json.loads(m["Body"])["Message"])["event_type"] for m in messages}
            assert expected in types, queue

    live(mongo_uri, test)


@pytest.mark.live_service
def test_the_worker_needs_its_queue(mongo_uri):
    async def test(r: Running) -> None:
        r.runtime.settings.events_queue_url = None
        with pytest.raises(RuntimeError, match="EVENTS_QUEUE_URL"):
            await worker.run(r.runtime, llm_client(), asyncio.Event())

    live(mongo_uri, test)
