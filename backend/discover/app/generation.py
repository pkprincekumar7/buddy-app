"""The personality's generation (docs/auth-users-split.md, 8; job type `generate_personality_analysis`).

- `start`: one job per child, through common.generation.jobs.start_job, which takes the
  `active_job_id` lock and inserts the job in one transaction. Only from `not_started` or
  `failed`: a `ready` personality is never regenerated (12.1). Used by
  `POST …/personality/generation` and by the worker on `onboarding.conversation_completed`.
- `process`: the worker's part. It builds the prompt from discover's own copies
  (`child_access`, `onboarding_inputs`), calls the LLM, checks the answer against the
  schema, builds the view model, and stores it (`status: ready`) in one transaction with
  `discover.personality_finalised`. A copy not there yet, a failed call or an answer that
  doesn't fit is retried with backoff, then `failed`; no LLM configured fails at once.
- `report_jobs`: `PendingJobCount` and `OldestRunningJobAgeSeconds` every minute, from one
  leader per region in the HTTP runtime (15.5).
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any, Literal

from pymongo.asynchronous.client_session import AsyncClientSession

from common.events import Event, add_to_outbox
from common.generation import jobs
from common.generation.fit import clip_to_schema
from common.generation.jobs import Target
from common.generation.llm import LlmClient, LlmConfigError
from common.metrics import RegionLeader
from common.models import CHILD_ACCESS, JOBS, ONBOARDING_INPUTS
from common.telemetry import current_traceparent
from discover.app.personality import LLM_SCHEMA, build_prompt, schema_errors, summary, view_model
from discover.app.runtime import SERVICE, Runtime
from discover.app.store import JOB_TYPE, PERSONALITIES

STARTABLE = ("not_started", "failed")
POLL_SECONDS = 2.0
REPORT_SECONDS = 60.0

_logger = logging.getLogger(__name__)


class AlreadyGenerated(Exception):
    """The personality is ready: there's no regeneration (12.1)."""


def target(child_id: str) -> Target:
    return Target(PERSONALITIES, child_id)


async def running_job(runtime: Runtime, personality: Mapping[str, Any] | None) -> str | None:
    """The personality's open job, if one is running."""
    held = (personality or {}).get("active_job_id")
    if not held:
        return None
    job = await runtime.db[JOBS].find_one(
        {"_id": held, "status": {"$in": list(jobs.OPEN_STATUSES)}}, {"_id": 1}
    )
    return held if job is not None else None


async def start(
    runtime: Runtime, *, child_id: str, user_id: str, location: str, input_version: int
) -> tuple[str, bool]:
    """Start the generation, or return the running one. Returns (job id, created).

    AlreadyGenerated if it's ready; common.generation.jobs.JobRefused if the child or user
    is deleted.
    """
    current = await runtime.db[PERSONALITIES].find_one({"_id": child_id, "location": location})
    if current is not None and current["status"] not in STARTABLE:
        held = await running_job(runtime, current)
        if held is not None:
            return held, False
        if current["status"] == "ready":
            raise AlreadyGenerated(child_id)
    try:
        return await _start_job(runtime, child_id, user_id, location, input_version)
    except jobs.TargetRefused:
        raise AlreadyGenerated(child_id) from None


async def _start_job(
    runtime: Runtime, child_id: str, user_id: str, location: str, input_version: int
) -> tuple[str, bool]:
    return await jobs.start_job(
        runtime.db,
        runtime.client,
        job_type=JOB_TYPE,
        user_id=user_id,
        child_id=child_id,
        location=location,
        target=target(child_id),
        input_version=input_version,
        target_on_insert={"version": 1, "source": "llm"},
        # Checked again in the start's transaction: a job finishing meanwhile can't be
        # followed by a second generation (review).
        refuse_if={"status": "ready"},
    )


async def fail_job(
    runtime: Runtime, job: Mapping[str, Any], error: str
) -> Literal["retry", "failed", "superseded"]:
    """End a job this worker can't finish (it crashed on it, or retakes ran out)."""
    return await jobs.fail_or_retry(runtime.db, runtime.client, job, error, permanent=True)


