"""The discover service's two apps, run by `python -m common.serve discover`.

`app` is public (port 8000, ALB rule 20: `/api/v1/children/*/personality*`); `internal_app`
is internal (port 8001, Cloud Map only). Each endpoint is in docs/auth-users-split-api.md:

- `GET /api/v1/children/{id}/personality`: the status and the server-built `view_model`;
- `POST …/personality/generation` (a retry after `failed`, or the page opening before the
  automatic start) and `GET …/personality/generation/{job_id}`;
- `POST …/personality/viewed`: the reveal passed, which makes Discover done;
- `GET /internal/discover/children/{id}/status` (grow's confirm-before-deny) and
  `…/summary` (grow's and transform's read-through of `personality_inputs`).

**Access** follows the circle rules (discover.app.access): the child's parent, or an admin
with `children:read:any` reading with the owner's `?location=` (audited); unlocked once the
conversation is completed. The HTTP runtime also publishes the job metrics from one leader
per region (discover.app.generation.report_jobs).
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
from pydantic import BaseModel
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.errors import PyMongoError

from common.audit import route_template
from common.authz import Caller, current_caller, signed_in
from common.events import Event, add_to_outbox
from common.generation.jobs import JobRefused
from common.internal_client import allow_callers
from common.metrics import MetricsPublisher
from common.models import CHILD_ID_PATTERN, JOBS
from common.routers import PolicyRouter, public
from common.telemetry import current_traceparent
from discover.app import generation
from discover.app.access import answers_for, child_for, error, not_found, require_unlocked
from discover.app.personality import summary
from discover.app.runtime import SERVICE, Runtime
from discover.app.store import KIND, PERSONALITIES

LOCATION_PATTERN = r"^[a-z0-9_-]{1,16}$"
READ_ANY = "children:read:any"
# Confirm-before-deny for grow (12.4); the circles that copy the summary (7.5).
STATUS_CALLERS = ("grow",)
SUMMARY_CALLERS = ("grow", "transform")

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
    description="Discover: each child's AI personality, generated and built on the server.",
    contact={"name": "Superpower Engineering", "email": "prince.kumar@pearson.com"},
    servers=[{"url": "/", "description": "Current environment"}],
    openapi_tags=[
        {"name": "health", "description": "Service health"},
        {"name": "personality", "description": "The child's personality"},
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
        raise HTTPException(status_code=503, detail="discover isn't configured")
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


async def _personality(runtime: Runtime, child: Mapping[str, Any]) -> dict[str, Any] | None:
    return await runtime.db[PERSONALITIES].find_one(
        {"_id": child["_id"], "location": child["location"], "user_id": child["user_id"]}
    )


# ── models ─────────────────────────────────────────────────────────────────────


class Personality(BaseModel):
    status: Literal["not_started", "generating", "ready", "failed"]
    view_model: dict[str, Any] | None
    job_id: str | None
    finalised_at: datetime | None
    viewed_at: datetime | None


class Started(BaseModel):
    job_id: str
    status: str


class Job(BaseModel):
    job_id: str
    kind: Literal["personality"]
    status: Literal["pending", "processing", "completed", "failed"]
    error: str | None
    created_at: datetime
    completed_at: datetime | None


class Completed(BaseModel):
    completed: bool


class Summary(BaseModel):
    """What a circle copies into personality_inputs (4.1)."""

    child_id: str
    user_id: str
    location: str
    traits: dict[str, Any]
    strengths: list[str]
    version: int


def _view(doc: Mapping[str, Any] | None) -> Personality:
    if doc is None:
        return Personality(
            status="not_started", view_model=None, job_id=None, finalised_at=None, viewed_at=None
        )
    status = doc["status"]
    return Personality(
        status=status,
        view_model=doc.get("view_model") if status == "ready" else None,
        job_id=doc.get("active_job_id") if status == "generating" else None,
        finalised_at=doc.get("finalised_at"),
        viewed_at=doc.get("viewed_at"),
    )


# ── public routes ──────────────────────────────────────────────────────────────

health_router = PolicyRouter()
router = PolicyRouter(prefix="/api/v1/children/{id}/personality", tags=["personality"])


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
    description="The personality's status and, once `ready`, the `view_model` the Discover "
    "pages render. An admin with `children:read:any` passes the owner's `?location=` "
    "(audited).",
)
async def get_personality(
    request: Request, id: ChildId, runtime: Ready, caller: SignedIn, location: LocationQuery = None
) -> Personality:
    if caller.has(READ_ANY):
        child = await _admin_child(request, runtime, caller, id, location)
    else:
        child = await _parents_child(runtime, caller, id)
    return _view(await _personality(runtime, child))


@router.post(
    "/generation",
    status_code=202,
    dependencies=[Depends(per_user("10/minute"))],
    responses={200: {"model": Started, "description": "The job already running"}},
    description="Start the personality when there's none (the retry after `failed`, or the "
    "page opening before the automatic start). The running job is returned with `200`; "
    "a `ready` personality is `409 already_generated`. Counts against the hourly LLM "
    "limit (`429 llm_limit`).",
)
async def start_generation(
    id: ChildId, response: Response, runtime: Ready, caller: SignedIn
) -> Started:
    child = await _parents_child(runtime, caller, id)
    personality = await _personality(runtime, child)
    if personality is not None and personality["status"] == "ready":
        raise error(409, "already_generated", "The personality is already generated.")
    running = await generation.running_job(runtime, personality)
    if running is None:
        answers = await answers_for(runtime, child)
        if not await runtime.llm_limit.take(caller.user_id):
            raise HTTPException(
                status_code=429,
                detail={"code": "llm_limit", "msg": "Too many generations this hour."},
                headers={"Retry-After": str(runtime.llm_limit.window)},
            )
        try:
            running, created = await generation.start(
                runtime,
                child_id=id,
                user_id=child["user_id"],
                location=child["location"],
                input_version=int(answers["version"]),
            )
        except generation.AlreadyGenerated:
            await runtime.llm_limit.give_back(caller.user_id)
            raise error(409, "already_generated", "The personality is already generated.") from None
        except JobRefused:
            raise not_found() from None
        except PyMongoError as exc:
            _logger.exception("discover: the job couldn't be stored")
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
    description="A personality job's status, while the page shows generating. When "
    "`completed`, reload the personality.",
)
async def get_job(id: ChildId, job_id: str, runtime: Ready, caller: SignedIn) -> Job:
    child = await _parents_child(runtime, caller, id)
    job = await runtime.db[JOBS].find_one(
        {
            "_id": job_id,
            "location": child["location"],
            "child_id": id,
            "user_id": child["user_id"],
        }
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


@router.post(
    "/viewed",
    dependencies=[Depends(per_user("30/minute"))],
    description="The parent has passed the reveal splash: Discover is done (publishes "
    "`discover.completed` the first time). `409 personality_not_ready` until it's `ready`.",
)
async def mark_viewed(id: ChildId, runtime: Ready, caller: SignedIn) -> Personality:
    child = await _parents_child(runtime, caller, id)
    selector = {"_id": id, "location": child["location"], "user_id": child["user_id"]}
    result: dict[str, Any] = {}

    async def write(session: AsyncClientSession) -> None:
        updated = await runtime.db[PERSONALITIES].find_one_and_update(
            {**selector, "status": "ready", "viewed_at": None},
            {"$set": {"viewed_at": datetime.now(UTC)}, "$inc": {"version": 1}},
            return_document=ReturnDocument.AFTER,
            session=session,
        )
        if updated is None:
            return
        event = Event.new(
            "discover.completed",
            producer=SERVICE,
            aggregate_id=id,
            location=child["location"],
            version=updated["version"],
            region=runtime.settings.aws_region,
            traceparent=current_traceparent(),
        )
        await add_to_outbox(runtime.db, event, session)
        result["doc"] = updated

    async with runtime.client.start_session() as session:
        await session.with_transaction(write)
    doc = result.get("doc") or await runtime.db[PERSONALITIES].find_one(selector)
    if doc is None or doc["status"] != "ready":
        raise error(409, "personality_not_ready", "The personality isn't ready yet.")
    return _view(doc)


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
    "/discover/children/{id}/status",
    tags=["internal"],
    description="Whether Discover is done (the personality ready and the reveal passed): "
    "grow's confirm-before-deny (12.4).",
)
async def internal_status(
    id: str,
    location: InternalLocation,
    runtime: Ready,
    _caller: Annotated[str, Depends(allow_callers(*STATUS_CALLERS))],
) -> Completed:
    found = await runtime.db[PERSONALITIES].find_one(
        {"_id": id, "location": location, "status": "ready", "viewed_at": {"$ne": None}},
        {"_id": 1},
    )
    return Completed(completed=found is not None)


@internal_router.get(
    "/discover/children/{id}/summary",
    tags=["internal"],
    description="The personality's trait summary and strengths in personality_inputs' shape, "
    "for a circle's read-through (7.5); `404` until it's finalised. The caller checks "
    "`user_id`.",
)
async def internal_summary(
    id: str,
    location: InternalLocation,
    runtime: Ready,
    _caller: Annotated[str, Depends(allow_callers(*SUMMARY_CALLERS))],
) -> Summary:
    doc = await runtime.db[PERSONALITIES].find_one(
        {"_id": id, "location": location, "status": "ready"}
    )
    if doc is None:
        raise HTTPException(status_code=404, detail="Not Found")
    payload = summary(doc["view_model"])
    return Summary(
        child_id=doc["_id"],
        user_id=doc["user_id"],
        location=doc["location"],
        traits=payload["traits"],
        strengths=payload["strengths"],
        version=doc["version"],
    )


internal_app.include_router(internal_router)
