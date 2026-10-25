"""Run a service: its public app on port 8000 and its internal app on port 8001 (design 13.2).

    python -m common.serve <service>

`<service>.app.main` defines `app` (the public routes, behind the ALB) and `internal_app`
(the `/internal/*` routes, reached only through Cloud Map). They're separate ASGI apps on
separate ports, so an internal route can't be reached on the public port, whatever a
service's routers do. Both servers share one process and one event loop.

Every service gets the same observability here (15.5): JSON logs, traces for both apps,
and `X-Request-Id` on every request (common.logging.RequestIdMiddleware).
"""

import asyncio
import contextlib
import importlib
import re
import signal
import sys
from collections.abc import Iterator, Sequence
from typing import Any, Protocol

import uvicorn

from common.logging import RequestIdMiddleware
from common.telemetry import setup_observability

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
    """The public and internal servers for `service`, not started."""
    return [
        _Server(
            uvicorn.Config(RequestIdMiddleware(asgi), host=host, port=port, server_header=False)
        )
        for asgi, port in zip(load_apps(service), (PUBLIC_PORT, INTERNAL_PORT), strict=True)
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


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print("usage: python -m common.serve <service>", file=sys.stderr)
        return 2
    servers = build_servers(argv[0])
    setup_observability(argv[0], apps=load_apps(argv[0]))
    asyncio.run(serve(servers))
    return 0


if __name__ == "__main__":  # pragma: no cover - the container's entry point; main() is tested
    sys.exit(main(sys.argv[1:]))
