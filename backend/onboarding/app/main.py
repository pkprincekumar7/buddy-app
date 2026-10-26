"""The onboarding service's two apps, run by `python -m common.serve onboarding`.

`app` is public (port 8000, ALB rule 10: `/api/v1/children/*/onboarding*`); `internal_app`
is internal (port 8001, Cloud Map only). Each endpoint is in docs/auth-users-split-api.md:

- `GET /api/v1/children/{id}/onboarding`: the answers once the chat is finished, else
  `not_started`; `PUT` the same path: all seven answers, once, at the end of the chat;
- `GET /internal/onboarding/children/{id}/status`: discover's confirm-before-deny;
- `GET /internal/onboarding/children/{id}/answers`: the circles' read-through for their
  `onboarding_inputs` copy.

**Access** follows the circle rules (onboarding.app.access): the child's parent, or an
admin with `children:read:any` reading with the owner's `?location=` (audited); unlocked
once the profile step is done.

**Events:** the first save publishes `onboarding.conversation_completed`, a later change
`onboarding.answers_updated`, each in the write's transaction (7.3). Identical answers
change and publish nothing.
"""

from __future__ import annotations

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
from pymongo.errors import DuplicateKeyError

from common.audit import route_template
from common.authz import Caller, current_caller, signed_in
from common.events import Event, add_to_outbox, is_tombstoned, tombstone_key
from common.internal_client import allow_callers
from common.models import ANSWER_FIELDS
from common.routers import PolicyRouter, public
from common.telemetry import current_traceparent
from onboarding.app.access import child_for, error, not_found, require_unlocked
from onboarding.app.runtime import SERVICE, Runtime
from onboarding.app.store import (
    CONVERSATIONS,
    ITEM_MAX,
    LIST_MAX_ITEMS,
    TEXT_MAX,
    new_conversation,
    to_millis,
)

LOCATION_PATTERN = r"^[a-z0-9_-]{1,16}$"
READ_ANY = "children:read:any"
# Confirm-before-deny for discover (12.4); the circles that copy the answers (7.5).
STATUS_CALLERS = ("discover",)
ANSWERS_CALLERS = ("discover", "grow", "transform", "release")
SAVE_ATTEMPTS = 3

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
    description="The conversational onboarding: each child's seven answers.",
    contact={"name": "Superpower Engineering", "email": "prince.kumar@pearson.com"},
    servers=[{"url": "/", "description": "Current environment"}],
    openapi_tags=[
        {"name": "health", "description": "Service health"},
        {"name": "onboarding", "description": "The conversation's answers"},
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
        raise HTTPException(status_code=503, detail="onboarding isn't configured")
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


ChildId = Annotated[str, Path(description="The child's id")]
LocationQuery = Annotated[
    str | None,
    Query(pattern=LOCATION_PATTERN, description="The owner's location (admins only)"),
]


async def _transaction(
    runtime: Runtime, write: Callable[[AsyncClientSession], Awaitable[None]]
) -> None:
    async with runtime.client.start_session() as session:
        await session.with_transaction(write)


# ── models ─────────────────────────────────────────────────────────────────────

_Item = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=ITEM_MAX)]
_Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=TEXT_MAX)]
_List = Annotated[list[_Item], Field(min_length=1, max_length=LIST_MAX_ITEMS)]


class Answers(BaseModel):
    """All seven, as the chat collected them. Question wording stays in the apps."""

    model_config = ConfigDict(extra="forbid", strict=True)

    strengths: _List
    hobbies: _List
    thinking_pattern: _Text
    communication_style: _Text
    energy_level: _Text
    social_behaviour: _Text
    emotional_behaviour: _Text


class Onboarding(BaseModel):
    status: Literal["not_started", "completed"]
    # For the heading, from the same database (12.2).
    child_name: str | None
    answers: dict[str, str | list[str]]
    completed_at: datetime | None


class Completed(BaseModel):
    completed: bool


class AnswersCopy(BaseModel):
    """What a circle copies into onboarding_inputs (4.1)."""

    child_id: str
    user_id: str
    location: str
    strengths: list[str]
    hobbies: list[str]
    thinking_pattern: str
    communication_style: str
    energy_level: str
    social_behaviour: str
    emotional_behaviour: str
    version: int


def _view(conversation: Mapping[str, Any] | None, child: Mapping[str, Any]) -> Onboarding:
    if conversation is None:
        return Onboarding(
            status="not_started", child_name=child.get("name"), answers={}, completed_at=None
        )
    return Onboarding(
        status="completed",
        child_name=child.get("name"),
        answers={name: conversation["answers"][name] for name in ANSWER_FIELDS},
        completed_at=conversation["completed_at"],
    )


def _event(
    runtime: Runtime, event_type: str, doc: Mapping[str, Any], answers: Mapping[str, Any]
) -> Event:
    return Event.new(
        event_type,
        producer=SERVICE,
        aggregate_id=doc["_id"],
        location=doc["location"],
        version=doc["version"],
        region=runtime.settings.aws_region,
        # The owner too, so a circle can start work before its child_access copy arrives.
        payload={"user_id": doc["user_id"], **answers},
        traceparent=current_traceparent(),
    )


class _Stale(Exception):
    """The conversation changed after it was read."""


