"""The grow service's two apps, run by `python -m common.serve grow`.

`app` is public (port 8000, ALB rule 30: `/api/v1/children/*/growth-areas*`); `internal_app`
is internal (port 8001, Cloud Map only). Each endpoint is in docs/auth-users-split-api.md:

- `GET /api/v1/children/{id}/growth-areas`: every area, in one query;
- `PUT …/growth-areas/{area_id}`: the parent's progress through an area, and its completion;
- `POST …/growth-areas/{area_id}/generation` (`kind`: `parent_questions` or
  `recommendations`) and `GET …/generation/{job_id}`;
- `GET …/growth-areas/worlds` and `POST …/worlds/{world}/runs`: the child's world runs in
  child view (grow.app.worlds), the child's input to the area's recommendations;
- `GET /internal/grow/children/{id}/status` (transform's confirm-before-deny) and `…/areas`
  (transform's and release's read-through of `growth_inputs`).

**Access** follows the circle rules (grow.app.access): the child's parent, or an admin
with `children:read:any` reading with the owner's `?location=` (audited); unlocked once
Discover is done. **Events:** completing an area publishes `grow.area_completed` (and, the
first time for the child, `grow.completed`); editing a completed one, `grow.area_updated`;
each in the save's transaction. An answered area is also completed by its recommendations'
job, with the same events in the job's transaction (grow.app.generation). The HTTP runtime
also publishes the job metrics from one leader per region.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Annotated, Any, Literal

import bson
from fastapi import Depends, FastAPI, HTTPException, Path, Query, Request, Response
from limits import parse
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from pydantic.json_schema import SkipJsonSchema
from pymongo import ASCENDING, ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.errors import DuplicateKeyError, PyMongoError

from common.audit import route_template
from common.authz import Caller, current_caller, signed_in
from common.events import Event, add_to_outbox, is_tombstoned, tombstone_key, write_guards
from common.generation.jobs import JobRefused, TargetRefused
from common.internal_client import allow_callers
from common.metrics import MetricsPublisher
from common.models import CHILD_ID_PATTERN, JOBS, stage_done
from common.routers import PolicyRouter, public
from common.telemetry import current_traceparent
from grow.app import generation, worlds
from grow.app.access import (
    answers_for,
    child_for,
    error,
    not_found,
    personality_for,
    require_unlocked,
)
from grow.app.areas import AREAS
from grow.app.runtime import SERVICE, Runtime
from grow.app.store import (
    ANSWER_MAX,
    ANSWERS_MAX_KEYS,
    AREA_ID_PATTERN,
    FEEDBACK_MAX,
    GROWTH_AREAS,
    JOB_TYPES,
    KINDS,
    LIST_MAX,
    MAX_AREA_BYTES,
    NAME_MAX,
    RECOMMENDATIONS_MAX,
    RESERVED_PREFIXES,
    SCHEMA_VERSION,
    STEP_MAX,
    SUMMARY_MAX,
    Kind,
    area_doc_id,
    valid_area_id,
)

LOCATION_PATTERN = r"^[a-z0-9_-]{1,16}$"
READ_ANY = "children:read:any"
# Confirm-before-deny for transform (12.4); the circles that copy the areas (7.5).
STATUS_CALLERS = ("transform",)
AREAS_CALLERS = ("transform", "release")
SAVE_ATTEMPTS = 3
SAVED_FIELDS = (
    "area_name", "status", "step", "answers", "child_activity", "recommendations", "feedback",
)  # fmt: skip

_logger = logging.getLogger(__name__)
_runtime: Runtime | None = None
_users = 0
_reporting: tuple[asyncio.Event, asyncio.Task[None]] | None = None


def configure(runtime: Runtime | None) -> None:
    """Attach (or detach) the runtime's resources to both apps."""
    global _runtime
    _runtime = runtime
    app.state.runtime = runtime
    internal_app.state.runtime = runtime
    if runtime is not None:
        app.state.authorizer = runtime.authorizer
        internal_app.state.service_tokens = runtime.verifier


