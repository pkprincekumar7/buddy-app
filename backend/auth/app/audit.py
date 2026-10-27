"""auth's audit trail (docs/auth-users-split.md, 5.2, 11.3).

Every service sends privileged accesses and denials to the audit log stream; auth also
keeps them in its `audit` collection, sharded on the actor's location. A row is written
**after** the change it describes, never inside that change's zone transaction, so the
insert runs as its own task: it can't slow or fail the request, and a failure is logged.

`AuthAuthorizer` is common's Authorizer with that second sink: `common.audit.AuditEvent`
has no location, so the row's location comes from the caller here.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from starlette.requests import Request

from auth.app.store import AUDIT
from common.audit import AuditEvent, AuditLog, route_template, should_record, source_ip
from common.authz import Authorizer, Caller
from common.events.store import Db

_logger = logging.getLogger(__name__)


class AuditTrail:
    def __init__(self, db: Db, log: AuditLog | None = None) -> None:
        self.db = db
        self.log = log if log is not None else AuditLog()
        self._pending: set[asyncio.Task[None]] = set()

    def record(self, event: AuditEvent, location: str) -> None:
        self.log.record(event)
        if not should_record(event):
            return
        task = asyncio.get_running_loop().create_task(self._insert(event, location))
        self._pending.add(task)
        task.add_done_callback(self._pending.discard)

    async def _insert(self, event: AuditEvent, location: str) -> None:
        row: dict[str, Any] = {
            "_id": str(uuid.uuid4()),
            "actor_id": event.actor_id,
            "actor_role": event.actor_role,
            "location": location,
            "permission": event.permission,
            "subject_id": event.subject_id,
            "privileged": event.privileged,
            "outcome": event.outcome,
            "status_code": event.status,
            "request_id": event.request_id,
            "source_ip": event.source_ip,
            "route": event.route,
            "changed_fields": list(event.changed_fields),
            "created_at": datetime.now(UTC),
        }
        try:
            await self.db[AUDIT].insert_one(row)
        except Exception:
            _logger.exception("audit row not saved (the log stream has the event)")

    async def flush(self) -> None:
        """Wait for the rows still being written (tests, and shutdown)."""
        if self._pending:
            await asyncio.gather(*self._pending, return_exceptions=True)

    def action(
        self,
        request: Request,
        caller: Caller,
        permission: str,
        subject_id: str,
        changed_fields: tuple[str, ...] = (),
    ) -> None:
        """An admin's change to another account, with the changed field names (11.3)."""
        self.record(
            AuditEvent(
                actor_id=caller.user_id,
                actor_role=caller.role,
                permission=permission,
                subject_id=subject_id,
                privileged=True,
                outcome="allowed",
                status=200,
                method=request.method,
                route=route_template(request),
                request_id=request.headers.get("x-request-id"),
                source_ip=source_ip(request),
                changed_fields=tuple(sorted(changed_fields)),
            ),
            caller.location,
        )


class AuthAuthorizer(Authorizer):
    """Every check's audit event also goes to auth's `audit` collection."""

    def __init__(self, *args: Any, trail: AuditTrail, **kwargs: Any) -> None:
        super().__init__(*args, audit=trail.log, **kwargs)
        self.trail = trail

    def record(
        self,
        request: Request,
        caller: Caller,
        permission: str,
        subject_id: str | None,
        *,
        privileged: bool,
        status: int | None = None,
    ) -> None:
        self.trail.record(
            AuditEvent(
                actor_id=caller.user_id,
                actor_role=caller.role,
                permission=permission,
                subject_id=subject_id,
                privileged=privileged,
                outcome="allowed" if status is None else "denied",
                status=status if status is not None else 200,
                method=request.method,
                route=route_template(request),
                request_id=request.headers.get("x-request-id"),
                source_ip=source_ip(request),
            ),
            caller.location,
        )
