"""The generation job queue, kept in each generating service's own `jobs` (docs/auth-users-split.md, 4.1, 8).

A job writes only to its own service's documents. Its target is the circle's document
(a personality, a growth area, a plan) and the lock field on it: `active_job_id`, or
`active_jobs.<type>` where one document has several kinds of generation.

- `start_job`: one transaction takes the lock on the target (creating the document if
  needed, `status: generating` unless the target keeps its own status) and inserts the job. A second start while a job is
  running gets that job back instead of a new one, and a failure leaves neither, so
  there's never a document stuck in `generating` without a job.
- `claim_next`: a worker takes the oldest due job whose `location` its region serves,
  including a job a crashed worker left `processing` too long. Each claim gets its own
  `claim_id`, and every write that ends or retries the job matches it: a worker whose job
  was retaken can't end or reset it under the new owner (review). A job retaken more times
  than `max_llm_attempts` allows is `exhausted`: the worker fails it instead of running it.
- `complete_job` / `fail_or_retry`: store the result (or the failure) on the target and
  release the lock, in one transaction with the job's end. `completed_at` is set on
  completed and failed jobs alike (the TTL deletes them 7 days later).
- A deleted child or user (a tombstone) cancels: a running job's result is dropped, and
  `cancel_jobs` ends every open job for them.
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from pymongo import ASCENDING, ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.mongo_client import AsyncMongoClient
from pymongo.errors import DuplicateKeyError

from common.events.store import Db, is_tombstoned, tombstone_key, write_guards
from common.models import JOBS, SCHEMA_VERSION

OPEN_STATUSES = ("pending", "processing")
DEFAULT_MAX_LLM_ATTEMPTS = 3
STALE_CLAIM_AFTER = timedelta(minutes=10)
BACKOFF_BASE_SECONDS = 30
BACKOFF_MAX_SECONDS = 900
CANCELLED = "cancelled"
EXHAUSTED = "gave up: the job stalled or crashed on every attempt"

Doc = dict[str, Any]
Client = AsyncMongoClient[Doc]
InTransaction = Callable[[AsyncClientSession], Awaitable[None]]


class JobRefused(Exception):
    """The child or user is being deleted (a tombstone): no new generation."""


class TargetRefused(Exception):
    """`start_job`'s `refuse_if` matched the target: e.g. it's generated already."""


class _ClaimLost(Exception):
    """The job was retaken by another worker: this one's writes must not apply."""


@dataclass(frozen=True)
class Target:
    """The circle's own document that receives the result, and its lock field."""

    collection: str
    doc_id: str
    lock: str = "active_job_id"

    def as_doc(self) -> Doc:
        return {"collection": self.collection, "id": self.doc_id, "lock": self.lock}

    @classmethod
    def of(cls, job: Mapping[str, Any]) -> Target:
        target = job["target"]
        return cls(target["collection"], target["id"], target["lock"])


def _now() -> datetime:
    return datetime.now(UTC)


def _get_path(doc: Mapping[str, Any] | None, path: str) -> Any:
    value: Any = doc
    for part in path.split("."):
        if not isinstance(value, Mapping):
            return None
        value = value.get(part)
    return value


def _tombstones(user_id: str, child_id: str) -> list[str]:
    return [tombstone_key("child", child_id), tombstone_key("user", user_id)]


def backoff(attempt: int) -> timedelta:
    """30 s, 60 s, 120 s, … capped at 15 min."""
    return timedelta(
        seconds=min(BACKOFF_BASE_SECONDS * 2 ** max(attempt - 1, 0), BACKOFF_MAX_SECONDS)
    )


# ── starting ───────────────────────────────────────────────────────────────────


