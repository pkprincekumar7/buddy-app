"""onboarding's worker (build plan 5.1): the child_access copy from `child.changed`, the
deletions, the contracts, and the worker end to end on Moto."""

import asyncio
import json
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from onboarding_testkit import (
    ANSWERS,
    LOCATION,
    OTHER,
    PARENT,
    Running,
    auth_header,
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
from common.models import CHILD_ACCESS
from onboarding import worker
from onboarding.app.store import CONVERSATIONS


def live(mongo_uri: str, test: Callable[[Running], Awaitable[None]]) -> None:
    async def go() -> None:
        async with running(mongo_uri) as r:
            await test(r)

    asyncio.run(go())


def _changed_event(child_id: str, version: int, user_id: str = PARENT, **fields: Any) -> Event:
    payload = {
        "user_id": user_id,
        "name": "Aarav",
        "age": 9,
        "gender": "boy",
        "is_deleted": False,
        "progress": progress(profile=True),
        **fields,
    }
    return example_event(
        "child.changed", aggregate_id=child_id, location=LOCATION, version=version, payload=payload
    )


def _changed(r: Running, child_id: str, version: int, **fields: Any) -> str:
    return sns_envelope(_changed_event(child_id, version, **fields), r.layout["topics"]["children"])


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


async def _saved(r: Running, child_id: str, user_id: str = PARENT) -> None:
    """A finished conversation, through the API."""
    r.children.add(child_id, user_id=user_id)
    response = await r.http.put(
        f"/api/v1/children/{child_id}/onboarding", json=ANSWERS, headers=auth_header(user_id)
    )
    assert response.status_code == 201


@pytest.mark.live_service
def test_every_subscribed_event_has_a_handler(mongo_uri):
    async def test(r: Running) -> None:
        assert_consumer_contract(worker.build_consumer(r.runtime))

    live(mongo_uri, test)


# ── the child_access copy ──────────────────────────────────────────────────────


@pytest.mark.live_service
def test_child_changed_keeps_the_newest_copy(mongo_uri):
    async def test(r: Running) -> None:
        child = str(uuid.uuid4())
        consumer = worker.build_consumer(r.runtime)
        assert (await consumer.handle_body(_changed(r, child, 2, name="Mira"))).value == "handled"
        copy = await r.db[CHILD_ACCESS].find_one({"_id": child})
        assert (copy["version"], copy["name"], copy["user_id"]) == (2, "Mira", PARENT)
        assert copy["progress"]["profile"] is True
        # An older snapshot, arriving late, changes nothing; a newer one wins.
        await consumer.handle_body(_changed(r, child, 1, name="Old"))
        assert (await r.db[CHILD_ACCESS].find_one({"_id": child}))["name"] == "Mira"
        await consumer.handle_body(_changed(r, child, 3, name="Mira K", is_deleted=True))
        latest = await r.db[CHILD_ACCESS].find_one({"_id": child})
        assert (latest["name"], latest["is_deleted"]) == ("Mira K", True)
        body = _changed(r, child, 3, name="Mira K", is_deleted=True)

        async def handle() -> None:
            await consumer.handle_body(body)

        async def state() -> Any:
            return await r.db[CHILD_ACCESS].find_one({"_id": child}, {"updated_at": 0})

        await assert_replay_safe(handle, state)

    live(mongo_uri, test)


# ── deletions ──────────────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_a_purged_child_is_deleted_and_cant_come_back(mongo_uri):
    async def test(r: Running) -> None:
        child, kept = str(uuid.uuid4()), str(uuid.uuid4())
        await _saved(r, child)
        await _saved(r, kept)
        await seed_user_outbox(
            r.db, user_id=PARENT, child_id=child, other_user_id=OTHER, other_child_id=kept
        )
        consumer = worker.build_consumer(r.runtime)
        assert (await consumer.handle_body(_child_deleted(r, child, 5))).value == "handled"
        assert await seeded_outbox_left(r.db) == {"named", "other"}  # only the child's went
        assert await r.db[CONVERSATIONS].find_one({"_id": child}) is None
        assert await r.db[CHILD_ACCESS].find_one({"_id": child}) is None
        assert await r.db[CONVERSATIONS].find_one({"_id": kept}) is not None
        stone = await r.db.tombstones.find_one({"_id": f"child:{child}"})
        assert stone["version"] == 5
        # A late snapshot can't recreate the copy, nor a save the conversation.
        await consumer.handle_body(_changed(r, child, 4))
        assert await r.db[CHILD_ACCESS].find_one({"_id": child}) is None
        late = await r.http.get(f"/api/v1/children/{child}/onboarding", headers=auth_header())
        assert late.status_code == 404
        # Safe to run twice.
        await consumer.handle_body(_child_deleted(r, child, 5))

    live(mongo_uri, test)


@pytest.mark.live_service
def test_account_deletion_removes_everything_and_always_confirms(mongo_uri):
    async def test(r: Running) -> None:
        a, b, theirs = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
        await _saved(r, a)
        await _saved(r, b)
        await _saved(r, theirs, OTHER)
        await seed_user_outbox(
            r.db, user_id=PARENT, child_id=a, other_user_id=OTHER, other_child_id=theirs
        )
        consumer = worker.build_consumer(r.runtime)
        assert (await consumer.handle_body(_deletion(r))).value == "handled"
        assert await seeded_outbox_left(r.db) == {"other"}
        assert await r.db[CONVERSATIONS].count_documents({"user_id": PARENT}) == 0
        assert await r.db[CHILD_ACCESS].count_documents({"user_id": PARENT}) == 0
        assert await r.db[CONVERSATIONS].count_documents({"user_id": OTHER}) == 1
        assert await r.db.tombstones.find_one({"_id": f"user:{PARENT}"}) is not None
        confirmations = await r.db.outbox.find({"event_type": "user.data_deleted"}).to_list(None)
        assert [(c["aggregate_id"], c["version"]) for c in confirmations] == [(PARENT, 2)]
        # The user's tombstone stops a late snapshot of one of their children.
        await consumer.handle_body(_changed(r, a, 9))
        assert await r.db[CHILD_ACCESS].find_one({"_id": a}) is None
        # A redelivery confirms again; a user with nothing here confirms too.
        await consumer.handle_body(_deletion(r))
        await consumer.handle_body(_deletion(r, str(uuid.uuid4())))
        assert await r.db.outbox.count_documents({"event_type": "user.data_deleted"}) == 3

    live(mongo_uri, test)


# ── the worker ─────────────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_the_worker_relays_and_consumes_until_stopped(mongo_uri):
    async def test(r: Running) -> None:
        saved = str(uuid.uuid4())
        await _saved(r, saved)
        child = str(uuid.uuid4())
        # children's relay publishes; SNS delivers to onboarding's queue.
        await SnsPublisher(r.runtime.sns, r.layout["topics"]["children"]).publish(
            _changed_event(child, 1)
        )
        stop = asyncio.Event()
        task = asyncio.create_task(worker.run(r.runtime, stop, wait_seconds=0))
        loop = asyncio.get_running_loop()
        deadline = loop.time() + 15
        while True:
            copied = await r.db[CHILD_ACCESS].find_one({"_id": child}) is not None
            published = await r.db.outbox.count_documents({"published_at": None}) == 0
            if copied and published:
                break
            assert loop.time() < deadline, "the worker didn't consume and relay"
            await asyncio.sleep(0.1)
        stop.set()
        await asyncio.wait_for(task, 15)
        # discover and children got conversation_completed from onboarding's topic.
        for queue in ("discover", "children"):
            messages = r.runtime.sqs.receive_message(
                QueueUrl=r.layout["queues"][queue], MaxNumberOfMessages=10, WaitTimeSeconds=0
            ).get("Messages", [])
            types = {json.loads(json.loads(m["Body"])["Message"])["event_type"] for m in messages}
            assert "onboarding.conversation_completed" in types, queue

    live(mongo_uri, test)


@pytest.mark.live_service
def test_the_worker_needs_its_queue(mongo_uri):
    async def test(r: Running) -> None:
        r.runtime.settings.events_queue_url = None
        with pytest.raises(RuntimeError, match="EVENTS_QUEUE_URL"):
            await worker.run(r.runtime, asyncio.Event())

    live(mongo_uri, test)
