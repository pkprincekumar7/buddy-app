"""The event as written to the outbox, published to SNS and received from SQS (design 7.2–7.4).

SNS message body (JSON):

    {"event_id", "event_type", "schema", "aggregate_id", "location", "version", "region",
     "occurred_at", "payload"}

with message attributes `event_type` (what the filter policies match), `schema` and, when
set, `traceparent`. Subscriptions keep raw delivery off, so SQS receives the SNS envelope
and its `TopicArn`, which is how a consumer knows the producer (7.2).
"""

from __future__ import annotations

import json
import re
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from common.events import catalogue, schemas
from common.regions import LOCATION_RE

_UUID4_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
_TRACEPARENT_RE = re.compile(r"[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}")
_REGION_RE = re.compile(r"[a-z]{2}(-[a-z]+)+-[0-9]")

# SNS's limit on one message: the body and its attributes together.
SNS_MAX_BYTES = 256 * 1024


class InvalidEvent(ValueError):
    """An event that breaks the envelope rules, the catalogue or its schema."""


class EventTooLarge(InvalidEvent):
    """Bigger than SNS takes (SNS_MAX_BYTES): it could never be published, so it isn't written."""


class ReservedEvent(InvalidEvent):
    """A reserved event (7.6): it has a schema but nothing consumes it, so it isn't published."""


def _now() -> datetime:
    return datetime.now(UTC)


