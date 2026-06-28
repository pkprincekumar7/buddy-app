"""
Worker service — standalone async process, no HTTP endpoints.

Entry point for the worker ECS task (command: python worker.py).
Polls the jobs collection, claims jobs atomically, calls the LLM via
llm_service, writes results to domain collections, and emits
PendingJobCount / ProcessingJobCount metrics to CloudWatch.

Environment variables:
  WORKER_CONCURRENCY            number of parallel job slots (default 5)
  WORKER_POLL_INTERVAL_SECONDS  idle poll interval in seconds (default 2)
  AWS_DEFAULT_REGION            used for CloudWatch client (default ap-south-1)
"""

import asyncio
import json
import logging
import os
from datetime import UTC, datetime, timedelta

import boto3
import motor.motor_asyncio

from app.models import CHILDREN, JOBS
from app.services import llm_service
from app.services.llm_service import LLMConfigError
from app.settings import settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("worker")


def _parse_int_env(name: str, default: int) -> int:
    """Parse an integer env var; log a warning and use default on invalid input."""
    raw = os.environ.get(name, str(default))
    try:
        return int(raw)
    except ValueError:
        log.warning("Invalid value for %s=%r; using default %d", name, raw, default)
        return default


# Clamp to at least 1 — asyncio.gather(*[]) would silently return immediately
# if WORKER_CONCURRENCY were set to 0.
WORKER_CONCURRENCY = max(1, _parse_int_env("WORKER_CONCURRENCY", 5))
POLL_INTERVAL_SECONDS = _parse_int_env("WORKER_POLL_INTERVAL_SECONDS", 2)
JOB_DEADLINE_MINUTES = 30
METRICS_INTERVAL_SECONDS = 60
CLEANUP_INTERVAL_SECONDS = 300

# LLM responses are structured JSON, so legitimate payloads are small (< 20 KB).
# 512 KB gives generous headroom while protecting against a misbehaving provider
# returning a multi-MB body that could bloat domain documents toward MongoDB's 16 MB limit.
_MAX_LLM_RESULT_BYTES = 512 * 1024

# Backoff delays per LLM attempt number (0-based index into list).
# Stored as retry_after timestamp on the job document so the sleeping
# does NOT block the worker slot — the slot returns immediately and
# picks up another job while the backoff elapses.
# Attempt 0 fails → retry_after = now (immediate),
# attempt 1 fails → retry_after = now + 30s,
# attempt 2+ fails → retry_after = now + 60s.
LLM_BACKOFF_SECONDS = [0, 30, 60]

# Motor is async-safe — one client shared across all coroutines
_mongo_client = motor.motor_asyncio.AsyncIOMotorClient(settings.mongodb_uri)
db = _mongo_client[settings.mongodb_db_name]

_aws_region = os.environ.get("AWS_DEFAULT_REGION", "ap-south-1")
cloudwatch = boto3.client("cloudwatch", region_name=_aws_region)


# ---------------------------------------------------------------------------
# Job claim
# ---------------------------------------------------------------------------


async def claim_next_job() -> dict | None:
    now = datetime.now(UTC)
    stale_threshold = now - timedelta(minutes=5)

    # NOTE: The claim filter intentionally omits the `location` shard key.
    # On the current single-region Atlas M10+ cluster this is fine — there is
    # only one shard so no scatter-gather occurs.  If the app is ever migrated
    # to an Atlas Global Cluster with location-based sharding, add:
    #   "location": os.environ["WORKER_LOCATION"]
    # to this filter and set that env var per regional worker task so each
    # worker only claims jobs for its own region.
    return await db[JOBS].find_one_and_update(
        {
            "$or": [
                # Unclaimed pending jobs within LLM retry budget whose backoff
                # has elapsed. retry_after <= now covers both the no-backoff case
                # (retry_after == created_at) and timed retries.
                {
                    "status": "pending",
                    "$expr": {"$lt": ["$llm_attempt", "$max_llm_attempts"]},
                    "retry_after": {"$lte": now},
                },
                # result_ready jobs waiting for a domain write retry
                {
                    "status": "result_ready",
                    "$expr": {"$lt": ["$domain_write_attempt", "$max_domain_attempts"]},
                },
                # Stale processing jobs (worker pod crashed mid-call).
                # Budget guard: if llm_attempt has already reached the max, the job
                # would be immediately failed on re-claim anyway — exclude it here so
                # cleanup_expired_jobs handles terminal clean-up instead of wasting a
                # claim on a no-op.
                {
                    "status": "processing",
                    "claimed_at": {"$lt": stale_threshold},
                    "$expr": {"$lt": ["$llm_attempt", "$max_llm_attempts"]},
                },
            ]
        },
        {"$set": {"status": "processing", "claimed_at": now, "updated_at": now}},
        sort=[("created_at", 1)],  # FIFO
        return_document=True,
        # Note: the returned document reflects the $set above (status="processing"),
        # NOT the pre-update state. handle_job therefore must NOT check job["status"]
        # to determine whether to skip the LLM call — it uses job["result"] instead,
        # which is the reliable signal that the LLM already ran successfully.
    )


