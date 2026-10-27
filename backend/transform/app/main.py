"""The transform service's two apps, run by `python -m common.serve transform`.

`app` is public (port 8000, ALB rule 40: `/api/v1/children/*/transform*`); `internal_app` is
internal (port 8001, Cloud Map only). Each endpoint is in docs/auth-users-split-api.md:

- `GET /api/v1/children/{id}/transform`: the Life Pathway (milestones per completed growth
  area) and the 90-day plan with its tracker, in one read plus the copy;
- `PATCH …/transform`: the parent's work on the plan, including the Day-90 event and photos;
- `POST …/transform/generation` (`kind`: `life_pathway`, `plan`, `event_tracker`) and
  `GET …/generation/{job_id}`; `POST …/transform/photos/presign`;
- `GET /internal/transform/children/{id}/status`: release's confirm-before-deny.

**Access** follows the circle rules (transform.app.access): the child's parent, or an admin
with `children:read:any` reading with the owner's `?location=` (audited); unlocked once a
growth area is completed. **Completion:** once the plan exists and the Day-90 event is set,
whichever comes last, `completed_at` is set and `transform.completed` published in the same
transaction. The HTTP runtime also publishes the job metrics from one leader per region.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime
from typing import Annotated, Any, Final

import bson
from fastapi import Depends, FastAPI, HTTPException, Path, Query, Request, Response
from limits import parse
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator
from pymongo import ASCENDING
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.errors import DuplicateKeyError, PyMongoError

from common import upload_tracking
from common.audit import route_template
from common.authz import Caller, current_caller, signed_in
from common.events import is_tombstoned, tombstone_key
from common.generation.jobs import JobRefused
from common.internal_client import allow_callers
from common.metrics import MetricsPublisher
from common.models import CHILD_ID_PATTERN, GROWTH_INPUTS, JOBS, growth_inputs_id
from common.routers import PolicyRouter, public
from common.uploads import UploadError
from transform.app import generation
from transform.app.access import (
    areas_for,
    child_for,
    error,
    not_found,
    personality_for,
    require_unlocked,
)
from transform.app.runtime import SERVICE, Runtime
from transform.app.store import (
    ASK_MAX,
    EVENT_NAME_MAX,
    KINDS,
    MAP_KEY_PATTERN,
    MAX_BYTES,
    PLANS,
    Kind,
    lock_name,
    new_plan,
)

LOCATION_PATTERN = r"^[a-z0-9_-]{1,16}$"
READ_ANY = "children:read:any"
STATUS_CALLERS = ("release",)  # confirm-before-deny (12.4)
SAVE_ATTEMPTS = 3
PHOTO_KIND: Final = "ninety-day-plan"
PLAN_KINDS: tuple[Kind, ...] = ("plan", "event_tracker")

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
    description="Transform: each child's Life Pathway and 90-day plan with its tracker.",
    contact={"name": "Superpower Engineering", "email": "prince.kumar@pearson.com"},
    servers=[{"url": "/", "description": "Current environment"}],
    openapi_tags=[
        {"name": "health", "description": "Service health"},
        {"name": "transform", "description": "The Life Pathway and the 90-day plan"},
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
        raise HTTPException(status_code=503, detail="transform isn't configured")
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

MapKey = Annotated[str, StringConstraints(pattern=MAP_KEY_PATTERN)]
_Strict = ConfigDict(extra="forbid", strict=True)


class PlanPatch(BaseModel):
    """The parent's part of the plan; each field sent replaces the stored one. `plan`,
    `track_steps` and the Life Pathway are transform's jobs' only (422)."""

    model_config = _Strict

    ask: Annotated[str, StringConstraints(max_length=ASK_MAX)] | None = None
    applied: dict[MapKey, bool] | None = None
    act_inputs: dict[MapKey, str] | None = None
    act_counts: dict[MapKey, int] | None = None
    track_done: dict[MapKey, bool] | None = None
    track_inputs: dict[MapKey, str] | None = None
    track_sittings: dict[MapKey, bool] | None = None
    feedback: dict[MapKey, dict[str, Any]] | None = None
    event_name: Annotated[str, StringConstraints(max_length=EVENT_NAME_MAX)] | None = None
    event_date: Annotated[date | None, Field(strict=False)] = None
    event_set: bool | None = None
    photos: dict[MapKey, list[str]] | None = None
    clear_track_steps: bool = False

    @model_validator(mode="after")
    def _small(self) -> PlanPatch:
        if len(self.model_dump_json(exclude_unset=True)) > MAX_BYTES:
            raise ValueError("the body is over 64 KB")
        return self


class Photo(BaseModel):
    key: str
    url: str | None


class AreaView(BaseModel):
    area_id: str
    area_name: str
    life_pathway_milestones: dict[str, Any] | None
    life_pathway_generating: bool


class Transform(BaseModel):
    areas: list[AreaView]
    ask: str | None
    plan: dict[str, Any] | None
    track_steps: dict[str, Any] | None
    applied: dict[str, bool]
    act_inputs: dict[str, str]
    act_counts: dict[str, int]
    track_done: dict[str, bool]
    track_inputs: dict[str, str]
    track_sittings: dict[str, bool]
    feedback: dict[str, Any]
    event_name: str | None
    event_date: date | None
    event_set: bool
    photos: dict[str, list[Photo]]
    generating: list[Kind]
    completed_at: datetime | None


class GenerationIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Kind
    area_id: Annotated[str, StringConstraints(pattern=r"^[a-z0-9_-]{1,50}$")] | None = None


class Started(BaseModel):
    job_id: str
    status: str


class Job(BaseModel):
    job_id: str
    kind: Kind
    status: str
    error: str | None
    created_at: datetime
    completed_at: datetime | None


class PresignIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field_key: MapKey
    content_type: Annotated[str, StringConstraints(max_length=100)]


class PresignOut(BaseModel):
    upload_url: str
    photo_key: str
    photo_url: str


class Completed(BaseModel):
    completed: bool


async def _view(
    runtime: Runtime, child: Mapping[str, Any], doc: Mapping[str, Any] | None
) -> Transform:
    doc = doc or {}
    areas = (
        await runtime.db[GROWTH_INPUTS]
        .find(
            {"location": child["location"], "child_id": child["_id"], "user_id": child["user_id"]}
        )
        .sort("updated_at", ASCENDING)
        .to_list(None)
    )
    running = doc.get("active_jobs") or {}
    pathway = doc.get("life_pathway") or {}
    photos: dict[str, list[Photo]] = {}
    for field_key, keys in (doc.get("photos") or {}).items():
        photos[field_key] = [
            Photo(key=key, url=await runtime.uploads.presign_get(key) if runtime.uploads else None)
            for key in keys
        ]
    event_date = doc.get("event_date")
    return Transform(
        areas=[
            AreaView(
                area_id=area["area_id"],
                area_name=area["area_name"],
                life_pathway_milestones=pathway.get(area["area_id"]),
                life_pathway_generating=bool(
                    running.get(lock_name("life_pathway", area["area_id"]))
                ),
            )
            for area in areas
        ],
        ask=doc.get("ask"),
        plan=doc.get("plan"),
        track_steps=doc.get("track_steps"),
        applied=doc.get("applied") or {},
        act_inputs=doc.get("act_inputs") or {},
        act_counts=doc.get("act_counts") or {},
        track_done=doc.get("track_done") or {},
        track_inputs=doc.get("track_inputs") or {},
        track_sittings=doc.get("track_sittings") or {},
        feedback=doc.get("feedback") or {},
        event_name=doc.get("event_name"),
        event_date=event_date.date() if isinstance(event_date, datetime) else None,
        event_set=bool(doc.get("event_set")),
        photos=photos,
        generating=[kind for kind in PLAN_KINDS if running.get(lock_name(kind))],
        completed_at=doc.get("completed_at"),
    )


class _Stale(Exception):
    """The plan changed after it was read."""


# ── public routes ──────────────────────────────────────────────────────────────

health_router = PolicyRouter()
router = PolicyRouter(prefix="/api/v1/children/{id}/transform", tags=["transform"])


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
    description="The Life Pathway (each completed growth area with its milestones) and the "
    "90-day plan with its tracker; photos with their keys and short-lived URLs. An admin "
    "with `children:read:any` passes the owner's `?location=` (audited).",
)
async def get_transform(
    request: Request, id: ChildId, runtime: Ready, caller: SignedIn, location: LocationQuery = None
) -> Transform:
    if caller.has(READ_ANY):
        child = await _admin_child(request, runtime, caller, id, location)
    else:
        child = await _parents_child(runtime, caller, id)
    return await _view(runtime, child, await runtime.db[PLANS].find_one(_selector(child)))


async def _accept_photos(
    runtime: Runtime, child: Mapping[str, Any], photos: Mapping[str, list[str]]
) -> None:
    keys = [key for field_keys in photos.values() for key in field_keys]
    if not keys:
        return
    if runtime.uploads is None:
        raise error(503, "uploads_not_configured", "Photo uploads aren't configured.")
    for key in keys:
        try:
            await runtime.uploads.accept(key, child["location"], child["_id"], PHOTO_KIND)
        except UploadError as exc:
            code = {"not_uploaded": "photo_not_uploaded", "too_large": "photo_too_large"}.get(
                exc.code, exc.code
            )
            raise error(422, code, str(exc)) from exc


@router.patch(
    "",
    dependencies=[Depends(per_user("60/minute"))],
    description="Save the parent's work on the 90-day plan; each field sent replaces the "
    "stored one (`photos`: each field key sent replaces that field's keys). Setting the "
    "Day-90 event once the plan exists completes Transform (`transform.completed`).",
)
async def patch_transform(
    id: ChildId, body: PlanPatch, runtime: Ready, caller: SignedIn
) -> Transform:
    child = await _parents_child(runtime, caller, id)
    changes: dict[str, Any] = body.model_dump(exclude_unset=True, exclude={"clear_track_steps"})
    if "event_date" in changes and changes["event_date"] is not None:
        day = changes["event_date"]
        changes["event_date"] = datetime(day.year, day.month, day.day, tzinfo=UTC)
    photos = changes.pop("photos", None) or {}
    await _accept_photos(runtime, child, photos)
    selector = _selector(child)
    plans = runtime.db[PLANS]
    result: dict[str, Any] = {}

    for _ in range(SAVE_ATTEMPTS):
        existing = await plans.find_one(selector)

        async def write(session: AsyncClientSession, existing: Any = existing) -> None:
            tombstones = [tombstone_key("child", id), tombstone_key("user", child["user_id"])]
            if await is_tombstoned(runtime.db, tombstones, session=session):
                raise not_found()  # deleted meanwhile: nothing may come back
            now = _now()
            stored_photos = dict((existing or {}).get("photos") or {})
            update: dict[str, Any] = {**changes, "updated_at": now}
            if photos:
                update["photos"] = {**stored_photos, **photos}
                await upload_tracking.attached(
                    runtime.db,
                    [key for keys in photos.values() for key in keys],
                    location=child["location"],
                    session=session,
                )
            merged = {
                **(existing or new_plan(id, child["user_id"], child["location"], now)),
                **update,
            }
            if body.clear_track_steps:
                merged.pop("track_steps", None)
            if len(bson.encode(merged)) > MAX_BYTES:
                raise error(422, "plan_too_large", "The plan is over 64 KB.")
            if existing is None:
                await plans.insert_one(merged, session=session)
            else:
                operation: dict[str, Any] = {"$set": update, "$inc": {"version": 1}}
                if body.clear_track_steps:
                    operation["$unset"] = {"track_steps": ""}
                if (
                    await plans.find_one_and_update(
                        {**selector, "version": existing["version"]}, operation, session=session
                    )
                    is None
                ):
                    raise _Stale()
            await generation.complete_if_ready(runtime, id, child["location"], session)
            # A key still in any field after the merge stays: a photo moved from one field
            # to another, or kept in two, isn't deleted (review).
            kept = {key for keys in merged.get("photos", {}).values() for key in keys}
            result["removed"] = sorted(
                {key for keys in stored_photos.values() for key in keys} - kept
            )

        try:
            async with runtime.client.start_session() as session:
                await session.with_transaction(write)
            break
        except (_Stale, DuplicateKeyError):
            continue  # another save won the race: decide again against it
    else:
        raise error(409, "plan_changed", "The plan changed meanwhile; try again.")
    for key in result["removed"]:
        # The replaced photos, after the change committed.
        try:
            await runtime.uploads.delete(key)  # type: ignore[union-attr]
        except Exception:
            _logger.warning("transform: an old photo wasn't deleted")
    return await _view(runtime, child, await plans.find_one(selector))


@router.post(
    "/generation",
    status_code=202,
    dependencies=[Depends(per_user("10/minute"))],
    responses={200: {"model": Started, "description": "The job already running"}},
    description="Generate one of Transform's AI parts (`kind`): an area's Life Pathway "
    "milestones (`area_id`, a completed growth area), the 90-day `plan` (needs the parent's "
    "`ask`), or the `event_tracker` (needs the plan and the Day-90 event). The running job "
    "is returned with `200`. Counts against the hourly LLM limit (`429 llm_limit`).",
)
async def start_generation(
    id: ChildId, body: GenerationIn, response: Response, runtime: Ready, caller: SignedIn
) -> Started:
    child = await _parents_child(runtime, caller, id)
    doc = await runtime.db[PLANS].find_one(_selector(child))
    kind, area_id = body.kind, body.area_id
    input_version = int((doc or {}).get("version", 1))
    if kind == "life_pathway":
        if area_id is None:
            raise error(422, "area_id_required", "Name the growth area.")
        area_key = {"_id": growth_inputs_id(id, area_id), "location": child["location"]}
        area = await runtime.db[GROWTH_INPUTS].find_one(area_key)
        if area is None:
            await areas_for(runtime, child)  # the copy may be behind: ask grow once
            area = await runtime.db[GROWTH_INPUTS].find_one(area_key)
        if area is None or area["user_id"] != child["user_id"]:
            raise error(409, "needs_completed_area", "Complete that growth area first.")
        input_version = int(area["version"])
    else:
        area_id = None
        if kind == "plan" and not (doc or {}).get("ask"):
            raise error(409, "needs_ask", "Save what the child is into (`ask`) first.")
        if kind == "event_tracker":
            if not (doc or {}).get("plan"):
                raise error(409, "needs_plan", "Generate the plan first.")
            if not (doc or {}).get("event_set") or not (doc or {}).get("event_date"):
                raise error(409, "needs_event", "Set the Day-90 event first.")
    running = await generation.running_job(runtime, doc, kind, area_id)
    if running is None:
        if kind != "event_tracker":
            await personality_for(runtime, child)
        if not await runtime.llm_limit.take(caller.user_id):
            raise HTTPException(
                status_code=429,
                detail={"code": "llm_limit", "msg": "Too many generations this hour."},
                headers={"Retry-After": str(runtime.llm_limit.window)},
            )
        try:
            running, created = await generation.start(
                runtime, kind=kind, child=child, area_id=area_id, input_version=input_version
            )
        except JobRefused:
            raise not_found() from None
        except PyMongoError as exc:
            _logger.exception("transform: the job couldn't be stored")
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
    description="A transform job's status. When `completed`, reload the transform.",
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
        kind=KINDS[job["type"]],
        status=job["status"],
        error=job.get("error"),
        created_at=job["created_at"],
        completed_at=job.get("completed_at"),
    )


@router.post(
    "/photos/presign",
    dependencies=[Depends(per_user("20/minute"))],
    description="A URL to PUT a plan photo to within 5 minutes; then add `photo_key` to "
    "`photos[field_key]` with PATCH (where the 5 MB limit is checked).",
)
async def presign_photo(
    id: ChildId, body: PresignIn, runtime: Ready, caller: SignedIn
) -> PresignOut:
    child = await _parents_child(runtime, caller, id)
    if runtime.uploads is None:
        raise error(503, "uploads_not_configured", "Photo uploads aren't configured.")
    try:
        key = runtime.uploads.new_key(child["location"], id, PHOTO_KIND, body.content_type)
    except UploadError as exc:
        raise error(415, exc.code, str(exc)) from exc
    try:
        upload_url = await runtime.uploads.presign_put(key, body.content_type)
        photo_url = await runtime.uploads.presign_get(key)
        await upload_tracking.record_presigned(
            runtime.db, key, location=child["location"], child_id=id
        )
    except Exception as exc:
        _logger.exception("transform: presigning failed")
        raise error(502, "upload_url_failed", "Couldn't create an upload URL.") from exc
    return PresignOut(upload_url=upload_url, photo_key=key, photo_url=photo_url)


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
    "/transform/children/{id}/status",
    tags=["internal"],
    description="Whether Transform is done (plan generated and Day-90 event set): release's "
    "confirm-before-deny (12.4).",
)
async def internal_status(
    id: str,
    location: Annotated[str, Query(pattern=LOCATION_PATTERN)],
    runtime: Ready,
    _caller: Annotated[str, Depends(allow_callers(*STATUS_CALLERS))],
) -> Completed:
    found = await runtime.db[PLANS].find_one(
        {"_id": id, "location": location, "completed_at": {"$exists": True}}, {"_id": 1}
    )
    return Completed(completed=found is not None)


internal_app.include_router(internal_router)
