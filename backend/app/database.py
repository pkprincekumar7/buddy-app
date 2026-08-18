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
    # No (location, user_id) index: every lookup is by _id (child_id), which is
    # covered by the (location, _id) unique index. The only user_id-scoped op is
    # delete_many in delete_account, which is rare and acceptable without an index.
    await db["goals"].create_index([("location", ASCENDING), ("_id", ASCENDING)], unique=True)

    # goal_insights: single-document-per-child, keyed by child_id.
    # No (location, user_id) index for the same reason as goals above.
    await db["goal_insights"].create_index(
        [("location", ASCENDING), ("_id", ASCENDING)], unique=True
    )

    # observations: single-document-per-child, keyed by child_id — same shape as
    # goals and goal_insights above, and indexed the same way. There is no
    # child_id FIELD here because _id IS the child id; a separate field would
    # duplicate the primary key and could drift from it. The only user_id-scoped
    # op is delete_many in delete_account, which is rare and acceptable unindexed.
    await db["observations"].create_index(
        [("location", ASCENDING), ("_id", ASCENDING)], unique=True
    )

    await db["goal_months"].create_index([("location", ASCENDING), ("_id", ASCENDING)], unique=True)
    # Uniqueness guard for the (child, month) pair, also the primary lookup index
    # for GET /user/goal-months (filters on location + child_id + user_id).
    # location MUST be the leading key: Atlas Global Clusters require that every
    # unique index on a sharded collection has the shard key as its prefix.
    # The shard key for goal_months is {location: 1}, so this index satisfies that
    # requirement. Changing the field order will break sharding on M10+.
    # Prefix (location, child_id, user_id) is covered by this unique index,
    # so no separate non-unique index is needed for list queries.
    await db["goal_months"].create_index(
        [
            ("location", ASCENDING),
            ("child_id", ASCENDING),
            ("user_id", ASCENDING),
            ("month", ASCENDING),
        ],
        unique=True,
    )

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
    # No (location, user_id, child_id, created_at) index on growth_areas:
    # GET /user/completed-growth-areas filters on (location, user_id, child_id) and
    # sorts by created_at. The (location, user_id, child_id, area_id) unique index
    # covers the filter prefix; the result set per child is small enough that the
    # in-memory sort on created_at is negligible. Fewer indexes = faster writes on
    # M0's shared IOPS cap.

    await db["children"].create_index([("location", ASCENDING), ("_id", ASCENDING)], unique=True)
    # Partial indexes on active (non-deleted) children only — soft-deleted children
    # are excluded so list/sort queries never surface them, and the index stays
    # smaller than a full-collection index. The partialFilterExpression must exactly
    # match the {is_deleted: False} equality used in query filters so MongoDB can
    # use these indexes (partial indexes are skipped when the query predicate is not
    # a superset of the filter expression).
    await db["children"].create_index(
        [("location", ASCENDING), ("user_id", ASCENDING), ("created_at", DESCENDING)],
        partialFilterExpression={"is_deleted": False},
    )
    await db["children"].create_index(
        [("location", ASCENDING), ("user_id", ASCENDING), ("name", ASCENDING)],
        partialFilterExpression={"is_deleted": False},
    )
    # Soft-delete purge sweep: find children past their 30-day retention window.
    # Partial filter restricts the index to soft-deleted docs only, keeping it tiny.
    # location is the leading key for shard-scoped purge queries (one shard at a time).
    await db["children"].create_index(
        [("location", ASCENDING), ("deleted_at", ASCENDING)],
        partialFilterExpression={"is_deleted": True},
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
    # jobs: client polling — fetch by job_id scoped to user and location (auth + shard guard).
    # location is first so the query lands on the correct shard without scatter-gather.
    await db["jobs"].create_index(
        [("location", ASCENDING), ("job_id", ASCENDING), ("user_id", ASCENDING)], unique=True
    )
    # jobs: in-flight cap check — count pending/processing/result_ready jobs per user+child+type.
    # location is first to scope the count to a single shard (avoids scatter-gather on enqueue).
    await db["jobs"].create_index(
        [
            ("location", ASCENDING),
            ("user_id", ASCENDING),
            ("child_id", ASCENDING),
            ("type", ASCENDING),
            ("status", ASCENDING),
        ]
    )
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
