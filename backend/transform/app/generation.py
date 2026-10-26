"""Transform's three generations (docs/auth-users-split.md, 8; API: POST …/transform/generation).

| kind | job type | writes | lock |
|---|---|---|---|
| `life_pathway` | `generate_life_pathway` | `life_pathway.<area_id>` | one per area |
| `plan` | `generate_ninety_day_plan` | `plan` | one |
| `event_tracker` | `generate_event_tracker` | `track_steps` | one |

- `start`: through common.generation.jobs.start_job on the child's plan document (created
  if it's not there yet). Jobs never set or fail a `status` (`target_status=None`): the
  plan has none.
- `process`: the kind's prompt from the plan and transform's copies (`child_access`,
  `personality_inputs`, `growth_inputs`), the LLM, then the answer checked (the Life
  Pathway by today's normaliser, the plan and tracker against their schemas) and stored.
  A finished `plan` completes Transform if the Day-90 event is already set
  (`transform.completed`, in the job's transaction). An unusable answer, a failed call or a
  copy not there yet is retried with backoff, then the job fails.
- `report_jobs`: the job metrics from one leader per region, in the HTTP runtime (15.5).
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any, Literal

from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from common.events import Event, add_to_outbox
from common.generation import jobs
from common.generation.jobs import Target
from common.generation.llm import LlmClient, LlmConfigError
from common.metrics import RegionLeader
from common.models import CHILD_ACCESS, GROWTH_INPUTS, JOBS, PERSONALITY_INPUTS, growth_inputs_id
from common.telemetry import current_traceparent
from transform.app import pathway, plans
from transform.app.runtime import SERVICE, Runtime
from transform.app.store import JOB_TYPES, KINDS, PLANS, Kind, lock_name

POLL_SECONDS = 2.0
REPORT_SECONDS = 60.0

Outcome = Literal["completed", "dropped", "retry", "failed"]

_logger = logging.getLogger(__name__)


def target(child_id: str, kind: Kind, area_id: str | None = None) -> Target:
    return Target(PLANS, child_id, lock=f"active_jobs.{lock_name(kind, area_id)}")


def job_area(job: Mapping[str, Any]) -> str | None:
    """A Life Pathway job's area, from its lock (`…generate_life_pathway:<area_id>`)."""
    lock: str = job["target"]["lock"]
    return lock.split(":", 1)[1] if ":" in lock else None


def completed_event(runtime: Runtime, doc: Mapping[str, Any]) -> Event:
    return Event.new(
        "transform.completed",
        producer=SERVICE,
        aggregate_id=doc["_id"],
        location=doc["location"],
        version=doc["version"],
        region=runtime.settings.aws_region,
        traceparent=current_traceparent(),
    )


async def complete_if_ready(
    runtime: Runtime, doc_id: str, location: str, session: AsyncClientSession
) -> bool:
    """Set `completed_at` (once) if the plan exists and the event is set; publish it."""
    updated = await runtime.db[PLANS].find_one_and_update(
        {
            "_id": doc_id,
            "location": location,
            "plan": {"$type": "object"},
            "event_set": True,
            "event_date": {"$type": "date"},
            "completed_at": {"$exists": False},
        },
        {"$set": {"completed_at": datetime.now(UTC)}, "$inc": {"version": 1}},
        return_document=ReturnDocument.AFTER,
        session=session,
    )
    if updated is None:
        return False
    await add_to_outbox(runtime.db, completed_event(runtime, updated), session)
    return True


async def running_job(
    runtime: Runtime, doc: Mapping[str, Any] | None, kind: Kind, area_id: str | None = None
) -> str | None:
    """The plan's open job of this kind (and area), if one is running."""
    held = ((doc or {}).get("active_jobs") or {}).get(lock_name(kind, area_id))
    if not held:
        return None
    job = await runtime.db[JOBS].find_one(
        {"_id": held, "status": {"$in": list(jobs.OPEN_STATUSES)}}, {"_id": 1}
    )
    return held if job is not None else None


