"""Photos presigned but never saved, swept after a day (Phase 5-6 review).

A presigned PUT can't stop an upload: the client may upload and never PATCH the key in, or
upload more than 5 MB, which the PATCH then refuses. Such an object belongs to no document,
so nothing would ever delete it while the child lives. Each service that presigns (children
for avatars, transform for plan photos) records the key in its own `pending_uploads` when it
presigns, removes the row in the transaction that saves the key, and its worker sweeps rows
older than a day: the object, then the row. Account and child deletion remove the rows with
the rest (their S3 prefixes go too).

Rows hold ids only: the key (`uploads/{location}/{child}/{kind}/{uuid}.{ext}`), the
location, the child and when it was presigned.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable
from datetime import UTC, datetime, timedelta
from typing import Any

from pymongo import ASCENDING
from pymongo.asynchronous.client_session import AsyncClientSession

from common.events.store import Db, ensure_validated_collection
from common.uploads import Uploads

PENDING_UPLOADS = "pending_uploads"
UNATTACHED_AFTER = timedelta(days=1)
SWEEP_BATCH = 100

PENDING_UPLOADS_VALIDATOR: dict[str, Any] = {
    "$jsonSchema": {
        "bsonType": "object",
        "required": ["_id", "location", "child_id", "created_at"],
        "properties": {
            "_id": {"bsonType": "string"},
            "location": {"bsonType": "string"},
            "child_id": {"bsonType": "string"},
            "created_at": {"bsonType": "date"},
        },
    }
}

_logger = logging.getLogger(__name__)


async def ensure_pending_uploads(db: Db) -> None:
    rows = await ensure_validated_collection(db, PENDING_UPLOADS, PENDING_UPLOADS_VALIDATOR)
    await rows.create_index([("location", ASCENDING), ("_id", ASCENDING)], unique=True)
    await rows.create_index([("location", ASCENDING), ("child_id", ASCENDING)])
    await rows.create_index("created_at")


async def record_presigned(db: Db, key: str, *, location: str, child_id: str) -> None:
    """At presign: the key is pending until a PATCH saves it."""
    await db[PENDING_UPLOADS].insert_one(
        {"_id": key, "location": location, "child_id": child_id, "created_at": datetime.now(UTC)}
    )


async def attached(
    db: Db, keys: Iterable[str], *, location: str, session: AsyncClientSession
) -> None:
    """In the transaction that saves `keys`: they're no longer pending."""
    await db[PENDING_UPLOADS].delete_many(
        {"location": location, "_id": {"$in": list(keys)}}, session=session
    )


async def forget_children(
    db: Db, child_ids: Iterable[str], *, location: str, session: AsyncClientSession
) -> None:
    """In a deletion's transaction: the children's rows (their objects go by prefix)."""
    await db[PENDING_UPLOADS].delete_many(
        {"location": location, "child_id": {"$in": list(child_ids)}}, session=session
    )


async def sweep(
    db: Db,
    uploads: Uploads,
    locations: list[str] | None,
    *,
    older_than: timedelta = UNATTACHED_AFTER,
) -> int:
    """Delete one batch of objects presigned over a day ago and never saved. Returns how
    many. A failed delete keeps its row, so the next sweep tries again."""
    selector: dict[str, Any] = {"created_at": {"$lt": datetime.now(UTC) - older_than}}
    if locations is not None:
        selector["location"] = {"$in": locations}
    rows = await db[PENDING_UPLOADS].find(selector).limit(SWEEP_BATCH).to_list(None)
    swept = 0
    for row in rows:
        try:
            await uploads.delete(row["_id"])
        except Exception:
            _logger.warning("uploads.sweep: an unattached photo wasn't deleted; retrying later")
            continue
        await db[PENDING_UPLOADS].delete_one({"_id": row["_id"], "location": row["location"]})
        swept += 1
    return swept
