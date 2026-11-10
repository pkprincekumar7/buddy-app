"""The build plan's 1.2 check, end to end: MongoDB outbox → relay → SNS → SQS → consumer.

Runs against in-process Moto (the same topology scripts/local-aws-setup.py creates) and a
real MongoDB replica set:
- a publish → consume round trip;
- a duplicate event changes nothing (the replay-twice harness);
- an older version is ignored;
- a tombstone blocks a late update;
- an event type from the wrong topic is rejected and left for the DLQ;
- the opt-in inbox skips an event it has already handled.
"""

import json
from typing import Any

import boto3
import pytest
from moto import mock_aws

from common.events import store, topology
from common.events.consumer import Consumer, Outcome
from common.events.envelope import Event, ReceivedEvent
from common.events.relay import Relay, SnsPublisher
from common.events.testing import assert_replay_safe, example_event, sns_envelope

pytestmark = pytest.mark.live_service

PREFIX = "buddy-test"
REGION = "ap-south-1"
CHILD = "9b1c6f64-2f4e-4d0e-8e2a-6c1f0d3a7b55"


@pytest.fixture
def aws():
    with mock_aws():
        kwargs = {
            "region_name": REGION,
            "aws_access_key_id": "test",
            "aws_secret_access_key": "test",
        }
        sns, sqs = boto3.client("sns", **kwargs), boto3.client("sqs", **kwargs)
        layout = topology.apply_local(sns, sqs, PREFIX)
        yield sns, sqs, layout


def _grow_consumer(db) -> Consumer:
    consumer = Consumer("grow", topic_prefix=PREFIX)

    @consumer.handler("child.changed")
    async def on_child_changed(event: ReceivedEvent, session: Any) -> None:
        payload = event.payload
        await store.versioned_upsert(
            db,
            "child_access",
            doc_id=event.event.aggregate_id,
            location=event.event.location,
            version=event.event.version,
            fields={
                "user_id": payload["user_id"],
                "name": payload["name"],
                "progress": payload["progress"],
            },
            tombstones=[store.tombstone_key("child", event.event.aggregate_id)],
            session=session,
        )

    return consumer


async def _write_child(db, client, version: int, name: str) -> Event:
    """The children service's write: the change and its outbox row in one transaction."""
    payload = example_event("child.changed").payload | {"name": name}
    event = Event.new(
        "child.changed",
        producer="children",
        aggregate_id=CHILD,
        location="in",
        version=version,
        region=REGION,
        payload=payload,
    )
    async with client.start_session() as session, await session.start_transaction():
        await db.children.update_one(
            {"_id": CHILD},
            {"$set": {"name": name, "version": version}},
            upsert=True,
            session=session,
        )
        await store.add_to_outbox(db, event, session)
    return event


async def _drain(consumer: Consumer, sqs, url: str) -> int:
    total = 0
    while handled := await consumer.poll_once(sqs, url, wait_seconds=0):
        total += handled
    return total


def test_publish_then_consume_round_trip(mongo_run, aws):
    sns, sqs, layout = aws

    async def body(db, client):
        await store.ensure_outbox(db)
        await store.ensure_tombstones(db)
        await _write_child(db, client, version=1, name="Mira")
        relay = Relay(db, SnsPublisher(sns, layout["topics"]["children"]), region=REGION)
        assert await relay.publish_pending() == 1

        consumer = _grow_consumer(db)
        assert await _drain(consumer, sqs, layout["queues"]["grow"]) == 1
        copy = await db.child_access.find_one({"_id": CHILD})
        assert (copy["name"], copy["version"]) == ("Mira", 1)
        # Every circle receives it; children doesn't subscribe to its own child.changed.
        for circle in ("onboarding", "discover", "transform", "release"):
            assert _depth(sqs, layout["queues"][circle]) == 1
        assert _depth(sqs, layout["queues"]["children"]) == 0

    mongo_run(body)


def test_a_duplicate_event_changes_nothing(mongo_run, aws):
    sns, sqs, layout = aws

    async def body(db, client):
        consumer = _grow_consumer(db)
        event = example_event("child.changed", aggregate_id=CHILD, version=2)
        envelope = sns_envelope(event, layout["topics"]["children"])

        async def handle() -> None:
            assert await consumer.handle_body(envelope) is Outcome.HANDLED

        async def snapshot() -> Any:
            return await db.child_access.find_one({"_id": CHILD}, {"updated_at": 0})

        await assert_replay_safe(handle, snapshot)

    mongo_run(body)


def test_an_older_version_is_ignored(mongo_run, aws):
    sns, sqs, layout = aws

    async def body(db, client):
        await store.ensure_outbox(db)
        await _write_child(db, client, version=2, name="New")
        await _write_child(db, client, version=1, name="Old")
        # Delivered newest first: standard SNS/SQS doesn't keep order.
        rows = await db[store.OUTBOX].find().sort("version", -1).to_list()
        publisher = SnsPublisher(sns, layout["topics"]["children"])
        for row in rows:
            await publisher.publish(Event.from_outbox(row))
        await _drain(_grow_consumer(db), sqs, layout["queues"]["grow"])
        copy = await db.child_access.find_one({"_id": CHILD})
        assert (copy["name"], copy["version"]) == ("New", 2)

    mongo_run(body)


