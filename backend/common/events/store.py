"""The shared collections every event-using service keeps (docs/auth-users-split.md, 4.1, 7.3, 7.4).

- `outbox`: written in the same transaction as the change; the relay publishes it.
- `tombstones`: a deleted child or user, so a late event or read-through can't recreate it.
- `inbox`: opt-in, for a handler that can't safely run twice.

Plus the two write patterns that make a handler safe to run twice: the version-checked
upsert and the one-way flag (7.4).
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from datetime import UTC, datetime
from typing import Any, Literal

from pymongo import ASCENDING
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import CollectionInvalid, DuplicateKeyError

from common.events.envelope import Event

OUTBOX = "outbox"
TOMBSTONES = "tombstones"
INBOX = "inbox"

OUTBOX_TTL_SECONDS = 7 * 24 * 3600  # after publishing (7.3)
TOMBSTONE_TTL_SECONDS = 30 * 24 * 3600  # longer than SQS's 14 days plus the DLQ redrive (4.1)
INBOX_TTL_SECONDS = 15 * 24 * 3600  # longer than SQS's 14-day retention (7.3)

Doc = dict[str, Any]
Db = AsyncDatabase[Doc]


def _now() -> datetime:
    return datetime.now(UTC)


# ── validators (4: every collection gets a $jsonSchema validator) ──────────────

OUTBOX_VALIDATOR: Doc = {
    "$jsonSchema": {
        "bsonType": "object",
        "required": [
            "_id", "event_type", "schema", "aggregate_id", "location", "version",
            "payload", "region", "created_at",
        ],
        "properties": {
            "_id": {"bsonType": "string"},
            "event_type": {"bsonType": "string"},
            "schema": {"bsonType": "string"},
            "aggregate_id": {"bsonType": "string"},
            "location": {"bsonType": "string"},
            "version": {"bsonType": ["int", "long"], "minimum": 1},
            "payload": {"bsonType": "object"},
            "region": {"bsonType": "string"},
            "traceparent": {"bsonType": "string"},
            "created_at": {"bsonType": "date"},
            "published_at": {"bsonType": ["date", "null"]},
        },
    }
}  # fmt: skip

TOMBSTONE_VALIDATOR: Doc = {
    "$jsonSchema": {
        "bsonType": "object",
        "required": ["_id", "location", "version", "deleted_at"],
        "properties": {
            "_id": {"bsonType": "string", "pattern": "^(child|user):"},
            "location": {"bsonType": "string"},
            "version": {"bsonType": ["int", "long"], "minimum": 1},
            "deleted_at": {"bsonType": "date"},
        },
    }
}

INBOX_VALIDATOR: Doc = {
    "$jsonSchema": {
        "bsonType": "object",
        "required": ["_id", "event_type", "processed_at"],
        "properties": {
            "_id": {"bsonType": "string"},
            "event_type": {"bsonType": "string"},
            "processed_at": {"bsonType": "date"},
        },
    }
}


async def ensure_validated_collection(db: Db, name: str, validator: Doc) -> AsyncCollection[Doc]:
    """Create `name` with `validator`, or update the validator of an existing one."""
    try:
        await db.create_collection(name, validator=validator)
    except CollectionInvalid:
        await db.command("collMod", name, validator=validator)
    return db[name]


async def ensure_outbox(db: Db) -> None:
    """The outbox collection with its validator and indexes. Safe to run on every start."""
    outbox = await ensure_validated_collection(db, OUTBOX, OUTBOX_VALIDATOR)
    await outbox.create_index([("location", ASCENDING), ("_id", ASCENDING)], unique=True)
    # The relay's polling query: its own region's unpublished rows, oldest first.
    await outbox.create_index(
        [("region", ASCENDING), ("published_at", ASCENDING), ("created_at", ASCENDING)]
    )
    # Unpublished rows (published_at null) never expire: TTL ignores non-dates.
    await outbox.create_index("published_at", expireAfterSeconds=OUTBOX_TTL_SECONDS)


async def ensure_tombstones(db: Db) -> None:
    tombstones = await ensure_validated_collection(db, TOMBSTONES, TOMBSTONE_VALIDATOR)
    await tombstones.create_index([("location", ASCENDING), ("_id", ASCENDING)], unique=True)
    await tombstones.create_index("deleted_at", expireAfterSeconds=TOMBSTONE_TTL_SECONDS)


async def ensure_inbox(db: Db) -> None:
    """Only in a service with a `dedupe=True` handler (7.3)."""
    inbox = await ensure_validated_collection(db, INBOX, INBOX_VALIDATOR)
    await inbox.create_index("processed_at", expireAfterSeconds=INBOX_TTL_SECONDS)


# ── the outbox ─────────────────────────────────────────────────────────────────


async def add_to_outbox(db: Db, event: Event, session: AsyncClientSession) -> None:
    """Write `event` in the caller's transaction, next to the change it describes (7.3).

    Run that transaction with `session.with_transaction(...)`, which retries a transient
    conflict, and create the collections at startup (`ensure_outbox`): a collection created
    implicitly inside a transaction conflicts with any concurrent create of it.
    """
    if not session.in_transaction:
        raise RuntimeError("add_to_outbox must run inside the change's transaction")
    await db[OUTBOX].insert_one(event.to_outbox(), session=session)


# ── tombstones ─────────────────────────────────────────────────────────────────


def tombstone_key(kind: Literal["child", "user"], record_id: str) -> str:
    return f"{kind}:{record_id}"


async def write_tombstone(
    db: Db,
    key: str,
    *,
    location: str,
    version: int,
    session: AsyncClientSession | None = None,
) -> None:
    """Record a deletion; safe to repeat (the highest version wins)."""
    await db[TOMBSTONES].update_one(
        {"_id": key, "location": location},
        {"$max": {"version": version}, "$set": {"deleted_at": _now()}},
        upsert=True,
        session=session,
    )


async def is_tombstoned(
    db: Db, keys: Iterable[str], session: AsyncClientSession | None = None
) -> bool:
    keys = list(keys)
    if not keys:
        return False
    return (
        await db[TOMBSTONES].find_one({"_id": {"$in": keys}}, {"_id": 1}, session=session)
        is not None
    )


# ── safe-to-run-twice writes (7.4) ────────────────────────────────────────────


async def versioned_upsert(
    db: Db,
    collection: str,
    *,
    doc_id: str,
    location: str,
    version: int,
    fields: Mapping[str, Any],
    tombstones: Iterable[str] = (),
    session: AsyncClientSession | None = None,
) -> bool:
    """Apply `fields` only if `version` is newer than the stored copy's. True if applied.

    A duplicate or older event changes nothing, and a tombstone for any of `tombstones`
    (e.g. the child's and its user's) drops the write, so deleted data can't come back.
    """
    reserved = {"_id", "location", "version", "updated_at"} & set(fields)
    if reserved:
        raise ValueError(f"fields mustn't set {sorted(reserved)}")
    if await is_tombstoned(db, tombstones, session=session):
        return False
    coll = db[collection]
    # Read first, so a stale event never relies on a write error: inside a transaction any
    # write error aborts the whole transaction.
    existing = await coll.find_one({"_id": doc_id}, {"version": 1}, session=session)
    if existing is not None and existing.get("version", 0) >= version:
        return False
    try:
        result = await coll.update_one(
            {"_id": doc_id, "location": location, "version": {"$lt": version}},
            {"$set": {**fields, "version": version, "updated_at": _now()}},
            upsert=existing is None,
            session=session,
        )
    except DuplicateKeyError:
        # A newer copy was inserted between the read and the write (another consumer).
        # In a transaction the error has aborted it: re-raise so the message is retried.
        if session is not None and session.in_transaction:
            raise
        return False
    return result.upserted_id is not None or result.modified_count == 1


async def set_flag(
    db: Db,
    collection: str,
    selector: Mapping[str, Any],
    path: str,
    *,
    session: AsyncClientSession | None = None,
) -> bool:
    """Set a one-way flag (`progress.discover`) to true. True only if it actually changed.

    Follow-up events are published only on a real change (7.4), so the caller checks this.
    """
    result = await db[collection].update_one(
        {**selector, path: {"$ne": True}},
        {"$set": {path: True, "updated_at": _now()}},
        session=session,
    )
    return result.modified_count == 1