def _start_reporting(runtime: Runtime) -> None:
    global _reporting
    if runtime.cloudwatch is None:
        return
    metrics = MetricsPublisher(
        runtime.cloudwatch, service=SERVICE, environment=runtime.settings.app_env
    )
    stop = asyncio.Event()
    _reporting = (stop, asyncio.create_task(generation.report_jobs(runtime, metrics, stop)))


async def _stop_reporting() -> None:
    global _reporting
    if _reporting is not None:
        stop, task = _reporting
        stop.set()
        await task
        _reporting = None


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Both apps share one Runtime per process; the last one to stop closes it."""
    global _users
    import os

    if _runtime is None and os.environ.get("MONGODB_URI"):
        runtime = Runtime.from_env()
        await runtime.prepare()
        configure(runtime)
        _start_reporting(runtime)
    _users += 1
    try:
        yield
    finally:
        _users -= 1
        if _users == 0 and _runtime is not None:
            await _stop_reporting()
            await _runtime.aclose()
            configure(None)


# The contact and servers every service's published spec carries.
app = FastAPI(
    title=SERVICE,
    description="Grow: each child's growth areas, with their generated questions, rounds "
    "and recommendations.",
    contact={"name": "Superpower Engineering", "email": "prince.kumar@pearson.com"},
    servers=[{"url": "/", "description": "Current environment"}],
    openapi_tags=[
        {"name": "health", "description": "Service health"},
        {"name": "growth-areas", "description": "The child's growth areas"},
    ],
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)
internal_app = FastAPI(
    title=f"{SERVICE} (internal)",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)
configure(None)


# ── shared dependencies ────────────────────────────────────────────────────────


def runtime_ready(request: Request) -> Runtime:
    """The runtime's resources, or 503 when the service runs without configuration."""
    runtime: Runtime | None = getattr(request.app.state, "runtime", None)
    if runtime is None:
        raise HTTPException(status_code=503, detail="grow isn't configured")
    return runtime


Ready = Annotated[Runtime, Depends(runtime_ready)]
SignedIn = Annotated[Caller, Depends(signed_in())]


def per_user(limit: str) -> Callable[..., Awaitable[None]]:
    item = parse(limit)

    async def dependency(
        request: Request, runtime: Ready, caller: Annotated[Caller, Depends(current_caller)]
    ) -> None:
        if not await runtime.limits.allow(
            item, route_template(request), request.method, f"user:{caller.user_id}"
        ):
            raise HTTPException(
                status_code=429,
                detail="Too many requests",
                headers={"Retry-After": str(item.get_expiry())},
            )

    return dependency


ChildId = Annotated[str, Path(pattern=CHILD_ID_PATTERN, description="The child's id")]
AreaId = Annotated[
    str,
    Path(
        pattern=AREA_ID_PATTERN,
        description="The area's id (today's: `self_care`, `life_ambition`, …); never starting "
        f"with {', '.join(RESERVED_PREFIXES)}",
    ),
]
LocationQuery = Annotated[
    str | None,
    Query(pattern=LOCATION_PATTERN, description="The owner's location (admins only)"),
]


def _checked_area_id(area_id: str) -> str:
    if not valid_area_id(area_id):
        raise error(422, "invalid_area_id", "That area id starts with another circle's path.")
    return area_id


async def _parents_child(runtime: Runtime, caller: Caller, child_id: str) -> dict[str, Any]:
    """The caller's own child, unlocked (the circle rules for a write)."""
    child = await child_for(runtime, child_id, location=caller.location, owner=caller.user_id)
    await require_unlocked(runtime, child)
    return child


