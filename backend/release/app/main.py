"""The release service's two apps, run by `python -m common.serve release`.

`app` is public (port 8000, ALB rule 50: `/api/v1/children/*/observations*`); `internal_app`
is internal (port 8001, Cloud Map only). Each endpoint is in docs/auth-users-split-api.md:

- `GET /api/v1/children/{id}/observations`: the patterns and what the parent watches;
- `PATCH …/observations`: "Start tracking" (`watching`, `span`);
- `POST …/observations/generation` and `GET …/generation/{job_id}`;
- `GET /internal/release/children/{id}/status`: the Connect visit's confirm-before-deny.

**Access** follows the circle rules (release.app.access): the child's parent, or an admin
with `children:read:any` reading with the owner's `?location=` (audited); unlocked once
Transform is done. **Completion:** the first time `watching` is non-empty, `completed_at` is
set and `release.completed` published in the same transaction. The HTTP runtime also
publishes the job metrics from one leader per region.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from fastapi import Depends, FastAPI, HTTPException, Path, Query, Request, Response
from limits import parse
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.errors import DuplicateKeyError, PyMongoError

from common.audit import route_template
from common.authz import Caller, current_caller, signed_in
from common.events import Event, add_to_outbox, is_tombstoned, tombstone_key
from common.generation.jobs import JobRefused
from common.internal_client import allow_callers
from common.metrics import MetricsPublisher
from common.models import CHILD_ID_PATTERN, GROWTH_INPUTS, JOBS
from common.routers import PolicyRouter, public
from common.telemetry import current_traceparent
from release.app import generation
from release.app.access import (
    answers_for,
    areas_for,
    child_for,
    error,
    not_found,
    require_unlocked,
)
from release.app.runtime import SERVICE, Runtime
from release.app.store import (
    KIND,
    OBSERVATIONS,
    PATTERN_ID_MAX,
    SCHEMA_VERSION_DEFAULT,
    SPAN_MAX,
    WATCHING_MAX,
)

LOCATION_PATTERN = r"^[a-z0-9_-]{1,16}$"
READ_ANY = "children:read:any"
# The Connect visit, served by children until a connect service exists (12.4).
STATUS_CALLERS = ("children",)
SAVE_ATTEMPTS = 3

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


# The same contact and servers as today's app (app/main.py), for the published spec.
app = FastAPI(
    title=SERVICE,
    description="Release: each child's observation patterns and what the parent watches.",
    contact={"name": "Superpower Engineering", "email": "prince.kumar@pearson.com"},
    servers=[{"url": "/", "description": "Current environment"}],
    openapi_tags=[
        {"name": "health", "description": "Service health"},
        {"name": "observations", "description": "The child's observation patterns"},
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
        raise HTTPException(status_code=503, detail="release isn't configured")
    return runtime


Ready = Annotated[Runtime, Depends(runtime_ready)]
SignedIn = Annotated[Caller, Depends(signed_in())]


def per_user(limit: str) -> Callable[..., Awaitable[None]]:
    item = parse(limit)

    async def dependency(
        request: Request, runtime: Ready, caller: Annotated[Caller, Depends(current_caller)]
    ) -> None:
        if not runtime.limits.hit(
            item, route_template(request), request.method, f"user:{caller.user_id}"
        ):
            raise HTTPException(
                status_code=429,
                detail="Too many requests",
                headers={"Retry-After": str(item.get_expiry())},
            )

    return dependency


ChildId = Annotated[str, Path(pattern=CHILD_ID_PATTERN, description="The child's id")]
LocationQuery = Annotated[
    str | None,
    Query(pattern=LOCATION_PATTERN, description="The owner's location (admins only)"),
]


async def _parents_child(runtime: Runtime, caller: Caller, child_id: str) -> dict[str, Any]:
    """The caller's own child, unlocked (the circle rules for a write)."""
    child = await child_for(runtime, child_id, location=caller.location, owner=caller.user_id)
    await require_unlocked(runtime, child)
    return child


def _selector(child: Mapping[str, Any]) -> dict[str, Any]:
    return {"_id": child["_id"], "location": child["location"], "user_id": child["user_id"]}


def _now() -> datetime:
    """To the millisecond, as MongoDB keeps it: a response shows what a later GET will."""
    moment = datetime.now(UTC)
    return moment.replace(microsecond=moment.microsecond // 1000 * 1000)


# ── models ─────────────────────────────────────────────────────────────────────

PatternId = Annotated[str, StringConstraints(min_length=1, max_length=PATTERN_ID_MAX)]


class Watching(BaseModel):
    """ "Start tracking": the patterns watched (ids from `items`) and for how long."""

    model_config = ConfigDict(extra="forbid", strict=True)

    watching: Annotated[list[PatternId], Field(max_length=WATCHING_MAX)]
    span: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=SPAN_MAX)
    ]