async def start(
    runtime: Runtime,
    *,
    kind: Kind,
    child: Mapping[str, Any],
    area_id: str | None,
    input_version: int,
) -> tuple[str, bool]:
    """Start the kind's generation, or return the running one."""
    return await jobs.start_job(
        runtime.db,
        runtime.client,
        job_type=JOB_TYPES[kind],
        user_id=child["user_id"],
        child_id=child["_id"],
        location=child["location"],
        target=target(child["_id"], kind, area_id),
        input_version=input_version,
        # A new plan document: what the parent's first save would have made.
        target_on_insert={"event_set": False, "version": 1},
        target_status=None,
    )


async def process(runtime: Runtime, llm: LlmClient, job: Mapping[str, Any]) -> Outcome:
    """One claimed job, to its end or its next retry."""
    db, kind = runtime.db, KINDS[job["type"]]
    child_id, location = job["child_id"], job["location"]

    async def give_up(error: str, *, permanent: bool = False) -> Literal["retry", "failed"]:
        return await jobs.fail_or_retry(
            db, runtime.client, job, error, permanent=permanent, target_status=None
        )

    doc = await db[PLANS].find_one({"_id": child_id, "location": location})
    child = await db[CHILD_ACCESS].find_one({"_id": child_id, "location": location})
    if doc is None or child is None:
        return await give_up("the plan or the child's copy isn't there yet")
    personality = await db[PERSONALITY_INPUTS].find_one({"_id": child_id, "location": location})
    area_id = job_area(job)
    area = None
    if kind == "life_pathway":
        area = await db[GROWTH_INPUTS].find_one(
            {"_id": growth_inputs_id(child_id, area_id or ""), "location": location}
        )
        if area is None:
            return await give_up("the area's copy isn't there yet")
        prompt, schema = pathway.prompt(child, personality, area), pathway.schema()
    elif kind == "plan":
        prompt, schema = (
            plans.plan_prompt(child, personality, doc.get("ask") or ""),
            plans.PLAN_SCHEMA,
        )
    else:
        event_date = doc.get("event_date")
        prompt = plans.tracker_prompt(
            child,
            doc.get("ask"),
            doc.get("event_name") or "",
            event_date.date().isoformat() if isinstance(event_date, datetime) else "",
        )
        schema = plans.TRACKER_SCHEMA
    try:
        result = await llm.invoke(prompt, schema=schema)
    except LlmConfigError as exc:
        return await give_up(str(exc), permanent=True)
    except Exception as exc:  # a timeout, a provider error, an unusable answer: retried
        return await give_up(f"the LLM call failed ({type(exc).__name__})")

    update: dict[str, Any]
    if kind == "life_pathway":
        ages = [pathway.child_age(child) + offset for offset in pathway.AGE_OFFSETS]
        milestones = pathway.normalize(result.data, ages)
        if milestones is None:
            return await give_up("the answer couldn't be used as life_pathway")
        update = {f"life_pathway.{area_id}": pathway.to_slots(milestones)}
    else:
        validator = plans.PLAN_VALIDATOR if kind == "plan" else plans.TRACKER_VALIDATOR
        problems = plans.errors(validator, result.data)
        if problems:
            return await give_up(f"the answer didn't fit the schema at {', '.join(problems[:5])}")
        update = {"plan" if kind == "plan" else "track_steps": result.data}

    async def after(session: AsyncClientSession) -> None:
        if kind == "plan":
            await complete_if_ready(runtime, child_id, location, session)

    stored = await jobs.complete_job(
        db, runtime.client, job, target_update=update, in_transaction=after
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
                _logger.info(
                    "transform.job id=%s type=%s outcome=%s", job["_id"], job["type"], outcome
                )
                continue
        except Exception:
            _logger.exception("transform: a job failed unexpectedly; retrying")
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
                _logger.exception("transform: couldn't report the job metrics")
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(stop.wait(), interval)
    finally:
        await leader.release()
