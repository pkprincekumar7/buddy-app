"""What the transform worker does with others' events (docs/auth-users-split.md, 7.4, 7.7, 10).

- **`child.changed`:** the `child_access` copy. When it changes the child's `age` or
  `gender`, every Life Pathway milestone is cleared (as today's `_LIFE_PATHWAY_INPUTS`), so
  the page offers to generate them again.
- **`onboarding.*`**, **`discover.personality_finalised`**, **`grow.area_completed` /
  `grow.area_updated`:** the `onboarding_inputs`, `personality_inputs` and `growth_inputs`
  copies, each a version-checked upsert, dropped over a tombstone. A `grow.area_updated`
  that was applied clears that area's milestones: they were built from the old answers.
  The owner comes from the event's `user_id`, else from `child_access`; with neither, the
  message is retried.
- **`child.deleted`** (the purge): the child's plan, copies and photos go, its jobs are
  cancelled, with a `child:` tombstone at the final version.
- **`user.deletion_requested`** (10.3): everything of the user's, their jobs cancelled, a
  `user:` tombstone and `user.data_deleted`, in one transaction. It always confirms.

Each is safe to run twice, so the consumer needs no inbox.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from typing import Final

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
from common.generation.jobs import cancel_jobs
from common.models import (
    CHILD_ACCESS,
    GROWTH_INPUTS,
    ONBOARDING_INPUTS,
    PERSONALITY_INPUTS,
    child_access_fields,
    growth_inputs_fields,
    growth_inputs_id,
    onboarding_inputs_fields,
    personality_inputs_fields,
)
from common.telemetry import current_traceparent
from transform.app.runtime import SERVICE, Runtime
from transform.app.store import PLANS

COPIES = (CHILD_ACCESS, ONBOARDING_INPUTS, PERSONALITY_INPUTS)
PHOTO_KIND: Final = "ninety-day-plan"

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
    """Apply a `child.changed` snapshot; clear the Life Pathway if age or gender changed."""
    event = received.event
    before = await runtime.db[CHILD_ACCESS].find_one(
        {"_id": event.aggregate_id, "location": event.location}, {"age": 1, "gender": 1}
    )
    applied = await versioned_upsert(
        runtime.db,
        CHILD_ACCESS,
        doc_id=event.aggregate_id,
        location=event.location,
        version=event.version,
        fields=child_access_fields(received),
        tombstones=_tombstones(event.aggregate_id, received.payload["user_id"]),
    )
    payload = received.payload
    if (
        applied
        and before is not None
        and (
            before.get("age") != payload.get("age") or before.get("gender") != payload.get("gender")
        )
    ):
        await runtime.db[PLANS].update_one(
            {"_id": event.aggregate_id, "location": event.location},
            {"$unset": {"life_pathway": ""}},
        )
    return applied


async def _owner(runtime: Runtime, received: ReceivedEvent) -> str:
    user_id = received.payload.get("user_id")
    if user_id:
        return str(user_id)
    event = received.event
    copy = await runtime.db[CHILD_ACCESS].find_one(
        {"_id": event.aggregate_id, "location": event.location}
    )
    if copy is None:
        raise OwnerUnknown(event.aggregate_id)  # the message comes back after child.changed
    return str(copy["user_id"])


async def copy_inputs(runtime: Runtime, received: ReceivedEvent) -> bool:
    """Another circle's data into its copy; True if it was newer."""
    event = received.event
    user_id = await _owner(runtime, received)
    doc_id = event.aggregate_id
    if event.event_type == "discover.personality_finalised":
        collection, fields = PERSONALITY_INPUTS, personality_inputs_fields(received, user_id)
    elif event.event_type.startswith("grow."):
        collection, fields = GROWTH_INPUTS, growth_inputs_fields(received, user_id)
        doc_id = growth_inputs_id(event.aggregate_id, received.payload["area_id"])
    else:
        collection, fields = ONBOARDING_INPUTS, onboarding_inputs_fields(received, user_id)
    applied = await versioned_upsert(
        runtime.db,
        collection,
        doc_id=doc_id,
        location=event.location,
        version=event.version,
        fields=fields,
        tombstones=_tombstones(event.aggregate_id, user_id),
    )
    if applied and event.event_type == "grow.area_updated":
        await runtime.db[PLANS].update_one(
            {"_id": event.aggregate_id, "location": event.location},
            {"$unset": {f"life_pathway.{received.payload['area_id']}": ""}},
        )
    return applied


async def delete_child(runtime: Runtime, received: ReceivedEvent) -> None:
    """A purged child's plan, copies, photos and jobs, and its tombstone."""
    event = received.event
    child_id, location = event.aggregate_id, event.location
    if runtime.uploads is not None:  # S3 isn't transactional, and deleting again is harmless
        await runtime.uploads.delete_child(location, child_id, PHOTO_KIND)

    async def write(session: AsyncClientSession) -> None:
        for name in (PLANS, *COPIES):
            await runtime.db[name].delete_one(
                {"_id": child_id, "location": location}, session=session
            )
        await runtime.db[GROWTH_INPUTS].delete_many(
            {"location": location, "child_id": child_id}, session=session
        )
        await cancel_jobs(runtime.db, child_id=child_id, session=session)
        await delete_child_events(runtime.db, location=location, child_id=child_id, session=session)
        await write_tombstone(
            runtime.db, tombstone_key("child", child_id), location=location,
            version=event.version, session=session,
        )  # fmt: skip

    await _transaction(runtime, write)
    _logger.info("transform.child_deleted id=%s location=%s", child_id, location)


async def delete_user(runtime: Runtime, received: ReceivedEvent) -> None:
    """Everything transform holds for the account, then the confirmation."""
    event = received.event
    user_id, location = event.aggregate_id, event.location
    if runtime.uploads is not None:
        # Every child it knows of: a photo can be uploaded before the child has a plan.
        owned = {"location": location, "user_id": user_id}
        children = {
            *await runtime.db[PLANS].distinct("_id", owned),
            *await runtime.db[CHILD_ACCESS].distinct("_id", owned),
        }
        for child_id in sorted(children):
            await runtime.uploads.delete_child(location, child_id, PHOTO_KIND)
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
        for name in (PLANS, GROWTH_INPUTS, *COPIES):
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
    _logger.info("transform.user_deleted id=%s", user_id)