class ObservationItem(BaseModel):
    id: str
    title: str
    summary: str
    notes: list[str]
    icon: str
    sources: list[str]


class Observations(BaseModel):
    status: Literal["not_started", "generating", "ready", "failed"]
    source: str | None
    items: list[ObservationItem]
    watching: list[str]
    span: str | None
    started_at: datetime | None
    job_id: str | None
    completed_at: datetime | None


class Started(BaseModel):
    job_id: str
    status: str


class Job(BaseModel):
    job_id: str
    kind: Literal["observations"]
    status: str
    error: str | None
    created_at: datetime
    completed_at: datetime | None


class Completed(BaseModel):
    completed: bool


def _view(doc: Mapping[str, Any] | None) -> Observations:
    doc = doc or {}
    status = doc.get("status", "not_started")
    return Observations(
        status=status,
        source=doc.get("source"),
        items=[ObservationItem(**item) for item in doc.get("items") or []],
        watching=doc.get("watching") or [],
        span=doc.get("span"),
        started_at=doc.get("started_at"),
        job_id=doc.get("active_job_id") if status == "generating" else None,
        completed_at=doc.get("completed_at"),
    )


class _Stale(Exception):
    """The observations changed after they were read."""


# ── public routes ──────────────────────────────────────────────────────────────

health_router = PolicyRouter()
router = PolicyRouter(prefix="/api/v1/children/{id}/observations", tags=["observations"])


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
    description="The child's observation patterns (at most six, validated by the server) "
    "and what the parent watches. An admin with `children:read:any` passes the owner's "
    "`?location=` (audited).",
)
async def get_observations(
    request: Request, id: ChildId, runtime: Ready, caller: SignedIn, location: LocationQuery = None
) -> Observations:
    if caller.has(READ_ANY):
        child = await _admin_child(request, runtime, caller, id, location)
    else:
        child = await _parents_child(runtime, caller, id)
    return _view(await runtime.db[OBSERVATIONS].find_one(_selector(child)))


@router.patch(
    "",
    dependencies=[Depends(per_user("20/minute"))],
    description='"Start tracking": the patterns watched (ids of the current items: '
    "`422 unknown_pattern`) and the span; `started_at` is set now. The first time "
    "something is watched, Release is done (`release.completed`).",
)
async def watch(id: ChildId, body: Watching, runtime: Ready, caller: SignedIn) -> Observations:
    child = await _parents_child(runtime, caller, id)
    selector = _selector(child)
    store = runtime.db[OBSERVATIONS]
    watching = list(dict.fromkeys(body.watching))
    result: dict[str, Any] = {}

    for _ in range(SAVE_ATTEMPTS):
        existing = await store.find_one(selector)

        async def write(session: AsyncClientSession, existing: Any = existing) -> None:
            tombstones = [tombstone_key("child", id), tombstone_key("user", child["user_id"])]
            if await is_tombstoned(runtime.db, tombstones, session=session):
                raise not_found()  # deleted meanwhile: nothing may come back
            known = {item["id"] for item in (existing or {}).get("items") or []}
            if set(watching) - known:
                raise error(422, "unknown_pattern", "Watch only the patterns shown.")
            now = _now()
            changes: dict[str, Any] = {"watching": watching, "span": body.span, "started_at": now}
            completing = bool(watching) and not (existing or {}).get("completed_at")
            if completing:
                changes["completed_at"] = now
            doc: dict[str, Any] | None
            if existing is None:  # nothing to watch yet: the empty list is all that fits
                doc = {
                    **selector, "child_id": id, "status": "not_started", **changes,
                    "version": 1, "created_at": now, "updated_at": now,
                    "schema_version": SCHEMA_VERSION_DEFAULT,
                }  # fmt: skip
                await store.insert_one(doc, session=session)
                result["doc"] = doc
                return  # nothing watched: nothing completes
            doc = await store.find_one_and_update(
                {**selector, "version": existing["version"]},
                {"$set": {**changes, "updated_at": now}, "$inc": {"version": 1}},
                return_document=ReturnDocument.AFTER,
                session=session,
            )
            if doc is None:
                raise _Stale()
            if completing:
                event = Event.new(
                    "release.completed",
                    producer=SERVICE,
                    aggregate_id=id,
                    location=child["location"],
                    version=doc["version"],
                    region=runtime.settings.aws_region,
                    traceparent=current_traceparent(),
                )
                await add_to_outbox(runtime.db, event, session)
            result["doc"] = doc

        try:
            async with runtime.client.start_session() as session:
                await session.with_transaction(write)
            break
        except (_Stale, DuplicateKeyError):
            continue  # another save won the race: decide again against it
    else:
        raise error(409, "observations_changed", "The patterns changed meanwhile; try again.")
    return _view(result["doc"])