async def _child_view_child(runtime: Runtime, caller: Caller, child_id: str) -> dict[str, Any]:
    """The caller's own child for child view's routes, which open in child view's own order
    (docs/child-view-build-plan.md): here only once the parent's chat is done; the children
    service decides the rest."""
    child = await child_for(runtime, child_id, location=caller.location, owner=caller.user_id)
    if not stage_done(child, "conversation"):
        raise error(403, "circle_locked", "Finish the chat about your child first.")
    return child


def _selector(child: Mapping[str, Any], area_id: str) -> dict[str, Any]:
    return {
        "_id": area_doc_id(child["_id"], area_id),
        "location": child["location"],
        "user_id": child["user_id"],
    }


async def _transaction(
    runtime: Runtime, write: Callable[[AsyncClientSession], Awaitable[None]]
) -> None:
    async with runtime.client.start_session() as session:
        await session.with_transaction(write)


# ── models ─────────────────────────────────────────────────────────────────────

_Strict = ConfigDict(extra="forbid", strict=True)
_Text = Annotated[str, StringConstraints(max_length=SUMMARY_MAX)]
_Item = Annotated[str, StringConstraints(max_length=ANSWER_MAX)]


class ActivityResults(BaseModel):
    model_config = _Strict

    summary: _Text | None = None
    strengths: Annotated[list[_Item], Field(max_length=LIST_MAX)] | None = None
    suggested_activities: Annotated[list[_Item], Field(max_length=LIST_MAX)] | None = None


class ChildActivity(BaseModel):
    """The child's activity results, carried by the area's events (`child_activity_results`)."""

    model_config = _Strict

    results: ActivityResults | None = None


class AreaIn(BaseModel):
    """The parent's part of an area. The generated parts are grow's jobs' only (422)."""

    model_config = _Strict

    area_name: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=NAME_MAX)
    ]
    status: Literal["in_progress", "completed"]
    step: Annotated[str, StringConstraints(max_length=STEP_MAX)] | None = None
    answers: Annotated[dict[str, _Item], Field(max_length=ANSWERS_MAX_KEYS)]
    child_activity: ChildActivity | None = None
    recommendations: Annotated[list[_Item], Field(max_length=RECOMMENDATIONS_MAX)] | None = None
    feedback: Annotated[str, StringConstraints(max_length=FEEDBACK_MAX)] | None = None


class Recommendation(BaseModel):
    """One of the area's AI recommendations (grow.app.areas.normalize_recommendations)."""

    title: str
    detail: str
    # What it's grounded in: the answers and the games, the games, the answers, the next
    # step. Left out (never null) when the stored item has none.
    source: Literal["both", "kid", "you", "step"] | SkipJsonSchema[None] = Field(
        default=None, exclude_if=lambda value: value is None
    )


class Area(BaseModel):
    area_id: str
    area_name: str
    status: Literal["in_progress", "completed"]
    step: str | None
    parent_questions: dict[str, Any] | None
    answers: dict[str, str]
    child_activity: dict[str, Any] | None
    recommendations: list[str] | None
    ai_three_month_recommendations: list[Recommendation] | None
    # The `at` of the world run the recommendations were written from; null without one.
    recommendations_run_at: datetime | None
    # Whether the recommendations were written from the area's present answers and
    # feedback (false without recommendations, or after a save changed either since).
    recommendations_current: bool
    feedback: str | None
    generating: list[Kind]
    completed_at: datetime | None
    updated_at: datetime


class Areas(BaseModel):
    areas: list[Area]


class GenerationIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Kind
    area_name: (
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=NAME_MAX)]
        | None
    ) = None


class Started(BaseModel):
    job_id: str
    status: str


class Job(BaseModel):
    job_id: str
    kind: Kind
    status: Literal["pending", "processing", "completed", "failed"]
    error: str | None
    created_at: datetime
    completed_at: datetime | None


class Completed(BaseModel):
    completed: bool


