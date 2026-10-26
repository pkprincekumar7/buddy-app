"""common.generation.jobs against a real MongoDB replica set (design 4.1, 8).

The build plan's 1.6 check: two concurrent starts create one job; a failed insert leaves
no stuck `generating`; jobs from another region's locations aren't claimed.
"""

import asyncio
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.errors import DuplicateKeyError, OperationFailure

from common.events import store
from common.generation import jobs
from common.generation.jobs import JobRefused, Target
from common.models import ensure_jobs

pytestmark = pytest.mark.live_service

CHILD = "9b1c6f64-2f4e-4d0e-8e2a-6c1f0d3a7b55"
USER = "3f6c2a1e-8b7d-4c5e-9f10-2a3b4c5d6e7f"
TARGET = Target("personalities", CHILD)


def _start(db, client, **overrides: Any):
    fields: dict[str, Any] = {
        "job_type": "generate_personality_analysis",
        "user_id": USER,
        "child_id": CHILD,
        "location": "in",
        "target": TARGET,
        "input_version": 1,
        "target_on_insert": {"source": "llm"},
        **overrides,
    }
    return jobs.start_job(db, client, **fields)


async def _setup(db) -> None:
    await ensure_jobs(db, "discover")
    await store.ensure_tombstones(db)
    await db.create_collection("personalities")


# ── starting ───────────────────────────────────────────────────────────────────


def test_two_concurrent_starts_create_one_job(mongo_run):
    async def body(db, client):
        await _setup(db)
        results = await asyncio.gather(*(_start(db, client) for _ in range(5)))
        job_ids = {job_id for job_id, _ in results}
        assert len(job_ids) == 1
        assert sum(created for _, created in results) == 1
        assert await db.jobs.count_documents({}) == 1
        target = await db.personalities.find_one({"_id": CHILD})
        assert target["status"] == "generating" and target["active_job_id"] in job_ids
        assert (target["source"], target["user_id"], target["schema_version"]) == ("llm", USER, 1)

    mongo_run(body)


def test_a_failed_job_insert_leaves_no_stuck_generating(mongo_run):
    async def body(db, client):
        await _setup(db)
        # discover's validator refuses grow's job type, so the job insert fails.
        with pytest.raises(OperationFailure, match="validation"):
            await _start(db, client, job_type="generate_recommendations")
        assert await db.personalities.count_documents({}) == 0  # rolled back with it
        assert await db.jobs.count_documents({}) == 0

    mongo_run(body)


def test_a_finished_jobs_lock_is_taken_over(mongo_run):
    async def body(db, client):
        await _setup(db)
        first, _ = await _start(db, client)
        await db.jobs.update_one({"_id": first}, {"$set": {"status": "failed"}})
        second, created = await _start(db, client)
        assert created and second != first
        assert (await db.personalities.find_one({}))["active_job_id"] == second

    mongo_run(body)


def test_a_lock_naming_a_missing_job_is_taken_over(mongo_run):
    async def body(db, client):
        await _setup(db)
        await db.personalities.insert_one({"_id": CHILD, "location": "in", "active_job_id": "gone"})
        job_id, created = await _start(db, client)
        assert created and job_id != "gone"

    mongo_run(body)


def test_per_type_locks_on_one_document(mongo_run):
    async def body(db, client):
        await ensure_jobs(db, "grow")
        area = Target("growth_areas", f"{CHILD}:focus", lock="active_jobs.generate_recommendations")
        questions = Target(
            "growth_areas", f"{CHILD}:focus", lock="active_jobs.generate_growth_parent_questions"
        )
        a, _ = await _start(
            db, client, job_type="generate_recommendations", target=area, target_set={"step": "x"}
        )
        b, _ = await _start(
            db,
            client,
            job_type="generate_growth_parent_questions",
            target=questions,
            target_set={"step": "x"},
        )
        doc = await db.growth_areas.find_one({})
        assert doc["active_jobs"] == {
            "generate_recommendations": a,
            "generate_growth_parent_questions": b,
        }

    mongo_run(body)


def test_a_deleted_child_gets_no_new_job(mongo_run):
    async def body(db, client):
        await _setup(db)
        await store.write_tombstone(
            db, store.tombstone_key("child", CHILD), location="in", version=3
        )
        with pytest.raises(JobRefused):
            await _start(db, client)
        assert await db.jobs.count_documents({}) == 0

    mongo_run(body)


def test_target_fields_mustnt_overlap(mongo_run):
    async def body(db, client):
        with pytest.raises(ValueError, match="both set"):
            await _start(db, client, target_set={"source": "x"})

    mongo_run(body)


