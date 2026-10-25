"""Dependencies the public and admin routers share (runtime, rate limits, errors)."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Annotated

from fastapi import Depends, HTTPException, Request
from limits import parse

from auth.app.runtime import Runtime
from common.audit import route_template
from common.authz import Caller, current_caller


def runtime_ready(request: Request) -> Runtime:
    """The runtime's resources, or 503 when the service runs without configuration."""
    runtime: Runtime | None = getattr(request.app.state, "runtime", None)
    if runtime is None:
        raise HTTPException(status_code=503, detail="auth isn't configured")
    return runtime


Ready = Annotated[Runtime, Depends(runtime_ready)]


def too_many(expiry: int) -> HTTPException:
    return HTTPException(
        status_code=429, detail="Too many requests", headers={"Retry-After": str(expiry)}
    )


def per_ip(limit: str) -> Callable[..., Awaitable[None]]:
    """For routes anyone may call: counted per client address."""
    item = parse(limit)

    async def dependency(request: Request, runtime: Ready) -> None:
        ip = runtime.limits.client_ip(request)
        if not runtime.limits.hit(item, route_template(request), request.method, f"ip:{ip}"):
            raise too_many(item.get_expiry())

    return dependency


def per_user(limit: str) -> Callable[..., Awaitable[None]]:
    """For signed-in routes: counted per user."""
    item = parse(limit)

    async def dependency(
        request: Request, runtime: Ready, caller: Annotated[Caller, Depends(current_caller)]
    ) -> None:
        if not runtime.limits.hit(
            item, route_template(request), request.method, f"user:{caller.user_id}"
        ):
            raise too_many(item.get_expiry())

    return dependency


def check_user_limit(runtime: Runtime, request: Request, limit: str, user_id: str) -> None:
    """Refresh and logout carry a refresh token, not an access token: limit by its `sub`."""
    item = parse(limit)
    if not runtime.limits.hit(item, route_template(request), request.method, f"user:{user_id}"):
        raise too_many(item.get_expiry())


def error(status: int, code: str, msg: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "msg": msg})