class AreaCopy(BaseModel):
    """One completed area, as transform and release copy it into growth_inputs (4.1)."""

    child_id: str
    user_id: str
    location: str
    area_id: str
    area_name: str
    answers: dict[str, str]
    child_activity_results: Any
    recommendations: list[str] | None
    ai_three_month_recommendations: list[dict[str, str]] | None
    reflections: list[dict[str, str]]
    child_games: list[str]
    version: int


class AreaCopies(BaseModel):
    areas: list[AreaCopy]


def _view(doc: Mapping[str, Any]) -> Area:
    running = doc.get("active_jobs") or {}
    return Area(
        area_id=doc["area_id"],
        area_name=doc["area_name"],
        status=doc["status"],
        step=doc.get("step"),
        parent_questions=doc.get("parent_questions"),
        answers=doc.get("answers") or {},
        child_activity=doc.get("child_activity"),
        recommendations=doc.get("recommendations"),
        ai_three_month_recommendations=doc.get("ai_three_month_recommendations"),
        recommendations_run_at=doc.get("recommendations_run_at"),
        recommendations_current=generation.recommendations_current(doc),
        feedback=doc.get("feedback"),
        generating=[KINDS[job_type] for job_type in JOB_TYPES.values() if running.get(job_type)],
        completed_at=doc.get("completed_at"),
        updated_at=doc["updated_at"],
    )


class _Stale(Exception):
    """The area changed after it was read."""


def _now() -> datetime:
    return generation.now_ms()


# ── public routes ──────────────────────────────────────────────────────────────

health_router = PolicyRouter()
router = PolicyRouter(prefix="/api/v1/children/{id}/growth-areas", tags=["growth-areas"])


@health_router.get(
    "/health",
    tags=["health"],
    dependencies=[Depends(public())],
    description="Liveness check for the load balancer.",
)
def health() -> dict[str, str]:
    return {"status": "ok", "service": SERVICE}


async def _admin_child(
    request: Request, runtime: Runtime, caller: Caller, child_id: str, location: str | None
) -> dict[str, Any]:
    """An admin's read (`children:read:any`): audited whether it's allowed or refused."""
    try:
        if location is None:
            raise error(422, "location_required", "Pass ?location= (the owner's location)")
        child = await child_for(runtime, child_id, location=location, owner=None)
    except HTTPException as exc:
        runtime.authorizer.record(
            request, caller, READ_ANY, None, privileged=True, status=exc.status_code
        )
        raise
    runtime.authorizer.record(request, caller, READ_ANY, child["user_id"], privileged=True)
    return child


@router.get(
    "",
    dependencies=[Depends(per_user("60/minute"))],
    description="Every growth area of the child, in the order they were started, with "
    "`generating` naming the kinds with a job running. An admin with `children:read:any` "
    "passes the owner's `?location=` (audited).",
)
async def list_areas(
    request: Request, id: ChildId, runtime: Ready, caller: SignedIn, location: LocationQuery = None
) -> Areas:
    if caller.has(READ_ANY):
        child = await _admin_child(request, runtime, caller, id, location)
    else:
        child = await _parents_child(runtime, caller, id)
    docs = (
        await runtime.db[GROWTH_AREAS]
        .find({"location": child["location"], "child_id": id, "user_id": child["user_id"]})
        .sort("created_at", ASCENDING)
        .to_list(None)
    )
    return Areas(areas=[_view(doc) for doc in docs])