# ---------------------------------------------------------------------------
# Failure handlers
# ---------------------------------------------------------------------------


async def handle_llm_failure(job: dict, error: str) -> None:
    new_attempt = job["llm_attempt"] + 1
    now = datetime.now(UTC)

    if new_attempt >= job["max_llm_attempts"]:
        log.warning(
            "job.failed job_id=%s reason=llm_exhausted attempts=%d error=%s",
            job["job_id"],
            new_attempt,
            error,
        )
        await db[CHILDREN].update_one(
            {"_id": job["child_id"]},
            {"$unset": {f"active_jobs.{job['type']}": ""}},
        )
        await db[JOBS].update_one(
            {"job_id": job["job_id"]},
            {
                "$set": {
                    "status": "failed",
                    "error": error,
                    "llm_attempt": new_attempt,
                    "completed_at": now,
                    "updated_at": now,
                }
            },
        )
    else:
        backoff = LLM_BACKOFF_SECONDS[min(new_attempt, len(LLM_BACKOFF_SECONDS) - 1)]
        retry_after = now + timedelta(seconds=backoff)
        log.info(
            "job.retry job_id=%s attempt=%d backoff=%ds",
            job["job_id"],
            new_attempt,
            backoff,
        )
        # Store retry_after on the job document and return immediately — the slot
        # is free to claim the next job. claim_next_job filters retry_after <= now,
        # so this job won't be picked up again until the backoff elapses.
        await db[JOBS].update_one(
            {"job_id": job["job_id"]},
            {
                "$set": {
                    "status": "pending",
                    "llm_attempt": new_attempt,
                    "retry_after": retry_after,
                    "updated_at": now,
                }
            },
        )


async def handle_domain_write_failure(job: dict, error: str) -> None:
    new_attempt = job["domain_write_attempt"] + 1
    now = datetime.now(UTC)

    if new_attempt >= job["max_domain_attempts"]:
        log.warning(
            "job.failed job_id=%s reason=domain_write_exhausted attempts=%d error=%s",
            job["job_id"],
            new_attempt,
            error,
        )
        await db[CHILDREN].update_one(
            {"_id": job["child_id"]},
            {"$unset": {f"active_jobs.{job['type']}": ""}},
        )
        await db[JOBS].update_one(
            {"job_id": job["job_id"]},
            {
                "$set": {
                    "status": "failed",
                    "error": error,
                    "completed_at": now,
                    "updated_at": now,
                }
            },
        )
    else:
        log.info(
            "job.domain_retry job_id=%s attempt=%d",
            job["job_id"],
            new_attempt,
        )
        # Leave as result_ready — will be picked up on next polling cycle
        await db[JOBS].update_one(
            {"job_id": job["job_id"]},
            {
                "$set": {
                    "status": "result_ready",
                    "domain_write_attempt": new_attempt,
                    "updated_at": now,
                }
            },
        )


# ---------------------------------------------------------------------------
# Domain write
# ---------------------------------------------------------------------------


async def write_to_domain(job: dict) -> None:
    wb = job["write_back"]
    now = datetime.now(UTC)
    try:
        await db[wb["collection"]].update_one(
            wb["filter"],
            {"$set": {wb["field"]: job["result"]}},
        )
    except Exception as e:
        await handle_domain_write_failure(job, str(e))
        return

    # Mark job completed FIRST — if the process dies here, the frontend
    # polls the job, gets status=completed, and calls onCompleted() correctly.
    # The stale active_jobs entry then self-heals on the next child re-fetch
    # (completed job_id → frontend stops polling that type naturally).
    await db[JOBS].update_one(
        {"job_id": job["job_id"]},
        {
            "$set": {
                "status": "completed",
                "completed_at": now,
                "updated_at": now,
            }
        },
    )

    # Clear active_jobs after the job is marked completed. If this write fails,
    # the entry is stale but harmless — it points to a completed job, so polling
    # resolves immediately on the next attempt.
    await db[CHILDREN].update_one(
        {"_id": job["child_id"]},
        {"$unset": {f"active_jobs.{job['type']}": ""}},
    )
    log.info("job.completed job_id=%s type=%s", job["job_id"], job["type"])


