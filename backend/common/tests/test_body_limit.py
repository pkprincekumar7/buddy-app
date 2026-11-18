"""common.body_limit: a body over the cap is refused before the app has read it all."""

import asyncio
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
from fastapi import FastAPI, Request

from common.body_limit import BodyLimitMiddleware

LIMIT = 1000

api = FastAPI()
seen: list[int] = []


@api.post("/echo")
async def echo(request: Request) -> dict[str, int]:
    body = await request.body()
    seen.append(len(body))
    return {"size": len(body)}


@api.post("/form")
async def form(request: Request) -> dict[str, int]:
    parsed = await request.form()
    return {"fields": len(parsed)}


def _call(
    app: Any, path: str, content: Any, headers: dict[str, str] | None = None
) -> httpx.Response:
    async def go() -> httpx.Response:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as http:
            return await http.post(path, content=content, headers=headers or {})

    return asyncio.run(go())


async def _chunks(total: int, size: int = 100) -> AsyncIterator[bytes]:
    # A well-formed start of a file part, then its bytes: a real form, just too big.
    yield b'--b\r\nContent-Disposition: form-data; name="f"; filename="a"\r\n\r\n'
    for _ in range(total // size):
        yield b"x" * size


def test_a_body_under_the_cap_goes_through():
    seen.clear()
    response = _call(BodyLimitMiddleware(api, LIMIT), "/echo", b"x" * LIMIT)
    assert response.json() == {"size": LIMIT} and seen == [LIMIT]


def test_a_declared_length_over_the_cap_is_refused_unread():
    seen.clear()
    response = _call(BodyLimitMiddleware(api, LIMIT), "/echo", b"x" * (LIMIT + 1))
    assert response.status_code == 413
    assert response.json()["detail"]["code"] == "body_too_large"
    assert seen == []  # the app never ran
    odd = _call(BodyLimitMiddleware(api, LIMIT), "/echo", b"x", headers={"content-length": "lots"})
    assert odd.status_code == 413


@pytest.mark.parametrize("path", ["/echo", "/form"])
def test_a_chunked_body_is_cut_off_once_over(path):
    # No Content-Length: counted as it arrives; the app's 500 for the cut is replaced.
    seen.clear()
    response = _call(
        BodyLimitMiddleware(api, LIMIT),
        path,
        _chunks(LIMIT * 5),
        headers={"content-type": "multipart/form-data; boundary=b"},
    )
    assert response.status_code == 413 and seen == []


async def _streaming_then_reading(scope: Any, receive: Any, send: Any) -> None:
    # An app that answers before it has read the body: the cap can't replace its answer.
    await send({"type": "http.response.start", "status": 200, "headers": []})
    while (await receive()).get("more_body"):
        pass  # pragma: no cover - the cap raises first


def test_an_answer_already_started_is_left_alone():
    with pytest.raises(Exception):  # noqa: B017 - the transport sees the cut response
        _call(BodyLimitMiddleware(_streaming_then_reading, LIMIT), "/", _chunks(LIMIT * 5))


async def _wrapping(scope: Any, receive: Any, send: Any) -> None:
    # An app that turns the cut into an error of its own.
    try:
        while (await receive()).get("more_body"):
            pass  # pragma: no cover - the cap raises first
    except Exception as exc:
        raise RuntimeError("body read failed") from exc


async def _broken(scope: Any, receive: Any, send: Any) -> None:
    raise RuntimeError("a bug")


def test_other_errors_pass_through_unless_the_cap_caused_them():
    assert _call(BodyLimitMiddleware(_wrapping, LIMIT), "/", _chunks(LIMIT * 5)).status_code == 413
    with pytest.raises(RuntimeError, match="a bug"):
        _call(BodyLimitMiddleware(_broken, LIMIT), "/", b"x")


def test_lifespan_and_other_scopes_pass_through():
    calls: list[str] = []

    async def app(scope: Any, receive: Any, send: Any) -> None:
        calls.append(scope["type"])

    asyncio.run(BodyLimitMiddleware(app, LIMIT)({"type": "lifespan"}, None, None))  # type: ignore[arg-type]
    assert calls == ["lifespan"]


def test_a_disconnect_passes_through_uncounted():
    got: list[str] = []

    async def app(scope: Any, receive: Any, send: Any) -> None:
        got.append((await receive())["type"])

    async def receive() -> dict[str, Any]:
        return {"type": "http.disconnect"}

    async def send(message: Any) -> None:  # pragma: no cover - the app sends nothing
        pass

    scope = {"type": "http", "headers": []}
    asyncio.run(BodyLimitMiddleware(app, LIMIT)(scope, receive, send))
    assert got == ["http.disconnect"]
