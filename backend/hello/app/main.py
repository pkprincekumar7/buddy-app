"""The hello service's two apps, run by `python -m common.serve hello`.

`app` is public (port 8000, behind the ALB); `internal_app` is internal (port 8001, through
Cloud Map only). Real services follow the same shape.

Besides `/health`, hello is Gate 1's demo of a service built only on `common` (build plan):
- `POST /pings` (signed in) writes a ping and its `hello.pinged` outbox row in one
  transaction; hello's worker publishes it and consumes it back into a local copy;
- `GET /pings/{ping_id}/via-internal` reads the ping through a signed internal call to
  hello's own `GET /internal/pings/{ping_id}`, which accepts only the `hello` caller;
- every route declares an access policy (the route-policy test).
"""

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field
from pymongo.asynchronous.client_session import AsyncClientSession

from common.authz import Caller, signed_in
from common.events import Event, add_to_outbox
from common.internal_client import allow_callers
from common.logging import request_id_var
from common.routers import public
from common.telemetry import current_traceparent
from hello.app.demo import PINGS, SERVICE, Demo

_demo: Demo | None = None
_users = 0


def configure(demo: Demo | None) -> None:
    """Attach (or detach) the demo's resources to both apps."""
    global _demo
    _demo = demo
    app.state.demo = demo
    internal_app.state.demo = demo
    if demo is not None:
        app.state.authorizer = demo.authorizer
        internal_app.state.service_tokens = demo.verifier


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Both apps share one Demo per process; the last one to stop closes it."""
    global _users
    import os

    if _demo is None and os.environ.get("MONGODB_URI"):
        demo = Demo.from_env()
        await demo.prepare()
        configure(demo)
    _users += 1
    try:
        yield
    finally:
        _users -= 1
        if _users == 0 and _demo is not None:
            await _demo.aclose()
            configure(None)


# The same contact and servers as today's app (app/main.py), for the published spec.
app = FastAPI(
    title=SERVICE,
    description="Placeholder service that proves the per-service build and deploy.",
    contact={"name": "Superpower Engineering", "email": "prince.kumar@pearson.com"},
    servers=[{"url": "/", "description": "Current environment"}],
    openapi_tags=[
        {"name": "health", "description": "Service health"},
        {"name": "pings", "description": "Gate 1 demo: an event and an internal call"},
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


def demo_ready(request: Request) -> Demo:
    """The demo's resources, or 503 when hello runs without configuration."""
    demo: Demo | None = getattr(request.app.state, "demo", None)
    if demo is None:
        raise HTTPException(status_code=503, detail="hello's demo isn't configured")
    return demo


class PingIn(BaseModel):
    message: str = Field(min_length=1, max_length=200)


class PingOut(BaseModel):
    id: str
    message: str
    created_at: datetime


def _out(doc: dict[str, Any]) -> PingOut:
    return PingOut(id=doc["_id"], message=doc["message"], created_at=doc["created_at"])


@app.get(
    "/health",
    tags=["health"],
    dependencies=[Depends(public())],
    description="Liveness check for the load balancer.",
)
def health() -> dict[str, str]:
    return {"status": "ok", "service": SERVICE}


@app.post(
    "/pings",
    status_code=201,
    tags=["pings"],
    description="Store a ping and publish `hello.pinged` with it (one transaction).",
)
async def create_ping(
    body: PingIn,
    demo: Annotated[Demo, Depends(demo_ready)],
    caller: Annotated[Caller, Depends(signed_in())],
) -> PingOut:
    now = datetime.now(UTC)
    ping_id = str(uuid.uuid4())
    ping: dict[str, Any] = {
        "_id": ping_id,
        "user_id": caller.user_id,
        "location": caller.location,
        "message": body.message,
        "version": 1,
        "created_at": now,
        "updated_at": now,
        "schema_version": 1,
    }
    event = Event.new(
        "hello.pinged",
        producer=SERVICE,
        aggregate_id=ping_id,
        location=caller.location,
        version=1,
        region=demo.settings.aws_region,
        payload={"user_id": caller.user_id, "message": body.message},
        traceparent=current_traceparent(),
    )

    async def write(session: AsyncClientSession) -> None:
        await demo.db[PINGS].insert_one(ping, session=session)
        await add_to_outbox(demo.db, event, session)

    # with_transaction retries a transient conflict (another write, or DDL) instead of failing.
    async with demo.client.start_session() as session:
        await session.with_transaction(write)
    return _out(ping)


@app.get(
    "/pings/{ping_id}/via-internal",
    tags=["pings"],
    description="Read a ping back through a signed internal call to hello's own internal API.",
)
async def ping_via_internal(
    ping_id: str,
    demo: Annotated[Demo, Depends(demo_ready)],
    caller: Annotated[Caller, Depends(signed_in())],
) -> PingOut:
    response = await demo.internal.get(
        SERVICE, f"/internal/pings/{ping_id}", request_id=request_id_var.get()
    )
    if response.status_code == 404:
        raise HTTPException(status_code=404, detail="Not Found")
    response.raise_for_status()
    doc = response.json()
    if doc["user_id"] != caller.user_id:  # another user's ping: 404, so ids can't be probed
        raise HTTPException(status_code=404, detail="Not Found")
    return PingOut(id=doc["id"], message=doc["message"], created_at=doc["created_at"])


@internal_app.get(
    "/internal/ping",
    tags=["internal"],
    dependencies=[Depends(public())],
    description="Reachability check for internal callers (port 8001, inside the VPC only).",
)
def ping() -> dict[str, str]:
    return {"status": "ok", "service": SERVICE}


@internal_app.get(
    "/internal/pings/{ping_id}",
    tags=["internal"],
    description="One ping, for hello itself (the demo's signed internal call).",
)
async def internal_ping(
    ping_id: str,
    demo: Annotated[Demo, Depends(demo_ready)],
    caller: Annotated[str, Depends(allow_callers(SERVICE))],
) -> dict[str, Any]:
    doc = await demo.db[PINGS].find_one({"_id": ping_id})
    if doc is None:
        raise HTTPException(status_code=404, detail="Not Found")
    return {
        "id": doc["_id"],
        "user_id": doc["user_id"],
        "message": doc["message"],
        "created_at": doc["created_at"],
    }
