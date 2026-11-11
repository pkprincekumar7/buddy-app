"""The audit trail written by the permission check (docs/auth-users-split.md, 11.3).

Every privileged access (allowed only because of the role) and every denial is an audit
event. Each goes to the sinks of the service's AuditLog: by default a JSON line on the
`buddy.audit` logger, which the service ships to the dedicated audit log group. auth adds a
sink for its `audit` collection.

Only field **names** are ever recorded, never values.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable, Iterable
from dataclasses import asdict, dataclass, field
from typing import Literal

from starlette.requests import Request

AUDIT_LOGGER = "buddy.audit"

_logger = logging.getLogger(AUDIT_LOGGER)
_errors = logging.getLogger(__name__)


@dataclass(frozen=True)
class AuditEvent:
    actor_id: str
    actor_role: str
    permission: str
    subject_id: str | None
    privileged: bool
    outcome: Literal["allowed", "denied"]
    status: int
    method: str
    route: str
    request_id: str | None
    source_ip: str | None
    changed_fields: tuple[str, ...] = field(default=())

    def to_dict(self) -> dict[str, object]:
        data = asdict(self)
        data["changed_fields"] = list(self.changed_fields)
        return data


AuditSink = Callable[[AuditEvent], None]


def log_sink(event: AuditEvent) -> None:
    _logger.info(json.dumps({"audit": event.to_dict()}, sort_keys=True))


def should_record(event: AuditEvent) -> bool:
    """Privileged accesses and denials are recorded; a parent reading their own data isn't."""
    return event.privileged or event.outcome == "denied"


class AuditLog:
    def __init__(self, sinks: Iterable[AuditSink] = (log_sink,)) -> None:
        self.sinks: list[AuditSink] = list(sinks)

    def record(self, event: AuditEvent) -> None:
        if not should_record(event):
            return
        for sink in self.sinks:
            # A broken sink must not turn an allowed request into an error, nor stop the
            # other sinks; the failure itself is logged.
            try:
                sink(event)
            except Exception:
                _errors.exception("audit sink %r failed", sink)


def source_ip(request: Request) -> str | None:
    """The viewer's IP: CloudFront's `CloudFront-Viewer-Address` ("ip:port"), else the peer."""
    viewer = request.headers.get("cloudfront-viewer-address")
    if viewer:
        return viewer.rsplit(":", 1)[0].strip("[]")
    return request.client.host if request.client else None


def route_template(request: Request) -> str:
    """The route's path template (`/api/v1/users/{user_id}/profile`), not the concrete path."""
    route = request.scope.get("route")
    return getattr(route, "path", None) or request.url.path
