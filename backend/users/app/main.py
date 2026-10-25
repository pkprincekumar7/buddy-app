"""The users service's two apps, run by `python -m common.serve users`.

`app` is public (port 8000, behind the ALB rule for `/api/v1/users/*`); `internal_app` is
internal (port 8001, through Cloud Map only). Each endpoint is in
docs/auth-users-split-api.md:

- `GET` / `PATCH /api/v1/users/{user_id}/profile` and `…/preferences`: the user themself
  (`{user_id}` = their id or `me`), or an admin with `profiles:read:any` /
  `profiles:write:any`, who must pass `?location=` (the owner's). Anyone else gets the same
  `404 profile_not_found` as a missing profile, so ids can't be probed (11.2).
- `GET /api/v1/users/profiles?ids=…`: names for a page of the admin account list.
- `PUT` / `DELETE /internal/users/{user_id}`: auth's registration saga only (10.1).

Every route declares an access policy: the routers refuse one without (11.2).
"""

from __future__ import annotations

import re
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Path, Query, Request, Response
from fastapi.exception_handlers import http_exception_handler
from fastapi.responses import JSONResponse
from limits import parse
from pydantic import BaseModel, ConfigDict, Field, model_validator
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError
from starlette.exceptions import HTTPException as StarletteHTTPException

from common.audit import AuditEvent, route_template, source_ip
from common.authz import Access, Caller, current_caller, require, require_self_or
from common.events import is_tombstoned, tombstone_key
from common.internal_client import allow_callers
from common.routers import PolicyRouter, public
from users.app.runtime import SERVICE, Runtime
from users.app.store import (
    ADDRESS_MAX,
    NAME_MAX,
    PROFILE_FIELDS,
    USERS,
    new_profile,
    preferences_view,
    profile_view,
)

_runtime: Runtime | None = None
_users = 0

LOCATION_PATTERN = r"^[a-z0-9_-]{1,16}$"
_UUID4_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
MAX_BATCH_IDS = 100