@router.put(
    "/{area_id}",
    dependencies=[Depends(per_user("60/minute"))],
    description="Save one area: the parent's progress through its wizard, and its "
    "completion (`grow.area_completed`, and `grow.completed` for the child's first). "
    "Editing a completed area publishes `grow.area_updated`; a completed area stays "
    "completed (a save sending `in_progress` is an edit of it). Answer keys must be ids from "
    "the area's `parent_questions`; the generated parts can't be sent.",
)
async def save_area(
    id: ChildId, area_id: AreaId, body: AreaIn, runtime: Ready, caller: SignedIn
) -> Area:
    _checked_area_id(area_id)
    child = await _parents_child(runtime, caller, id)
    selector = _selector(child, area_id)
    areas = runtime.db[GROWTH_AREAS]
    fields: dict[str, Any] = body.model_dump()
    result: dict[str, Any] = {}

    for _ in range(SAVE_ATTEMPTS):
        existing = await areas.find_one(selector)

        async def write(session: AsyncClientSession, existing: Any = existing) -> None:
            # The child's guards first: a deletion in flight conflicts with this save (so a
            # first save's insert can't commit after it), and so does another of the
            # child's areas completing at once (grow.completed once; generation.guard_keys).
            tombstones = generation.guard_keys(id, child["user_id"])
            await write_guards(runtime.db, tombstones, location=child["location"], session=session)
            if await is_tombstoned(
                runtime.db, tombstones, session=session, location=child["location"]
            ):
                raise not_found()  # deleted meanwhile: nothing may come back
            was_completed = existing is not None and existing["status"] == "completed"
            questions = ((existing or {}).get("parent_questions") or {}).get("questions") or []
            unknown = set(fields["answers"]) - {q["id"] for q in questions}
            if unknown:
                raise error(422, "unknown_question", "Answers must use the area's question ids.")
            completing = fields["status"] == "completed" and not was_completed
            now = _now()
            changes = dict(fields)
            if was_completed:
                # A completed area stays completed: a save from a copy that hasn't seen the
                # recommendations job complete it (another device, the sheet while the job
                # ran) sends `in_progress`, and is an edit of the completed area (review).
                changes["status"] = "completed"
            if changes["status"] == "completed":
                changes["step"] = None
            if completing:
                changes.update(generation.completion_fields(now))
            if existing is not None and all(
                existing.get(name) == changes[name] for name in SAVED_FIELDS
            ):
                result["doc"] = existing  # nothing changed: nothing to publish
                return
            merged = {**(existing or {}), **changes}
            if len(bson.encode(merged)) > MAX_AREA_BYTES:
                raise error(422, "area_too_large", "The area is over 64 KB.")
            doc: dict[str, Any] | None
            if existing is None:
                doc = {
                    **selector,
                    "child_id": id,
                    "area_id": area_id,
                    **changes,
                    "version": 1,
                    "created_at": now,
                    "updated_at": now,
                    "schema_version": SCHEMA_VERSION,
                }
                await areas.insert_one(doc, session=session)
            else:
                doc = await areas.find_one_and_update(
                    {**selector, "version": existing["version"]},
                    {"$set": {**changes, "updated_at": now}, "$inc": {"version": 1}},
                    return_document=ReturnDocument.AFTER,
                    session=session,
                )
                if doc is None:
                    raise _Stale()
            if completing:
                await generation.publish_completion(runtime, doc, session)
            elif was_completed:
                await add_to_outbox(
                    runtime.db, generation.area_event(runtime, "grow.area_updated", doc), session
                )
            result["doc"] = doc

        try:
            await _transaction(runtime, write)
            break
        except (_Stale, DuplicateKeyError):
            continue  # another save won the race: decide again against it
    else:
        raise error(409, "area_changed", "The area changed meanwhile; try again.")
    return _view(result["doc"])


async def _started_anyway(runtime: Runtime, selector: Mapping[str, Any], kind: Kind) -> bool:
    """Whether the area has a job of this kind running after a start that failed with a
    database error (its commit may have gone through). Unknown counts as not started."""
    try:
        area = await runtime.db[GROWTH_AREAS].find_one(selector)
        return await generation.running_job(runtime, area, kind) is not None
    except PyMongoError:
        return False


