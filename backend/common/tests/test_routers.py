"""common.routers: deny by default, and the route-policy test every service runs (design 11.2)."""

from typing import Annotated

import pytest
from fastapi import APIRouter, Depends, FastAPI
from fastapi.routing import APIRoute

from common.authz import Caller, require, signed_in
from common.routers import (
    MissingPolicyError,
    PolicyRouter,
    assert_every_route_has_a_policy,
    public,
    route_policies,
    routes_without_a_policy,
)


def _routes(router: APIRouter) -> list[APIRoute]:
    return [route for route in router.routes if isinstance(route, APIRoute)]


def test_a_route_without_a_policy_is_refused_at_registration():
    router = PolicyRouter()
    with pytest.raises(MissingPolicyError, match="GET /open has no access policy"):

        @router.get("/open")
        async def open_route() -> None:
            return None  # pragma: no cover - never registered

    assert router.routes == []


def test_routes_with_a_policy_register():
    router = PolicyRouter(prefix="/api")

    @router.get("/health", dependencies=[Depends(public())])
    async def health() -> None:
        return None  # pragma: no cover - not called

    @router.get("/me")
    async def me(caller: Annotated[Caller, Depends(signed_in())]) -> None:
        return None  # pragma: no cover - not called

    assert [route.path for route in _routes(router)] == ["/api/health", "/api/me"]
    assert route_policies(_routes(router)[1]) == ["signed_in"]


def test_a_router_level_policy_covers_its_routes():
    router = PolicyRouter(dependencies=[Depends(require("accounts:list"))])

    @router.get("/accounts")
    async def accounts() -> None:
        return None  # pragma: no cover - not called

    assert route_policies(_routes(router)[0]) == ["require:accounts:list"]


def test_a_policy_nested_in_another_dependency_counts():
    async def current_admin(caller: Annotated[Caller, Depends(require("accounts:lock"))]) -> Caller:
        return caller  # pragma: no cover - not called

    router = PolicyRouter()

    @router.post("/accounts/{account_id}/lock")
    async def lock(account_id: str, admin: Annotated[Caller, Depends(current_admin)]) -> None:
        return None  # pragma: no cover - not called

    assert route_policies(_routes(router)[0]) == ["require:accounts:lock"]


def test_including_a_plain_router_is_checked_too():
    plain = APIRouter()

    @plain.get("/sneaky")
    async def sneaky() -> None:
        return None  # pragma: no cover - not called

    with pytest.raises(MissingPolicyError, match="/sneaky"):
        PolicyRouter().include_router(plain)


def test_the_route_policy_test_catches_routes_added_on_the_app():
    app = FastAPI()
    router = PolicyRouter()

    @router.get("/health", dependencies=[Depends(public())])
    async def health() -> None:
        return None  # pragma: no cover - not called

    app.include_router(router)
    assert_every_route_has_a_policy(app)  # the docs and openapi routes aren't API routes

    @app.get("/forgotten")
    async def forgotten() -> None:
        return None  # pragma: no cover - not called

    assert routes_without_a_policy(app) == ["GET /forgotten"]
    with pytest.raises(AssertionError, match="GET /forgotten"):
        assert_every_route_has_a_policy(app)


def test_public_returns_nothing():
    assert public()() is None
