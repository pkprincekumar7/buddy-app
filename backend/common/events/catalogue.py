"""The event catalogue: who produces and who consumes each event (docs/auth-users-split.md, 7.6).

Loaded from catalogue.json, the one definition behind the TopicArn check, the subscriptions
and filter policies of the local Moto topology, and modules/events (build plan 2.4).
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from functools import cache
from importlib import resources

ANY_PRODUCER = "*"
_SERVICE_RE = re.compile(r"[a-z][a-z0-9_]{0,30}")
_EVENT_RE = re.compile(r"[a-z][a-z_]*\.[a-z][a-z_]*")


@dataclass(frozen=True)
class EventSpec:
    event_type: str
    producer: str
    consumers: tuple[str, ...]
    schema: str
    reserved: bool

    def produced_by(self, service: str, data_services: frozenset[str]) -> bool:
        """May `service` publish this event? `*` means any service holding user data (7.2)."""
        if self.producer == ANY_PRODUCER:
            return service in data_services
        return service == self.producer


@dataclass(frozen=True)
class Catalogue:
    events: dict[str, EventSpec]
    data_services: frozenset[str]

    def spec(self, event_type: str) -> EventSpec:
        try:
            return self.events[event_type]
        except KeyError:
            raise KeyError(f"unknown event type {event_type!r}") from None

    def subscriptions(self, service: str) -> list[str]:
        """The event types `service` consumes: its queue's filter policy (reserved ones never)."""
        return sorted(
            e.event_type for e in self.events.values() if service in e.consumers and not e.reserved
        )

    def producers(self) -> list[str]:
        """Every service with a topic: a producer of at least one published event."""
        found: set[str] = set()
        for spec in self.events.values():
            if spec.reserved:
                continue
            found |= self.data_services if spec.producer == ANY_PRODUCER else {spec.producer}
        return sorted(found)

    def consumers(self) -> list[str]:
        return sorted({c for e in self.events.values() if not e.reserved for c in e.consumers})

    def topics_for(self, service: str) -> dict[str, list[str]]:
        """Producer service → the event types `service` takes from that producer's topic."""
        topics: dict[str, set[str]] = {}
        for event_type in self.subscriptions(service):
            spec = self.events[event_type]
            sources = self.data_services if spec.producer == ANY_PRODUCER else {spec.producer}
            for producer in sources:
                topics.setdefault(producer, set()).add(event_type)
        return {producer: sorted(types) for producer, types in sorted(topics.items())}


def parse(data: object) -> Catalogue:
    """Validate catalogue.json's content and build the Catalogue."""
    if not isinstance(data, dict) or not isinstance(data.get("events"), dict):
        raise ValueError("catalogue: needs an `events` object")
    data_services = data.get("data_services")
    if not isinstance(data_services, list) or not all(
        isinstance(s, str) and _SERVICE_RE.fullmatch(s) for s in data_services
    ):
        raise ValueError("catalogue: `data_services` must be a list of service names")
    events: dict[str, EventSpec] = {}
    for event_type, raw in data["events"].items():
        if not _EVENT_RE.fullmatch(event_type) or not isinstance(raw, dict):
            raise ValueError(f"catalogue: bad event {event_type!r}")
        producer, consumers = raw.get("producer"), raw.get("consumers")
        schema, reserved = raw.get("schema"), raw.get("reserved", False)
        if not (
            producer == ANY_PRODUCER
            or (isinstance(producer, str) and _SERVICE_RE.fullmatch(producer))
        ):
            raise ValueError(f"catalogue: {event_type}: bad producer {producer!r}")
        if not isinstance(consumers, list) or not all(
            isinstance(c, str) and _SERVICE_RE.fullmatch(c) for c in consumers
        ):
            raise ValueError(f"catalogue: {event_type}: bad consumers")
        if not isinstance(schema, str) or not re.fullmatch(
            rf"{re.escape(event_type)}\.v[1-9][0-9]*", schema
        ):
            raise ValueError(f"catalogue: {event_type}: schema must be {event_type}.vN")
        if not isinstance(reserved, bool):
            raise ValueError(f"catalogue: {event_type}: reserved must be true or false")
        # 7.6: an event is published only once a service consumes it.
        if not reserved and not consumers:
            raise ValueError(f"catalogue: {event_type}: no consumers, so mark it reserved")
        events[event_type] = EventSpec(event_type, producer, tuple(consumers), schema, reserved)
    return Catalogue(events=events, data_services=frozenset(data_services))


@cache
def load() -> Catalogue:
    """The packaged catalogue.json."""
    text = resources.files("common.events").joinpath("catalogue.json").read_text(encoding="utf-8")
    return parse(json.loads(text))
