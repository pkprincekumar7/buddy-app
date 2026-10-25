"""children's worker (build plan 4.2). The plan's checks:
- completion events arriving out of order all set their flags;
- the purge publishes `child.deleted` with the final version.
Plus account deletion, the contracts, and the worker end to end on Moto."""

import asyncio
import json
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from children_testkit import (
    BUCKET,
    LOCATION,
    OTHER,
    PARENT,
    Running,
    add_child,
    auth_header,
    running,
)

from children import worker
from children.app import lifecycle
from children.app.store import CHILDREN
from common.events import Event, SnsPublisher
from common.events.testing import (
    assert_consumer_contract,
    assert_replay_safe,
    example_event,
    sns_envelope,
)

API = "/api/v1/children"


def live(mongo_uri: str, test: Callable[[Running], Awaitable[None]], **options: Any) -> None:
    async def go() -> None:
        async with running(mongo_uri, **options) as r:
            await test(r)

    asyncio.run(go())


def _completed(r: Running, event_type: str, child_id: str) -> str:
    """The circle's completion event, as its topic delivers it."""
    event = example_event(event_type, aggregate_id=child_id, location=LOCATION)
    return sns_envelope(event, r.layout["topics"][event.event_type.split(".")[0]])


async def _changed(r: Running, child_id: str) -> list[dict[str, Any]]:
    rows = (
        await r.db.outbox.find({"aggregate_id": child_id, "event_type": "child.changed"})
        .sort("version", 1)
        .to_list(None)
    )
    return [{"version": row["version"], **row["payload"]["progress"]} for row in rows]


# ── progress flags ─────────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_completion_events_out_of_order_all_set_their_flags(mongo_uri):
    async def test(r: Running) -> None:
        child = (await add_child(r, age=9, gender="boy")).json()
        consumer = worker.build_consumer(r.runtime)
        # The journey's order is conversation → discover → grow → transform → release;
        # they arrive backwards.
        for event_type in (
            "release.completed", "transform.completed", "grow.completed",
            "discover.completed", "onboarding.conversation_completed",
        ):  # fmt: skip
            assert (
                await consumer.handle_body(_completed(r, event_type, child["id"]))
            ).value == "handled"
        progress = (await r.http.get(f"{API}/{child['id']}", headers=auth_header())).json()[
            "progress"
        ]
        assert all(
            progress[flag]
            for flag in ("profile", "conversation", "discover", "grow", "transform", "release")
        )
        assert progress["connect"] is False
        # One snapshot per real change, each with the version it made.
        snapshots = await _changed(r, child["id"])
        assert [s["version"] for s in snapshots] == [1, 2, 3, 4, 5, 6]
        assert snapshots[1]["release"] and not snapshots[1]["transform"]

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_duplicate_completion_changes_nothing(mongo_uri):
    async def test(r: Running) -> None:
        child = (await add_child(r)).json()
        consumer = worker.build_consumer(r.runtime)
        body = _completed(r, "discover.completed", child["id"])

        async def handle() -> None:
            await consumer.handle_body(body)

        async def state() -> Any:
            return await r.db[CHILDREN].find_one({"_id": child["id"]}, {"updated_at": 0})

        await handle()
        await assert_replay_safe(handle, state)
        assert len(await _changed(r, child["id"])) == 2  # create + the one real change
        # A purged (or unknown) child is skipped quietly.
        assert (
            await lifecycle.set_progress(
                r.runtime, consumer.check(_completed(r, "grow.completed", str(uuid.uuid4())))
            )
            is False
        )

    live(mongo_uri, test)


@pytest.mark.live_service
def test_the_contract_and_a_forged_completion(mongo_uri):
    async def test(r: Running) -> None:
        consumer = worker.build_consumer(r.runtime)
        assert_consumer_contract(consumer)
        child = (await add_child(r)).json()
        # discover.completed from grow's topic is a forgery: rejected, flag untouched.
        event = example_event("discover.completed", aggregate_id=child["id"], location=LOCATION)
        forged = sns_envelope(event, r.layout["topics"]["grow"])
        assert (await consumer.handle_body(forged)).value == "rejected"
        doc = await r.db[CHILDREN].find_one({"_id": child["id"]})
        assert doc is not None and doc["progress"]["discover"] is False

    live(mongo_uri, test)


