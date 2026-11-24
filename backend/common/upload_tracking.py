"""Photos that no document points at, swept by the service's worker (Phase 5-6 review).

A presigned POST can't stop an upload: the client may upload and never PATCH the key in, or
upload more than 5 MB, which the PATCH then refuses. Such an object belongs to no document,
so nothing would ever delete it while the child lives. Each service that presigns (children
for avatars, transform for plan photos) records the key in its own `pending_uploads` when it
presigns, removes the row in the transaction that saves the key, and its worker sweeps the
rows that are due: the object, then the row. A row is due

- a day after it was presigned (`created_at`), if no PATCH saved it;
- at its `sweep_after`, when one is set:
  - **deletion** (`forget_children`, in the child's or account's deletion transaction): the
    S3 prefix was emptied first, but a form presigned just before stays valid for
    UPLOAD_URL_TTL_SECONDS and could still land an object afterwards. So the rows aren't
    dropped: they're due once that window (and a margin) is over, and the sweep deletes the
    keys, whether or not anything was uploaded, then the rows;
  - **replacement** (`replaced`, in the transaction that stops pointing at a photo): due at
    once. `delete_now` deletes it after the commit and drops the row; if that fails, the
    sweep retries.

Rows hold ids only: the key (`uploads/{location}/{child}/{kind}/{uuid}.{ext}`), the
location, the child, when it was presigned and when it's due. A deleted child's rows outlive
it by about UPLOAD_URL_TTL_SECONDS + DELETED_SWEEP_MARGIN plus one sweep interval.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable
from datetime import UTC, datetime, timedelta
from typing import Any

from pymongo import ASCENDING
from pymongo.asynchronous.client_session import AsyncClientSession

from common.events.store import Db, ensure_validated_collection
from common.uploads import UPLOAD_URL_TTL_SECONDS, Uploads

PENDING_UPLOADS = "pending_uploads"
UNATTACHED_AFTER = timedelta(days=1)
# After a deletion: past the presigned form's validity, with room for an upload that
# started just before it expired.
DELETED_SWEEP_MARGIN = timedelta(minutes=10)
DELETED_SWEEP_AFTER = timedelta(seconds=UPLOAD_URL_TTL_SECONDS) + DELETED_SWEEP_MARGIN
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
            "sweep_after": {"bsonType": "date"},
        },
    }
}

_logger = logging.getLogger(__name__)


async def ensure_pending_uploads(db: Db) -> None:
    rows = await ensure_validated_collection(db, PENDING_UPLOADS, PENDING_UPLOADS_VALIDATOR)
    await rows.create_index([("location", ASCENDING), ("_id", ASCENDING)], unique=True)
    await rows.create_index([("location", ASCENDING), ("child_id", ASCENDING)])
    await rows.create_index("created_at")
    await rows.create_index("sweep_after", sparse=True)


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
    """In a deletion's transaction: the children's rows become due once a form presigned
    before the deletion can no longer upload (module docstring). Their objects already went
    by prefix; the sweep then deletes anything uploaded since, and the rows."""
    await db[PENDING_UPLOADS].update_many(
        {"location": location, "child_id": {"$in": list(child_ids)}},
        # $min: a row due sooner (a replaced photo) stays due sooner.
        {"$min": {"sweep_after": datetime.now(UTC) + DELETED_SWEEP_AFTER}},
        session=session,
    )


async def replaced(
    db: Db, key: str, *, location: str, child_id: str, session: AsyncClientSession
) -> None:
    """In the transaction that stops pointing at `key` (a replaced or cleared photo): it's
    due for the sweep at once, so a failed `delete_now` after the commit isn't lost."""
    now = datetime.now(UTC)
    await db[PENDING_UPLOADS].update_one(
        {"_id": key, "location": location},
        {
            "$set": {"sweep_after": now},
            "$setOnInsert": {"child_id": child_id, "created_at": now},
        },
        upsert=True,
        session=session,
    )


async def delete_now(db: Db, uploads: Uploads, key: str, *, location: str) -> bool:
    """After `replaced` committed: delete the object and its row. False (logged) if S3
    failed; the row stays, so the sweep deletes it later."""
    try:
        await uploads.delete(key)
    except Exception:
        _logger.warning("uploads: a replaced photo wasn't deleted; the sweep retries")
        return False
    await db[PENDING_UPLOADS].delete_one({"_id": key, "location": location})
    return True


async def sweep(
    db: Db,
    uploads: Uploads,
    locations: list[str] | None,
    *,
    older_than: timedelta = UNATTACHED_AFTER,
) -> int:
    """Delete one batch of due objects: presigned over a day ago and never saved, or past
    their `sweep_after`. Returns how many. A failed delete keeps its row, so the next sweep
    tries again."""
    now = datetime.now(UTC)
    selector: dict[str, Any] = {
        "$or": [{"created_at": {"$lt": now - older_than}}, {"sweep_after": {"$lte": now}}]
    }
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
