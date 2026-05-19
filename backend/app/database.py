import logging

from pymongo import ASCENDING, DESCENDING
from motor.motor_asyncio import AsyncIOMotorDatabase
from fastapi import Request

log = logging.getLogger(__name__)


def get_db(request: Request) -> AsyncIOMotorDatabase:
    return request.app.state.db


async def init_indexes(db: AsyncIOMotorDatabase) -> None:
    # email_index is intentionally unsharded — it is the global uniqueness guard
    # and the source of truth for email → (user_id, location) resolution.
    # _id (email) is already uniquely indexed by MongoDB; the user_id index
    # supports reverse lookups on account deletion.
    await db["email_index"].create_index([("user_id", ASCENDING)])

    # (location, _id) is marked unique=True on every sharded collection.
    # _id is already globally unique by MongoDB's default index, so this constraint
    # is never violated in practice — but it satisfies the Atlas Global Cluster
    # requirement that the shard key {location: 1, _id: 1} must have a unique index.
    await db["users"].create_index([("location", ASCENDING), ("_id", ASCENDING)], unique=True)
    await db["users"].create_index([("location", ASCENDING), ("email", ASCENDING)], unique=True)
    await db["users"].create_index([("location", ASCENDING), ("role", ASCENDING)])

    # No TTL index: MongoDB TTL indexes cannot be compound, so including the shard key
    # (location) is impossible. Expiry is enforced in the refresh flow; stale sessions
    # are removed when the user refreshes, logs out, or deletes their account.
    # A background cleanup task in main.py handles sessions that are never explicitly
    # closed (see _cleanup_expired_sessions).
    await db["sessions"].create_index([("location", ASCENDING), ("_id", ASCENDING)], unique=True)
    await db["sessions"].create_index([("location", ASCENDING), ("expires_at", ASCENDING)])
    await db["sessions"].create_index([("location", ASCENDING), ("user_id", ASCENDING)])

    # goals: single-document-per-child, keyed by child_id.
    await db["goals"].create_index([("location", ASCENDING), ("_id", ASCENDING)], unique=True)
    await db["goals"].create_index([("location", ASCENDING), ("user_id", ASCENDING)])

    # growth_areas: unique per (user, child, area) — child_id added to the compound key.
    await db["growth_areas"].create_index([("location", ASCENDING), ("_id", ASCENDING)], unique=True)
    await db["growth_areas"].create_index(
        [("location", ASCENDING), ("user_id", ASCENDING), ("child_id", ASCENDING), ("area_id", ASCENDING)],
        unique=True,
    )
    await db["growth_areas"].create_index(
        [("location", ASCENDING), ("user_id", ASCENDING), ("child_id", ASCENDING), ("created_at", ASCENDING)]
    )

    await db["children"].create_index([("location", ASCENDING), ("_id", ASCENDING)], unique=True)
    await db["children"].create_index(
        [("location", ASCENDING), ("user_id", ASCENDING), ("created_at", DESCENDING)]
    )
    await db["children"].create_index(
        [("location", ASCENDING), ("user_id", ASCENDING), ("name", ASCENDING)]
    )

    log.info("database: MongoDB indexes ensured")