# ── the purge ──────────────────────────────────────────────────────────────────


async def _deleted_days_ago(r: Running, days: int, **fields: Any) -> dict[str, Any]:
    child = (await add_child(r, **fields)).json()
    await r.http.delete(f"{API}/{child['id']}", headers=auth_header())
    when = datetime.now(UTC) - timedelta(days=days)
    await r.db[CHILDREN].update_one({"_id": child["id"]}, {"$set": {"deleted_at": when}})
    return child


@pytest.mark.live_service
def test_the_purge_publishes_child_deleted_with_the_final_version(mongo_uri):
    async def test(r: Running) -> None:
        old = await _deleted_days_ago(r, 31)
        recent = await _deleted_days_ago(r, 29)
        live_child = (await add_child(r, name="Here")).json()
        key = f"uploads/{LOCATION}/{old['id']}/avatar/{uuid.uuid4()}.jpg"
        plan = f"uploads/{LOCATION}/{old['id']}/ninety-day-plan/{uuid.uuid4()}.jpg"
        s3 = r.runtime.uploads.client
        for k in (key, plan):
            s3.put_object(Bucket=BUCKET, Key=k, Body=b"x", ContentType="image/jpeg")

        assert await lifecycle.purge(r.runtime, None) == 1
        assert await r.db[CHILDREN].find_one({"_id": old["id"]}) is None
        row = await r.db.outbox.find_one({"aggregate_id": old["id"], "event_type": "child.deleted"})
        # Soft delete made version 2; the purge is the final write: 3.
        assert row is not None and row["version"] == 3 and row["payload"] == {"user_id": PARENT}
        tombstone = await r.db.tombstones.find_one({"_id": f"child:{old['id']}"})
        assert tombstone is not None and tombstone["version"] == 3
        # Its avatar went; transform's plan photo is transform's to delete.
        remaining = [o["Key"] for o in s3.list_objects_v2(Bucket=BUCKET).get("Contents", [])]
        assert remaining == [plan]
        for kept in (recent, live_child):
            assert await r.db[CHILDREN].find_one({"_id": kept["id"]}) is not None
        # Another region's locations aren't this worker's.
        await _deleted_days_ago(r, 40)
        assert await lifecycle.purge(r.runtime, ["us"]) == 0

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_child_restored_meanwhile_isnt_purged(mongo_uri, monkeypatch):
    async def test(r: Running) -> None:
        old = await _deleted_days_ago(r, 31)
        real = lifecycle._delete_avatars

        async def restored_meanwhile(runtime: Any, docs: Any) -> None:
            await runtime.db[CHILDREN].update_one(
                {"_id": old["id"]}, {"$set": {"is_deleted": False}, "$inc": {"version": 1}}
            )
            await real(runtime, docs)

        monkeypatch.setattr(lifecycle, "_delete_avatars", restored_meanwhile)
        assert await lifecycle.purge(r.runtime, None) == 0
        assert await r.db[CHILDREN].find_one({"_id": old["id"]}) is not None
        assert await r.db.outbox.count_documents({"event_type": "child.deleted"}) == 0

    live(mongo_uri, test)


# ── account deletion ───────────────────────────────────────────────────────────


def _deletion(r: Running, user_id: str = PARENT, version: int = 2) -> str:
    event = Event.new(
        "user.deletion_requested", producer="auth", aggregate_id=user_id,
        location=LOCATION, version=version, region="ap-south-1",
    )  # fmt: skip
    return sns_envelope(event, r.layout["topics"]["auth"])


