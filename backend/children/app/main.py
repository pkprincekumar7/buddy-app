"""The children service's two apps, run by `python -m common.serve children`.

`app` is public (port 8000, ALB rule 100: `/api/v1/children` and `/api/v1/children/*`
that no circle claims); `internal_app` is internal (port 8001, Cloud Map only). Each
endpoint is in docs/auth-users-split-api.md:

- `GET /api/v1/children` (Home, one query), `POST`, and `GET` / `PATCH` / `DELETE
  /api/v1/children/{id}`; `POST …/{id}/avatar/presign` for a photo;
- `GET /internal/children/{id}`: the circles' read-through for their child_access copy.

**Ownership (12.3):** a parent's queries filter by their own `{location, user_id}`, so
someone else's child is simply not found (`404 child_not_found`). Only parents create or
change children (`403 parents_only` for admins, as today); an admin with
`children:read:any` may read, passing the owner's `?location=` (and `?user_id=` for the
list), and each such read is audited.

**Events:** every write that changes what the circles copy (name, age, gender, progress,
deletion) publishes **one** `child.changed` with the full snapshot, in the same
transaction (7.4).
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from fastapi import Depends, FastAPI, HTTPException, Path, Query, Request, Response
from limits import parse
from pydantic import BaseModel, ConfigDict, Field, model_validator
from pymongo import ASCENDING, DESCENDING, ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from children.app.runtime import SERVICE, Runtime
from children.app.store import (
    AGE_MAX,
    AGE_MIN,
    AVATAR_ID_MAX,
    CHILDREN,
    GENDER_MAX,
    MAX_CHILDREN,
    NAME_MAX,
    SCHOOL_MAX,
    SNAPSHOT_FIELDS,
    new_child,
    profile_complete,
    snapshot,
)
from common.audit import route_template
from common.authz import Caller, current_caller, signed_in
from common.events import Event, add_to_outbox
from common.internal_client import allow_callers
from common.models import PROGRESS_FLAGS
from common.routers import PolicyRouter, public
from common.telemetry import current_traceparent
from common.uploads import UploadError

LOCATION_PATTERN = r"^[a-z0-9_-]{1,16}$"
UUID_PATTERN = r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
READ_ANY = "children:read:any"
# Every circle reads children through (7.5); connect joins when it's built.
INTERNAL_CALLERS = ("onboarding", "discover", "grow", "transform", "release")

_logger = logging.getLogger(__name__)
_runtime: Runtime | None = None
_users = 0


def configure(runtime: Runtime | None) -> None:
    """Attach (or detach) the runtime's resources to both apps."""
    global _runtime
    _runtime = runtime
    app.state.runtime = runtime
    internal_app.state.runtime = runtime
    if runtime is not None:
        app.state.authorizer = runtime.authorizer
        internal_app.state.service_tokens = runtime.verifier


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Both apps share one Runtime per process; the last one to stop closes it."""
    global _users
    import os

    if _runtime is None and os.environ.get("MONGODB_URI"):
        runtime = Runtime.from_env()
        await runtime.prepare()
        configure(runtime)
    _users += 1
    try:
        yield
    finally:
        _users -= 1
        if _users == 0 and _runtime is not None:
            await _runtime.aclose()
            configure(None)


# The same contact and servers as today's app (app/main.py), for the published spec.
app = FastAPI(
    title=SERVICE,
    description="Each parent's children: profiles, photos and journey progress.",
    contact={"name": "Superpower Engineering", "email": "prince.kumar@pearson.com"},
    servers=[{"url": "/", "description": "Current environment"}],
    openapi_tags=[
        {"name": "health", "description": "Service health"},
        {"name": "children", "description": "Children and their progress"},
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
        raise HTTPException(status_code=503, detail="children isn't configured")
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


def _error(status: int, code: str, msg: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "msg": msg})


def _not_found() -> HTTPException:
    return _error(404, "child_not_found", "No such child.")


def _parents_only(caller: Caller) -> None:
    if caller.role != "parent":
        raise _error(403, "parents_only", "Only parents can add or change children.")


ChildId = Annotated[str, Path(description="The child's id")]
LocationQuery = Annotated[
    str | None,
    Query(pattern=LOCATION_PATTERN, description="The owner's location (admins only)"),
]


async def _owned(runtime: Runtime, caller: Caller, child_id: str) -> dict[str, Any]:
    """This parent's live child, or 404 (someone else's, deleted, or none)."""
    doc = await runtime.db[CHILDREN].find_one(
        {
            "_id": child_id,
            "location": caller.location,
            "user_id": caller.user_id,
            "is_deleted": False,
        }
    )
    if doc is None:
        raise _not_found()
    return doc


async def _event(runtime: Runtime, doc: Mapping[str, Any], session: AsyncClientSession) -> None:
    """One child.changed with the whole snapshot, in the write's transaction (7.4)."""
    event = Event.new(
        "child.changed",
        producer=SERVICE,
        aggregate_id=doc["_id"],
        location=doc["location"],
        version=doc["version"],
        region=runtime.settings.aws_region,
        payload=snapshot(doc),
        traceparent=current_traceparent(),
    )
    await add_to_outbox(runtime.db, event, session)