@router.post(
    "/{area_id}/generation",
    status_code=202,
    dependencies=[Depends(per_user("10/minute"))],
    responses={200: {"model": Started, "description": "The job already running"}},
    description="Generate one of the area's AI parts (`kind`). `parent_questions` on a new "
    "area creates it (with `area_name`). The question sets are generated once "
    "(`409 already_generated`). Recommendations need the parent's answers saved or a run of "
    "the area's world (`409 needs_input`), are written from both, and replace the last ones; "
    "the area's `recommendations_run_at` is the run they used, and its "
    "`recommendations_current` says whether they're from its present answers and feedback. "
    "An answered area is completed by its recommendations' job (`grow.area_completed`, and "
    "`grow.completed` for the child's first). The running job is returned with `200`. "
    "Counts against the hourly LLM limit (`429 llm_limit`).",
)
async def start_generation(
    id: ChildId,
    area_id: AreaId,
    body: GenerationIn,
    response: Response,
    runtime: Ready,
    caller: SignedIn,
) -> Started:
    _checked_area_id(area_id)
    if area_id not in AREAS:
        raise error(422, "unknown_area", "Generation is for the growth areas the apps show.")
    child = await _parents_child(runtime, caller, id)
    selector = _selector(child, area_id)
    area = await runtime.db[GROWTH_AREAS].find_one(selector)
    kind = body.kind
    if area is None and kind != "parent_questions":
        raise error(404, "area_not_found", "Start the area with its questions first.")
    if kind in generation.GENERATED_ONCE and area and area.get(kind):
        raise error(409, "already_generated", f"The area's {kind} are already generated.")
    if kind == "recommendations" and not (area or {}).get("answers"):
        played = await runtime.db[worlds.WORLD_RUNS].find_one(_runs_selector(child))
        if not worlds.runs_for(played, area_id):
            raise error(
                409, "needs_input", "Save the parent's answers or play the area's games first."
            )
    running = await generation.running_job(runtime, area, kind)
    if running is None:
        answers = await answers_for(runtime, child)
        await personality_for(runtime, child)
        # The kill switch (common.generation.switch): no new LLM spend while it's off.
        if not await runtime.switch.enabled():
            raise error(
                503, "generation_paused", "Generation is paused for now. Please try again later."
            )
        if not await runtime.llm_limit.take(caller.user_id):
            raise HTTPException(
                status_code=429,
                detail={"code": "llm_limit", "msg": "Too many generations this hour."},
                headers={"Retry-After": str(runtime.llm_limit.window)},
            )
        name = (area or {}).get("area_name") or body.area_name or AREAS[area_id]["name"]
        try:
            running, created = await generation.start(
                runtime,
                kind=kind,
                doc_id=selector["_id"],
                child=child,
                area_id=area_id,
                area_name=name,
                input_version=int(answers["version"]),
            )
        except Exception as exc:
            # No job was started: no LLM call to count (review). Every failed start, the
            # refusals below and anything unexpected alike. A database error can follow a
            # start that did commit (an unknown commit result): its job runs, so it keeps
            # the slot (review).
            if not (
                isinstance(exc, PyMongoError) and await _started_anyway(runtime, selector, kind)
            ):
                await runtime.llm_limit.give_back(caller.user_id)
            if isinstance(exc, JobRefused):
                raise not_found() from None
            if isinstance(exc, TargetRefused):
                raise error(
                    409, "already_generated", f"The area's {kind} are already generated."
                ) from None
            if isinstance(exc, PyMongoError):
                _logger.exception("grow: the job couldn't be stored")
                raise error(503, "generation_unavailable", "Try again in a moment.") from exc
            raise
        if created:
            return Started(job_id=running, status="pending")
        await runtime.llm_limit.give_back(caller.user_id)  # a running job: no new call
    job = await runtime.db[JOBS].find_one({"_id": running}, {"status": 1})
    response.status_code = 200
    return Started(job_id=running, status=job["status"] if job else "pending")


