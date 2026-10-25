"""common.events.store and relay against a real MongoDB replica set (design 4.1, 7.3, 7.4)."""

import asyncio
from typing import Any

import pytest
from pymongo.errors import DuplicateKeyError, OperationFailure

from common.events import store
from common.events.envelope import Event
from common.events.relay import Relay, SnsPublisher
from common.events.testing import example_event

pytestmark = pytest.mark.live_service

CHILD = "9b1c6f64-2f4e-4d0e-8e2a-6c1f0d3a7b55"
USER = "3f6c2a1e-8b7d-4c5e-9f10-2a3b4c5d6e7f"


class FakePublisher:
    def __init__(self) -> None:
        self.published: list[Event] = []
        self.failures = 0

    async def publish(self, event: Event) -> None:
        if self.failures:
            self.failures -= 1
            raise ConnectionError("sns down")
        self.published.append(event)


# ── collections ────────────────────────────────────────────────────────────────


def test_ensure_is_safe_to_repeat_and_validates(mongo_run):
    async def body(db, client):
        for _ in range(2):
            await store.ensure_outbox(db)
            await store.ensure_tombstones(db)
            await store.ensure_inbox(db)
        indexes = await db[store.OUTBOX].index_information()
        ttl = [i for i in indexes.values() if "expireAfterSeconds" in i]
        assert ttl[0]["expireAfterSeconds"] == store.OUTBOX_TTL_SECONDS
        with pytest.raises(OperationFailure):  # the validator refuses a malformed row
            await db[store.OUTBOX].insert_one({"_id": "x", "event_type": "child.changed"})

    mongo_run(body)


def test_add_to_outbox_needs_the_changes_transaction(mongo_run):
    async def body(db, client):
        await store.ensure_outbox(db)
        event = example_event("child.changed")
        async with client.start_session() as session:
            with pytest.raises(RuntimeError, match="inside the change's transaction"):
                await store.add_to_outbox(db, event, session)
            async with await session.start_transaction():
                await db.children.insert_one({"_id": CHILD}, session=session)
                await store.add_to_outbox(db, event, session)
        row = await db[store.OUTBOX].find_one({"_id": event.event_id})
        assert row["published_at"] is None and row["region"] == "ap-south-1"

    mongo_run(body)


def test_the_outbox_row_rolls_back_with_the_change(mongo_run):
    async def body(db, client):
        await store.ensure_outbox(db)
        with pytest.raises(ZeroDivisionError):
            async with client.start_session() as session, await session.start_transaction():
                await store.add_to_outbox(db, example_event("child.changed"), session)
                1 / 0  # noqa: B018 - the change fails after the outbox write
        assert await db[store.OUTBOX].count_documents({}) == 0

    mongo_run(body)


# ── safe-to-run-twice writes (7.4) ────────────────────────────────────────────


def _upsert(db, version: int, name: str, **kwargs: Any):
    return store.versioned_upsert(
        db,
        "child_access",
        doc_id=CHILD,
        location="in",
        version=version,
        fields={"name": name},
        tombstones=[store.tombstone_key("child", CHILD), store.tombstone_key("user", USER)],
        **kwargs,
    )


def test_versioned_upsert(mongo_run):
    async def body(db, client):
        assert await _upsert(db, 2, "Mira")
        assert not await _upsert(db, 2, "Mira")  # a duplicate changes nothing
        assert not await _upsert(db, 1, "Old")  # an older version is ignored
        assert await _upsert(db, 3, "Mira R")
        doc = await db.child_access.find_one({"_id": CHILD})
        assert (doc["name"], doc["version"], doc["location"]) == ("Mira R", 3, "in")

    mongo_run(body)


def test_a_tombstone_blocks_a_late_update(mongo_run):
    async def body(db, client):
        await store.ensure_tombstones(db)
        await store.write_tombstone(
            db, store.tombstone_key("child", CHILD), location="in", version=9
        )
        await store.write_tombstone(
            db, store.tombstone_key("child", CHILD), location="in", version=4
        )
        assert not await _upsert(db, 10, "Back from the dead")
        assert await db.child_access.count_documents({}) == 0
        tomb = await db[store.TOMBSTONES].find_one({})
        assert tomb["version"] == 9  # the highest version wins
        assert not await store.is_tombstoned(db, [])

    mongo_run(body)


def test_a_user_tombstone_blocks_too(mongo_run):
    async def body(db, client):
        await store.write_tombstone(db, store.tombstone_key("user", USER), location="in", version=1)
        assert not await _upsert(db, 1, "Mira")

    mongo_run(body)


def test_versioned_upsert_inside_a_transaction(mongo_run):
    async def body(db, client):
        await db.create_collection("child_access")
        async with client.start_session() as session, await session.start_transaction():
            assert await _upsert(db, 1, "Mira", session=session)
            assert not await _upsert(db, 1, "Mira", session=session)  # no write error, no abort
        assert (await db.child_access.find_one({}))["name"] == "Mira"

    mongo_run(body)


def test_a_race_with_a_newer_insert(mongo_run, monkeypatch):
    # Between the read and the write another consumer inserted the copy.
    async def body(db, client):
        await db.child_access.insert_one({"_id": CHILD, "location": "in", "version": 5})
        coll_type = type(db.child_access)
        real_find_one = coll_type.find_one

        async def find_nothing(self, *args, **kwargs):
            return (
                None if self.name == "child_access" else await real_find_one(self, *args, **kwargs)
            )

        monkeypatch.setattr(coll_type, "find_one", find_nothing)
        assert not await _upsert(db, 4, "Older")
        async with client.start_session() as session:
            with pytest.raises(DuplicateKeyError):
                async with await session.start_transaction():
                    await _upsert(db, 4, "Older", session=session)

    mongo_run(body)


