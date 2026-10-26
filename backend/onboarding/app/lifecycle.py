"""What the onboarding worker does with others' events (docs/auth-users-split.md, 7.4, 7.7, 10).

- **`child.changed`:** the `child_access` copy, as a version-checked upsert. A duplicate or
  older event changes nothing, and a tombstone for the child or its user drops it.
- **`child.deleted`** (the purge, 30 days after a soft delete): the child's conversation
  and copy go, in one transaction with a `child:` tombstone at the child's final version,
  so a late event or read-through can't bring them back.
- **`user.deletion_requested`** (10.3): every conversation and copy of the user, a `user:`
  tombstone and `user.data_deleted`, in one transaction. It always confirms, even with
  nothing to delete; a duplicate deletes nothing and confirms again, which auth ignores.

Each is safe to run twice, so the consumer needs no inbox.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable

from pymongo.asynchronous.client_session import AsyncClientSession

from common.events import (
    Event,
    ReceivedEvent,
    add_to_outbox,
    tombstone_key,
    versioned_upsert,
    write_tombstone,
)
from common.models import CHILD_ACCESS, child_access_fields
from common.telemetry import current_traceparent
from onboarding.app.runtime import SERVICE, Runtime
from onboarding.app.store import CONVERSATIONS

_logger = logging.getLogger(__name__)


async def _transaction(
    runtime: Runtime, write: Callable[[AsyncClientSession], Awaitable[None]]
) -> None:
    async with runtime.client.start_session() as session:
        await session.with_transaction(write)


async def copy_child(runtime: Runtime, received: ReceivedEvent) -> bool:
    """Apply a `child.changed` snapshot to `child_access`; True if it was newer."""
    event = received.event
    return await versioned_upsert(
        runtime.db,
        CHILD_ACCESS,
        doc_id=event.aggregate_id,
        location=event.location,
        version=event.version,
        fields=child_access_fields(received),
        tombstones=[
            tombstone_key("child", event.aggregate_id),
            tombstone_key("user", received.payload["user_id"]),
        ],
    )


async def delete_child(runtime: Runtime, received: ReceivedEvent) -> None:
    """A purged child's conversation and copy, and its tombstone."""
    event = received.event
    child_id, location = event.aggregate_id, event.location

    async def write(session: AsyncClientSession) -> None:
        selector = {"_id": child_id, "location": location}
        await runtime.db[CONVERSATIONS].delete_one(selector, session=session)
        await runtime.db[CHILD_ACCESS].delete_one(selector, session=session)
        await write_tombstone(
            runtime.db, tombstone_key("child", child_id), location=location,
            version=event.version, session=session,
        )  # fmt: skip

    await _transaction(runtime, write)
    _logger.info("onboarding.child_deleted id=%s location=%s", child_id, location)


async def delete_user(runtime: Runtime, received: ReceivedEvent) -> None:
    """Everything onboarding holds for the account, then the confirmation."""
    event = received.event
    user_id, location = event.aggregate_id, event.location
    confirmation = Event.new(
        "user.data_deleted",
        producer=SERVICE,
        aggregate_id=user_id,
        location=location,
        # The account's authz_version, as the request carried it (4.1).
        version=event.version,
        region=runtime.settings.aws_region,
        traceparent=current_traceparent(),
    )
    removed: dict[str, int] = {}

    async def write(session: AsyncClientSession) -> None:
        selector = {"location": location, "user_id": user_id}
        result = await runtime.db[CONVERSATIONS].delete_many(selector, session=session)
        await runtime.db[CHILD_ACCESS].delete_many(selector, session=session)
        # The user's tombstone covers each of their children: every copy write checks both.
        await write_tombstone(
            runtime.db, tombstone_key("user", user_id), location=location,
            version=event.version, session=session,
        )  # fmt: skip
        await add_to_outbox(runtime.db, confirmation, session)
        removed["conversations"] = result.deleted_count

    await _transaction(runtime, write)
    _logger.info(
        "onboarding.user_deleted id=%s conversations=%d", user_id, removed["conversations"]
    )
