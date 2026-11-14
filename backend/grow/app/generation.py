"""A growth area's two generations (docs/auth-users-split.md, 8; API: POST …/generation).

| kind | job type | writes | once? |
|---|---|---|---|
| `parent_questions` | `generate_growth_parent_questions` | `parent_questions` | yes |
| `recommendations` | `generate_recommendations` | `ai_three_month_recommendations`, `recommendations_run_at`, `child_games`, `recommendations_input`, `version`; for an answered area not yet completed, `status`, `step`, `completed_at`, `updated_at` | no |

- `start`: through common.generation.jobs.start_job, one lock per kind per area
  (`active_jobs.<job type>`). A job never fails the area's `status`
  (`target_status=None`); `parent_questions` on a new area creates it `in_progress`.
- `process`: builds the kind's prompt from the area, grow's copies and, for
  recommendations, the child's latest run of the area's world (grow.app.worlds); calls the
  LLM, runs the answer through today's normaliser (grow.app.areas), and stores the result.
  An answer the normaliser rejects, a failed call or a copy not there yet is retried with
  backoff, then the job fails; the area keeps whatever it had. Recommendations store that
  run's `at` as `recommendations_run_at` (null without a run): the apps regenerate when
  the latest run's `at` differs. With it goes `child_games`, that run's games as
  `Played …` lines (grow.app.worlds.game_lines; empty without a run), which the area
  events carry as Release's child evidence, and `recommendations_input`, the hash of the
  answers and feedback they were written from (input_hash): the public Area's
  `recommendations_current` compares it with the area's present ones. They also bump the
  area's `version` and, in the same transaction: an answered area not yet completed is
  completed here (completion_fields, publish_completion: what the parent's completing
  save does), so it can't stay in progress when the app leaves or its save fails; a
  completed area publishes `grow.area_updated` (transform's Life Pathway prefers them, as
  today). An area with no answers (the games alone) stays as it is.
- `report_jobs`: `PendingJobCount` and `OldestRunningJobAgeSeconds` from one leader per
  region, in the HTTP runtime (15.5).
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import logging
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from typing import Any, Literal

from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from common.events import Event, add_to_outbox, tombstone_key, write_guards
from common.generation import jobs
from common.generation.jobs import Target
from common.generation.llm import LlmClient, LlmConfigError
from common.metrics import RegionLeader
from common.models import CHILD_ACCESS, JOBS, ONBOARDING_INPUTS, PERSONALITY_INPUTS
from common.telemetry import current_traceparent
from grow.app import prompts, worlds
from grow.app.areas import AREAS, fit_sources, normalize_questions, normalize_recommendations
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
        "child_games": doc.get("child_games") or [],
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


def answered(doc: Mapping[str, Any]) -> bool:
    """Whether the parent saved at least one non-empty answer (the apps' answered count)."""
    return any(str(v).strip() for v in (doc.get("answers") or {}).values())


def input_hash(doc: Mapping[str, Any]) -> str:
    """What the recommendations are written from on the parent's side: the answers and the
    feedback, as one stable hash (stored as `recommendations_input`)."""
    used = {"answers": doc.get("answers") or {}, "feedback": doc.get("feedback")}
    text = json.dumps(used, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(text.encode()).hexdigest()


def recommendations_current(doc: Mapping[str, Any]) -> bool:
    """Whether the stored recommendations were written from the area's present answers and
    feedback. False without them, and for ones stored before the hash was (no
    `recommendations_input`): the apps then write them again."""
    stored = doc.get("recommendations_input")
    return bool(doc.get("ai_three_month_recommendations")) and stored == input_hash(doc)


def now_ms() -> datetime:
    """To the millisecond, as MongoDB keeps it: a response shows what a later GET will."""
    moment = datetime.now(UTC)
    return moment.replace(microsecond=moment.microsecond // 1000 * 1000)


def completion_fields(now: datetime) -> dict[str, Any]:
    """What completing an area sets, from the parent's save or the recommendations job."""
    return {"status": "completed", "step": None, "completed_at": now}


def guard_keys(child_id: str, user_id: str) -> list[str]:
    """The child's and user's tombstone keys. An area write touches their guards
    (common.events.write_guards) before checking them: it then conflicts with a deletion in
    flight, and two writes of one child's areas conflict too, so only one of two areas
    completing at once sees itself as the first (`grow.completed` once)."""
    return [tombstone_key("child", child_id), tombstone_key("user", user_id)]


async def publish_completion(
    runtime: Runtime, doc: Mapping[str, Any], session: AsyncClientSession
) -> None:
    """`grow.area_completed` for the area just completed in `session`, and `grow.completed`
    when it's the child's first. The caller has written the child's guards in `session`
    (guard_keys), so a second area completing at once conflicts and counts again."""
    db = runtime.db
    await add_to_outbox(db, area_event(runtime, "grow.area_completed", doc), session)
    others = await db[GROWTH_AREAS].count_documents(
        {
            "location": doc["location"],
            "child_id": doc["child_id"],
            "status": "completed",
            "_id": {"$ne": doc["_id"]},
        },
        session=session,
    )
    if others == 0:
        await add_to_outbox(db, area_event(runtime, "grow.completed", doc), session)


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
GENERATED_ONCE = ("parent_questions",)


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
    runs: Sequence[Mapping[str, Any]],
) -> tuple[str, dict[str, Any]]:
    info = area_info(area["area_id"], area["area_name"])
    if kind == "parent_questions":
        return (
            prompts.parent_questions_prompt(child, answers, personality, info),
            prompts.parent_questions_schema(),
        )
    return (
        prompts.recommendations_prompt(
            child,
            info,
            _reflections(area, hints=True),
            worlds.latest_run(
                area["area_id"],
                runs,
                datetime.now(UTC),
                name=child.get("name"),
                gender=child.get("gender"),
            ),
            area.get("feedback"),
        ),
        prompts.recommendations_schema(),
    )


def _normalised(kind: Kind, area_id: str, raw: Any) -> Any:
    """The result to store, or None when today's normaliser rejects the answer."""
    if kind == "parent_questions":
        questions = normalize_questions(raw, area_id)
        return {"questions": questions} if questions else None
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
    runs: list[Mapping[str, Any]] = []
    if kind == "recommendations":  # the child's input: their runs of the area's world
        played = await db[worlds.WORLD_RUNS].find_one(
            {"_id": job["child_id"], "location": location}
        )
        runs = worlds.runs_for(played, area["area_id"])
    prompt, schema = _prompt(kind, area, child, answers, personality, runs)
    try:
        result = await llm.invoke(prompt, schema=schema)
    except LlmConfigError as exc:
        return await give_up(str(exc), permanent=True)
    except Exception as exc:  # a timeout, a provider error, an unusable answer: retried
        return await give_up(f"the LLM call failed ({type(exc).__name__})")
    value = _normalised(kind, area["area_id"], result.data)
    if value is None:
        return await give_up(f"the answer couldn't be used as {kind}")
    if kind == "recommendations":
        # A tag the inputs can't back ("kid" with no games played) is fixed, not stored.
        value = fit_sources(value, answered=answered(area), played=bool(runs))

    async def after(session: AsyncClientSession) -> None:
        if kind != "recommendations":
            return  # the question sets are grow's own: no other service uses them
        # Before reading the area: a deletion in flight, or another of the child's areas
        # completing, conflicts with this transaction (guard_keys).
        stones = guard_keys(job["child_id"], job["user_id"])
        await write_guards(db, stones, location=location, session=session)
        current = await db[GROWTH_AREAS].find_one(
            {"_id": doc_id, "location": location}, session=session
        )
        if current is None:  # stored just above, in this transaction
            raise RuntimeError("the growth area is missing")
        completing = current["status"] != "completed" and answered(current)
        changes: dict[str, Any] = {"$inc": {"version": 1}}
        if completing:
            now = now_ms()
            changes["$set"] = {**completion_fields(now), "updated_at": now}
        updated = await db[GROWTH_AREAS].find_one_and_update(
            {"_id": doc_id, "location": location},
            changes,
            return_document=ReturnDocument.AFTER,
            session=session,
        )
        if updated is None:
            raise RuntimeError("the growth area is missing")
        if completing:
            await publish_completion(runtime, updated, session)
        elif updated["status"] == "completed":
            await add_to_outbox(db, area_event(runtime, "grow.area_updated", updated), session)

    update: dict[str, Any] = {FIELDS[kind]: value}
    if kind == "recommendations":
        update["recommendations_run_at"] = runs[-1]["at"] if runs else None
        update["child_games"] = worlds.game_lines(area["area_id"], runs[-1]) if runs else []
        # The answers and feedback the prompt was built from (read before the LLM call): a
        # save meanwhile leaves these not current (recommendations_current).
        update["recommendations_input"] = input_hash(area)
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
            if not await runtime.switch.enabled():
                # Paused (common.generation.switch): jobs wait; look again shortly.
                with contextlib.suppress(TimeoutError):
                    await asyncio.wait_for(stop.wait(), jobs.idle_wait(poll))
                continue
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
            await asyncio.wait_for(stop.wait(), jobs.idle_wait(poll))


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
                        "OldestPendingJobAgeSeconds",
                        await jobs.oldest_pending_age(runtime.db, locations=locations),
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