async def start_job(
    db: Db,
    client: Client,
    *,
    job_type: str,
    user_id: str,
    child_id: str,
    location: str,
    target: Target,
    input_version: int,
    target_on_insert: Mapping[str, Any] | None = None,
    target_set: Mapping[str, Any] | None = None,
    max_llm_attempts: int = DEFAULT_MAX_LLM_ATTEMPTS,
    target_status: str | None = "generating",
    refuse_if: Mapping[str, Any] | None = None,
) -> tuple[str, bool]:
    """Start a job, or return the one already running. Returns (job id, created).

    `target_status=None` leaves the target's `status` alone (a growth area's status is the
    parent's wizard, not the job's); a new target then needs it in `target_on_insert`.
    `refuse_if`, a filter on the target, raises TargetRefused when it matches, checked in
    the start's transaction: "generated once" can't race a job finishing (review).
    """
    set_fields = {
        **({} if target_status is None else {"status": target_status}),
        **(target_set or {}),
    }
    insert_fields = dict(target_on_insert or {})
    overlap = set(set_fields) & set(insert_fields)
    if overlap:
        raise ValueError(f"target_set and target_on_insert both set {sorted(overlap)}")
    outcome: dict[str, Any] = {}

    async def run(session: AsyncClientSession) -> None:
        stones = _tombstones(user_id, child_id)
        # Conflicts with a deletion of this child or user in flight (store.write_guards).
        await write_guards(db, stones, location=location, session=session)
        if await is_tombstoned(db, stones, location=location, session=session):
            raise JobRefused(f"child {child_id} or its user is deleted")
        if refuse_if is not None and await db[target.collection].find_one(
            {"_id": target.doc_id, "location": location, **refuse_if}, {"_id": 1}, session=session
        ):
            raise TargetRefused(target.doc_id)
        current = await db[target.collection].find_one(
            {"_id": target.doc_id, "location": location}, {target.lock: 1}, session=session
        )
        held = _get_path(current, target.lock)
        if held:
            running = await db[JOBS].find_one(
                {"_id": held, "location": location, "status": {"$in": list(OPEN_STATUSES)}},
                {"_id": 1},
                session=session,
            )
            if running is not None:
                outcome.update(job_id=held, created=False)
                return
        now = _now()
        job_id = str(uuid.uuid4())
        # A concurrent start conflicts on this document: MongoDB aborts one transaction,
        # with_transaction runs it again, and the rerun finds the lock held above.
        await db[target.collection].update_one(
            {"_id": target.doc_id, "location": location},
            {
                "$set": {**set_fields, target.lock: job_id, "updated_at": now},
                "$setOnInsert": {
                    "user_id": user_id,
                    "child_id": child_id,
                    "created_at": now,
                    "schema_version": SCHEMA_VERSION,
                    **insert_fields,
                },
            },
            upsert=True,
            session=session,
        )
        await db[JOBS].insert_one(
            {
                "_id": job_id,
                "user_id": user_id,
                "child_id": child_id,
                "location": location,
                "type": job_type,
                "target": target.as_doc(),
                "status": "pending",
                "input_version": input_version,
                "llm_attempt": 0,
                "max_llm_attempts": max_llm_attempts,
                "created_at": now,
                "updated_at": now,
                "schema_version": SCHEMA_VERSION,
            },
            session=session,
        )
        outcome.update(job_id=job_id, created=True)

    attempts = 3
    for attempt in range(1, attempts + 1):
        outcome.clear()
        try:
            async with client.start_session() as session:
                await session.with_transaction(run)
            return outcome["job_id"], outcome["created"]
        except DuplicateKeyError:
            # Two starts both inserted the missing target document; the loser retries and
            # now finds the winner's lock.
            if attempt == attempts:
                raise
    raise AssertionError("unreachable")  # pragma: no cover - the loop returns or raises


# ── claiming ───────────────────────────────────────────────────────────────────


def _region_filter(locations: list[str] | None) -> Doc:
    # None: no scoping (a single-region environment, `locations_for_region("")`).
    return {} if locations is None else {"location": {"$in": locations}}


async def claim_next(
    db: Db, *, locations: list[str] | None, stale_after: timedelta = STALE_CLAIM_AFTER
) -> Doc | None:
    """The oldest due job in this region's locations, now `processing`, or None."""
    now = _now()
    return await db[JOBS].find_one_and_update(
        {
            **_region_filter(locations),
            "$or": [
                {
                    "status": "pending",
                    "$or": [{"retry_after": None}, {"retry_after": {"$lte": now}}],
                },
                # A worker crashed mid-job: take it over.
                {"status": "processing", "claimed_at": {"$lt": now - stale_after}},
            ],
        },
        {
            "$set": {
                "status": "processing",
                "claimed_at": now,
                "claim_id": str(uuid.uuid4()),
                "updated_at": now,
            },
            "$inc": {"llm_attempt": 1},
        },
        sort=[("created_at", ASCENDING)],
        return_document=ReturnDocument.AFTER,
    )


def exhausted(job: Mapping[str, Any]) -> bool:
    """Claimed more often than its attempts allow: only stale retakes get here (a failed
    attempt past the limit fails at once). The worker fails it rather than run it again."""
    return int(job["llm_attempt"]) > int(job["max_llm_attempts"])


# ── finishing ──────────────────────────────────────────────────────────────────


def _claimed(job: Mapping[str, Any]) -> Doc:
    """This claim of `job`, still processing: what every ending write matches."""
    return {
        "_id": job["_id"],
        "location": job["location"],
        "status": "processing",
        "claim_id": job.get("claim_id"),
    }


async def _end(
    db: Db,
    session: AsyncClientSession,
    job: Mapping[str, Any],
    status: Literal["completed", "failed"],
    error: str | None = None,
) -> None:
    now = _now()
    fields: Doc = {"status": status, "completed_at": now, "updated_at": now}
    if error is not None:
        fields["error"] = error[:500]
    ended = await db[JOBS].update_one(_claimed(job), {"$set": fields}, session=session)
    if ended.matched_count == 0:
        # Retaken (or cancelled) meanwhile: undo this attempt's writes with the transaction.
        raise _ClaimLost(job["_id"])


