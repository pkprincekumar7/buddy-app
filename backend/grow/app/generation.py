"""A growth area's three generations (docs/auth-users-split.md, 8; API: POST …/generation).

| kind | job type | writes | once? |
|---|---|---|---|
| `parent_questions` | `generate_growth_parent_questions` | `parent_questions` | yes |
| `child_rounds` | `generate_growth_child_rounds` | `child_rounds` | yes |
| `recommendations` | `generate_recommendations` | `ai_three_month_recommendations` | no |

- `start`: through common.generation.jobs.start_job, one lock per kind per area
  (`active_jobs.<job type>`). The area's `status` is the parent's, so the job never sets
  or fails it (`target_status=None`); `parent_questions` on a new area creates it
  `in_progress`.
- `process`: builds the kind's prompt from the area and grow's copies, calls the LLM,
  runs the answer through today's normaliser (grow.app.areas), and stores the result. An
  answer the normaliser rejects, a failed call or a copy not there yet is retried with
  backoff, then the job fails; the area keeps whatever it had. Recommendations bump the
  area's `version` and, for a completed area, publish `grow.area_updated` in the same
  transaction: transform's Life Pathway prefers them, as today.
- `report_jobs`: `PendingJobCount` and `OldestRunningJobAgeSeconds` from one leader per
  region, in the HTTP runtime (15.5).
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Mapping
from typing import Any, Literal

from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from common.events import Event, add_to_outbox
from common.generation import jobs
from common.generation.jobs import Target
from common.generation.llm import LlmClient, LlmConfigError
from common.metrics import RegionLeader
from common.models import CHILD_ACCESS, JOBS, ONBOARDING_INPUTS, PERSONALITY_INPUTS
from common.telemetry import current_traceparent
from grow.app import prompts
from grow.app.areas import (
    AREAS,
    fill_template,
    normalize_questions,
    normalize_recommendations,
    normalize_rounds,
    picked_options,
    top_archetype,
)
from grow.app.runtime import SERVICE, Runtime
from grow.app.store import FIELDS, GROWTH_AREAS, JOB_TYPES, KINDS, Kind

POLL_SECONDS = 2.0
REPORT_SECONDS = 60.0

Outcome = Literal["completed", "dropped", "retry", "failed", "superseded"]

_logger = logging.getLogger(__name__)


def target(doc_id: str, kind: Kind) -> Target:
    return Target(GROWTH_AREAS, doc_id, lock=f"active_jobs.{JOB_TYPES[kind]}")


def area_info(area_id: str, area_name: str) -> dict[str, str]:
    """The area as the prompts describe it: today's table, else the parent's own name."""
    known = AREAS.get(area_id)
    return dict(known) if known else {"id": area_id, "name": area_name, "description": ""}


def reflections(doc: Mapping[str, Any]) -> list[dict[str, str]]:
    """The questions the parent answered, with the answers; answers whose question isn't
    in the area any more are kept with no question (release's buildGrowthAreaContext)."""
    pairs = _reflections(doc, hints=False)
    if pairs:
        return pairs
    answers = doc.get("answers") or {}
    return [{"question": "", "answer": str(v).strip()} for v in answers.values() if str(v).strip()]


def child_choices(doc: Mapping[str, Any]) -> list[str]:
    """The child's picks as "Chose “X” over “Y”" lines, one per round played
    (release's buildChildActivityContext): the rejected option is half the meaning."""
    rounds = (doc.get("child_rounds") or {}).get("rounds") or []
    picks = (doc.get("child_activity") or {}).get("selections") or []
    lines = []
    for round_ in rounds:
        a, b = round_["a"], round_["b"]
        chose, over = (a, b) if a["id"] in picks else (b, a) if b["id"] in picks else (None, None)
        if chose is not None and over is not None:
            lines.append(f"Chose “{chose['text']}” over “{over['text']}”")
    return lines


def area_payload(doc: Mapping[str, Any]) -> dict[str, Any]:
    """`grow.area_completed` / `grow.area_updated`: what transform and release copy (7.6)."""
    activity = doc.get("child_activity") or {}
    return {
        "user_id": doc["user_id"],
        "area_id": doc["area_id"],
        "area_name": doc["area_name"],
        "answers": doc.get("answers") or {},
        "child_activity_results": activity.get("results"),
        "recommendations": doc.get("recommendations"),
        "ai_three_month_recommendations": doc.get("ai_three_month_recommendations"),
        "reflections": reflections(doc),
        "child_choices": child_choices(doc),
    }


def area_event(runtime: Runtime, event_type: str, doc: Mapping[str, Any]) -> Event:
    payload = {} if event_type == "grow.completed" else area_payload(doc)
    return Event.new(
        event_type,
        producer=SERVICE,
        aggregate_id=doc["child_id"],
        location=doc["location"],
        version=doc["version"],
        region=runtime.settings.aws_region,
        payload=payload,
        traceparent=current_traceparent(),
    )


async def running_job(runtime: Runtime, area: Mapping[str, Any] | None, kind: Kind) -> str | None:
    """The area's open job of this kind, if one is running."""
    held = ((area or {}).get("active_jobs") or {}).get(JOB_TYPES[kind])
    if not held:
        return None
    job = await runtime.db[JOBS].find_one(
        {"_id": held, "status": {"$in": list(jobs.OPEN_STATUSES)}}, {"_id": 1}
    )
    return held if job is not None else None


# Kinds generated once per area; recommendations replace the last ones.
GENERATED_ONCE = ("parent_questions", "child_rounds")


async def start(
    runtime: Runtime,
    *,
    kind: Kind,
    doc_id: str,
    child: Mapping[str, Any],
    area_id: str,
    area_name: str,
    input_version: int,
) -> tuple[str, bool]:
    """Start the kind's generation for the area, or return the running one."""
    return await jobs.start_job(
        runtime.db,
        runtime.client,
        job_type=JOB_TYPES[kind],
        user_id=child["user_id"],
        child_id=child["_id"],
        location=child["location"],
        target=target(doc_id, kind),
        input_version=input_version,
        # A new area (parent_questions): what the parent's first save would have made.
        target_on_insert={
            "area_id": area_id,
            "area_name": area_name,
            "status": "in_progress",
            "answers": {},
            "version": 1,
        },
        target_status=None,
        # The question sets are made once: checked again in the start's transaction, so a
        # job finishing meanwhile isn't followed by a second one (review).
        refuse_if=(
            {kind: {"$exists": True, "$nin": [None, {}, []]}} if kind in GENERATED_ONCE else None
        ),
    )


def _reflections(area: Mapping[str, Any], *, hints: bool) -> list[dict[str, str]]:
    """The questions the parent was asked, with what they answered (answered ones only)."""
    questions = (area.get("parent_questions") or {}).get("questions") or []
    answers = area.get("answers") or {}
    out = []
    for question in questions:
        answer = answers.get(question["id"])
        if answer:
            pair = {"question": question["question"], "answer": str(answer)}
            if hints:
                pair["hint"] = question.get("hint", "")
            out.append(pair)
    return out


def _prompt(
    kind: Kind,
    area: Mapping[str, Any],
    child: Mapping[str, Any],
    answers: Mapping[str, Any] | None,
    personality: Mapping[str, Any] | None,
) -> tuple[str, dict[str, Any]]:
    info = area_info(area["area_id"], area["area_name"])
    if kind == "parent_questions":
        return (
            prompts.parent_questions_prompt(child, answers, personality, info),
            prompts.parent_questions_schema(),
        )
    if kind == "child_rounds":
        return (
            prompts.child_rounds_prompt(
                child, answers, personality, info, _reflections(area, hints=False)
            ),
            prompts.child_rounds_schema(area["area_id"]),
        )
    rounds = (area.get("child_rounds") or {}).get("rounds") or []
    selections = (area.get("child_activity") or {}).get("selections")
    archetype = top_archetype(area["area_id"], rounds, selections)
    pattern = (
        {
            "title": archetype["title"],
            "line": fill_template(archetype["line"], child.get("name"), child.get("gender")),
        }
        if archetype
        else None
    )
    return (
        prompts.recommendations_prompt(
            child,
            info,
            _reflections(area, hints=True),
            [option["text"] for option in picked_options(rounds, selections)],
            pattern,
            area.get("feedback"),
        ),
        prompts.recommendations_schema(),
    )


def _normalised(kind: Kind, area_id: str, raw: Any) -> Any:
    """The result to store, or None when today's normaliser rejects the answer."""
    if kind == "parent_questions":
        questions = normalize_questions(raw, area_id)
        return {"questions": questions} if questions else None
    if kind == "child_rounds":
        rounds = normalize_rounds(raw, area_id)
        return {"rounds": rounds} if rounds else None
    return (
        normalize_recommendations(raw.get("recommendations") if isinstance(raw, dict) else raw)
        or None
    )


async def fail_job(
    runtime: Runtime, job: Mapping[str, Any], error: str
) -> Literal["retry", "failed", "superseded"]:
    """End a job this worker can't finish (it crashed on it, or retakes ran out)."""
    return await jobs.fail_or_retry(
        runtime.db, runtime.client, job, error, permanent=True, target_status=None
    )


async def process(runtime: Runtime, llm: LlmClient, job: Mapping[str, Any]) -> Outcome:
    """One claimed job, to its end or its next retry."""
    db, kind = runtime.db, KINDS[job["type"]]
    doc_id, location = job["target"]["id"], job["location"]

    async def give_up(
        error: str, *, permanent: bool = False
    ) -> Literal["retry", "failed", "superseded"]:
        return await jobs.fail_or_retry(
            db, runtime.client, job, error, permanent=permanent, target_status=None
        )

    if jobs.exhausted(job):  # retaken after crashes more often than its attempts allow
        await fail_job(runtime, job, jobs.EXHAUSTED)
        return "failed"

    area = await db[GROWTH_AREAS].find_one({"_id": doc_id, "location": location})
    child = await db[CHILD_ACCESS].find_one({"_id": job["child_id"], "location": location})
    if area is None or child is None:
        return await give_up("the area or the child's copy isn't there yet")
    answers = await db[ONBOARDING_INPUTS].find_one({"_id": job["child_id"], "location": location})
    personality = await db[PERSONALITY_INPUTS].find_one(
        {"_id": job["child_id"], "location": location}
    )
    prompt, schema = _prompt(kind, area, child, answers, personality)
    try:
        result = await llm.invoke(prompt, schema=schema)
    except LlmConfigError as exc:
        return await give_up(str(exc), permanent=True)
    except Exception as exc:  # a timeout, a provider error, an unusable answer: retried
        return await give_up(f"the LLM call failed ({type(exc).__name__})")
    value = _normalised(kind, area["area_id"], result.data)
    if value is None:
        return await give_up(f"the answer couldn't be used as {kind}")

    async def after(session: AsyncClientSession) -> None:
        if kind != "recommendations":
            return  # the question sets are grow's own: no other service uses them
        updated = await db[GROWTH_AREAS].find_one_and_update(
            {"_id": doc_id, "location": location},
            {"$inc": {"version": 1}},
            return_document=ReturnDocument.AFTER,
            session=session,
        )
        if updated is not None and updated["status"] == "completed":
            await add_to_outbox(db, area_event(runtime, "grow.area_updated", updated), session)

    stored = await jobs.complete_job(
        db, runtime.client, job, target_update={FIELDS[kind]: value}, in_transaction=after
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
                _logger.info("grow.job id=%s type=%s outcome=%s", job["_id"], job["type"], outcome)
                continue
        except Exception:
            _logger.exception("grow: a job failed unexpectedly; retrying")
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
                _logger.exception("grow: couldn't report the job metrics")
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(stop.wait(), interval)
    finally:
        await leader.release()
