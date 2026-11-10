"""JSON logs with trace and request ids, and no personal data (docs/auth-users-split.md, 15.5).

Every line is one JSON object: `time`, `level`, `logger`, `message`, `service`, and, when
known, `trace_id`, `span_id` (so CloudWatch jumps to the trace in X-Ray) and `request_id`.
Fields passed with `extra={...}` are included, except personal data: emails, names,
addresses and similar keys are dropped, and anything that looks like an email in a message
is masked. Log ids, never people.

`RequestIdMiddleware` takes `X-Request-Id` from the gateway (or makes one) and returns it,
and writes one access line per request (production-readiness review, OBS-04):

    {"logger": "common.access", "message": "GET /api/v1/children 200 12ms",
     "method": "GET", "path": "/api/v1/children", "route": "/api/v1/children",
     "status": 200, "latency_ms": 12, "user": "<16 hex>", "request_id": "..."}

`user` is a hash of the signed-in user's id (common.authz records it on the request), so
lines for one user can be grouped without the id itself. Successful health checks aren't
logged: the load balancer and the container check poll them every few seconds. The
request id also goes on internal calls (common.internal_client), the jobs a request
starts (common.generation.jobs) and the events it writes (common.events).
"""

from __future__ import annotations

import contextvars
import hashlib
import json
import logging
import re
import sys
import time
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
_access = logging.getLogger("common.access")
# Polled by the load balancer and the container health check: logged only when they fail.
QUIET_PATHS = frozenset({"/health", "/api/health"})
# Where common.authz leaves the signed-in user's id for the access line (scope["state"]).
USER_ID_STATE = "user_id"

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


def is_request_id(value: object) -> bool:
    """A request id worth carrying: what RequestIdMiddleware accepts from a gateway."""
    return isinstance(value, str) and bool(_REQUEST_ID_RE.fullmatch(value))


def current_request_id(headers: Any = None) -> str | None:
    """This request's id (RequestIdMiddleware's), else a valid X-Request-Id in `headers`
    (an app called without the middleware, as in tests)."""
    request_id = request_id_var.get()
    if request_id:
        return request_id
    incoming = headers.get("x-request-id") if headers is not None else None
    return incoming if is_request_id(incoming) else None


def user_hash(user_id: str) -> str:
    """A stable stand-in for a user id in logs: the first 16 hex characters of its SHA-256."""
    return hashlib.sha256(user_id.encode()).hexdigest()[:16]


class RequestIdMiddleware:
    """Carries `X-Request-Id` through the request (logs, internal calls) and back out, and
    writes the request's access line."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        incoming = dict(scope.get("headers") or []).get(b"x-request-id", b"").decode("latin-1")
        request_id = incoming if _REQUEST_ID_RE.fullmatch(incoming) else str(uuid.uuid4())
        token = request_id_var.set(request_id)
        started = time.perf_counter()
        status = 500  # unless a response starts: an app that raised before sending one

        async def send_with_id(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = int(message["status"])
                headers = [h for h in message.get("headers", []) if h[0].lower() != b"x-request-id"]
                headers.append((b"x-request-id", request_id.encode("latin-1")))
                message = {**message, "headers": headers}
            await send(message)

        try:
            await self.app(scope, receive, send_with_id)
        finally:
            _log_access(scope, request_id, status, round((time.perf_counter() - started) * 1000))
            request_id_var.reset(token)


def _log_access(scope: Scope, request_id: str, status: int, latency_ms: int) -> None:
    path = str(scope.get("path", ""))
    if path in QUIET_PATHS and status < 400:
        return
    method = str(scope.get("method", ""))
    route = getattr(scope.get("route"), "path", None) or path
    fields: dict[str, Any] = {
        "method": method,
        "path": path,
        "route": route,
        "status": status,
        "latency_ms": latency_ms,
        # On the record itself, not only from the context: a handler that formats later
        # (a queue) would find the context reset.
        "request_id": request_id,
    }
    state = scope.get("state")
    user_id = state.get(USER_ID_STATE) if isinstance(state, dict) else None
    if isinstance(user_id, str) and user_id:
        fields["user"] = user_hash(user_id)
    _access.info("%s %s %s %sms", method, path, status, latency_ms, extra=fields)