async def process(
    runtime: Runtime, llm: LlmClient, job: Mapping[str, Any]
) -> Literal["completed", "dropped", "retry", "failed", "superseded"]:
    """One claimed job, to its end or its next retry."""
    db, child_id, location = runtime.db, job["child_id"], job["location"]

    async def give_up(
        error: str, *, permanent: bool = False
    ) -> Literal["retry", "failed", "superseded"]:
        return await jobs.fail_or_retry(db, runtime.client, job, error, permanent=permanent)

    if jobs.exhausted(job):  # retaken after crashes more often than its attempts allow
        await fail_job(runtime, job, jobs.EXHAUSTED)
        return "failed"

    child = await db[CHILD_ACCESS].find_one({"_id": child_id, "location": location})
    answers = await db[ONBOARDING_INPUTS].find_one({"_id": child_id, "location": location})
    if child is None or answers is None:
        return await give_up("the child's copies haven't arrived yet")
    try:
        result = await llm.invoke(build_prompt(child, answers), schema=LLM_SCHEMA)
    except LlmConfigError as exc:
        return await give_up(str(exc), permanent=True)
    except Exception as exc:  # a timeout, a provider error, an unusable answer: retried
        return await give_up(f"the LLM call failed ({type(exc).__name__})")
    # Over-long text is clipped, not a reason to fail (common.generation.fit).
    answer = clip_to_schema(result.data, LLM_SCHEMA)
    problems = schema_errors(answer)
    if problems:
        return await give_up(f"the answer didn't fit the schema at {', '.join(problems[:5])}")
    model = view_model(answer, child.get("name"))
    personality = await db[PERSONALITIES].find_one(
        {"_id": child_id, "location": location}, {"version": 1}
    )
    version = int((personality or {}).get("version", 0)) + 1
    finalised = Event.new(
        "discover.personality_finalised",
        producer=SERVICE,
        aggregate_id=child_id,
        location=location,
        version=version,
        region=runtime.settings.aws_region,
        # The owner too, so a circle can keep its copy before its child_access arrives.
        payload={"user_id": job["user_id"], **summary(model)},
        traceparent=current_traceparent(),
    )

    async def publish(session: AsyncClientSession) -> None:
        await add_to_outbox(db, finalised, session)

    stored = await jobs.complete_job(
        db,
        runtime.client,
        job,
        target_update={
            "status": "ready",
            "view_model": model,
            "analysis": answer,
            "source": "llm",
            "finalised_at": datetime.now(UTC),
            "version": version,
        },
        in_transaction=publish,
    )
    return "completed" if stored else "dropped"


async def run_jobs(
    runtime: Runtime, llm: LlmClient, stop: asyncio.Event, *, poll: float = POLL_SECONDS
) -> None:
    """Claim and process this region's jobs until `stop` is set."""
    locations = runtime.locations()
    while not stop.is_set():
        try:
            job = await jobs.claim_next(runtime.db, locations=locations)
            if job is not None:
                try:
                    outcome = await process(runtime, llm, job)
                except Exception as exc:
                    # Ended now rather than left `processing` until a retake (review).
                    _logger.exception("%s: job %s crashed", SERVICE, job["_id"])
                    outcome = await fail_job(runtime, job, f"crashed ({type(exc).__name__})")
                _logger.info("discover.job id=%s outcome=%s", job["_id"], outcome)
                continue
        except Exception:
            _logger.exception("discover: a job failed unexpectedly; retrying")
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(stop.wait(), poll)


async def report_jobs(
    runtime: Runtime, metrics: Any, stop: asyncio.Event, *, interval: float = REPORT_SECONDS
) -> None:
    """The job metrics, from this region's leader only (common.metrics.RegionLeader)."""
    leader = RegionLeader(runtime.cache, f"leader:{SERVICE}:jobs:{runtime.settings.aws_region}")
    locations = runtime.locations()
    try:
        while not stop.is_set():
            try:
                if await leader.try_lead():
                    metrics.put(
                        "PendingJobCount", await jobs.pending_count(runtime.db, locations=locations)
                    )
                    metrics.put(
                        "OldestRunningJobAgeSeconds",
                        await jobs.oldest_processing_age(runtime.db, locations=locations),
                    )
                    await metrics.flush()
            except Exception:
                _logger.exception("discover: couldn't report the job metrics")
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(stop.wait(), interval)
    finally:
        await leader.release()