async def _transaction(
    runtime: Runtime, write: Callable[[AsyncClientSession], Awaitable[None]]
) -> None:
    async with runtime.client.start_session() as session:
        await session.with_transaction(write)


# ── models ─────────────────────────────────────────────────────────────────────

_Strict = ConfigDict(extra="forbid", str_strip_whitespace=True)
Age = Annotated[int | None, Field(default=None, ge=AGE_MIN, le=AGE_MAX)]
Gender = Annotated[str | None, Field(default=None, max_length=GENDER_MAX)]
School = Annotated[str | None, Field(default=None, max_length=SCHOOL_MAX)]
AvatarId = Annotated[str | None, Field(default=None, max_length=AVATAR_ID_MAX)]


class ChildIn(BaseModel):
    """A new child. Onboarding answers, personality, progress and photos belong elsewhere."""

    model_config = _Strict

    name: str = Field(min_length=1, max_length=NAME_MAX)
    age: Age
    gender: Gender
    school: School
    avatar_id: AvatarId


class ChildPatch(BaseModel):
    """Any subset; `null` clears an optional field. `avatar_id` and `avatar_key` exclude each other."""

    model_config = _Strict

    name: str | None = Field(default=None, min_length=1, max_length=NAME_MAX)
    age: Age
    gender: Gender
    school: School
    avatar_id: AvatarId
    avatar_key: str | None = Field(default=None, max_length=300)

    @model_validator(mode="after")
    def _check(self) -> ChildPatch:
        sent = self.model_fields_set
        if not sent:
            raise ValueError("send at least one field")
        if "name" in sent and self.name is None:
            raise ValueError("name can't be null")
        if self.avatar_id and self.avatar_key:
            raise ValueError("set avatar_id or avatar_key, not both")
        return self


class Progress(BaseModel):
    profile: bool
    conversation: bool
    discover: bool
    grow: bool
    transform: bool
    release: bool
    connect: bool


class Child(BaseModel):
    id: str
    name: str
    age: int | None
    gender: str | None
    school: str | None
    avatar_id: str | None
    avatar_url: str | None
    progress: Progress
    created_at: datetime
    updated_at: datetime


class PresignIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content_type: str = Field(max_length=100)


class PresignOut(BaseModel):
    upload_url: str
    avatar_key: str
    avatar_url: str


class ChildAccess(BaseModel):
    """What a circle copies into child_access (7.7)."""

    child_id: str
    user_id: str
    location: str
    name: str
    age: int | None
    gender: str | None
    is_deleted: bool
    progress: Progress
    version: int


async def _view(runtime: Runtime, doc: Mapping[str, Any]) -> Child:
    key = doc.get("avatar_key")
    avatar_url = await runtime.uploads.presign_get(key) if key and runtime.uploads else None
    return Child(
        id=doc["_id"],
        name=doc["name"],
        age=doc.get("age"),
        gender=doc.get("gender"),
        school=doc.get("school"),
        avatar_id=doc.get("avatar_id"),
        avatar_url=avatar_url,
        progress=Progress(**{flag: bool(doc["progress"].get(flag)) for flag in PROGRESS_FLAGS}),
        created_at=doc["created_at"],
        updated_at=doc["updated_at"],
    )


# ── public routes ──────────────────────────────────────────────────────────────

health_router = PolicyRouter()
router = PolicyRouter(prefix="/api/v1/children", tags=["children"])


@health_router.get(
    "/health",
    tags=["health"],
    dependencies=[Depends(public())],
    description="Liveness check for the load balancer.",
)
def health() -> dict[str, str]:
    return {"status": "ok", "service": SERVICE}


_SORTS: dict[str, tuple[str, int]] = {
    "created_at": ("created_at", ASCENDING),
    "-created_at": ("created_at", DESCENDING),
    "name": ("name", ASCENDING),
    "-name": ("name", DESCENDING),
}