@pytest.mark.live_service
def test_account_deletion_removes_every_child_at_once_and_confirms(mongo_uri):
    async def test(r: Running) -> None:
        a = (await add_child(r, name="A")).json()
        b = await _deleted_days_ago(r, 3, name="B")  # soft-deleted: no 30-day wait
        theirs = (await add_child(r, OTHER, name="Theirs")).json()
        key = f"uploads/{LOCATION}/{a['id']}/avatar/{uuid.uuid4()}.jpg"
        r.runtime.uploads.client.put_object(
            Bucket=BUCKET, Key=key, Body=b"x", ContentType="image/jpeg"
        )
        consumer = worker.build_consumer(r.runtime)
        assert (await consumer.handle_body(_deletion(r))).value == "handled"
        assert await r.db[CHILDREN].count_documents({"user_id": PARENT}) == 0
        assert await r.db[CHILDREN].find_one({"_id": theirs["id"]}) is not None
        assert r.runtime.uploads.client.list_objects_v2(Bucket=BUCKET).get("KeyCount") == 0
        stones = {t["_id"]: t["version"] for t in await r.db.tombstones.find({}).to_list(None)}
        assert stones == {f"child:{a['id']}": 2, f"child:{b['id']}": 3, f"user:{PARENT}": 2}
        confirmations = await r.db.outbox.find({"event_type": "user.data_deleted"}).to_list(None)
        assert [(c["aggregate_id"], c["version"]) for c in confirmations] == [(PARENT, 2)]
        # A redelivery deletes nothing and confirms again; a user with no children confirms too.
        await consumer.handle_body(_deletion(r))
        await consumer.handle_body(_deletion(r, OTHER))
        assert await r.db.outbox.count_documents({"event_type": "user.data_deleted"}) == 3
        assert await r.db[CHILDREN].count_documents({}) == 0

    live(mongo_uri, test)


@pytest.mark.live_service
def test_without_an_uploads_bucket_the_documents_still_go(mongo_uri):
    async def test(r: Running) -> None:
        await add_child(r)
        await worker.build_consumer(r.runtime).handle_body(_deletion(r))
        assert await r.db[CHILDREN].count_documents({}) == 0

    live(mongo_uri, test, uploads=False)


# ── the worker ─────────────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_the_worker_relays_consumes_and_purges_until_stopped(mongo_uri):
    async def test(r: Running) -> None:
        child = (await add_child(r)).json()
        old = await _deleted_days_ago(r, 31)
        # discover's relay publishes; SNS delivers to children's queue.
        await SnsPublisher(r.runtime.sns, r.layout["topics"]["discover"]).publish(
            example_event("discover.completed", aggregate_id=child["id"], location=LOCATION)
        )
        stop = asyncio.Event()
        task = asyncio.create_task(worker.run(r.runtime, stop, wait_seconds=0, purge_interval=0.05))
        loop = asyncio.get_running_loop()
        deadline = loop.time() + 15
        while True:
            doc = await r.db[CHILDREN].find_one({"_id": child["id"]})
            purged = await r.db[CHILDREN].find_one({"_id": old["id"]}) is None
            published = await r.db.outbox.count_documents({"published_at": None}) == 0
            if doc and doc["progress"]["discover"] and purged and published:
                break
            assert loop.time() < deadline, "the worker didn't consume, purge and relay"
            await asyncio.sleep(0.1)
        stop.set()
        await asyncio.wait_for(task, 15)
        # The circles' queues got child.changed and child.deleted from children's topic.
        messages = r.runtime.sqs.receive_message(
            QueueUrl=r.layout["queues"]["grow"], MaxNumberOfMessages=10, WaitTimeSeconds=0
        ).get("Messages", [])
        types = {json.loads(json.loads(m["Body"])["Message"])["event_type"] for m in messages}
        assert {"child.changed", "child.deleted"} <= types
        assert worker.region_locations(r.runtime) is None
        r.runtime.settings.app_env = "dev"
        assert "in" in (worker.region_locations(r.runtime) or [])

    live(mongo_uri, test)


@pytest.mark.live_service
def test_the_worker_needs_its_queue_and_survives_a_failed_purge(mongo_uri, monkeypatch):
    async def test(r: Running) -> None:
        r.runtime.settings.events_queue_url = None
        with pytest.raises(RuntimeError, match="EVENTS_QUEUE_URL"):
            await worker.run(r.runtime, asyncio.Event())
        stop = asyncio.Event()
        calls = [0]

        async def flaky(*args: Any) -> int:
            calls[0] += 1
            if calls[0] == 1:
                raise RuntimeError("network")
            if calls[0] == 2:
                return lifecycle.PURGE_BATCH  # a full batch: purge again at once
            stop.set()
            return 0

        monkeypatch.setattr(lifecycle, "purge", flaky)
        await asyncio.wait_for(worker.run_purge(r.runtime, stop, interval=0.01), 5)
        assert calls[0] == 3

    live(mongo_uri, test)