@router.get(
    "/{area_id}/generation/{job_id}",
    # Polled every few seconds while the job runs, so looser than the other routes: several
    # jobs at once, or an older app polling every 2 s, mustn't hit 429 (review, JOB-05).
    dependencies=[Depends(per_user("300/minute"))],
    description="A grow job's status, while the area shows generating. When `completed`, "
    "reload the areas.",
)
async def get_job(
    id: ChildId, area_id: AreaId, job_id: str, runtime: Ready, caller: SignedIn
) -> Job:
    child = await _parents_child(runtime, caller, id)
    job = await runtime.db[JOBS].find_one(
        {
            "_id": job_id,
            "location": child["location"],
            "child_id": id,
            "user_id": child["user_id"],
            "target.id": area_doc_id(id, area_id),
        }
    )
    if job is None:
        raise error(404, "job_not_found", "No such job.")
    return Job(
        job_id=job["_id"],
        kind=KINDS[job["type"]],
        status=job["status"],
        error=job.get("error"),
        created_at=job["created_at"],
        completed_at=job.get("completed_at"),
    )


# ── the child's worlds (child view) ────────────────────────────────────────────


class WorldGame(BaseModel):
    type: Literal["dash", "sort", "timing", "catch", "memory", "spark", "react"]
    title: str
    skill: str
    how: str
    tip: str
    # The game's settings (its words, counts and timings), shaped by `type`.
    cfg: dict[str, Any]


class World(BaseModel):
    name: str
    icon: str
    mission: str
    hint: str
    games: list[WorldGame]


class Band(BaseModel):
    min: int
    label: str
    color: Literal["gold", "cyan", "violet"]


class WorldRun(BaseModel):
    total: int
    scores: list[int]
    at: datetime


class Worlds(BaseModel):
    """The six worlds and their games, the score bands, and the child's runs per world
    (`"0"`…`"5"`, oldest first, the last 10)."""

    worlds: list[World]
    bands: list[Band]
    runs: dict[str, list[WorldRun]]


Score = Annotated[int, Field(ge=0, le=100)]


class RunIn(BaseModel):
    model_config = _Strict
    scores: Annotated[
        list[Score],
        Field(min_length=worlds.GAMES_PER_WORLD, max_length=worlds.GAMES_PER_WORLD),
    ]


WorldIndex = Annotated[int, Path(ge=0, le=worlds.WORLD_COUNT - 1, description="The world, 0 to 5")]


def _runs_selector(child: Mapping[str, Any]) -> dict[str, Any]:
    return {"_id": child["_id"], "location": child["location"], "user_id": child["user_id"]}


async def _worlds_view(runtime: Runtime, child: Mapping[str, Any]) -> Worlds:
    doc = await runtime.db[worlds.WORLD_RUNS].find_one(_runs_selector(child)) or {}
    return Worlds(
        worlds=[World(**w) for w in worlds.WORLDS],
        bands=[Band(**b) for b in worlds.BANDS],
        runs={k: [WorldRun(**r) for r in v] for k, v in doc.get("runs", {}).items()},
    )


@router.get(
    "/worlds",
    dependencies=[Depends(per_user("60/minute"))],
    description="Child view's six worlds with their games, the score bands, and the child's "
    "last runs per world. Parents only (the parent's Growth page reads it too).",
)
async def get_worlds(id: ChildId, runtime: Ready, caller: SignedIn) -> Worlds:
    child = await _child_view_child(runtime, caller, id)
    return await _worlds_view(runtime, child)