async def complete_job(
    db: Db,
    client: Client,
    job: Mapping[str, Any],
    *,
    target_update: Mapping[str, Any],
    in_transaction: InTransaction | None = None,
) -> bool:
    """Store the result on the target, release the lock and end the job. False if dropped.

    `in_transaction` runs in the same transaction, e.g. to add the outbox row for
    `discover.personality_finalised`. The result is dropped (the job ends `failed`,
    `cancelled`) if the child or user was deleted meanwhile, or if the lock was taken over;
    and dropped without touching the job if another worker retook it (its claim decides).
    """
    target = Target.of(job)
    applied: dict[str, bool] = {}

    async def run(session: AsyncClientSession) -> None:
        stones = _tombstones(job["user_id"], job["child_id"])
        if await is_tombstoned(db, stones, location=job["location"], session=session):
            await _end(db, session, job, "failed", CANCELLED)
            applied["ok"] = False
            return
        result = await db[target.collection].update_one(
            {"_id": target.doc_id, "location": job["location"], target.lock: job["_id"]},
            {"$set": {**target_update, "updated_at": _now()}, "$unset": {target.lock: ""}},
            session=session,
        )
        if result.matched_count == 0:
            await _end(db, session, job, "failed", "superseded: the target's lock moved on")
            applied["ok"] = False
            return
        if in_transaction is not None:
            await in_transaction(session)
        await _end(db, session, job, "completed")
        applied["ok"] = True

    try:
        async with client.start_session() as session:
            await session.with_transaction(run)
    except _ClaimLost:
        return False
    return applied["ok"]


async def fail_or_retry(
    db: Db,
    client: Client,
    job: Mapping[str, Any],
    error: str,
    *,
    target_failure: Mapping[str, Any] | None = None,
    permanent: bool = False,
    target_status: str | None = "failed",
) -> Literal["retry", "failed", "superseded"]:
    """After a failed attempt: retry later with backoff, or fail the job and its target.

    `permanent` (e.g. no LLM provider configured) fails at once instead of using retries.
    `target_status=None` releases the lock without touching the target's `status`.
    `superseded`: another worker retook the job meanwhile, so this one changes nothing.
    """
    if not permanent and job["llm_attempt"] < job["max_llm_attempts"]:
        now = _now()
        retried = await db[JOBS].update_one(
            _claimed(job),
            {
                "$set": {
                    "status": "pending",
                    "retry_after": now + backoff(job["llm_attempt"]),
                    "error": error[:500],
                    "updated_at": now,
                }
            },
        )
        return "retry" if retried.matched_count else "superseded"
    target = Target.of(job)

    async def run(session: AsyncClientSession) -> None:
        await db[target.collection].update_one(
            {"_id": target.doc_id, "location": job["location"], target.lock: job["_id"]},
            {
                "$set": {
                    **({} if target_status is None else {"status": target_status}),
                    **(target_failure or {}),
                    "updated_at": _now(),
                },
                "$unset": {target.lock: ""},
            },
            session=session,
        )
        await _end(db, session, job, "failed", error)

    try:
        async with client.start_session() as session:
            await session.with_transaction(run)
    except _ClaimLost:
        return "superseded"
    return "failed"


async def cancel_jobs(
    db: Db,
    *,
    user_id: str | None = None,
    child_id: str | None = None,
    location: str | None = None,
    session: AsyncClientSession | None = None,
) -> int:
    """End every open job of a deleted user or child (10.2, 10.3). Returns how many."""
    if (user_id is None) == (child_id is None):
        raise ValueError("give exactly one of user_id or child_id")
    selector: Doc = {"user_id": user_id} if user_id is not None else {"child_id": child_id}
    if location is not None:
        selector["location"] = location
    now = _now()
    result = await db[JOBS].update_many(
        {**selector, "status": {"$in": list(OPEN_STATUSES)}},
        {"$set": {"status": "failed", "error": CANCELLED, "completed_at": now, "updated_at": now}},
        session=session,
    )
    return result.modified_count


# ── the metrics' inputs (15.5) ─────────────────────────────────────────────────


async def pending_count(db: Db, *, locations: list[str] | None) -> int:
    """`PendingJobCount`: this region's jobs waiting for a worker."""
    return await db[JOBS].count_documents({**_region_filter(locations), "status": "pending"})


async def oldest_processing_age(db: Db, *, locations: list[str] | None) -> float:
    """`OldestRunningJobAgeSeconds`: how long this region's oldest running job has run; 0 if none."""
    oldest = await db[JOBS].find_one(
        {**_region_filter(locations), "status": "processing"},
        {"claimed_at": 1},
        sort=[("claimed_at", ASCENDING)],
    )
    if oldest is None:
        return 0.0
    claimed = oldest["claimed_at"]
    if claimed.tzinfo is None:
        claimed = claimed.replace(tzinfo=UTC)
    return max(0.0, (_now() - claimed).total_seconds())
