"""Account deletion, auth's part (docs/auth-users-split.md, 10.3).

**Start** (`DELETE /api/v1/auth/account`, `start`):
1. a non-locked admin is taken off the admin counter first (never the last one), by the
   caller, who passes `undo` to put them back if step 2 doesn't happen;
2. one transaction in the user's zone: `is_being_deleted`, `tokens_revoked_at` (with a new
   authz_version), every session deleted, and the `user.deletion_requested` outbox row.
   It finds the account only with the role and lock step 1 was decided on
   (`AccountChanged` otherwise);
3. outside it (unsharded, so it can't join a zone's transaction, 14): the `deletions` row
   with the services expected to confirm;
4. `authz:{id}` → `deleting`, so every service refuses the user at once.

Once step 2 has committed the deletion has started, whatever happens next: a failed step 3
or 4 is logged, not raised, and made good by the worker (`confirm` creates a missing row;
the authz stream writes the entry), and `undo` isn't run.

**Confirmations** (the worker, `confirm`): each `user.data_deleted` adds the service it came
from **as its topic says** (`ReceivedEvent.source_service`), never anything in its payload,
so one service can't confirm for another. When every expected service has confirmed, the
credentials go **last**: `email_index`, then `auth.auth`, then `authz:{id}`, then the
`deletions` row. So a stuck deletion can't be signed into, and can still be resumed.

**Stuck:** a deletion older than 24 hours is logged as `auth.deletion.stuck` (a CloudWatch
log metric filter alarms on it); a service hasn't confirmed.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable, Mapping
from datetime import UTC, datetime, timedelta
from typing import Any, cast

from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.errors import PyMongoError

from auth.app.authz_cache import delete_entry, entry_from_account, write_entry
from auth.app.runtime import SERVICE, Runtime
from auth.app.store import AUTH, DELETIONS, EMAIL_INDEX, SESSIONS, authz_change
from common.events import Event, ReceivedEvent, add_to_outbox
from common.telemetry import current_traceparent

STUCK_AFTER = timedelta(hours=24)

_logger = logging.getLogger(__name__)


class AlreadyDeleting(Exception):
    """The account's deletion has already started."""


class AccountChanged(Exception):
    """The account's role or lock changed after it was read, so the counter step may be wrong."""


def _not_committed(exc: BaseException) -> bool:
    """False when the commit may have happened (its result unknown): then nothing is undone."""
    return not (
        isinstance(exc, PyMongoError) and exc.has_error_label("UnknownTransactionCommitResult")
    )


async def start(
    runtime: Runtime,
    account: Mapping[str, Any],
    *,
    undo: Callable[[], Awaitable[None]] | None = None,
) -> dict[str, Any]:
    """Steps 2–4 for `account`, as read by the caller. Returns it as updated.

    `undo` (the caller's admin-counter step, reversed) runs only if step 2 didn't commit.
    """
    user_id, location = account["_id"], account["location"]
    now = datetime.now(UTC)
    result: dict[str, Any] = {}

    async def write(session: AsyncClientSession) -> None:
        updated = await runtime.db[AUTH].find_one_and_update(
            {
                "_id": user_id,
                "location": location,
                "is_being_deleted": {"$ne": True},
                # As the caller read it: its admin-counter step was decided on these.
                "role": account["role"],
                "is_locked": True if account.get("is_locked") else {"$ne": True},
            },
            authz_change({"is_being_deleted": True, "tokens_revoked_at": now}, now),
            return_document=ReturnDocument.AFTER,
            session=session,
        )
        if updated is None:
            current = await runtime.db[AUTH].find_one(
                {"_id": user_id, "location": location}, session=session
            )
            if current is None or current.get("is_being_deleted"):
                raise AlreadyDeleting(user_id)
            raise AccountChanged(user_id)
        await runtime.db[SESSIONS].delete_many(
            {"location": location, "user_id": user_id}, session=session
        )
        event = Event.new(
            "user.deletion_requested",
            producer=SERVICE,
            aggregate_id=user_id,
            location=location,
            # The account's authz_version: what every tombstone of this user records (4.1).
            version=updated["authz_version"],
            region=runtime.settings.aws_region,
            traceparent=current_traceparent(),
        )
        await add_to_outbox(runtime.db, event, session)
        result["account"] = updated

    try:
        async with runtime.client.start_session() as session:
            await session.with_transaction(write)
    except BaseException as exc:
        if undo is not None and _not_committed(exc):
            await undo()
        raise
    updated = result["account"]
    try:
        await runtime.db[DELETIONS].update_one(
            {"_id": user_id},
            {
                "$setOnInsert": {
                    "location": location,
                    "requested_at": now,
                    "expected": runtime.settings.participants,
                    "confirmed": [],
                }
            },
            upsert=True,
        )
        await write_entry(runtime.cache, user_id, entry_from_account(updated))
    except Exception:
        # Started all the same: the worker makes these good (above).
        _logger.exception("user.deletion_requested id=%s: after-commit step failed", user_id)
    _logger.info("user.deletion_requested id=%s location=%s", user_id, location)
    return updated


async def confirm(runtime: Runtime, received: ReceivedEvent) -> bool:
    """Record one `user.data_deleted`; finish when all expected services have. True if
    this confirmation finished the deletion."""
    user_id, location = received.event.aggregate_id, received.event.location
    deletions = runtime.db[DELETIONS]
    # Created here too if the start crashed between its transaction and the upsert.
    # With upsert and AFTER there's always a document.
    doc = cast(
        dict[str, Any],
        await deletions.find_one_and_update(
            {"_id": user_id},
            {
                "$addToSet": {"confirmed": received.source_service},
                "$setOnInsert": {
                    "location": location,
                    "requested_at": datetime.now(UTC),
                    "expected": runtime.settings.participants,
                },
            },
            upsert=True,
            return_document=ReturnDocument.AFTER,
        ),
    )
    _logger.info("user.data_deleted id=%s from=%s", user_id, received.source_service)
    if not set(doc["expected"]) <= set(doc["confirmed"]):
        return False
    await finish(runtime, user_id, doc["location"])
    return True


async def finish(runtime: Runtime, user_id: str, location: str) -> None:
    """Every service has confirmed: the credentials go last, in this order (10.3)."""
    await runtime.db[EMAIL_INDEX].delete_many({"user_id": user_id})
    await runtime.db[AUTH].delete_one({"_id": user_id, "location": location})
    await delete_entry(runtime.cache, user_id)
    await runtime.db[DELETIONS].delete_one({"_id": user_id})
    _logger.info("user.deleted id=%s location=%s", user_id, location)


async def report_stuck(runtime: Runtime, locations: list[str] | None) -> int:
    """Log each of this region's deletions older than 24 h; returns how many."""
    selector: dict[str, Any] = {"requested_at": {"$lt": datetime.now(UTC) - STUCK_AFTER}}
    if locations is not None:
        selector["location"] = {"$in": locations}
    stuck = await runtime.db[DELETIONS].find(selector).to_list(None)
    for doc in stuck:
        missing = sorted(set(doc["expected"]) - set(doc["confirmed"]))
        _logger.error(
            "auth.deletion.stuck id=%s since=%s waiting_for=%s",
            doc["_id"],
            doc["requested_at"].isoformat(),
            ",".join(missing),
        )
    return len(stuck)