def test_a_tombstone_blocks_a_late_update(mongo_run, aws):
    sns, sqs, layout = aws

    async def body(db, client):
        await store.ensure_tombstones(db)
        await store.write_tombstone(
            db, store.tombstone_key("child", CHILD), location="in", version=5
        )
        late = example_event("child.changed", aggregate_id=CHILD, version=6)
        await SnsPublisher(sns, layout["topics"]["children"]).publish(late)
        assert await _drain(_grow_consumer(db), sqs, layout["queues"]["grow"]) == 1  # acknowledged
        assert await db.child_access.count_documents({}) == 0  # but not applied

    mongo_run(body)


def test_an_event_type_from_the_wrong_topic_is_rejected(mongo_run, aws):
    sns, sqs, layout = aws

    async def body(db, client):
        # A compromised discover publishes child.changed on its own topic. Its filter would
        # never send that to grow, so put the forged envelope on grow's queue directly, as a
        # misconfigured subscription would.
        forged = example_event("child.changed", aggregate_id=CHILD)
        url = layout["queues"]["grow"]
        sqs.send_message(
            QueueUrl=url, MessageBody=sns_envelope(forged, layout["topics"]["discover"])
        )
        consumer = _grow_consumer(db)
        assert await consumer.poll_once(sqs, url, wait_seconds=0) == 0
        assert await db.child_access.count_documents({}) == 0
        assert _depth(sqs, url, include_in_flight=True) == 1  # left for retries, then the DLQ

    mongo_run(body)


def test_the_filter_policy_keeps_unsubscribed_events_out(mongo_run, aws):
    sns, sqs, layout = aws

    async def body(db, client):
        event = example_event("discover.completed", aggregate_id=CHILD)
        await SnsPublisher(sns, layout["topics"]["discover"]).publish(event)
        assert _depth(sqs, layout["queues"]["children"]) == 1
        assert _depth(sqs, layout["queues"]["grow"]) == 0  # grow takes only personality_finalised

    mongo_run(body)


def test_the_inbox_skips_an_event_already_handled(mongo_run, aws):
    sns, sqs, layout = aws

    async def body(db, client):
        await store.ensure_inbox(db)
        await db.create_collection("counters")
        consumer = Consumer("children", topic_prefix=PREFIX, db=db, client=client)

        @consumer.handler("discover.completed", dedupe=True)
        async def count(event: ReceivedEvent, session: Any) -> None:
            await db.counters.update_one(
                {"_id": "seen"}, {"$inc": {"n": 1}}, upsert=True, session=session
            )

        envelope = sns_envelope(example_event("discover.completed"), layout["topics"]["discover"])
        assert await consumer.handle_body(envelope) is Outcome.HANDLED
        assert await consumer.handle_body(envelope) is Outcome.DUPLICATE
        assert (await db.counters.find_one({"_id": "seen"}))["n"] == 1

    mongo_run(body)


def test_a_duplicate_key_from_the_handler_itself_is_not_mistaken_for_the_inbox(mongo_run, aws):
    sns, sqs, layout = aws

    async def body(db, client):
        await store.ensure_inbox(db)
        await db.create_collection("things")
        await db.things.insert_one({"_id": "taken"})
        consumer = Consumer("children", topic_prefix=PREFIX, db=db, client=client)

        @consumer.handler("discover.completed", dedupe=True)
        async def clash(event: ReceivedEvent, session: Any) -> None:
            await db.things.insert_one({"_id": "taken"}, session=session)

        envelope = sns_envelope(example_event("discover.completed"), layout["topics"]["discover"])
        with pytest.raises(Exception, match="duplicate key"):
            await consumer.handle_body(envelope)
        assert await db.inbox.count_documents({}) == 0  # rolled back: it will be retried

    mongo_run(body)


def test_the_queues_have_a_dlq_and_a_policy(aws):
    sns, sqs, layout = aws
    attrs = sqs.get_queue_attributes(QueueUrl=layout["queues"]["grow"], AttributeNames=["All"])[
        "Attributes"
    ]
    assert json.loads(attrs["RedrivePolicy"])["maxReceiveCount"] in (5, "5")
    sources = json.loads(attrs["Policy"])["Statement"][0]["Condition"]["ArnEquals"]["aws:SourceArn"]
    assert sorted(sources) == sorted(
        layout["topics"][p] for p in ("auth", "children", "discover", "onboarding")
    )
    # Safe to re-run, as scripts/local-aws-setup.py does.
    assert topology.apply_local(sns, sqs, PREFIX) == layout


def _depth(sqs, url: str, include_in_flight: bool = False) -> int:
    names = ["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible"]
    attrs = sqs.get_queue_attributes(QueueUrl=url, AttributeNames=names)["Attributes"]
    return int(attrs[names[0]]) + (int(attrs[names[1]]) if include_in_flight else 0)