PROFILE_NOT_FOUND = {"code": "profile_not_found", "msg": "Profile not found"}


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
    description="Each account's profile (names and address) and app preferences.",
    contact={"name": "Superpower Engineering", "email": "prince.kumar@pearson.com"},
    servers=[{"url": "/", "description": "Current environment"}],
    openapi_tags=[
        {"name": "health", "description": "Service health"},
        {"name": "profiles", "description": "Names and address"},
        {"name": "preferences", "description": "App preferences"},
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


@app.exception_handler(StarletteHTTPException)
async def _same_404_for_every_user(request: Request, exc: StarletteHTTPException) -> Response:
    """Someone else's id (refused by require_self_or) and a missing profile look the same."""
    if exc.status_code == 404 and "{user_id}" in route_template(request):
        return JSONResponse({"detail": PROFILE_NOT_FOUND}, status_code=404, headers=exc.headers)
    return await http_exception_handler(request, exc)


# ── shared dependencies ────────────────────────────────────────────────────────


def runtime_ready(request: Request) -> Runtime:
    """The runtime's resources, or 503 when the service runs without configuration."""
    runtime: Runtime | None = getattr(request.app.state, "runtime", None)
    if runtime is None:
        raise HTTPException(status_code=503, detail="users isn't configured")
    return runtime


Ready = Annotated[Runtime, Depends(runtime_ready)]


def per_user(limit: str) -> Callable[..., Awaitable[None]]:
    """A per-user rate limit, counted in the runtime's limiter (Valkey, or per task)."""
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
    return HTTPException(status_code=404, detail=PROFILE_NOT_FOUND)


# Read by require_self_or from the path; declared so the spec documents it.
UserIdPath = Annotated[str, Path(description="The user's id, or `me` for your own")]

LocationQuery = Annotated[
    str | None,
    Query(
        pattern=LOCATION_PATTERN,
        description="The owner's location, from the account listing. Required when an "
        "admin reads or changes someone else's data; ignored for your own.",
    ),
]


def owner_location(access: Access, location: str | None) -> str:
    """Where the subject's profile lives: the caller's own location, or `?location=`.

    Every read is targeted by location, and an admin's token may be from another zone, so
    an admin must say whose zone (docs/auth-users-split-api.md, conventions).
    """
    if not access.privileged:
        return access.caller.location
    if location is None:
        raise _error(422, "location_required", "Pass ?location= (the owner's location)")
    return location


def audit_change(request: Request, runtime: Runtime, access: Access, fields: list[str]) -> None:
    """An admin's change to someone else's data, with the changed field names (11.3)."""
    if not access.privileged:
        return
    runtime.authorizer.audit.record(
        AuditEvent(
            actor_id=access.caller.user_id,
            actor_role=access.caller.role,
            permission="profiles:write:any",
            subject_id=access.subject_id,
            privileged=True,
            outcome="allowed",
            status=200,
            method=request.method,
            route=route_template(request),
            request_id=request.headers.get("x-request-id"),
            source_ip=source_ip(request),
            changed_fields=tuple(sorted(fields)),
        )
    )


# ── models ─────────────────────────────────────────────────────────────────────


class Profile(BaseModel):
    id: str
    first_name: str
    middle_name: str | None
    last_name: str | None
    address_line_one: str | None
    address_line_two: str | None
    address_line_three: str | None
    location: str
    created_at: datetime
    updated_at: datetime


class ProfileName(BaseModel):
    id: str
    first_name: str
    middle_name: str | None
    last_name: str | None


class ProfileNames(BaseModel):
    items: list[ProfileName]


class Preferences(BaseModel):
    tts_enabled: bool


_Strict = ConfigDict(extra="forbid", str_strip_whitespace=True)
OptionalName = Annotated[str | None, Field(default=None, max_length=NAME_MAX)]
OptionalAddress = Annotated[str | None, Field(default=None, max_length=ADDRESS_MAX)]


class ProfilePatch(BaseModel):
    """Any subset of the fields: each one sent is replaced; `null` clears an optional one."""

    model_config = _Strict

    first_name: str | None = Field(default=None, min_length=1, max_length=NAME_MAX)
    middle_name: OptionalName
    last_name: OptionalName
    address_line_one: OptionalAddress
    address_line_two: OptionalAddress
    address_line_three: OptionalAddress

    @model_validator(mode="after")
    def _check(self) -> ProfilePatch:
        if not self.model_fields_set:
            raise ValueError("send at least one field")
        if "first_name" in self.model_fields_set and self.first_name is None:
            raise ValueError("first_name can't be null")
        return self

    def changes(self) -> dict[str, str | None]:
        """The sent fields; an empty optional string is stored as null."""
        return {
            name: (getattr(self, name) or None) if name != "first_name" else self.first_name
            for name in PROFILE_FIELDS
            if name in self.model_fields_set
        }


class PreferencesPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tts_enabled: bool


class ProfileIn(BaseModel):
    """The profile auth creates at registration (10.1)."""

    model_config = _Strict

    first_name: str = Field(min_length=1, max_length=NAME_MAX)
    middle_name: OptionalName
    last_name: OptionalName
    location: str = Field(pattern=LOCATION_PATTERN)
    address_line_one: OptionalAddress
    address_line_two: OptionalAddress
    address_line_three: OptionalAddress

    def fields(self) -> dict[str, str | None]:
        return {
            name: getattr(self, name) if name == "first_name" else (getattr(self, name) or None)
            for name in PROFILE_FIELDS
        }


# ── public routes ──────────────────────────────────────────────────────────────

health_router = PolicyRouter()
router = PolicyRouter(prefix="/api/v1/users")


@health_router.get(
    "/health",
    tags=["health"],
    dependencies=[Depends(public())],
    description="Liveness check for the load balancer.",
)
def health() -> dict[str, str]:
    return {"status": "ok", "service": SERVICE}


@router.get(
    "/profiles",
    tags=["profiles"],
    description="Names for a page of accounts, for the admin account list. Ids with no "
    "profile are left out. Admins only (`profiles:read:any`); audited with the ids.",
    dependencies=[Depends(per_user("60/minute"))],
)
async def list_profile_names(
    request: Request,
    runtime: Ready,
    caller: Annotated[Caller, Depends(require("profiles:read:any"))],
    ids: Annotated[str, Query(description="1–100 comma-separated user ids")],
) -> ProfileNames:
    wanted = list(dict.fromkeys(part.strip() for part in ids.split(",")))
    if not 1 <= len(wanted) <= MAX_BATCH_IDS or not all(_UUID4_RE.fullmatch(i) for i in wanted):
        raise _error(422, "invalid_ids", f"ids must be 1–{MAX_BATCH_IDS} user ids")
    for subject in wanted:
        runtime.authorizer.record(request, caller, "profiles:read:any", subject, privileged=True)
    # Reads every zone once sharded, which is accepted for an admin screen. No address
    # lines: the list doesn't need them.
    projection = {"first_name": 1, "middle_name": 1, "last_name": 1}
    docs = await runtime.db[USERS].find({"_id": {"$in": wanted}}, projection).to_list(None)
    by_id = {doc["_id"]: doc for doc in docs}
    return ProfileNames(
        items=[
            ProfileName(
                id=i,
                first_name=by_id[i]["first_name"],
                middle_name=by_id[i].get("middle_name"),
                last_name=by_id[i].get("last_name"),
            )
            for i in wanted
            if i in by_id
        ]
    )


@router.get(
    "/{user_id}/profile",
    tags=["profiles"],
    description="A user's names and address: your own (`me`), or anyone's with "
    "`profiles:read:any` and `?location=`.",
    dependencies=[Depends(per_user("60/minute"))],
)
async def get_profile(
    user_id: UserIdPath,
    runtime: Ready,
    access: Annotated[Access, Depends(require_self_or("profiles:read:any"))],
    location: LocationQuery = None,
) -> Profile:
    doc = await runtime.db[USERS].find_one(
        {"_id": access.subject_id, "location": owner_location(access, location)}
    )
    if doc is None:
        raise _not_found()
    return Profile(**profile_view(doc))


@router.patch(
    "/{user_id}/profile",
    tags=["profiles"],
    description="Change names and address. Each field sent is replaced; `null` clears an "
    "optional one. Admins (`profiles:write:any`) are audited with the changed field names.",
    dependencies=[Depends(per_user("30/minute"))],
)
async def update_profile(
    user_id: UserIdPath,
    request: Request,
    body: ProfilePatch,
    runtime: Ready,
    access: Annotated[Access, Depends(require_self_or("profiles:write:any"))],
    location: LocationQuery = None,
) -> Profile:
    changes = body.changes()
    doc = await runtime.db[USERS].find_one_and_update(
        {"_id": access.subject_id, "location": owner_location(access, location)},
        {"$set": {**changes, "updated_at": datetime.now(UTC)}, "$inc": {"version": 1}},
        return_document=ReturnDocument.AFTER,
    )
    if doc is None:
        raise _not_found()
    # No event yet: user.profile_updated is reserved until connect exists (7.6).
    audit_change(request, runtime, access, list(changes))
    return Profile(**profile_view(doc))


@router.get(
    "/{user_id}/preferences",
    tags=["preferences"],
    description="App preferences: your own (`me`), or anyone's with `profiles:read:any` "
    "and `?location=`.",
    dependencies=[Depends(per_user("60/minute"))],
)
async def get_preferences(
    user_id: UserIdPath,
    runtime: Ready,
    access: Annotated[Access, Depends(require_self_or("profiles:read:any"))],
    location: LocationQuery = None,
) -> Preferences:
    doc = await runtime.db[USERS].find_one(
        {"_id": access.subject_id, "location": owner_location(access, location)},
        {"preferences": 1},
    )
    if doc is None:
        raise _not_found()
    return Preferences(**preferences_view(doc))


@router.patch(
    "/{user_id}/preferences",
    tags=["preferences"],
    description="Change app preferences. No event: no other service uses them.",
    dependencies=[Depends(per_user("30/minute"))],
)
async def update_preferences(
    user_id: UserIdPath,
    request: Request,
    body: PreferencesPatch,
    runtime: Ready,
    access: Annotated[Access, Depends(require_self_or("profiles:write:any"))],
    location: LocationQuery = None,
) -> Preferences:
    doc = await runtime.db[USERS].find_one_and_update(
        {"_id": access.subject_id, "location": owner_location(access, location)},
        {
            "$set": {"preferences.tts_enabled": body.tts_enabled, "updated_at": datetime.now(UTC)},
            "$inc": {"version": 1},
        },
        projection={"preferences": 1},
        return_document=ReturnDocument.AFTER,
    )
    if doc is None:
        raise _not_found()
    audit_change(request, runtime, access, ["tts_enabled"])
    return Preferences(**preferences_view(doc))


app.include_router(health_router)
app.include_router(router)


# ── internal routes (port 8001) ────────────────────────────────────────────────

internal_router = PolicyRouter(prefix="/internal")


def _user_id(user_id: str) -> str:
    if not _UUID4_RE.fullmatch(user_id):
        raise _error(422, "invalid_user_id", "user_id must be a UUIDv4")
    return user_id


@internal_router.get(
    "/ping",
    tags=["internal"],
    dependencies=[Depends(public())],
    description="Reachability check for internal callers (port 8001, inside the VPC only).",
)
def ping() -> dict[str, str]:
    return {"status": "ok", "service": SERVICE}


@internal_router.put(
    "/users/{user_id}",
    tags=["internal"],
    description="Create or replace a profile: auth's registration saga (10.1). A retry with "
    "the same body changes nothing; the location never changes.",
    responses={201: {"description": "Created"}, 200: {"description": "Already existed"}},
)
async def put_profile(
    user_id: str,
    body: ProfileIn,
    response: Response,
    runtime: Ready,
    _caller: Annotated[str, Depends(allow_callers("auth"))],
) -> Profile:
    user_id = _user_id(user_id)
    users = runtime.db[USERS]
    fields = body.fields()
    existing = await users.find_one({"_id": user_id})
    if existing is None:
        # A deleted account's id never comes back (7.4).
        if await is_tombstoned(runtime.db, [tombstone_key("user", user_id)]):
            raise _error(409, "profile_deleted", "This account was deleted")
        doc = new_profile(user_id, body.location, fields, datetime.now(UTC))
        try:
            await users.insert_one(doc)
        except DuplicateKeyError:
            # A concurrent retry inserted it first: answer as for an existing profile.
            existing = await users.find_one({"_id": user_id})
        else:
            response.status_code = 201
            return Profile(**profile_view(doc))
        if existing is None:
            # …and something deleted it again in between: the saga retries.
            raise _error(409, "profile_conflict", "The profile changed concurrently; retry")
    if existing["location"] != body.location:
        raise _error(409, "location_mismatch", "A profile's location never changes")
    if any(existing.get(name) != value for name, value in fields.items()):
        updated = await users.find_one_and_update(
            {"_id": user_id, "location": body.location},
            {"$set": {**fields, "updated_at": datetime.now(UTC)}, "$inc": {"version": 1}},
            return_document=ReturnDocument.AFTER,
        )
        existing = updated if updated is not None else existing
    return Profile(**profile_view(existing))


@internal_router.delete(
    "/users/{user_id}",
    status_code=204,
    tags=["internal"],
    description="Delete a profile: auth undoing a failed registration, or its reaper (10.1). "
    "Not account deletion, which is event-driven (10.3).",
)
async def delete_profile(
    user_id: str,
    runtime: Ready,
    _caller: Annotated[str, Depends(allow_callers("auth"))],
    location: Annotated[str, Query(pattern=LOCATION_PATTERN)],
) -> Response:
    await runtime.db[USERS].delete_one({"_id": _user_id(user_id), "location": location})
    return Response(status_code=204)


internal_app.include_router(internal_router)