@router.post(
    "/generation",
    status_code=202,
    dependencies=[Depends(per_user("10/minute"))],
    responses={200: {"model": Started, "description": "The job already running"}},
    description="Generate the observation patterns from what the parent and child told us; "
    "a new set replaces the last one and clears `watching`. The running job is returned "
    "with `200`. Counts against the hourly LLM limit (`429 llm_limit`).",
)
async def start_generation(
    id: ChildId, response: Response, runtime: Ready, caller: SignedIn
) -> Started:
    child = await _parents_child(runtime, caller, id)
    doc = await runtime.db[OBSERVATIONS].find_one(_selector(child))
    running = await generation.running_job(runtime, doc)
    if running is None:
        await answers_for(runtime, child)
        if not await runtime.db[GROWTH_INPUTS].find_one(
            {"location": child["location"], "child_id": id}
        ):
            await areas_for(runtime, child)  # the copies may be behind: ask grow once
        found = await generation.evidence_for(runtime, id, child["location"])
        if not found.blocks:
            raise error(409, "needs_evidence", "There's nothing to read back yet.")
        if not await runtime.llm_limit.take(caller.user_id):
            raise HTTPException(
                status_code=429,
                detail={"code": "llm_limit", "msg": "Too many generations this hour."},
                headers={"Retry-After": str(runtime.llm_limit.window)},
            )
        try:
            running, created = await generation.start(
                runtime, child=child, input_version=int((doc or {}).get("version", 1))
            )
        except JobRefused:
            raise not_found() from None
        except PyMongoError as exc:
            _logger.exception("release: the job couldn't be stored")
            raise error(503, "generation_unavailable", "Try again in a moment.") from exc
        if created:
            return Started(job_id=running, status="pending")
        await runtime.llm_limit.give_back(caller.user_id)  # a running job: no new call
    job = await runtime.db[JOBS].find_one({"_id": running}, {"status": 1})
    response.status_code = 200
    return Started(job_id=running, status=job["status"] if job else "pending")


@router.get(
    "/generation/{job_id}",
    dependencies=[Depends(per_user("60/minute"))],
    description="A release job's status. When `completed`, reload the observations.",
)
async def get_job(id: ChildId, job_id: str, runtime: Ready, caller: SignedIn) -> Job:
    child = await _parents_child(runtime, caller, id)
    job = await runtime.db[JOBS].find_one(
        {"_id": job_id, "location": child["location"], "child_id": id, "user_id": child["user_id"]}
    )
    if job is None:
        raise error(404, "job_not_found", "No such job.")
    return Job(
        job_id=job["_id"],
        kind=KIND,
        status=job["status"],
        error=job.get("error"),
        created_at=job["created_at"],
        completed_at=job.get("completed_at"),
    )


app.include_router(health_router)
app.include_router(router)


# ── internal routes (port 8001) ────────────────────────────────────────────────

internal_router = PolicyRouter(prefix="/internal")


@internal_router.get(
    "/ping",
    tags=["internal"],
    dependencies=[Depends(public())],
    description="Reachability check for internal callers (port 8001, inside the VPC only).",
)
def ping() -> dict[str, str]:
    return {"status": "ok", "service": SERVICE}


@internal_router.get(
    "/release/children/{id}/status",
    tags=["internal"],
    description="Whether Release is done (a pattern watched): the Connect visit's "
    "confirm-before-deny (12.4).",
)
async def internal_status(
    id: str,
    location: Annotated[str, Query(pattern=LOCATION_PATTERN)],
    runtime: Ready,
    _caller: Annotated[str, Depends(allow_callers(*STATUS_CALLERS))],
) -> Completed:
    found = await runtime.db[OBSERVATIONS].find_one(
        {"_id": id, "location": location, "completed_at": {"$exists": True}}, {"_id": 1}
    )
    return Completed(completed=found is not None)


internal_app.include_router(internal_router)