def test_a_duplicate_key_from_a_racing_insert_is_retried(mongo_run, monkeypatch):
    async def body(db, client):
        await _setup(db)
        real = AsyncClientSession.with_transaction
        calls = {"n": 0}

        async def flaky(self, callback, *args, **kwargs):
            calls["n"] += 1
            if calls["n"] == 1:
                raise DuplicateKeyError("E11000 duplicate key")
            return await real(self, callback, *args, **kwargs)

        monkeypatch.setattr(AsyncClientSession, "with_transaction", flaky)
        job_id, created = await _start(db, client)
        assert created and calls["n"] == 2

        async def always(self, callback, *args, **kwargs):
            raise DuplicateKeyError("E11000 duplicate key")

        monkeypatch.setattr(AsyncClientSession, "with_transaction", always)
        with pytest.raises(DuplicateKeyError):
            await _start(db, client)

    mongo_run(body)


# ── claiming ───────────────────────────────────────────────────────────────────


async def _job(db, job_id: str, location: str = "in", **fields: Any) -> None:
    now = datetime.now(UTC)
    await db.jobs.insert_one(
        {
            "_id": job_id,
            "user_id": USER,
            "child_id": CHILD,
            "location": location,
            "type": "generate_personality_analysis",
            "target": TARGET.as_doc(),
            "status": "pending",
            "input_version": 1,
            "llm_attempt": 0,
            "max_llm_attempts": 3,
            "created_at": now,
            "updated_at": now,
            "schema_version": 1,
            **fields,
        }
    )


def test_jobs_from_another_regions_locations_arent_claimed(mongo_run):
    async def body(db, client):
        await ensure_jobs(db, "discover")
        await _job(db, "eu-job", location="eu", created_at=datetime(2020, 1, 1, tzinfo=UTC))
        await _job(db, "in-job", location="in")
        claimed = await jobs.claim_next(db, locations=["in", "apac", "me"])
        assert claimed is not None and claimed["_id"] == "in-job"
        assert (claimed["status"], claimed["llm_attempt"]) == ("processing", 1)
        assert await jobs.claim_next(db, locations=["in", "apac", "me"]) is None
        unscoped = await jobs.claim_next(db, locations=None)
        assert unscoped is not None and unscoped["_id"] == "eu-job"

    mongo_run(body)


def test_claims_wait_for_retry_after_and_take_over_stale_work(mongo_run):
    async def body(db, client):
        await ensure_jobs(db, "discover")
        now = datetime.now(UTC)
        await _job(db, "later", retry_after=now + timedelta(minutes=5))
        await _job(
            db, "stale", status="processing", claimed_at=now - timedelta(hours=1), llm_attempt=1
        )
        await _job(db, "busy", status="processing", claimed_at=now)
        claimed = await jobs.claim_next(db, locations=["in"])
        assert claimed is not None and claimed["_id"] == "stale" and claimed["llm_attempt"] == 2
        assert await jobs.claim_next(db, locations=["in"]) is None

    mongo_run(body)


async def _claim(db) -> dict[str, Any]:
    job = await jobs.claim_next(db, locations=["in"])
    assert job is not None
    return job


# ── finishing ──────────────────────────────────────────────────────────────────


def test_completing_stores_the_result_and_releases_the_lock(mongo_run):
    async def body(db, client):
        await _setup(db)
        await store.ensure_outbox(db)
        job_id, _ = await _start(db, client)
        job = await _claim(db)
        seen: list[bool] = []

        async def also(session: AsyncClientSession) -> None:
            seen.append(session.in_transaction)

        assert await jobs.complete_job(
            db,
            client,
            job,
            target_update={"status": "ready", "view_model": {"a": 1}},
            in_transaction=also,
        )
        target = await db.personalities.find_one({})
        assert target["status"] == "ready" and "active_job_id" not in target
        done = await db.jobs.find_one({"_id": job_id})
        assert done["status"] == "completed" and done["completed_at"]
        assert seen == [True]

    mongo_run(body)


def test_a_result_for_a_deleted_child_is_dropped(mongo_run):
    async def body(db, client):
        await _setup(db)
        await _start(db, client)
        job = await _claim(db)
        await store.write_tombstone(db, store.tombstone_key("user", USER), location="in", version=2)
        assert not await jobs.complete_job(db, client, job, target_update={"status": "ready"})
        assert (await db.personalities.find_one({}))["status"] == "generating"  # not written
        ended = await db.jobs.find_one({})
        assert (ended["status"], ended["error"]) == ("failed", "cancelled") and ended[
            "completed_at"
        ]

    mongo_run(body)


def test_completing_without_extra_work(mongo_run):
    async def body(db, client):
        await _setup(db)
        await _start(db, client)
        assert await jobs.complete_job(
            db, client, await _claim(db), target_update={"status": "ready"}
        )

    mongo_run(body)


