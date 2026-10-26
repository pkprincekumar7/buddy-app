"""What the discover worker does with others' events (docs/auth-users-split.md, 7.4, 7.7, 10, 12.1).

- **`child.changed`:** the `child_access` copy, as a version-checked upsert.
- **`onboarding.conversation_completed`:** the `onboarding_inputs` copy, then the
  personality starts on its own (discover.app.generation.start), so the Discover page
  usually opens on "generating…". A personality already `generating` or `ready` is left
  alone, so a redelivery starts nothing.
- **`child.deleted`** (the purge): the child's personality and copies go, its open jobs
  are cancelled, in one transaction with a `child:` tombstone at the final version.
- **`user.deletion_requested`** (10.3): everything of the user's, their jobs cancelled, a
  `user:` tombstone and `user.data_deleted`, in one transaction. It always confirms.

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
    delete_child_events,
    delete_user_events,
    tombstone_key,
    versioned_upsert,
    write_tombstone,
)
from common.generation.jobs import JobRefused, cancel_jobs
from common.models import (
    CHILD_ACCESS,
    ONBOARDING_INPUTS,
    child_access_fields,
    onboarding_inputs_fields,
)
from common.telemetry import current_traceparent
from discover.app import generation
from discover.app.runtime import SERVICE, Runtime
from discover.app.store import PERSONALITIES

COPIES = (PERSONALITIES, CHILD_ACCESS, ONBOARDING_INPUTS)

_logger = logging.getLogger(__name__)


class OwnerUnknown(Exception):
    """The child's parent isn't known yet (no user_id in the event, no copy): retried later."""


async def _transaction(
    runtime: Runtime, write: Callable[[AsyncClientSession], Awaitable[None]]
) -> None:
    async with runtime.client.start_session() as session:
        await session.with_transaction(write)


def _tombstones(child_id: str, user_id: str) -> list[str]:
    return [tombstone_key("child", child_id), tombstone_key("user", user_id)]


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
        tombstones=_tombstones(event.aggregate_id, received.payload["user_id"]),
    )


async def conversation_completed(runtime: Runtime, received: ReceivedEvent) -> bool:
    """Copy the answers and start the personality; True if a new job was started."""
    event = received.event
    child_id, location = event.aggregate_id, event.location
    user_id = received.payload.get("user_id")
    if not user_id:
        copy = await runtime.db[CHILD_ACCESS].find_one({"_id": child_id, "location": location})
        if copy is None:
            raise OwnerUnknown(child_id)  # the message comes back after child.changed
        user_id = copy["user_id"]
    await versioned_upsert(
        runtime.db,
        ONBOARDING_INPUTS,
        doc_id=child_id,
        location=location,
        version=event.version,
        fields=onboarding_inputs_fields(received, user_id),
        tombstones=_tombstones(child_id, user_id),
    )
    try:
        _, created = await generation.start(
            runtime,
            child_id=child_id,
            user_id=user_id,
            location=location,
            input_version=event.version,
        )
    except (generation.AlreadyGenerated, JobRefused):
        return False
    return created


async def delete_child(runtime: Runtime, received: ReceivedEvent) -> None:
    """A purged child's personality, copies and jobs, and its tombstone."""
    event = received.event
    child_id, location = event.aggregate_id, event.location

    async def write(session: AsyncClientSession) -> None:
        for name in COPIES:
            await runtime.db[name].delete_one(
                {"_id": child_id, "location": location}, session=session
            )
        await cancel_jobs(runtime.db, child_id=child_id, session=session)
        await delete_child_events(runtime.db, location=location, child_id=child_id, session=session)
        await write_tombstone(
            runtime.db, tombstone_key("child", child_id), location=location,
            version=event.version, session=session,
        )  # fmt: skip

    await _transaction(runtime, write)
    _logger.info("discover.child_deleted id=%s location=%s", child_id, location)


async def delete_user(runtime: Runtime, received: ReceivedEvent) -> None:
    """Everything discover holds for the account, then the confirmation."""
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

    async def write(session: AsyncClientSession) -> None:
        # The user's children, as this service knows them (before their copies go).
        child_ids = await runtime.db[CHILD_ACCESS].distinct(
            "_id", {"location": location, "user_id": user_id}, session=session
        )
        for name in COPIES:
            await runtime.db[name].delete_many(
                {"location": location, "user_id": user_id}, session=session
            )
        await cancel_jobs(runtime.db, user_id=user_id, session=session)
        # The user's tombstone covers each of their children: every write checks both.
        await write_tombstone(
            runtime.db, tombstone_key("user", user_id), location=location,
            version=event.version, session=session,
        )  # fmt: skip
        await delete_user_events(
            runtime.db, location=location, user_id=user_id, child_ids=child_ids, session=session
        )
        await add_to_outbox(runtime.db, confirmation, session)

    await _transaction(runtime, write)
    _logger.info("discover.user_deleted id=%s", user_id)
