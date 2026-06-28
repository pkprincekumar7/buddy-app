import logging

from fastapi import Request
from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo import ASCENDING, DESCENDING

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
    await db["growth_areas"].create_index(
        [("location", ASCENDING), ("_id", ASCENDING)], unique=True
    )
    await db["growth_areas"].create_index(
        [
            ("location", ASCENDING),
            ("user_id", ASCENDING),
            ("child_id", ASCENDING),
            ("area_id", ASCENDING),
        ],
        unique=True,
    )
    await db["growth_areas"].create_index(
        [
            ("location", ASCENDING),
            ("user_id", ASCENDING),
            ("child_id", ASCENDING),
            ("created_at", ASCENDING),
        ]
    )

    await db["children"].create_index([("location", ASCENDING), ("_id", ASCENDING)], unique=True)
    await db["children"].create_index(
        [("location", ASCENDING), ("user_id", ASCENDING), ("created_at", DESCENDING)]
    )
    await db["children"].create_index(
        [("location", ASCENDING), ("user_id", ASCENDING), ("name", ASCENDING)]
    )

    # jobs: worker polling — find pending jobs whose backoff has elapsed (retry_after <= now),
    # then sort FIFO by created_at.  retry_after is included so the index covers the claim
    # query without a collection scan.
    # Note: this index omits the shard key (location) because the worker processes jobs
    # across all locations. On a sharded Atlas cluster this causes scatter-gather per claim —
    # acceptable at current scale; add location to the index if claim latency becomes a concern.
    await db["jobs"].create_index(
        [("status", ASCENDING), ("retry_after", ASCENDING), ("created_at", ASCENDING)]
    )
    # jobs: client polling — fetch by job_id scoped to user (auth guard)
    await db["jobs"].create_index([("job_id", ASCENDING), ("user_id", ASCENDING)], unique=True)
    # jobs: stale claim recovery — find jobs stuck in processing
    await db["jobs"].create_index([("status", ASCENDING), ("claimed_at", ASCENDING)])
    # jobs: result_ready domain-write retry — the claim query for result_ready jobs filters
    # on domain_write_attempt which cannot use the (status, retry_after, created_at) index
    # because $expr bypasses index selection.  This partial index lets MongoDB satisfy
    # the result_ready branch without a collection scan.
    await db["jobs"].create_index(
        [("status", ASCENDING), ("domain_write_attempt", ASCENDING)],
        partialFilterExpression={"status": "result_ready"},
    )
    # jobs: TTL — auto-delete completed/failed jobs after 24h
    # partialFilterExpression restricts TTL to terminal states only;
    # pending/processing jobs must never be deleted by TTL.
    await db["jobs"].create_index(
        "completed_at",
        expireAfterSeconds=86400,
        partialFilterExpression={"status": {"$in": ["completed", "failed"]}},
    )

    log.info("database: MongoDB indexes ensured")
