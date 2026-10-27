"""common.serve: a service's public and internal apps on their own ports, stopped together."""

import asyncio
import gc
import os
import signal
import sys
import types
from typing import Any, cast

import pytest

from common import serve as serve_mod


def _fake_service(monkeypatch, name: str, **apps) -> None:
    """Register `<name>.app.main` with the given attributes, without a real package."""
    package, app_pkg, main = (
        types.ModuleType(n) for n in (name, f"{name}.app", f"{name}.app.main")
    )
    for attr, value in apps.items():
        setattr(main, attr, value)
    monkeypatch.setitem(sys.modules, name, package)
    monkeypatch.setitem(sys.modules, f"{name}.app", app_pkg)
    monkeypatch.setitem(sys.modules, f"{name}.app.main", main)


async def _asgi(scope, receive, send):  # pragma: no cover - never called, only passed around
    pass


async def _internal(scope, receive, send):  # pragma: no cover - never called, only passed around
    pass


def test_build_servers_puts_each_app_on_its_port(monkeypatch):
    _fake_service(monkeypatch, "svc_demo", app=_asgi, internal_app=_internal)
    public, internal = serve_mod.build_servers("svc_demo")
    # Each app behind the request-id middleware, so every request (and log line) has one,
    # then the body cap: 1 MiB unless the service sets MAX_BODY_BYTES.
    wrapped = [server.config.app for server in (public, internal)]
    assert all(isinstance(app, serve_mod.RequestIdMiddleware) for app in wrapped)
    capped = [cast(Any, app).app for app in wrapped]
    assert all(isinstance(app, serve_mod.BodyLimitMiddleware) for app in capped)
    assert [app.app for app in capped] == [_asgi, _internal]
    assert {app.max_bytes for app in capped} == {serve_mod.DEFAULT_MAX_BODY_BYTES}
    _fake_service(monkeypatch, "svc_big", app=_asgi, internal_app=_internal, MAX_BODY_BYTES=5)
    big = serve_mod.build_servers("svc_big")
    assert {cast(Any, s.config.app).app.max_bytes for s in big} == {5}
    assert (public.config.port, internal.config.port) == (
        serve_mod.PUBLIC_PORT,
        serve_mod.INTERNAL_PORT,
    )
    assert public.config.host == internal.config.host == "0.0.0.0"  # nosec B104
    assert not public.config.server_header


@pytest.mark.parametrize("missing", ["app", "internal_app"])
def test_build_servers_needs_both_apps(monkeypatch, missing):
    apps = {"app": _asgi, "internal_app": _internal}
    del apps[missing]
    _fake_service(monkeypatch, "svc_half", **apps)
    with pytest.raises(ValueError, match=missing):
        serve_mod.build_servers("svc_half")


@pytest.mark.parametrize("name", ["", "Hello", "1svc", "svc.app", "../svc", "a" * 32])
def test_build_servers_rejects_bad_names(name):
    with pytest.raises(ValueError, match="invalid service name"):
        serve_mod.build_servers(name)


def test_servers_leave_signals_alone():
    (server,) = [serve_mod._Server(serve_mod.uvicorn.Config(_asgi))]
    before = signal.getsignal(signal.SIGTERM)
    with server.capture_signals():
        assert signal.getsignal(signal.SIGTERM) is before


class _FakeServer:
    """Runs until told to exit, like uvicorn.Server, or fails at once."""

    def __init__(self, fail: BaseException | None = None, finish: bool = False):
        self.should_exit = False
        self.fail = fail
        self.finish = finish
        self.stopped = False

    async def serve(self):
        if self.fail:
            raise self.fail
        while not (self.should_exit or self.finish):
            await asyncio.sleep(0.01)
        self.stopped = True


def test_a_signal_stops_every_server():
    servers = [_FakeServer(), _FakeServer()]

    async def run():
        task = asyncio.create_task(serve_mod.serve(servers))
        await asyncio.sleep(0.05)
        os.kill(os.getpid(), signal.SIGTERM)
        await asyncio.wait_for(task, 2)

    asyncio.run(run())
    assert all(s.stopped for s in servers)


def test_one_server_stopping_stops_the_rest():
    servers = [_FakeServer(finish=True), _FakeServer()]
    asyncio.run(asyncio.wait_for(serve_mod.serve(servers), 2))
    assert all(s.stopped for s in servers)


def test_a_failing_server_stops_the_rest_and_raises():
    healthy = _FakeServer()
    with pytest.raises(RuntimeError, match="boom"):
        asyncio.run(
            asyncio.wait_for(serve_mod.serve([_FakeServer(fail=RuntimeError("boom")), healthy]), 2)
        )
    assert healthy.stopped


def test_a_server_that_cannot_bind_exits_the_process():
    # uvicorn calls sys.exit(1) when its port is taken. asyncio raises it straight out of
    # the loop, so the failed task's exception is never retrieved; the quiet handler keeps
    # asyncio from logging that when the task is collected.
    loop = asyncio.new_event_loop()
    loop.set_exception_handler(lambda _loop, _context: None)
    try:
        with pytest.raises(SystemExit):
            loop.run_until_complete(
                asyncio.wait_for(
                    serve_mod.serve([_FakeServer(fail=SystemExit(1)), _FakeServer()]), 2
                )
            )
    finally:
        # What asyncio.run does on the way out: cancel the server that never got to run.
        pending = asyncio.all_tasks(loop)
        for task in pending:
            task.cancel()
        loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
        loop.close()
        gc.collect()


def test_signal_handlers_are_removed_afterwards():
    async def run():
        await serve_mod.serve([_FakeServer(finish=True)])
        return asyncio.get_running_loop().remove_signal_handler(signal.SIGTERM)

    assert asyncio.run(run()) is False  # nothing left to remove


def test_main_needs_one_service_name(capsys):
    assert serve_mod.main([]) == 2
    assert serve_mod.main(["a", "b"]) == 2
    assert "usage" in capsys.readouterr().err


def test_main_serves_the_named_service(monkeypatch):
    seen = {}

    def fake_build(service):
        seen["service"] = service
        return ["servers"]

    async def fake_serve(servers):
        seen["servers"] = servers

    def fake_observe(service, apps):
        seen["observed"] = (service, apps)

    _fake_service(monkeypatch, "svc_main", app=_asgi, internal_app=_internal)
    monkeypatch.setattr(serve_mod, "build_servers", fake_build)
    monkeypatch.setattr(serve_mod, "serve", fake_serve)
    monkeypatch.setattr(serve_mod, "setup_observability", fake_observe)
    assert serve_mod.main(["svc_main"]) == 0
    assert seen == {
        "service": "svc_main",
        "servers": ["servers"],
        "observed": ("svc_main", (_asgi, _internal)),  # logs and traces for both apps
    }
