"""Deny by default: every route declares who may call it (docs/auth-users-split.md, 11.2).

- `PolicyRouter` refuses to register a route without an access policy, at import time.
- `assert_every_route_has_a_policy(app)` is the route-policy test: it walks `app.routes`, so
  it also catches routes added straight onto the app or through a plain APIRouter.
- `public()` is the policy for routes anyone may call (login, register, health).

A policy is a dependency marked by common.authz.mark_policy: `public()`, `signed_in()`,
`require(...)` or `require_self_or(...)`, on the route, its router or a nested dependency.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, FastAPI
from fastapi.dependencies.models import Dependant
from fastapi.routing import APIRoute

from common.authz import POLICY_ATTR, mark_policy


class MissingPolicyError(RuntimeError):
    """A route was registered without an access policy."""


def public() -> Callable[[], None]:
    """Anyone may call the route, signed in or not."""

    def dependency() -> None:
        return None

    return mark_policy("public", dependency)


def route_policies(route: APIRoute) -> list[str]:
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


def _describe(route: APIRoute) -> str:
    return f"{' '.join(sorted(route.methods))} {route.path}"


class PolicyRouter(APIRouter):
    """An APIRouter that won't register a route without an access policy."""

    def add_api_route(self, path: str, endpoint: Callable[..., Any], **kwargs: Any) -> None:
        super().add_api_route(path, endpoint, **kwargs)
        route = self.routes[-1]
        if isinstance(route, APIRoute) and not route_policies(route):
            self.routes.pop()
            raise MissingPolicyError(
                f"{_describe(route)} has no access policy: add public(), signed_in(), "
                "require(...) or require_self_or(...)"
            )


def routes_without_a_policy(app: FastAPI) -> list[str]:
    return [
        _describe(route)
        for route in app.routes
        if isinstance(route, APIRoute) and not route_policies(route)
    ]


def assert_every_route_has_a_policy(app: FastAPI) -> None:
    """The route-policy test every service runs against its public app."""
    missing = routes_without_a_policy(app)
    assert not missing, "routes without an access policy:\n  " + "\n  ".join(missing)
