"""JSON logs with trace and request ids, and no personal data (docs/auth-users-split.md, 15.5).

Every line is one JSON object: `time`, `level`, `logger`, `message`, `service`, and, when
known, `trace_id`, `span_id` (so CloudWatch jumps to the trace in X-Ray) and `request_id`.
Fields passed with `extra={...}` are included, except personal data: emails, names,
addresses and similar keys are dropped, and anything that looks like an email in a message
is masked. Log ids, never people.

`RequestIdMiddleware` takes `X-Request-Id` from the gateway (or makes one) and returns it.
"""

from __future__ import annotations

import contextvars
import json
import logging
import re
import sys
import uuid
from datetime import UTC, datetime
from typing import Any

from opentelemetry import trace
from starlette.types import ASGIApp, Message, Receive, Scope, Send

request_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "request_id", default=None
)

# Keys never written, whatever a caller passes in `extra`.
PERSONAL_KEYS: frozenset[str] = frozenset(
    {
        "email",
        "email_address",
        "name",
        "first_name",
        "middle_name",
        "last_name",
        "full_name",
        "child_name",
        "address",
        "address_line1",
        "address_line2",
        "street",
        "city",
        "postcode",
        "postal_code",
        "zip",
        "phone",
        "phone_number",
        "date_of_birth",
        "password",
        "token",
        "access_token",
        "refresh_token",
        "authorization",
        "cookie",
    }
)

_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_REQUEST_ID_RE = re.compile(r"[A-Za-z0-9._-]{1,128}")

# LogRecord's own attributes: anything else on a record came from `extra`.
_RECORD_ATTRS = frozenset(vars(logging.LogRecord("", 0, "", 0, "", None, None))) | {
    "message",
    "asctime",
    "taskName",
}


def mask_emails(text: str) -> str:
    return _EMAIL_RE.sub("[email]", text)


def _clean(value: Any) -> Any:
    """Drop personal keys at any depth, and mask emails in strings."""
    if isinstance(value, dict):
        return {k: _clean(v) for k, v in value.items() if str(k).lower() not in PERSONAL_KEYS}
    if isinstance(value, list | tuple):
        return [_clean(v) for v in value]
    if isinstance(value, str):
        return mask_emails(value)
    return value


class JsonFormatter(logging.Formatter):
    def __init__(self, service: str) -> None:
        super().__init__()
        self.service = service

    def format(self, record: logging.LogRecord) -> str:
        line: dict[str, Any] = {
            "time": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "message": mask_emails(record.getMessage()),
            "service": self.service,
        }
        context = trace.get_current_span().get_span_context()
        if context.is_valid:
            line["trace_id"] = format(context.trace_id, "032x")
            line["span_id"] = format(context.span_id, "016x")
        request_id = request_id_var.get()
        if request_id:
            line["request_id"] = request_id
        for key, value in vars(record).items():
            if key in _RECORD_ATTRS or key in line or key.lower() in PERSONAL_KEYS:
                continue
            line[key] = _clean(value)
        if record.exc_info:
            line["exception"] = mask_emails(self.formatException(record.exc_info))
        return json.dumps(line, default=str, sort_keys=True)


def configure_logging(service: str, level: str = "INFO") -> None:
    """One JSON handler on the root logger, on stdout (the awslogs driver ships it)."""
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter(service))
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)
    # Access logs repeat what the request span records; keep uvicorn's errors only.
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)


class RequestIdMiddleware:
    """Carries `X-Request-Id` through the request (logs, internal calls) and back out."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        incoming = dict(scope.get("headers") or []).get(b"x-request-id", b"").decode("latin-1")
        request_id = incoming if _REQUEST_ID_RE.fullmatch(incoming) else str(uuid.uuid4())
        token = request_id_var.set(request_id)

        async def send_with_id(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = [h for h in message.get("headers", []) if h[0].lower() != b"x-request-id"]
                headers.append((b"x-request-id", request_id.encode("latin-1")))
                message = {**message, "headers": headers}
            await send(message)

        try:
            await self.app(scope, receive, send_with_id)
        finally:
            request_id_var.reset(token)