def test_a_result_whose_lock_moved_on_is_dropped(mongo_run):
    async def body(db, client):
        await _setup(db)
        await _start(db, client)
        job = await _claim(db)
        await db.personalities.update_one({}, {"$set": {"active_job_id": "newer"}})
        assert not await jobs.complete_job(db, client, job, target_update={"status": "ready"})
        assert (await db.jobs.find_one({}))["error"].startswith("superseded")

    mongo_run(body)


def test_a_failure_retries_with_backoff_then_fails(mongo_run):
    async def body(db, client):
        await _setup(db)
        job_id, _ = await _start(db, client, max_llm_attempts=2)
        job = await _claim(db)
        assert await jobs.fail_or_retry(db, client, job, "timeout") == "retry"
        retry = await db.jobs.find_one({"_id": job_id})
        assert retry["status"] == "pending" and retry["error"] == "timeout"
        assert retry["retry_after"] > datetime.now(UTC) + timedelta(seconds=25)

        await db.jobs.update_one({"_id": job_id}, {"$set": {"retry_after": datetime.now(UTC)}})
        job = await _claim(db)
        assert job["llm_attempt"] == 2
        assert (
            await jobs.fail_or_retry(db, client, job, "x" * 600, target_failure={"reason": "llm"})
            == "failed"
        )
        failed = await db.jobs.find_one({"_id": job_id})
        assert (
            failed["status"] == "failed" and failed["completed_at"] and len(failed["error"]) == 500
        )
        target = await db.personalities.find_one({})
        assert (target["status"], target["reason"]) == (
            "failed",
            "llm",
        ) and "active_job_id" not in target

    mongo_run(body)


def test_a_permanent_failure_skips_the_retries(mongo_run):
    async def body(db, client):
        await _setup(db)
        await _start(db, client)
        job = await _claim(db)
        assert await jobs.fail_or_retry(db, client, job, "no provider", permanent=True) == "failed"

    mongo_run(body)


def test_cancel_jobs_for_a_deleted_user_or_child(mongo_run):
    async def body(db, client):
        await ensure_jobs(db, "discover")
        await _job(db, "a")
        await _job(db, "b", status="processing", claimed_at=datetime.now(UTC))
        await _job(db, "c", status="completed", completed_at=datetime.now(UTC))
        assert await jobs.cancel_jobs(db, user_id=USER) == 2
        assert await jobs.cancel_jobs(db, child_id=CHILD) == 0
        assert {d["error"] for d in await db.jobs.find({"_id": {"$in": ["a", "b"]}}).to_list()} == {
            "cancelled"
        }
        with pytest.raises(ValueError, match="exactly one"):
            await jobs.cancel_jobs(db)

    mongo_run(body)


def test_the_metric_inputs(mongo_run):
    async def body(db, client):
        await ensure_jobs(db, "discover")
        assert await jobs.oldest_processing_age(db, locations=["in"]) == 0.0
        await _job(db, "p1")
        await _job(db, "p2", location="eu")
        await _job(
            db, "run", status="processing", claimed_at=datetime.now(UTC) - timedelta(minutes=3)
        )
        assert await jobs.pending_count(db, locations=["in"]) == 1
        assert await jobs.pending_count(db, locations=None) == 2
        assert 170 < await jobs.oldest_processing_age(db, locations=["in"]) < 300

    mongo_run(body)


def test_backoff_doubles_and_is_capped():
    assert [jobs.backoff(n).total_seconds() for n in (0, 1, 2, 3, 10)] == [30, 30, 60, 120, 900]


def test_naive_claim_times_are_utc():
    class Coll:
        async def find_one(self, *args: Any, **kwargs: Any) -> dict[str, Any]:
            return {"claimed_at": (datetime.now(UTC) - timedelta(seconds=40)).replace(tzinfo=None)}

    age = asyncio.run(jobs.oldest_processing_age({"jobs": Coll()}, locations=None))  # type: ignore[arg-type]
    assert 39 < age < 80


def test_a_target_can_keep_its_own_status(mongo_run):
    """A growth area's status is the parent's wizard: a job neither sets nor fails it."""

    async def body(db, client):
        await ensure_jobs(db, "grow")
        await store.ensure_tombstones(db)
        area = Target("growth_areas", f"{CHILD}:focus", lock="active_jobs.generate_recommendations")
        await _start(
            db,
            client,
            job_type="generate_recommendations",
            target=area,
            target_on_insert={"status": "in_progress"},
            target_status=None,
        )
        assert (await db.growth_areas.find_one({}))["status"] == "in_progress"
        await db.growth_areas.update_one({}, {"$set": {"status": "completed"}})
        job = await _claim(db)
        assert (
            await jobs.fail_or_retry(db, client, job, "x", permanent=True, target_status=None)
            == "failed"
        )
        doc = await db.growth_areas.find_one({})
        assert doc["status"] == "completed" and doc["active_jobs"] == {}

    mongo_run(body)