@router.get(
    "",
    dependencies=[Depends(per_user("60/minute"))],
    description="Your children with their progress, for Home: one query. An admin with "
    "`children:read:any` passes the parent's `?user_id=` and `?location=` (audited).",
)
async def list_children(
    request: Request,
    runtime: Ready,
    caller: SignedIn,
    sort: Annotated[Literal["created_at", "-created_at", "name", "-name"], Query()] = "-created_at",
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    user_id: Annotated[str | None, Query(pattern=UUID_PATTERN)] = None,
    location: LocationQuery = None,
) -> list[Child]:
    owner, zone = caller.user_id, caller.location
    if user_id is not None:
        if not caller.has(READ_ANY):
            runtime.authorizer.record(
                request, caller, READ_ANY, user_id, privileged=True, status=403
            )
            raise _error(403, "forbidden", "Only admins may list another parent's children.")
        if location is None:
            raise _error(422, "location_required", "Pass ?location= (the owner's location)")
        runtime.authorizer.record(request, caller, READ_ANY, user_id, privileged=True)
        owner, zone = user_id, location
    field, direction = _SORTS[sort]
    docs = (
        await runtime.db[CHILDREN]
        .find({"location": zone, "user_id": owner, "is_deleted": False})
        .sort(field, direction)
        .limit(limit)
        .to_list(None)
    )
    return [await _view(runtime, doc) for doc in docs]


@router.post(
    "",
    status_code=201,
    dependencies=[Depends(per_user("20/minute"))],
    description="Add a child (parents only; at most 10). Unknown fields are refused: "
    "answers, personality and progress belong to other services.",
)
async def create_child(body: ChildIn, runtime: Ready, caller: SignedIn) -> Child:
    _parents_only(caller)
    children = runtime.db[CHILDREN]
    live = {"location": caller.location, "user_id": caller.user_id, "is_deleted": False}
    if await children.count_documents(live) >= MAX_CHILDREN:
        raise _error(422, "child_limit", f"A parent can have at most {MAX_CHILDREN} children.")
    doc = new_child(
        str(uuid.uuid4()), caller.user_id, caller.location, body.model_dump(), datetime.now(UTC)
    )

    async def write(session: AsyncClientSession) -> None:
        await children.insert_one(doc, session=session)
        await _event(runtime, doc, session)

    await _transaction(runtime, write)
    return await _view(runtime, doc)


@router.get(
    "/{id}",
    dependencies=[Depends(per_user("60/minute"))],
    description="One child. An admin with `children:read:any` passes the owner's "
    "`?location=` (audited).",
)
async def get_child(
    request: Request, id: ChildId, runtime: Ready, caller: SignedIn, location: LocationQuery = None
) -> Child:
    if not caller.has(READ_ANY):
        return await _view(runtime, await _owned(runtime, caller, id))
    if location is None:
        raise _error(422, "location_required", "Pass ?location= (the owner's location)")
    doc = await runtime.db[CHILDREN].find_one(
        {"_id": id, "location": location, "is_deleted": False}
    )
    if doc is None:
        raise _not_found()
    runtime.authorizer.record(request, caller, READ_ANY, doc["user_id"], privileged=True)
    return await _view(runtime, doc)


PATCH_ATTEMPTS = 3


class _Stale(Exception):
    """The child changed after it was read (its version moved)."""


def _upload_error(exc: UploadError) -> HTTPException:
    """A refused avatar_key, with common.uploads' codes named for avatars as the API says."""
    code = {"not_uploaded": "avatar_not_uploaded", "too_large": "avatar_too_large"}.get(
        exc.code, exc.code
    )
    return _error(422, code, str(exc))


