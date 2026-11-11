"""A cap on request bodies, before the app reads them (Phase 5-6 review).

FastAPI parses a form or JSON body in full before any dependency runs (authentication,
rate limits, a route's own size check), and Starlette spools a file part to disk without a
limit. Nothing in front of the services caps a body either (the ALB doesn't). So without
this, any caller could make a task read and store a body of any size.

`BodyLimitMiddleware` refuses a declared `Content-Length` over the cap at once, and counts
a body sent without one (chunked) as it arrives, answering `413 body_too_large` as soon as
it's over. common.serve puts it in front of both of a service's apps: 1 MiB unless the
service's `app.main` sets `MAX_BODY_BYTES` (shared does, for a recording).
"""

from __future__ import annotations

import json

from starlette.types import ASGIApp, Message, Receive, Scope, Send

DEFAULT_MAX_BODY_BYTES = 1024 * 1024
_BODY = json.dumps(
    {"detail": {"code": "body_too_large", "msg": "The request body is too large."}}
).encode()


class _TooLarge(Exception):
    pass


class BodyLimitMiddleware:
    def __init__(self, app: ASGIApp, max_bytes: int = DEFAULT_MAX_BODY_BYTES) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        declared = dict(scope.get("headers") or []).get(b"content-length")
        if declared is not None:
            try:
                too_large = int(declared) > self.max_bytes
            except ValueError:
                too_large = True  # not a number: refuse rather than guess
            if too_large:
                await _refuse(send)
                return
        received = 0
        started = False
        over = False

        async def counted_receive() -> Message:
            nonlocal received, over
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    over = True
                    raise _TooLarge
            return message

        async def tracked_send(message: Message) -> None:
            nonlocal started
            if over:
                return  # the app's error response for our exception: ours goes instead
            started = started or message["type"] == "http.response.start"
            await send(message)

        try:
            await self.app(scope, counted_receive, tracked_send)
        except _TooLarge:
            pass
        except Exception:
            if not over:
                raise
        if over and not started:
            await _refuse(send)


async def _refuse(send: Send) -> None:
    await send(
        {
            "type": "http.response.start",
            "status": 413,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(_BODY)).encode()),
                (b"connection", b"close"),
            ],
        }
    )
    await send({"type": "http.response.body", "body": _BODY})
