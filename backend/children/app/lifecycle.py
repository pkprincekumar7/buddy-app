"""What the children worker does to children (docs/auth-users-split.md, 10.2, 10.3, 12.4).

**Progress flags (12.4).** Each circle's completion event sets its flag:
`onboarding.conversation_completed` → `conversation`, `discover.completed` → `discover`,
`grow.completed` → `grow`, `transform.completed` → `transform`, `release.completed` →
`release`. **No order check**: events aren't ordered, so `grow.completed` may arrive before
`discover.completed`, and rejecting it would lose it; the circles enforce the order
themselves. A flag is one-way, so a duplicate changes nothing, and only a real change
bumps `version` and publishes one `child.changed` snapshot (7.4).

**The purge (10.2).** A child soft-deleted more than 30 days ago is removed for good: its
avatar objects first (S3 isn't transactional, and deleting again is harmless), then, in
one transaction, the document, a `child:` tombstone and `child.deleted`, all at the child's
**final version** (its last write's + 1), so every circle drops it and nothing can bring it
back.

**Account deletion (10.3).** `user.deletion_requested` deletes every child of the user at
once, without the 30 days: their avatars, then in one transaction the documents, a `child:`
tombstone each, a `user:` tombstone and `user.data_deleted`. It always confirms, even with no
children; a duplicate deletes nothing and confirms again, which auth ignores. The circles
hear `user.deletion_requested` themselves, so no `child.deleted` is sent per child.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime, timedelta
from typing import Any

from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from children.app.runtime import SERVICE, Runtime
from children.app.store import CHILDREN, snapshot
from common import upload_tracking
from common.events import (
    Event,
    ReceivedEvent,
    add_to_outbox,
    delete_child_events,
    delete_user_events,
    tombstone_key,
    write_tombstone,
)
from common.telemetry import current_traceparent

# Which flag each completion event sets (12.4). `connect` is set by the visit route
# (main.connect_visit) until a connect service exists.
FLAG_FOR_EVENT: dict[str, str] = {
    "onboarding.conversation_completed": "conversation",
    "discover.completed": "discover",
    "grow.completed": "grow",
    "transform.completed": "transform",
    "release.completed": "release",
}
PURGE_AFTER = timedelta(days=30)
PURGE_BATCH = 100

_logger = logging.getLogger(__name__)


def _event(
    runtime: Runtime, event_type: str, doc: Mapping[str, Any], version: int, payload: dict[str, Any]
) -> Event:
    return Event.new(
        event_type,
        producer=SERVICE,
        aggregate_id=doc["_id"],
        location=doc["location"],
        version=version,
        region=runtime.settings.aws_region,
        payload=payload,
        traceparent=current_traceparent(),
    )


async def _transaction(runtime: Runtime, write: Any) -> None:
    async with runtime.client.start_session() as session:
        await session.with_transaction(write)


# ── progress flags ─────────────────────────────────────────────────────────────


async def set_progress(runtime: Runtime, received: ReceivedEvent) -> bool:
    """Set the event's flag on its child; publish a snapshot only if it changed it."""
    flag = FLAG_FOR_EVENT[received.event_type]
    child_id, location = received.event.aggregate_id, received.event.location
    changed: dict[str, bool] = {"value": False}

    async def write(session: AsyncClientSession) -> None:
        updated = await runtime.db[CHILDREN].find_one_and_update(
            {"_id": child_id, "location": location, f"progress.{flag}": {"$ne": True}},
            {
                "$set": {f"progress.{flag}": True, "updated_at": datetime.now(UTC)},
                "$inc": {"version": 1},
            },
            return_document=ReturnDocument.AFTER,
            session=session,
        )
        changed["value"] = updated is not None
        if updated is not None:
            await add_to_outbox(
                runtime.db,
                _event(runtime, "child.changed", updated, updated["version"], snapshot(updated)),
                session,
            )

    # Already set, or a child that's gone (purged, or never here): nothing to do.
    await _transaction(runtime, write)
    return changed["value"]


# ── the purge ──────────────────────────────────────────────────────────────────


async def _delete_avatars(runtime: Runtime, docs: Sequence[Mapping[str, Any]]) -> None:
    if runtime.uploads is None:
        return
    for doc in docs:
        await runtime.uploads.delete_child(doc["location"], doc["_id"], "avatar")