@router.post(
    "/worlds/{world}/runs",
    dependencies=[Depends(per_user("60/minute"))],
    description="A finished world: its three games' scores (0 to 100). The world keeps its "
    "last 10 runs, and publishes `grow.world_played` in the same transaction (children marks "
    "Grow done in child view from it). Parents only.",
)
async def add_world_run(
    id: ChildId, world: WorldIndex, body: RunIn, runtime: Ready, caller: SignedIn
) -> Worlds:
    child = await _child_view_child(runtime, caller, id)
    db = runtime.db
    selector = _runs_selector(child)
    now = _now()
    run = {"total": worlds.total(body.scores), "scores": body.scores, "at": now}

    async def write(session: AsyncClientSession) -> None:
        # Not for a child or account being deleted: their tombstones, behind their guards,
        # so a deletion in flight and this write conflict and one runs again.
        stones = [tombstone_key("user", child["user_id"]), tombstone_key("child", id)]
        await write_guards(db, stones, location=child["location"], session=session)
        if await is_tombstoned(db, stones, session, location=child["location"]):
            raise not_found()
        await db[worlds.WORLD_RUNS].update_one(
            selector,
            {"$setOnInsert": worlds.empty(id, child["user_id"], child["location"], now)},
            upsert=True,
            session=session,
        )
        played = await db[worlds.WORLD_RUNS].find_one_and_update(
            selector,
            {
                "$push": {f"runs.{world}": {"$each": [run], "$slice": -worlds.RUNS_KEPT}},
                "$set": {"updated_at": now},
                "$inc": {"version": 1},
            },
            return_document=ReturnDocument.AFTER,
            session=session,
        )
        if played is None:  # made just above, in this transaction
            raise RuntimeError("the world runs document is missing")
        # In the same transaction: children marks Grow done in child view from it, so the
        # run and the child's progress can't disagree (the app sends nothing else).
        await add_to_outbox(
            db,
            Event.new(
                "grow.world_played",
                producer=SERVICE,
                aggregate_id=id,
                location=child["location"],
                version=played["version"],
                region=runtime.settings.aws_region,
                payload={"world": world},
                traceparent=current_traceparent(),
            ),
            session,
        )

    await _transaction(runtime, write)
    return await _worlds_view(runtime, child)


app.include_router(health_router)
app.include_router(router)


# ── internal routes (port 8001) ────────────────────────────────────────────────

internal_router = PolicyRouter(prefix="/internal")
InternalLocation = Annotated[str, Query(pattern=LOCATION_PATTERN)]


@internal_router.get(
    "/ping",
    tags=["internal"],
    dependencies=[Depends(public())],
    description="Reachability check for internal callers (port 8001, inside the VPC only).",
)
def ping() -> dict[str, str]:
    return {"status": "ok", "service": SERVICE}


@internal_router.get(
    "/grow/children/{id}/status",
    tags=["internal"],
    description="Whether any growth area is completed: transform's confirm-before-deny (12.4).",
)
async def internal_status(
    id: str,
    location: InternalLocation,
    runtime: Ready,
    _caller: Annotated[str, Depends(allow_callers(*STATUS_CALLERS))],
) -> Completed:
    found = await runtime.db[GROWTH_AREAS].find_one(
        {"location": location, "child_id": id, "status": "completed"}, {"_id": 1}
    )
    return Completed(completed=found is not None)


@internal_router.get(
    "/grow/children/{id}/areas",
    tags=["internal"],
    description="The completed areas in growth_inputs' shape, each with its version, for a "
    "circle's read-through (7.5); an empty list until one is completed. The caller checks "
    "`user_id`.",
)
async def internal_areas(
    id: str,
    location: InternalLocation,
    runtime: Ready,
    _caller: Annotated[str, Depends(allow_callers(*AREAS_CALLERS))],
) -> AreaCopies:
    docs = (
        await runtime.db[GROWTH_AREAS]
        .find({"location": location, "child_id": id, "status": "completed"})
        .sort("created_at", ASCENDING)
        .to_list(None)
    )
    copies = []
    for doc in docs:
        payload = generation.area_payload(doc)
        copies.append(
            AreaCopy(
                child_id=doc["child_id"],
                location=doc["location"],
                version=doc["version"],
                **payload,
            )
        )
    return AreaCopies(areas=copies)


internal_app.include_router(internal_router)