@dataclass(frozen=True)
class Event:
    event_id: str
    event_type: str
    schema: str
    aggregate_id: str
    location: str
    version: int
    region: str
    payload: dict[str, Any]
    created_at: datetime
    traceparent: str | None = None

    # ── building one ──────────────────────────────────────────────────────────

    @classmethod
    def new(
        cls,
        event_type: str,
        *,
        producer: str,
        aggregate_id: str,
        location: str,
        version: int,
        region: str,
        payload: dict[str, Any] | None = None,
        traceparent: str | None = None,
    ) -> Event:
        """A new event from `producer`, checked against the catalogue and its schema."""
        cat = catalogue.load()
        try:
            spec = cat.spec(event_type)
        except KeyError as exc:
            raise InvalidEvent(str(exc)) from exc
        if spec.reserved:
            raise ReservedEvent(f"{event_type} is reserved: nothing consumes it yet (7.6)")
        if not spec.produced_by(producer, cat.data_services):
            raise InvalidEvent(f"{producer} doesn't produce {event_type}")
        event = cls(
            event_id=str(uuid.uuid4()),
            event_type=event_type,
            schema=spec.schema,
            aggregate_id=aggregate_id,
            location=location,
            version=version,
            region=region,
            payload=payload if payload is not None else {},
            created_at=_now(),
            traceparent=traceparent,
        )
        event.check()
        return event

    def check(self) -> None:
        """Raise InvalidEvent unless the envelope is well formed and the payload valid."""
        if not isinstance(self.event_id, str) or not _UUID4_RE.fullmatch(self.event_id):
            raise InvalidEvent("event_id must be a UUIDv4")
        if not isinstance(self.schema, str) or not re.fullmatch(
            rf"{re.escape(str(self.event_type))}\.v[1-9][0-9]*", self.schema
        ):
            raise InvalidEvent(f"schema {self.schema!r} isn't a version of {self.event_type!r}")
        if (
            not isinstance(self.aggregate_id, str)
            or not self.aggregate_id
            or len(self.aggregate_id) > 200
        ):
            raise InvalidEvent("aggregate_id must be a non-empty string")
        if not isinstance(self.location, str) or not LOCATION_RE.fullmatch(self.location):
            raise InvalidEvent("location is malformed")
        if not isinstance(self.version, int) or isinstance(self.version, bool) or self.version < 1:
            raise InvalidEvent("version must be a positive integer")
        if not isinstance(self.region, str) or not _REGION_RE.fullmatch(self.region):
            raise InvalidEvent("region must be an AWS region")
        if self.traceparent is not None and not _TRACEPARENT_RE.fullmatch(self.traceparent):
            raise InvalidEvent("traceparent is malformed")
        if not isinstance(self.payload, dict):
            raise InvalidEvent("payload must be an object")
        try:
            schemas.validate(self.schema, self.payload)
        except KeyError as exc:
            raise InvalidEvent(str(exc)) from exc
        except schemas.InvalidPayload as exc:
            raise InvalidEvent(str(exc)) from exc
        if self.message_bytes() > SNS_MAX_BYTES:
            raise EventTooLarge(f"{self.event_type} is over SNS's {SNS_MAX_BYTES} bytes")

    # ── the outbox row (4.1) ──────────────────────────────────────────────────

    def to_outbox(self) -> dict[str, Any]:
        doc: dict[str, Any] = {
            "_id": self.event_id,
            "event_type": self.event_type,
            "schema": self.schema,
            "aggregate_id": self.aggregate_id,
            "location": self.location,
            "version": self.version,
            "payload": self.payload,
            "region": self.region,
            "created_at": self.created_at,
            "published_at": None,
        }
        if self.traceparent is not None:
            doc["traceparent"] = self.traceparent
        return doc

    @classmethod
    def from_outbox(cls, doc: dict[str, Any]) -> Event:
        created = doc["created_at"]
        if created.tzinfo is None:  # MongoDB returns naive UTC datetimes
            created = created.replace(tzinfo=UTC)
        return cls(
            event_id=doc["_id"],
            event_type=doc["event_type"],
            schema=doc["schema"],
            aggregate_id=doc["aggregate_id"],
            location=doc["location"],
            version=doc["version"],
            region=doc["region"],
            payload=doc["payload"],
            created_at=created,
            traceparent=doc.get("traceparent"),
        )

    # ── the SNS message ───────────────────────────────────────────────────────

    def to_message(self) -> str:
        return json.dumps(
            {
                "event_id": self.event_id,
                "event_type": self.event_type,
                "schema": self.schema,
                "aggregate_id": self.aggregate_id,
                "location": self.location,
                "version": self.version,
                "region": self.region,
                "occurred_at": self.created_at.isoformat(),
                "payload": self.payload,
            },
            sort_keys=True,
            separators=(",", ":"),
        )

    def message_bytes(self) -> int:
        """The size SNS counts: the body, and each attribute's name, type and value."""
        size = len(self.to_message().encode())
        for name, attribute in self.message_attributes().items():
            size += len(name.encode()) + sum(len(v.encode()) for v in attribute.values())
        return size

    def message_attributes(self) -> dict[str, dict[str, str]]:
        attrs = {
            "event_type": {"DataType": "String", "StringValue": self.event_type},
            "schema": {"DataType": "String", "StringValue": self.schema},
        }
        if self.traceparent is not None:
            attrs["traceparent"] = {"DataType": "String", "StringValue": self.traceparent}
        return attrs

    @classmethod
    def from_message(cls, message: str, traceparent: str | None = None) -> Event:
        """Parse and check an SNS message body; InvalidEvent if anything is off."""
        try:
            data = json.loads(message)
            event = cls(
                event_id=data["event_id"],
                event_type=data["event_type"],
                schema=data["schema"],
                aggregate_id=data["aggregate_id"],
                location=data["location"],
                version=data["version"],
                region=data["region"],
                payload=data["payload"],
                created_at=datetime.fromisoformat(data["occurred_at"]),
                traceparent=traceparent,
            )
        except (json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
            raise InvalidEvent(f"malformed message: {exc}") from exc
        event.check()
        return event


@dataclass(frozen=True)
class ReceivedEvent:
    """An event as a consumer sees it: checked, with the producer taken from its topic."""

    event: Event
    source_service: str
    topic_arn: str
    message_id: str = field(default="")

    @property
    def event_type(self) -> str:
        return self.event.event_type

    @property
    def payload(self) -> dict[str, Any]:
        return self.event.payload
