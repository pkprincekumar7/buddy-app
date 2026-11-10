"""Test harnesses for services that publish or consume events (docs/auth-users-split.md, 7.4, 7.8).

- `example_event(...)`: a valid event built from its schema's example.
- `sns_envelope(...)`: the SQS message body SNS would deliver for an event and topic.
- `assert_replay_safe(...)`: the replay-twice test: handling an event twice leaves the same
  state as handling it once.
- `assert_consumer_contract(...)`: the consumer has a handler for every event it subscribes
  to, and each schema's example is accepted by the consumer's checks.
- `seed_user_outbox(...)` / `seeded_outbox_left(...)`: outbox rows for an account-deletion
  test, and which of them survived (only another user's should).
"""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

from common.events import catalogue, schemas
from common.events.consumer import Consumer
from common.events.envelope import Event
from common.events.topology import topic_name

TEST_REGION = "ap-south-1"
TEST_ACCOUNT = "123456789012"


def topic_arn(prefix: str, service: str, region: str = TEST_REGION) -> str:
    return f"arn:aws:sns:{region}:{TEST_ACCOUNT}:{topic_name(prefix, service)}"


def example_event(event_type: str, *, producer: str | None = None, **fields: Any) -> Event:
    """A valid event with its schema's example payload; `fields` override envelope values."""
    spec = catalogue.load().spec(event_type)
    if producer is None:
        producer = (
            sorted(catalogue.load().data_services)[0] if spec.producer == "*" else spec.producer
        )
    defaults: dict[str, Any] = {
        "aggregate_id": "9b1c6f64-2f4e-4d0e-8e2a-6c1f0d3a7b55",
        "location": "in",
        "version": 1,
        "region": TEST_REGION,
        "payload": schemas.example(spec.schema),
    }
    return Event.new(event_type, producer=producer, **{**defaults, **fields})


def sns_envelope(event: Event, arn: str, *, attribute_type: str | None = None) -> str:
    """The body SQS holds for `event` published to `arn` (raw delivery off)."""
    attributes = {
        name: {"Type": "String", "Value": value["StringValue"]}
        for name, value in event.message_attributes().items()
    }
    if attribute_type is not None:
        attributes["event_type"] = {"Type": "String", "Value": attribute_type}
    return json.dumps(
        {
            "Type": "Notification",
            "MessageId": event.event_id,
            "TopicArn": arn,
            "Message": event.to_message(),
            "MessageAttributes": attributes,
        }
    )


async def assert_replay_safe(
    handle: Callable[[], Awaitable[Any]], snapshot: Callable[[], Awaitable[Any]]
) -> None:
    """Handle once, snapshot, handle again: the state must be unchanged (7.4)."""
    await handle()
    once = await snapshot()
    await handle()
    twice = await snapshot()
    assert once == twice, f"handling the event twice changed the state:\n{once!r}\n!=\n{twice!r}"


def assert_consumer_contract(consumer: Consumer) -> None:
    """Every subscribed event has a handler, and its schema example passes the checks."""
    missing = consumer.missing_handlers()
    assert not missing, f"{consumer.service} has no handler for: {', '.join(missing)}"
    for event_type in sorted(consumer.subscriptions):
        spec = consumer.catalogue.spec(event_type)
        producer = (
            sorted(consumer.catalogue.data_services)[0] if spec.producer == "*" else spec.producer
        )
        body = sns_envelope(example_event(event_type), topic_arn(consumer.topic_prefix, producer))
        consumer.check(body)


SEEDED = "seeded-"


async def seed_user_outbox(
    db: Any,
    *,
    user_id: str,
    child_id: str | None,
    other_user_id: str,
    other_child_id: str | None = None,
    location: str = "in",
) -> None:
    """Rows a deletion of `user_id` must remove (their child's or their own, one naming them in
    its payload, one already published) and one of another user's, which must stay."""
    now = datetime.now(UTC)

    def row(name: str, aggregate_id: str, payload: dict[str, Any], published: bool = False) -> Any:
        return {
            "_id": f"{SEEDED}{name}", "event_type": "test.seeded", "schema": "test.seeded.v1",
            "aggregate_id": aggregate_id, "location": location, "version": 1,
            "payload": payload, "region": TEST_REGION, "created_at": now,
            "published_at": now if published else None,
        }  # fmt: skip

    await db.outbox.insert_many(
        [
            row("own", child_id or user_id, {"name": "Aarav"}),
            row("named", "4e0c1b2a-0000-4000-8000-000000000001", {"user_id": user_id}),
            row("published", child_id or user_id, {"name": "Aarav"}, published=True),
            row("other", other_child_id or other_user_id, {"user_id": other_user_id}),
        ]
    )


async def seeded_outbox_left(db: Any) -> set[str]:
    rows = await db.outbox.find({"_id": {"$regex": f"^{SEEDED}"}}, {"_id": 1}).to_list(None)
    return {row["_id"].removeprefix(SEEDED) for row in rows}
