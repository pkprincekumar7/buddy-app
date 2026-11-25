"""Deny by default: every route declares who may call it (docs/auth-users-split.md, 11.2).

- `PolicyRouter` refuses to register a route without an access policy, at import time, and
  refuses to include a router (a plain APIRouter too) with any such route in it.
- `assert_every_route_has_a_policy(app)` is the route-policy test: it walks every route the
  app serves, through every included router, so it also catches routes added straight onto
  the app or through a plain APIRouter.
- `api_routes(app)` lists those routes with their full paths, for tests that look at them.
- `public()` is the policy for routes anyone may call (login, register, health).

A policy is a dependency marked by common.authz.mark_policy: `public()`, `signed_in()`,
`require(...)` or `require_self_or(...)`, on the route, its router, an include_router call
or a nested dependency.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any, Protocol

from fastapi import APIRouter, FastAPI
from fastapi.dependencies.models import Dependant
from fastapi.routing import APIRoute, iter_route_contexts
from starlette.routing import BaseRoute

from common.authz import POLICY_ATTR, mark_policy


class MissingPolicyError(RuntimeError):
    """A route was registered without an access policy."""


def public() -> Callable[[], None]:
    """Anyone may call the route, signed in or not."""

    def dependency() -> None:
        return None

    return mark_policy("public", dependency)


@dataclass(frozen=True)
class EffectiveRoute:
    """An API route as the app serves it: full path, and every dependency that runs for it
    (its own, its routers' and each include_router call's)."""

    path: str
    methods: frozenset[str]
    dependant: Dependant


def _effective_api_routes(routes: Sequence[BaseRoute]) -> list[EffectiveRoute]:
    # From FastAPI 0.137, include_router no longer copies the included router's routes: it
    # adds one entry that holds the router, so routes form a tree and `router.routes` is "an
    # internal implementation detail" (0.137.0 release notes). iter_route_contexts is how
    # FastAPI's own OpenAPI generation walks that tree; each context it yields reads like
    # the route with the prefixes and dependencies of every inclusion above it applied. It
    # isn't in FastAPI's docs yet, so it's used here and nowhere else.
    found: list[EffectiveRoute] = []
    for context in iter_route_contexts(routes):
        if not isinstance(context.original_route, APIRoute):
            continue  # the docs and openapi routes, websockets, static files
        found.append(
            EffectiveRoute(
                path=context.path or "",
                methods=frozenset(context.methods or ()),
                dependant=context.dependant,
            )
        )
    return found


def api_routes(app: FastAPI | APIRouter) -> list[EffectiveRoute]:
    """Every API route `app` serves, through every router included in it."""
    return _effective_api_routes(app.routes)


class _HasDependant(Protocol):
    @property
    def dependant(self) -> Dependant: ...


def route_policies(route: _HasDependant) -> list[str]:
    """The policies guarding `route`, found anywhere in its dependency tree."""
    found: set[str] = set()
    stack: list[Dependant] = [route.dependant]
    while stack:
        dependant = stack.pop()
        name = getattr(dependant.call, POLICY_ATTR, None)
        if isinstance(name, str):
            found.add(name)
        stack.extend(dependant.dependencies)
    return sorted(found)


def _describe(route: APIRoute | EffectiveRoute) -> str:
    # Newer FastAPI types methods as optional (set[str] | None); a route always has them
    # (GET by default), so `or ()` is only for the type checker.
    return f"{' '.join(sorted(route.methods or ()))} {route.path}"


def _missing_policy(route: APIRoute | EffectiveRoute) -> MissingPolicyError:
    return MissingPolicyError(
        f"{_describe(route)} has no access policy: add public(), signed_in(), "
        "require(...) or require_self_or(...)"
    )


class PolicyRouter(APIRouter):
    """An APIRouter that won't register a route, or include a router, without an access policy."""

    def add_api_route(self, path: str, endpoint: Callable[..., Any], **kwargs: Any) -> None:
        super().add_api_route(path, endpoint, **kwargs)
        route = self.routes[-1]
        if isinstance(route, APIRoute) and not route_policies(route):
            self.routes.pop()
            raise _missing_policy(route)

    def include_router(self, router: APIRouter, **kwargs: Any) -> None:
        # The included router's routes don't pass through add_api_route (see
        # _effective_api_routes), so they're checked first, on a probe router with this
        # router's prefix and dependencies: as they'll be served, and before anything is added.
        probe = APIRouter(prefix=self.prefix, dependencies=self.dependencies)
        probe.include_router(router, **kwargs)
        for route in api_routes(probe):
            if not route_policies(route):
                raise _missing_policy(route)
        super().include_router(router, **kwargs)


def routes_without_a_policy(app: FastAPI) -> list[str]:
    return [_describe(route) for route in api_routes(app) if not route_policies(route)]


def assert_every_route_has_a_policy(app: FastAPI) -> None:
    """The route-policy test every service runs against its public app."""
    missing = routes_without_a_policy(app)
    assert not missing, "routes without an access policy:\n  " + "\n  ".join(missing)
