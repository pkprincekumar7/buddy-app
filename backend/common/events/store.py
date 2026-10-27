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
from pymongo.errors import CollectionInvalid, DuplicateKeyError, OperationFailure

from common.events.envelope import Event

OUTBOX = "outbox"
TOMBSTONES = "tombstones"
GUARDS = "guards"
INBOX = "inbox"

OUTBOX_TTL_SECONDS = 7 * 24 * 3600  # after publishing (7.3)
TOMBSTONE_TTL_SECONDS = 30 * 24 * 3600  # longer than SQS's 14 days plus the DLQ redrive (4.1)
GUARD_TTL_SECONDS = 24 * 3600  # only ever needed while two transactions overlap
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
            # A row the relay could never publish, kept for a person to look at (relay).
            "set_aside_at": {"bsonType": "date"},
            "set_aside_reason": {"bsonType": "string"},
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

# A child's or user's write guard: see write_guards.
GUARD_VALIDATOR: Doc = {
    "$jsonSchema": {
        "bsonType": "object",
        "required": ["_id", "location", "touched_at"],
        "properties": {
            "_id": {"bsonType": "string", "pattern": "^(child|user):"},
            "location": {"bsonType": "string"},
            "touched_at": {"bsonType": "date"},
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


NAMESPACE_EXISTS = 48


async def ensure_validated_collection(db: Db, name: str, validator: Doc) -> AsyncCollection[Doc]:
    """Create `name` with `validator`, or update the validator of an existing one.

    A service and its worker prepare at the same start, so the other may create `name`
    between pymongo's existence check and the create: the server then refuses with
    NamespaceExists (48), which is the same "already there" as CollectionInvalid."""
    try:
        await db.create_collection(name, validator=validator)
    except CollectionInvalid:
        pass
    except OperationFailure as exc:
        if exc.code != NAMESPACE_EXISTS:
            raise
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
    # Account deletion's delete_user_events and the purge's delete_child_events (10.2, 10.3).
    await outbox.create_index([("location", ASCENDING), ("aggregate_id", ASCENDING)])
    # Unpublished rows (published_at null) never expire: TTL ignores non-dates.
    await outbox.create_index("published_at", expireAfterSeconds=OUTBOX_TTL_SECONDS)


async def ensure_tombstones(db: Db) -> None:
    """The tombstones and the write guards that go with them."""
    tombstones = await ensure_validated_collection(db, TOMBSTONES, TOMBSTONE_VALIDATOR)
    await tombstones.create_index([("location", ASCENDING), ("_id", ASCENDING)], unique=True)
    await tombstones.create_index("deleted_at", expireAfterSeconds=TOMBSTONE_TTL_SECONDS)
    guards = await ensure_validated_collection(db, GUARDS, GUARD_VALIDATOR)
    await guards.create_index([("location", ASCENDING), ("_id", ASCENDING)], unique=True)
    await guards.create_index("touched_at", expireAfterSeconds=GUARD_TTL_SECONDS)


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


async def delete_user_events(
    db: Db,
    *,
    location: str,
    user_id: str,
    child_ids: Iterable[str] = (),
    session: AsyncClientSession,
) -> int:
    """Account deletion (10.3): the user's rows in this service's outbox, published or not.

    A published row keeps its payload (child snapshots, answers, reflections) for 7 days,
    so it goes with the rest of the user's data. A row is the user's when its aggregate is
    the user or one of their children, or its payload names them. Unpublished ones go too:
    every consumer would drop them on the user's tombstone anyway. `user.data_deleted`
    rows are kept. Call it in the deletion's transaction. Returns how many.
    """
    if not session.in_transaction:
        raise RuntimeError("delete_user_events must run inside the deletion's transaction")
    selector: Doc = {
        "location": location,
        # Confirmations stay: ids only, and auth needs each one (a repeat confirms again).
        "event_type": {"$ne": "user.data_deleted"},
        "$or": [
            {"aggregate_id": {"$in": [user_id, *child_ids]}},
            {"payload.user_id": user_id},
        ],
    }
    result = await db[OUTBOX].delete_many(selector, session=session)
    return result.deleted_count


async def delete_child_events(
    db: Db, *, location: str, child_id: str, session: AsyncClientSession
) -> int:
    """A purged child (10.2): this service's rows about the child, published or not, as
    `delete_user_events` does for an account. `child.deleted` rows stay (ids only; the
    circles need it). Call it in the purge's transaction. Returns how many."""
    if not session.in_transaction:
        raise RuntimeError("delete_child_events must run inside the purge's transaction")
    result = await db[OUTBOX].delete_many(
        {"location": location, "aggregate_id": child_id, "event_type": {"$ne": "child.deleted"}},
        session=session,
    )
    return result.deleted_count


# ── tombstones ─────────────────────────────────────────────────────────────────


def tombstone_key(kind: Literal["child", "user"], record_id: str) -> str:
    return f"{kind}:{record_id}"


async def write_guards(
    db: Db, keys: Iterable[str], *, location: str, session: AsyncClientSession | None
) -> None:
    """Touch each key's guard (`child:<id>`, `user:<id>`) in the caller's transaction.

    MongoDB doesn't see a conflict between reading a tombstone that isn't there yet and
    writing it (review): a copy write that checked "not deleted" could commit after the
    deletion and bring the copy back. Every write that checks tombstones and every
    tombstone write also write the same guard document, so the two transactions conflict
    and one runs again: the copy then sees the tombstone, or the deletion sees the copy.
    Ids only, and gone a day after the last touch.
    """
    for key in sorted(set(keys)):  # one order everywhere
        await db[GUARDS].update_one(
            {"_id": key, "location": location},
            {"$set": {"touched_at": _now()}},
            upsert=True,
            session=session,
        )


async def write_tombstone(
    db: Db,
    key: str,
    *,
    location: str,
    version: int,
    session: AsyncClientSession | None = None,
) -> None:
    """Record a deletion; safe to repeat (the highest version wins). It touches the key's
    guard too, so it conflicts with any copy write of that key in flight (write_guards)."""
    await write_guards(db, [key], location=location, session=session)
    await db[TOMBSTONES].update_one(
        {"_id": key, "location": location},
        {"$max": {"version": version}, "$set": {"deleted_at": _now()}},
        upsert=True,
        session=session,
    )


async def is_tombstoned(
    db: Db,
    keys: Iterable[str],
    session: AsyncClientSession | None = None,
    *,
    location: str | None = None,
) -> bool:
    """Whether any of `keys` is deleted; give `location` when known (the shard key)."""
    keys = list(keys)
    if not keys:
        return False
    selector: Doc = {"_id": {"$in": keys}}
    if location is not None:
        selector["location"] = location
    return await db[TOMBSTONES].find_one(selector, {"_id": 1}, session=session) is not None


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
    Without `session` it runs in a transaction of its own: the tombstone check and the
    write then conflict with a deletion in flight (write_guards).
    """
    reserved = {"_id", "location", "version", "updated_at"} & set(fields)
    if reserved:
        raise ValueError(f"fields mustn't set {sorted(reserved)}")
    stones = list(tombstones)

    async def apply(s: AsyncClientSession) -> bool:
        if stones:
            await write_guards(db, stones, location=location, session=s)
        if await is_tombstoned(db, stones, location=location, session=s):
            return False
        coll = db[collection]
        # Read first, so a stale event never relies on a write error: inside a transaction
        # any write error aborts the whole transaction.
        existing = await coll.find_one(
            {"_id": doc_id, "location": location}, {"version": 1}, session=s
        )
        if existing is not None and existing.get("version", 0) >= version:
            return False
        result = await coll.update_one(
            {"_id": doc_id, "location": location, "version": {"$lt": version}},
            {"$set": {**fields, "version": version, "updated_at": _now()}},
            upsert=existing is None,
            session=s,
        )
        return result.upserted_id is not None or result.modified_count == 1

    if session is not None:
        # The caller's transaction: a duplicate-key error has aborted it, so it's re-raised
        # for the message to be retried.
        return await apply(session)
    applied: dict[str, bool] = {}

    async def run(s: AsyncClientSession) -> None:
        applied["ok"] = await apply(s)

    try:
        async with db.client.start_session() as own:
            await own.with_transaction(run)
    except DuplicateKeyError:
        return False  # a newer copy was inserted between the read and the write
    return applied["ok"]


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