@router.patch(
    "/{id}",
    dependencies=[Depends(per_user("30/minute"))],
    description="Change a child's profile (parents only). `null` clears an optional field; "
    "an `avatar_key` from avatar/presign must be this child's uploaded photo, ≤ 5 MB.",
)
async def update_child(id: ChildId, body: ChildPatch, runtime: Ready, caller: SignedIn) -> Child:
    _parents_only(caller)
    before = await _owned(runtime, caller, id)
    requested: dict[str, Any] = {name: getattr(body, name) for name in body.model_fields_set}
    if requested.get("avatar_key"):
        if runtime.uploads is None:
            raise _error(503, "uploads_not_configured", "Photo uploads aren't configured.")
        try:
            await runtime.uploads.accept(requested["avatar_key"], before["location"], id, "avatar")
        except UploadError as exc:
            raise _upload_error(exc) from exc
        requested["avatar_id"] = None
    elif requested.get("avatar_id"):
        requested["avatar_key"] = None
    now = datetime.now(UTC)
    result: dict[str, Any] = {}

    async def write(session: AsyncClientSession) -> None:
        # What changes, and whether the copies must hear of it, is decided against the
        # version read: a concurrent PATCH in between makes the update find nothing.
        changes = dict(requested)
        merged = {**before, **changes}
        if not before["progress"]["profile"] and profile_complete(merged):
            changes["progress.profile"] = True  # one-way: set once, never cleared (12.4)
        copied_changed = "progress.profile" in changes or any(
            name in changes and changes[name] != before.get(name) for name in SNAPSHOT_FIELDS
        )
        updated = await runtime.db[CHILDREN].find_one_and_update(
            {
                "_id": id,
                "location": before["location"],
                "user_id": caller.user_id,
                "is_deleted": False,
                "version": before["version"],
            },
            {"$set": {**changes, "updated_at": now}, "$inc": {"version": 1}},
            return_document=ReturnDocument.AFTER,
            session=session,
        )
        if updated is None:
            raise _Stale()
        if copied_changed:
            await _event(runtime, updated, session)
        result["doc"] = updated

    for _ in range(PATCH_ATTEMPTS):
        try:
            await _transaction(runtime, write)
            break
        except _Stale:
            before = await _owned(runtime, caller, id)  # 404 if deleted in between
    else:
        raise _error(409, "child_changed", "The child changed while updating; try again.")
    old_key = before.get("avatar_key")
    if old_key and old_key != result["doc"].get("avatar_key") and runtime.uploads is not None:
        # The replaced or cleared photo, after the change committed.
        try:
            await runtime.uploads.delete(old_key)
        except Exception:
            _logger.warning("children: old avatar not deleted; the purge removes it later")
    return await _view(runtime, result["doc"])


@router.delete(
    "/{id}",
    status_code=204,
    response_model=None,
    dependencies=[Depends(per_user("10/minute"))],
    description="Delete a child (parents only): hidden everywhere at once, purged after 30 days.",
)
async def delete_child(id: ChildId, runtime: Ready, caller: SignedIn) -> Response:
    _parents_only(caller)
    before = await _owned(runtime, caller, id)
    now = datetime.now(UTC)

    async def write(session: AsyncClientSession) -> None:
        updated = await runtime.db[CHILDREN].find_one_and_update(
            {
                "_id": id,
                "location": before["location"],
                "user_id": caller.user_id,
                "is_deleted": False,
            },
            {
                "$set": {"is_deleted": True, "deleted_at": now, "updated_at": now},
                "$inc": {"version": 1},
            },
            return_document=ReturnDocument.AFTER,
            session=session,
        )
        if updated is None:
            raise _not_found()
        await _event(runtime, updated, session)

    await _transaction(runtime, write)
    return Response(status_code=204)


@router.post(
    "/{id}/avatar/presign",
    dependencies=[Depends(per_user("20/minute"))],
    description="A 5-minute URL to upload the child's photo straight to S3 (parents only); "
    "then PATCH the child with the returned `avatar_key`.",
)
async def presign_avatar(
    id: ChildId, body: PresignIn, runtime: Ready, caller: SignedIn
) -> PresignOut:
    _parents_only(caller)
    child = await _owned(runtime, caller, id)
    if runtime.uploads is None:
        raise _error(503, "uploads_not_configured", "Photo uploads aren't configured.")
    try:
        key = runtime.uploads.new_key(child["location"], id, "avatar", body.content_type)
    except UploadError as exc:
        raise _error(415, exc.code, str(exc)) from exc
    try:
        upload_url = await runtime.uploads.presign_put(key, body.content_type)
        avatar_url = await runtime.uploads.presign_get(key)
    except Exception as exc:
        _logger.exception("children: presigning failed")
        raise _error(502, "upload_url_failed", "Couldn't create an upload URL.") from exc
    return PresignOut(upload_url=upload_url, avatar_key=key, avatar_url=avatar_url)


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
    "/children/{id}",
    tags=["internal"],
    description="A child's child_access fields, deleted or not, for a circle's read-through "
    "(7.5). The caller checks `user_id` against its own request.",
)
async def internal_child(
    id: str,
    location: Annotated[str, Query(pattern=LOCATION_PATTERN)],
    runtime: Ready,
    _caller: Annotated[str, Depends(allow_callers(*INTERNAL_CALLERS))],
) -> ChildAccess:
    doc = await runtime.db[CHILDREN].find_one({"_id": id, "location": location})
    if doc is None:
        raise HTTPException(status_code=404, detail="Not Found")
    return ChildAccess(
        child_id=doc["_id"],
        user_id=doc["user_id"],
        location=doc["location"],
        name=doc["name"],
        age=doc.get("age"),
        gender=doc.get("gender"),
        is_deleted=bool(doc.get("is_deleted")),
        progress=Progress(**{flag: bool(doc["progress"].get(flag)) for flag in PROGRESS_FLAGS}),
        version=doc["version"],
    )


internal_app.include_router(internal_router)