async def purge_one(runtime: Runtime, doc: Mapping[str, Any]) -> bool:
    """Remove one soft-deleted child for good; False if it changed since it was read."""
    await _delete_avatars(runtime, [doc])
    final = doc["version"] + 1
    done = {"purged": False}

    async def write(session: AsyncClientSession) -> None:
        removed = await runtime.db[CHILDREN].delete_one(
            # Exactly as read: a child restored meanwhile isn't purged.
            {
                "_id": doc["_id"],
                "location": doc["location"],
                "version": doc["version"],
                "is_deleted": True,
            },
            session=session,
        )
        done["purged"] = removed.deleted_count == 1
        if not done["purged"]:
            return
        await upload_tracking.forget_children(
            runtime.db, [doc["_id"]], location=doc["location"], session=session
        )
        # Its earlier snapshots (names, progress) go with it; child.deleted stays.
        await delete_child_events(
            runtime.db, location=doc["location"], child_id=doc["_id"], session=session
        )
        await write_tombstone(
            runtime.db, tombstone_key("child", doc["_id"]), location=doc["location"],
            version=final, session=session,
        )  # fmt: skip
        await add_to_outbox(
            runtime.db,
            _event(runtime, "child.deleted", doc, final, {"user_id": doc["user_id"]}),
            session,
        )

    await _transaction(runtime, write)
    if done["purged"]:
        _logger.info("children.purged id=%s location=%s", doc["_id"], doc["location"])
    return done["purged"]


async def purge(runtime: Runtime, locations: list[str] | None) -> int:
    """Remove one batch of children deleted more than 30 days ago; returns how many."""
    selector: dict[str, Any] = {
        "is_deleted": True,
        "deleted_at": {"$lt": datetime.now(UTC) - PURGE_AFTER},
    }
    if locations is not None:
        selector["location"] = {"$in": locations}
    docs = await runtime.db[CHILDREN].find(selector).limit(PURGE_BATCH).to_list(None)
    return sum([await purge_one(runtime, doc) for doc in docs])


# ── account deletion ───────────────────────────────────────────────────────────


async def delete_user(runtime: Runtime, received: ReceivedEvent) -> int:
    """Every child of the account, then the confirmation; returns how many were deleted."""
    event = received.event
    user_id, location = event.aggregate_id, event.location
    selector = {"location": location, "user_id": user_id}
    # Avatars first (S3 isn't transactional; a crash after it leaves the documents to retry).
    before = await runtime.db[CHILDREN].find(selector).to_list(None)
    await _delete_avatars(runtime, before)
    deleted: dict[str, list[dict[str, Any]]] = {}
    confirmation = Event.new(
        "user.data_deleted",
        producer=SERVICE,
        aggregate_id=user_id,
        location=location,
        version=event.version,
        region=runtime.settings.aws_region,
        traceparent=current_traceparent(),
    )

    async def write(session: AsyncClientSession) -> None:
        # Read again in the transaction: a child added since the read above is deleted and
        # tombstoned too (review). The user's guard makes a create racing this conflict.
        docs = await runtime.db[CHILDREN].find(selector, session=session).to_list(None)
        deleted["docs"] = docs
        child_ids = [doc["_id"] for doc in docs]
        await runtime.db[CHILDREN].delete_many(selector, session=session)
        await upload_tracking.forget_children(
            runtime.db, child_ids, location=location, session=session
        )
        for doc in docs:
            await write_tombstone(
                runtime.db, tombstone_key("child", doc["_id"]), location=location,
                version=doc["version"] + 1, session=session,
            )  # fmt: skip
        await write_tombstone(
            runtime.db, tombstone_key("user", user_id), location=location,
            version=event.version, session=session,
        )  # fmt: skip
        await delete_user_events(
            runtime.db, location=location, user_id=user_id, child_ids=child_ids, session=session
        )
        await add_to_outbox(runtime.db, confirmation, session)

    await _transaction(runtime, write)
    docs = deleted["docs"]
    # A child created between the first read and the transaction: its avatars now.
    known = {doc["_id"] for doc in before}
    await _delete_avatars(runtime, [doc for doc in docs if doc["_id"] not in known])
    _logger.info("children.user_deleted id=%s children=%d", user_id, len(docs))
    return len(docs)
