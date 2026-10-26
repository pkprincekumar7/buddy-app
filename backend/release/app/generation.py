"""The observations' generation (docs/auth-users-split.md, 8; job type `generate_observations`).

- `start`: one job per child, through common.generation.jobs.start_job, which takes the
  `active_job_id` lock, sets `status: generating` and inserts the job in one transaction.
  From any status: a new set replaces the last one (the page's refresh).
- `process`: the worker's part. It builds the evidence from release's copies, calls the
  LLM, and runs the answer through today's normaliser and selection
  (release.app.observations): at most six cards, every offered evidence block on one first,
  child-choice notes only if they match a line we gave. It stores them (`status: ready`,
  `source: llm`) and clears `watching`, as today's promote step does: a tick against an
  older set of cards means nothing against a new one. `completed_at` stays. No evidence
  fails at once; an unusable answer, a failed call or a missing copy is retried.
- `report_jobs`: the job metrics from one leader per region, in the HTTP runtime (15.5).
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Mapping
from typing import Any, Literal

from pymongo.asynchronous.client_session import AsyncClientSession

from common.generation import jobs
from common.generation.jobs import Target
from common.generation.llm import LlmClient, LlmConfigError
from common.metrics import RegionLeader
from common.models import CHILD_ACCESS, GROWTH_INPUTS, JOBS, ONBOARDING_INPUTS
from release.app import observations
from release.app.runtime import SERVICE, Runtime
from release.app.store import JOB_TYPE, OBSERVATIONS

POLL_SECONDS = 2.0
REPORT_SECONDS = 60.0

Outcome = Literal["completed", "dropped", "retry", "failed"]

_logger = logging.getLogger(__name__)


async def evidence_for(runtime: Runtime, child_id: str, location: str) -> observations.Evidence:
    """The evidence blocks from release's copies of the child's answers and areas."""
    answers = await runtime.db[ONBOARDING_INPUTS].find_one({"_id": child_id, "location": location})
    areas = (
        await runtime.db[GROWTH_INPUTS]
        .find({"location": location, "child_id": child_id})
        .sort("updated_at", 1)
        .to_list(None)
    )
    return observations.evidence(answers, areas)


async def running_job(runtime: Runtime, doc: Mapping[str, Any] | None) -> str | None:
    """The child's open job, if one is running."""
    held = (doc or {}).get("active_job_id")
    if not held:
        return None
    job = await runtime.db[JOBS].find_one(
        {"_id": held, "status": {"$in": list(jobs.OPEN_STATUSES)}}, {"_id": 1}
    )
    return held if job is not None else None


async def start(
    runtime: Runtime, *, child: Mapping[str, Any], input_version: int
) -> tuple[str, bool]:
    """Start the generation, or return the running one. Returns (job id, created)."""
    return await jobs.start_job(
        runtime.db,
        runtime.client,
        job_type=JOB_TYPE,
        user_id=child["user_id"],
        child_id=child["_id"],
        location=child["location"],
        target=Target(OBSERVATIONS, child["_id"]),
        input_version=input_version,
        target_on_insert={"version": 1},
    )


async def process(runtime: Runtime, llm: LlmClient, job: Mapping[str, Any]) -> Outcome:
    """One claimed job, to its end or its next retry."""
    db, child_id, location = runtime.db, job["child_id"], job["location"]

    async def give_up(error: str, *, permanent: bool = False) -> Literal["retry", "failed"]:
        return await jobs.fail_or_retry(db, runtime.client, job, error, permanent=permanent)

    child = await db[CHILD_ACCESS].find_one({"_id": child_id, "location": location})
    if child is None:
        return await give_up("the child's copy isn't there yet")
    found = await evidence_for(runtime, child_id, location)
    if not found.blocks:
        return await give_up("there's no evidence to read back yet", permanent=True)
    try:
        result = await llm.invoke(observations.prompt(child, found), schema=observations.schema())
    except LlmConfigError as exc:
        return await give_up(str(exc), permanent=True)
    except Exception as exc:  # a timeout, a provider error, an unusable answer: retried
        return await give_up(f"the LLM call failed ({type(exc).__name__})")
    candidates = observations.normalize(result.data, found.choice_lines)
    if not candidates:
        return await give_up("nothing in the answer could be shown")
    selection = observations.select(candidates, found.sources)
    if selection.unrepresented:
        _logger.warning(
            "release.job id=%s no observation cites: %s",
            job["_id"],
            ", ".join(selection.unrepresented),
        )

    async def bump(session: AsyncClientSession) -> None:
        await db[OBSERVATIONS].update_one(
            {"_id": child_id, "location": location}, {"$inc": {"version": 1}}, session=session
        )

    stored = await jobs.complete_job(
        db,
        runtime.client,
        job,
        target_update={
            "status": "ready",
            "source": "llm",
            "items": selection.items,
            "watching": [],
        },
        in_transaction=bump,
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
                outcome = await process(runtime, llm, job)
                _logger.info("release.job id=%s outcome=%s", job["_id"], outcome)
                continue
        except Exception:
            _logger.exception("release: a job failed unexpectedly; retrying")
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
                _logger.exception("release: couldn't report the job metrics")
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(stop.wait(), interval)
    finally:
        await leader.release()
