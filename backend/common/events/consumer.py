"""The SQS consumer (docs/auth-users-split.md, 7.2–7.4).

Each message is the SNS envelope (raw delivery is off), so its `TopicArn` says which
service published it. A message is handled only if all of these hold:
- it's an SNS notification from a topic named `{prefix}-{service}-events`;
- the event is in the catalogue, isn't reserved, and this service subscribes to it;
- the topic's service produces that event type. `user.data_deleted` may come from any
  service holding user data, and the handler is told which one (from the topic, never the
  payload), so grow can't confirm a deletion on behalf of users;
- the envelope is well formed and the payload matches its schema.

Anything else is **rejected**: not handled, and not deleted, so it reaches the DLQ after 5
receives and the DLQ alarm fires. A handler that raises leaves its message too: it comes
back after the visibility timeout.

Every handler must be safe to run twice (7.4). `dedupe=True` adds the opt-in inbox for one
that can't be: the inbox row and the handler's writes share one transaction.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.mongo_client import AsyncMongoClient
from pymongo.errors import DuplicateKeyError

from common.events import catalogue as catalogue_mod
from common.events.envelope import Event, InvalidEvent, ReceivedEvent
from common.events.store import INBOX, Db
from common.telemetry import linked_span

_logger = logging.getLogger(__name__)

Handler = Callable[[ReceivedEvent, AsyncClientSession | None], Awaitable[None]]

_TOPIC_ARN_RE = re.compile(r"arn:aws:sns:[a-z0-9-]+:[0-9]{12}:([A-Za-z0-9_-]{1,256})")


class Outcome(StrEnum):
    HANDLED = "handled"
    DUPLICATE = "duplicate"  # already in the inbox
    REJECTED = "rejected"  # left for the DLQ


@dataclass(frozen=True)
class _Registration:
    handler: Handler
    dedupe: bool


class Rejected(Exception):
    """Why a message was rejected; logged, never raised past handle_body."""


class Consumer:
    def __init__(
        self,
        service: str,
        *,
        topic_prefix: str,
        db: Db | None = None,
        client: AsyncMongoClient[dict[str, Any]] | None = None,
        catalogue: catalogue_mod.Catalogue | None = None,
    ) -> None:
        self.service = service
        self.topic_prefix = topic_prefix
        self.db = db
        self.client = client
        self.catalogue = catalogue or catalogue_mod.load()
        self.subscriptions = frozenset(self.catalogue.subscriptions(service))
        self._handlers: dict[str, _Registration] = {}

    # ── registration ──────────────────────────────────────────────────────────

    def handler(self, event_type: str, *, dedupe: bool = False) -> Callable[[Handler], Handler]:
        """Register the handler for `event_type`, which this service must subscribe to."""
        if event_type not in self.subscriptions:
            raise ValueError(f"{self.service} doesn't subscribe to {event_type!r} (catalogue.json)")
        if event_type in self._handlers:
            raise ValueError(f"{event_type} already has a handler")
        if dedupe and (self.db is None or self.client is None):
            raise ValueError("dedupe=True needs the consumer's db and client (for the inbox)")

        def register(fn: Handler) -> Handler:
            self._handlers[event_type] = _Registration(fn, dedupe)
            return fn

        return register

    def missing_handlers(self) -> list[str]:
        """Subscribed event types with no handler; the contract test requires none."""
        return sorted(self.subscriptions - set(self._handlers))

    # ── checks ────────────────────────────────────────────────────────────────

    def source_service(self, topic_arn: object) -> str | None:
        """The producer, from a topic named `{prefix}-{service}-events`; None otherwise."""
        if not isinstance(topic_arn, str):
            return None
        match = _TOPIC_ARN_RE.fullmatch(topic_arn)
        if not match:
            return None
        name = match.group(1)
        head, tail = f"{self.topic_prefix}-", "-events"
        if not (name.startswith(head) and name.endswith(tail)):
            return None
        service = name[len(head) : -len(tail)]
        return service or None

    def check(self, body: str, message_id: str = "") -> ReceivedEvent:
        """The checked event, or Rejected saying why."""
        try:
            envelope = json.loads(body)
        except json.JSONDecodeError as exc:
            raise Rejected("body isn't JSON") from exc
        if not isinstance(envelope, dict) or envelope.get("Type") != "Notification":
            raise Rejected("not an SNS notification (is raw delivery on?)")
        topic_arn = envelope.get("TopicArn")
        source = self.source_service(topic_arn)
        if source is None:
            raise Rejected(f"unexpected topic {topic_arn!r}")
        attributes = envelope.get("MessageAttributes") or {}
        if not isinstance(attributes, dict):
            raise Rejected("malformed message attributes")
        trace = attributes.get("traceparent", {})
        message = envelope.get("Message")
        if not isinstance(message, str):
            raise Rejected("no message")
        try:
            event = Event.from_message(
                message, traceparent=trace.get("Value") if isinstance(trace, dict) else None
            )
        except InvalidEvent as exc:
            raise Rejected(str(exc)) from exc
        attr_type = attributes.get("event_type", {})
        if not isinstance(attr_type, dict) or attr_type.get("Value") != event.event_type:
            # The filter policy matched the attribute; the body must agree with it.
            raise Rejected("event_type attribute doesn't match the message")
        try:
            spec = self.catalogue.spec(event.event_type)
        except KeyError as exc:
            raise Rejected(str(exc)) from exc
        if spec.reserved:
            raise Rejected(f"{event.event_type} is reserved")
        if event.schema != spec.schema:
            raise Rejected(f"schema {event.schema} isn't the catalogue's {spec.schema}")
        if not spec.produced_by(source, self.catalogue.data_services):
            raise Rejected(f"{event.event_type} can't come from {source}'s topic")
        if event.event_type not in self.subscriptions:
            raise Rejected(f"{self.service} doesn't subscribe to {event.event_type}")
        return ReceivedEvent(
            event=event, source_service=source, topic_arn=str(topic_arn), message_id=message_id
        )

    # ── handling ──────────────────────────────────────────────────────────────

    async def handle_body(self, body: str, message_id: str = "") -> Outcome:
        try:
            received = self.check(body, message_id)
        except Rejected as exc:
            _logger.error("event rejected (message %s): %s", message_id, exc)
            return Outcome.REJECTED
        registration = self._handlers.get(received.event_type)
        if registration is None:
            raise LookupError(f"no handler for {received.event_type} in {self.service}")
        # A new trace linked to the producer's span, not a child of it (15.5).
        with linked_span(
            f"consume {received.event_type}",
            received.event.traceparent,
            **{
                "messaging.system": "aws_sqs",
                "buddy.event_type": received.event_type,
                "buddy.source_service": received.source_service,
            },
        ):
            if not registration.dedupe:
                await registration.handler(received, None)
                return Outcome.HANDLED
            return await self._handle_once(received, registration.handler)

    async def _handle_once(self, received: ReceivedEvent, handler: Handler) -> Outcome:
        assert self.db is not None and self.client is not None  # checked at registration
        inbox_written = False
        try:
            async with self.client.start_session() as session, await session.start_transaction():
                await self.db[INBOX].insert_one(
                    {
                        "_id": received.event.event_id,
                        "event_type": received.event_type,
                        "processed_at": datetime.now(UTC),
                    },
                    session=session,
                )
                inbox_written = True
                await handler(received, session)
        except DuplicateKeyError:
            if inbox_written:
                raise  # the handler's own write, not the inbox
            return Outcome.DUPLICATE
        return Outcome.HANDLED

    async def poll_once(self, sqs: Any, queue_url: str, *, wait_seconds: int = 20) -> int:
        """Receive one batch and handle it. Returns how many messages were deleted."""
        response = await asyncio.to_thread(
            sqs.receive_message,
            QueueUrl=queue_url,
            MaxNumberOfMessages=10,
            WaitTimeSeconds=wait_seconds,
        )
        deleted = 0
        for message in response.get("Messages", []):
            try:
                outcome = await self.handle_body(message["Body"], message.get("MessageId", ""))
            except Exception:
                _logger.exception("event handler failed (message %s)", message.get("MessageId"))
                continue  # back after the visibility timeout; the DLQ after 5 receives
            if outcome is Outcome.REJECTED:
                continue
            await asyncio.to_thread(
                sqs.delete_message, QueueUrl=queue_url, ReceiptHandle=message["ReceiptHandle"]
            )
            deleted += 1
        return deleted

    async def run(
        self, sqs: Any, queue_url: str, stop: asyncio.Event, *, wait_seconds: int = 20
    ) -> None:
        """Long-poll until `stop` is set (within one poll's `wait_seconds`)."""
        while not stop.is_set():
            try:
                await self.poll_once(sqs, queue_url, wait_seconds=wait_seconds)
            except Exception:
                _logger.exception("polling %s failed; retrying", queue_url)
                with contextlib.suppress(TimeoutError):
                    await asyncio.wait_for(stop.wait(), 5)
