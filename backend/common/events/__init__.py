"""Events between services: outbox, relay, SNS + SQS, local copies (docs/auth-users-split.md, 7).

- `catalogue`: who produces and consumes each event (catalogue.json).
- `schemas`: each event's payload schema (schemas/<event>.vN.json).
- `envelope`: the event as written, published and received.
- `store`: the outbox, tombstones and inbox, and the safe-to-run-twice writes.
- `relay`: publishes the outbox to the service's own SNS topic.
- `consumer`: receives from the service's SQS queue, with the TopicArn check.
- `topology`: the topics, queues and subscriptions the catalogue implies.
- `testing`: contract and replay-twice harnesses.
"""

from common.events.consumer import Consumer, Outcome
from common.events.envelope import (
    Event,
    EventTooLarge,
    InvalidEvent,
    ReceivedEvent,
    ReservedEvent,
)
from common.events.relay import Relay, SnsPublisher
from common.events.store import (
    add_to_outbox,
    delete_child_events,
    delete_user_events,
    ensure_inbox,
    ensure_outbox,
    ensure_tombstones,
    is_tombstoned,
    set_flag,
    tombstone_key,
    versioned_upsert,
    write_guards,
    write_tombstone,
)

__all__ = [
    "Consumer",
    "Event",
    "EventTooLarge",
    "InvalidEvent",
    "Outcome",
    "ReceivedEvent",
    "Relay",
    "ReservedEvent",
    "SnsPublisher",
    "add_to_outbox",
    "delete_child_events",
    "delete_user_events",
    "ensure_inbox",
    "ensure_outbox",
    "ensure_tombstones",
    "is_tombstoned",
    "set_flag",
    "tombstone_key",
    "versioned_upsert",
    "write_guards",
    "write_tombstone",
]
