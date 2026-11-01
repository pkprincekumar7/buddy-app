"""Run a service: its public app on port 8000 and its internal app on port 8001 (design 13.2).

    python -m common.serve <service>

`<service>.app.main` defines `app` (the public routes, behind the ALB) and `internal_app`
(the `/internal/*` routes, reached only through Cloud Map). They're separate ASGI apps on
separate ports, so an internal route can't be reached on the public port, whatever a
service's routers do. Both servers share one process and one event loop.

Every service gets the same observability here (15.5): JSON logs, traces for both apps,
and `X-Request-Id` on every request (common.logging.RequestIdMiddleware); the same cap
on request bodies (common.body_limit); and 422s that don't echo the submitted values
(common.validation).
"""

import asyncio
import contextlib
import importlib
import os
import re
import signal
import sys
from collections.abc import Iterator, Mapping, Sequence
from typing import Any, Protocol

import uvicorn
from fastapi import FastAPI

from common.body_limit import DEFAULT_MAX_BODY_BYTES, BodyLimitMiddleware
from common.logging import RequestIdMiddleware
from common.settings_base import STRICT_ENVS
from common.telemetry import setup_observability
from common.validation import redact_validation_errors

PUBLIC_PORT = 8000
INTERNAL_PORT = 8001

_SERVICE_RE = re.compile(r"[a-z][a-z0-9_]{0,30}")


class Runnable(Protocol):
    """What `serve` needs from a server: uvicorn.Server has both."""

    should_exit: bool

    async def serve(self) -> None: ...


class _Server(uvicorn.Server):
    """A uvicorn server that leaves signals to `serve`.

    Each uvicorn server installs its own SIGTERM handler, so with two in one process only
    the last one installed would stop. `serve` handles the signal once and stops both.
    """

    @contextlib.contextmanager
    def capture_signals(self) -> Iterator[None]:
        yield


def load_apps(service: str) -> tuple[Any, Any]:
    """`service`'s public and internal ASGI apps."""
    if not _SERVICE_RE.fullmatch(service):
        raise ValueError(f"invalid service name {service!r}")
    module = importlib.import_module(f"{service}.app.main")
    apps = []
    for attr in ("app", "internal_app"):
        asgi = getattr(module, attr, None)
        if asgi is None:
            raise ValueError(f"{service}.app.main defines no {attr}")
        apps.append(asgi)
    return apps[0], apps[1]


# Containers listen on all interfaces; security groups limit who reaches each port.
def build_servers(service: str, host: str = "0.0.0.0") -> list[uvicorn.Server]:  # nosec B104
    """The public and internal servers for `service`, not started. Each app is behind the
    body cap (common.body_limit): 1 MiB, or the service's `MAX_BODY_BYTES`; a FastAPI app
    also gets the redacted 422 handler (common.validation)."""
    apps = load_apps(service)
    for asgi in apps:
        if isinstance(asgi, FastAPI):
            redact_validation_errors(asgi)
    module = importlib.import_module(f"{service}.app.main")
    limit = int(getattr(module, "MAX_BODY_BYTES", DEFAULT_MAX_BODY_BYTES))
    return [
        _Server(
            uvicorn.Config(
                RequestIdMiddleware(BodyLimitMiddleware(asgi, limit)),
                host=host,
                port=port,
                server_header=False,
            )
        )
        for asgi, port in zip(apps, (PUBLIC_PORT, INTERNAL_PORT), strict=True)
    ]


def _stop(servers: Sequence[Runnable]) -> None:
    for server in servers:
        server.should_exit = True


async def serve(servers: Sequence[Runnable]) -> None:
    """Run the servers until a signal arrives or one of them stops, then stop the rest.

    A server that fails stops the others too, and its error is raised once they've shut
    down, so the container exits instead of running half a service. (uvicorn exits through
    SystemExit when it can't bind its port; asyncio raises that at once and cancels the rest.)
    """
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, _stop, servers)
    tasks = [asyncio.create_task(server.serve()) for server in servers]
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        _stop(servers)
        await asyncio.wait(tasks)
        for task in tasks:
            task.result()
    finally:
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.remove_signal_handler(sig)


def unsafe_http_environment(environ: Mapping[str, str]) -> list[str]:
    """What an HTTP runtime in stg or prod mustn't start with (AUTH-07); the settings check
    the rest (common.settings_base). Only these two are HTTP's alone: a worker has no proxy
    in front of it, and the image's unconfigured mode (no MONGODB_URI: 503 to everything)
    is for running it outside an environment, not for serving users."""
    if environ.get("APP_ENV") not in STRICT_ENVS:
        return []
    problems = []
    if environ.get("BEHIND_PROXY", "").strip().lower() not in {"1", "true", "yes", "on"}:
        problems.append("BEHIND_PROXY isn't true: client IPs would be the ALB's")
    if not environ.get("MONGODB_URI", "").strip():
        problems.append("MONGODB_URI is unset: every route but /health would answer 503")
    return problems


def main(argv: list[str], environ: Mapping[str, str] = os.environ) -> int:
    if len(argv) != 1:
        print("usage: python -m common.serve <service>", file=sys.stderr)
        return 2
    if problems := unsafe_http_environment(environ):
        print(
            f"unsafe settings for APP_ENV={environ['APP_ENV']}: " + "; ".join(problems),
            file=sys.stderr,
        )
        return 1
    servers = build_servers(argv[0])
    setup_observability(argv[0], apps=load_apps(argv[0]))
    asyncio.run(serve(servers))
    # uvicorn returns normally when the app's startup fails (unsafe settings, a database it
    # can't reach): it logs the error and never sets `started`. Exit non-zero then, so ECS
    # and the deploy see a failed task rather than a clean stop.
    if not all(getattr(server, "started", True) for server in servers):
        print(f"{argv[0]}: startup failed", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":  # pragma: no cover - the container's entry point; main() is tested
    sys.exit(main(sys.argv[1:]))