# ---------------------------------------------------------------------------
# Job processing
# ---------------------------------------------------------------------------


async def handle_job(job: dict) -> None:
    # claim_next_job always sets status="processing" in the returned document,
    # even for jobs that were already result_ready. Checking job["status"] would
    # therefore always read "processing" — check result instead, which is the
    # reliable signal that the LLM call already succeeded.
    if job.get("result") is not None:
        # LLM already ran — skip directly to domain write retry.
        await write_to_domain(job)
        return

    log.info(
        "job.processing job_id=%s type=%s attempt=%d",
        job["job_id"],
        job["type"],
        job["llm_attempt"],
    )

    try:
        result = await llm_service.invoke(
            prompt=job["payload"]["prompt"],
            schema=job["payload"].get("response_json_schema"),
            provider=job["payload"].get("provider"),
        )
    except LLMConfigError as e:
        # Permanent config failure — no provider key set or import failed.
        # Retrying will not help; fail the job immediately without consuming
        # retry budget so the caller gets a clear error fast.
        log.error(
            "job.config_error job_id=%s — failing immediately, no retry: %s",
            job["job_id"],
            e,
        )
        now = datetime.now(UTC)
        await db[CHILDREN].update_one(
            {"_id": job["child_id"]},
            {"$unset": {f"active_jobs.{job['type']}": ""}},
        )
        await db[JOBS].update_one(
            {"job_id": job["job_id"]},
            {
                "$set": {
                    "status": "failed",
                    "error": str(e),
                    "llm_attempt": job["llm_attempt"],
                    "completed_at": now,
                    "updated_at": now,
                }
            },
        )
        return
    except Exception as e:
        await handle_llm_failure(job, str(e))
        return

    serialized_result = json.dumps(result)
    if len(serialized_result) > _MAX_LLM_RESULT_BYTES:
        await handle_llm_failure(
            job,
            f"LLM response exceeds size limit: {len(serialized_result):,} bytes"
            f" > {_MAX_LLM_RESULT_BYTES:,}",
        )
        return

    # llm_attempt is intentionally NOT incremented on success — it is only
    # incremented inside handle_llm_failure. On a stale-recovery re-claim
    # (pod crashed after LLM succeeded but before the domain write completed),
    # result is already set so handle_job skips the LLM call entirely and goes
    # straight to write_to_domain. Incrementing here would inflate the counter
    # and could prematurely exhaust the retry budget on a future transient error.

    # Save LLM result to job document first — durable buffer.
    # If MongoDB fails during the domain write, the result is not lost;
    # the worker retries only the domain write using the stored result.
    await db[JOBS].update_one(
        {"job_id": job["job_id"]},
        {
            "$set": {
                "status": "result_ready",
                "result": result,
                "updated_at": datetime.now(UTC),
            }
        },
    )

    await write_to_domain({**job, "result": result})


# ---------------------------------------------------------------------------
# Background coroutines
# ---------------------------------------------------------------------------


async def emit_metrics() -> None:
    """Emit PendingJobCount and ProcessingJobCount to CloudWatch every 60s.

    PendingJobCount drives the step scaling policy.
    ProcessingJobCount > 0 for an extended period indicates stuck workers
    and triggers the ProcessingJobCountHigh alarm defined in cloudwatch.tf.
    """
    while True:
        await asyncio.sleep(METRICS_INTERVAL_SECONDS)
        try:
            pending_count, processing_count = await asyncio.gather(
                db[JOBS].count_documents({"status": "pending"}),
                db[JOBS].count_documents({"status": "processing"}),
            )
            await asyncio.to_thread(
                cloudwatch.put_metric_data,
                Namespace="Buddy360/Worker",
                MetricData=[
                    {"MetricName": "PendingJobCount", "Value": pending_count, "Unit": "Count"},
                    {
                        "MetricName": "ProcessingJobCount",
                        "Value": processing_count,
                        "Unit": "Count",
                    },
                ],
            )
            log.debug(
                "metrics.emitted PendingJobCount=%d ProcessingJobCount=%d",
                pending_count,
                processing_count,
            )
        except Exception as exc:
            # NoCredentialsError is expected in local dev where AWS creds are absent.
            # Log at DEBUG to avoid filling local logs; keep ERROR for other failures.
            if "NoCredentialsError" in type(exc).__name__ or "NoCredentialsError" in str(exc):
                log.debug("metrics.emit_skipped reason=no_aws_credentials")
            else:
                log.exception("metrics.emit_error")