def test_versioned_upsert_refuses_reserved_fields(mongo_run):
    async def body(db, client):
        with pytest.raises(ValueError, match="version"):
            await store.versioned_upsert(
                db, "c", doc_id="x", location="in", version=1, fields={"version": 9}
            )

    mongo_run(body)


def test_set_flag_reports_only_a_real_change(mongo_run):
    async def body(db, client):
        await db.children.insert_one({"_id": CHILD, "progress": {"discover": False}})
        assert await store.set_flag(db, "children", {"_id": CHILD}, "progress.discover")
        assert not await store.set_flag(db, "children", {"_id": CHILD}, "progress.discover")
        assert (await db.children.find_one({}))["progress"]["discover"] is True

    mongo_run(body)


# ── the relay ──────────────────────────────────────────────────────────────────


async def _write(db, client, region: str = "ap-south-1", **fields: Any) -> Event:
    event = example_event("child.changed", region=region, **fields)
    async with client.start_session() as session, await session.start_transaction():
        await store.add_to_outbox(db, event, session)
    return event


def test_publish_pending_takes_only_its_regions_rows_oldest_first(mongo_run):
    async def body(db, client):
        await store.ensure_outbox(db)
        first = await _write(db, client)
        await _write(db, client, region="eu-west-1")
        second = await _write(db, client, version=2)
        publisher = FakePublisher()
        relay = Relay(db, publisher, region="ap-south-1")
        assert await relay.publish_pending() == 2
        assert [e.event_id for e in publisher.published] == [first.event_id, second.event_id]
        assert await relay.publish_pending() == 0  # marked published
        assert await db[store.OUTBOX].count_documents({"published_at": None}) == 1  # eu's row

    mongo_run(body)


def test_a_row_another_relay_marked_first_isnt_counted(mongo_run):
    async def body(db, client):
        await store.ensure_outbox(db)
        await _write(db, client)

        class RacingPublisher(FakePublisher):
            async def publish(self, event: Event) -> None:
                await super().publish(event)
                # Another task of the same region published and marked it meanwhile.
                await db[store.OUTBOX].update_one(
                    {"_id": event.event_id}, {"$set": {"published_at": event.created_at}}
                )

        assert await Relay(db, RacingPublisher(), region="ap-south-1").publish_pending() == 0

    mongo_run(body)


def test_run_publishes_new_rows_from_the_change_stream(mongo_run):
    async def body(db, client):
        await store.ensure_outbox(db)
        backlog = await _write(db, client)
        publisher = FakePublisher()
        relay = Relay(db, publisher, region="ap-south-1", poll_interval=60, max_await_ms=100)
        stop = asyncio.Event()
        task = asyncio.create_task(relay.run(stop))
        await _until(lambda: len(publisher.published) == 1)
        live = await _write(db, client, version=2)
        await _write(db, client, region="eu-west-1")  # not this region's
        await _until(lambda: len(publisher.published) == 2)
        stop.set()
        await asyncio.wait_for(task, 5)
        assert [e.event_id for e in publisher.published] == [backlog.event_id, live.event_id]

    mongo_run(body)


def test_run_falls_back_to_polling_when_publishing_fails(mongo_run):
    async def body(db, client):
        await store.ensure_outbox(db)
        event = await _write(db, client)
        publisher = FakePublisher()
        publisher.failures = 2  # the stream's backlog and the first poll fail
        relay = Relay(db, publisher, region="ap-south-1", poll_interval=0.05, max_await_ms=50)
        stop = asyncio.Event()
        task = asyncio.create_task(relay.run(stop))
        await _until(lambda: len(publisher.published) == 1)
        stop.set()
        await asyncio.wait_for(task, 5)
        assert publisher.published[0].event_id == event.event_id

    mongo_run(body)


def test_run_polls_on_an_interval_while_watching(mongo_run):
    async def body(db, client):
        await store.ensure_outbox(db)
        publisher = FakePublisher()
        relay = Relay(db, publisher, region="ap-south-1", poll_interval=0.05, max_await_ms=50)
        stop = asyncio.Event()
        task = asyncio.create_task(relay.run(stop))
        await asyncio.sleep(0.2)
        stop.set()
        await asyncio.wait_for(task, 5)
        assert publisher.published == []

    mongo_run(body)


def test_sns_publisher_sends_the_message_and_attributes():
    class Client:
        def __init__(self) -> None:
            self.calls: list[dict[str, Any]] = []

        def publish(self, **kwargs: Any) -> None:
            self.calls.append(kwargs)

    client = Client()
    event = example_event("child.changed")
    asyncio.run(SnsPublisher(client, "arn:topic").publish(event))
    (call,) = client.calls
    assert call["TopicArn"] == "arn:topic"
    assert call["Message"] == event.to_message()
    assert call["MessageAttributes"]["event_type"]["StringValue"] == "child.changed"


async def _until(condition, timeout: float = 5.0) -> None:
    deadline = asyncio.get_running_loop().time() + timeout
    while not condition():
        if asyncio.get_running_loop().time() > deadline:
            raise AssertionError("timed out waiting")
        await asyncio.sleep(0.02)