# ── public routes ──────────────────────────────────────────────────────────────

health_router = PolicyRouter()
router = PolicyRouter(prefix="/api/v1/children/{id}/onboarding", tags=["onboarding"])


@health_router.get(
    "/health",
    tags=["health"],
    dependencies=[Depends(public())],
    description="Liveness check for the load balancer.",
)
def health() -> dict[str, str]:
    return {"status": "ok", "service": SERVICE}


@router.get(
    "",
    dependencies=[Depends(per_user("60/minute"))],
    description="The child's answers once the conversation is finished, else `not_started`. "
    "An admin with `children:read:any` passes the owner's `?location=` (audited).",
)
async def get_onboarding(
    request: Request, id: ChildId, runtime: Ready, caller: SignedIn, location: LocationQuery = None
) -> Onboarding:
    if caller.has(READ_ANY):
        if location is None:
            raise error(422, "location_required", "Pass ?location= (the owner's location)")
        child = await child_for(runtime, id, location=location, owner=None)
        runtime.authorizer.record(request, caller, READ_ANY, child["user_id"], privileged=True)
    else:
        child = await child_for(runtime, id, location=caller.location, owner=caller.user_id)
        await require_unlocked(runtime, child)
    conversation = await runtime.db[CONVERSATIONS].find_one(
        {"_id": id, "location": child["location"], "user_id": child["user_id"]}
    )
    return _view(conversation, child)


@router.put(
    "",
    dependencies=[Depends(per_user("10/minute"))],
    responses={201: {"description": "The conversation's first save"}},
    description="All seven answers, once, at the end of the chat (the child's parent only). "
    "The first save is `201` and publishes `onboarding.conversation_completed`; a later "
    "change is `200` and publishes `onboarding.answers_updated`; identical answers change "
    "nothing.",
)
async def put_onboarding(
    id: ChildId, body: Answers, response: Response, runtime: Ready, caller: SignedIn
) -> Onboarding:
    child = await child_for(runtime, id, location=caller.location, owner=caller.user_id)
    await require_unlocked(runtime, child)
    answers = body.model_dump()
    selector = {"_id": id, "location": child["location"], "user_id": child["user_id"]}
    conversations = runtime.db[CONVERSATIONS]
    result: dict[str, Any] = {}

    for _ in range(SAVE_ATTEMPTS):
        existing = await conversations.find_one(selector)

        async def write(session: AsyncClientSession, existing: Any = existing) -> None:
            tombstones = [tombstone_key("child", id), tombstone_key("user", child["user_id"])]
            if await is_tombstoned(runtime.db, tombstones, session=session):
                raise not_found()  # deleted meanwhile: nothing may come back
            now = to_millis(datetime.now(UTC))
            if existing is None:
                doc = new_conversation(id, child["user_id"], child["location"], answers, now)
                await conversations.insert_one(doc, session=session)
                event = _event(runtime, "onboarding.conversation_completed", doc, answers)
                await add_to_outbox(runtime.db, event, session)
                result.update(doc=doc, created=True)
                return
            if existing["answers"] == answers:
                result.update(doc=existing, created=False)
                return
            updated = await conversations.find_one_and_update(
                {**selector, "version": existing["version"]},
                {"$set": {"answers": answers, "updated_at": now}, "$inc": {"version": 1}},
                return_document=ReturnDocument.AFTER,
                session=session,
            )
            if updated is None:
                raise _Stale()
            await add_to_outbox(
                runtime.db, _event(runtime, "onboarding.answers_updated", updated, answers), session
            )
            result.update(doc=updated, created=False)

        try:
            await _transaction(runtime, write)
            break
        except (_Stale, DuplicateKeyError):
            continue  # another save won the race: decide again against it
    else:
        raise error(409, "conversation_changed", "The answers changed meanwhile; try again.")
    response.status_code = 201 if result["created"] else 200
    return _view(result["doc"], child)


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
    "/onboarding/children/{id}/status",
    tags=["internal"],
    description="Whether the child's conversation is completed: discover's confirm-before-deny "
    "(12.4). A child with no conversation is `completed: false`.",
)
async def internal_status(
    id: str,
    location: InternalLocation,
    runtime: Ready,
    _caller: Annotated[str, Depends(allow_callers(*STATUS_CALLERS))],
) -> Completed:
    found = await runtime.db[CONVERSATIONS].find_one({"_id": id, "location": location}, {"_id": 1})
    return Completed(completed=found is not None)


@internal_router.get(
    "/onboarding/children/{id}/answers",
    tags=["internal"],
    description="The child's answers in onboarding_inputs' shape, for a circle's read-through "
    "(7.5); `404` until the conversation is completed. The caller checks `user_id`.",
)
async def internal_answers(
    id: str,
    location: InternalLocation,
    runtime: Ready,
    _caller: Annotated[str, Depends(allow_callers(*ANSWERS_CALLERS))],
) -> AnswersCopy:
    doc = await runtime.db[CONVERSATIONS].find_one({"_id": id, "location": location})
    if doc is None:
        raise HTTPException(status_code=404, detail="Not Found")
    return AnswersCopy(
        child_id=doc["_id"],
        user_id=doc["user_id"],
        location=doc["location"],
        **doc["answers"],
        version=doc["version"],
    )


internal_app.include_router(internal_router)