async def cleanup_expired_jobs() -> None:
    """Forcibly fail jobs older than JOB_DEADLINE_MINUTES that are still non-terminal.
    Uses find_one_and_update so the status transition is atomic — no race with
    claim_next_job picking up the same stale job and overwriting the cleanup's
    failed status with completed."""
    while True:
        await asyncio.sleep(CLEANUP_INTERVAL_SECONDS)
        deadline = datetime.now(UTC) - timedelta(minutes=JOB_DEADLINE_MINUTES)
        try:
            while True:
                now = datetime.now(UTC)
                job = await db[JOBS].find_one_and_update(
                    {
                        "status": {"$in": ["pending", "processing", "result_ready"]},
                        "created_at": {"$lt": deadline},
                    },
                    {
                        "$set": {
                            "status": "failed",
                            "error": "job deadline exceeded (30 minutes)",
                            "completed_at": now,
                            "updated_at": now,
                        }
                    },
                    return_document=True,
                )
                if job is None:
                    break
                log.warning(
                    "job.deadline_exceeded job_id=%s type=%s llm_attempts=%d domain_write_attempts=%d",
                    job["job_id"],
                    job.get("type"),
                    job.get("llm_attempt", 0),
                    job.get("domain_write_attempt", 0),
                )
                await db[CHILDREN].update_one(
                    {"_id": job["child_id"]},
                    {"$unset": {f"active_jobs.{job['type']}": ""}},
                )
        except Exception:
            log.exception("cleanup.error")


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------


async def process_one_forever() -> None:
    """One independent worker slot — picks up the next job immediately after
    finishing the current one. No batch barrier between slots."""
    while True:
        try:
            job = await claim_next_job()
        except Exception:
            log.exception("claim.error")
            await asyncio.sleep(POLL_INTERVAL_SECONDS)
            continue

        if not job:
            await asyncio.sleep(POLL_INTERVAL_SECONDS)
            continue

        try:
            await handle_job(job)
        except Exception:
            log.exception("handle_job.unhandled job_id=%s", job.get("job_id"))


async def main() -> None:
    log.info(
        "worker.start concurrency=%d poll_interval=%ds region=%s",
        WORKER_CONCURRENCY,
        POLL_INTERVAL_SECONDS,
        _aws_region,
    )

    # Fail fast if MongoDB is unreachable — Motor defers connection errors to
    # the first I/O call, so without a ping every job would fail with a
    # connection error rather than the process exiting cleanly at startup.
    try:
        await db.command("ping")
        log.info("worker.mongodb_connected db=%s", settings.mongodb_db_name)
    except Exception:
        log.exception("worker.mongodb_ping_failed — exiting")
        raise

    def _bg_task_done(task: asyncio.Task) -> None:
        """Log unexpected background task termination — both tasks loop forever,
        so any completion (including via exception) is a bug."""
        try:
            exc = task.exception()
        except asyncio.CancelledError:
            return  # normal shutdown
        if exc is not None:
            log.critical("worker.background_task_crashed name=%s error=%s", task.get_name(), exc)
        else:
            log.critical("worker.background_task_exited_unexpectedly name=%s", task.get_name())

    metrics_task = asyncio.create_task(emit_metrics(), name="emit_metrics")
    cleanup_task = asyncio.create_task(cleanup_expired_jobs(), name="cleanup_expired_jobs")
    metrics_task.add_done_callback(_bg_task_done)
    cleanup_task.add_done_callback(_bg_task_done)

    # WORKER_CONCURRENCY independent slots run forever in parallel.
    # Each slot picks up the next job as soon as it finishes one.
    await asyncio.gather(*[process_one_forever() for _ in range(WORKER_CONCURRENCY)])


if __name__ == "__main__":
    asyncio.run(main())
