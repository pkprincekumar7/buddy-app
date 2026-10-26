"""common.events: the catalogue, the schemas, the envelope and the topology (design 7.2, 7.6, 7.8)."""

import json
from datetime import UTC, datetime
from importlib import resources
from typing import Any

import pytest
from jsonschema import Draft202012Validator

from common.events import catalogue, envelope, schemas, topology
from common.events.envelope import Event, EventTooLarge, InvalidEvent, ReservedEvent
from common.events.testing import example_event

CHILD = "9b1c6f64-2f4e-4d0e-8e2a-6c1f0d3a7b55"


# ── catalogue ──────────────────────────────────────────────────────────────────


def test_the_catalogue_matches_the_design():
    cat = catalogue.load()
    assert len(cat.events) == 17  # 7.6 plus hello's demo event, hello.pinged (removed in 8.6)
    assert {e for e, s in cat.events.items() if s.reserved} == {
        "user.role_changed",
        "user.profile_updated",
        "connect.visited",
    }
    assert cat.spec("child.changed").consumers == (
        "onboarding",
        "discover",
        "grow",
        "transform",
        "release",
    )
    # One topic per producing service (7.2): the design's 8 plus hello's; connect isn't built.
    assert cat.producers() == [
        "auth",
        "children",
        "discover",
        "grow",
        "hello",
        "onboarding",
        "release",
        "transform",
        "users",
    ]


def test_every_event_has_a_valid_schema_whose_example_validates():
    for spec in catalogue.load().events.values():
        document = schemas.document(spec.schema)
        Draft202012Validator.check_schema(document)
        schemas.validate(spec.schema, schemas.example(spec.schema))


def test_no_schema_file_is_orphaned():
    files = {
        p.name.removesuffix(".json")
        for p in resources.files("common.events").joinpath("schemas").iterdir()
        if p.name.endswith(".json")
    }
    assert files == {s.schema for s in catalogue.load().events.values()}


def test_subscriptions_skip_reserved_events():
    cat = catalogue.load()
    assert cat.subscriptions("children") == [
        "discover.completed",
        "grow.completed",
        "onboarding.conversation_completed",
        "release.completed",
        "transform.completed",
        "user.deletion_requested",
    ]
    assert cat.subscriptions("shared") == []


def test_data_deleted_comes_from_every_data_service_topic():
    cat = catalogue.load()
    topics = cat.topics_for("auth")
    assert set(topics) == cat.data_services
    assert all(types == ["user.data_deleted"] for types in topics.values())
    spec = cat.spec("user.data_deleted")
    assert spec.produced_by("grow", cat.data_services)
    assert not spec.produced_by("auth", cat.data_services)
    assert not spec.produced_by("shared", cat.data_services)


def test_unknown_event_type():
    with pytest.raises(KeyError, match="unknown event type"):
        catalogue.load().spec("child.exploded")


def _catalogue(**event: Any) -> dict[str, Any]:
    base = {"producer": "grow", "consumers": ["children"], "schema": "grow.completed.v1"}
    return {"data_services": ["grow"], "events": {"grow.completed": {**base, **event}}}


@pytest.mark.parametrize(
    ("data", "message"),
    [
        ([], "events"),
        ({"events": {}}, "data_services"),
        ({"events": {}, "data_services": ["Bad"]}, "data_services"),
        ({"data_services": [], "events": {"Bad": {}}}, "bad event"),
        ({"data_services": [], "events": {"a.b": []}}, "bad event"),
        (_catalogue(producer="Grow"), "producer"),
        (_catalogue(consumers="children"), "consumers"),
        (_catalogue(schema="grow.completed"), "schema"),
        (_catalogue(schema="child.changed.v1"), "schema"),
        (_catalogue(reserved="yes"), "reserved"),
        (_catalogue(consumers=[]), "mark it reserved"),
    ],
)
def test_a_malformed_catalogue_is_refused(data, message):
    with pytest.raises(ValueError, match=message):
        catalogue.parse(data)


def test_a_reserved_event_needs_no_consumers():
    cat = catalogue.parse(_catalogue(consumers=[], reserved=True))
    assert cat.producers() == [] and cat.consumers() == []


# ── schemas ────────────────────────────────────────────────────────────────────


def test_invalid_payload_says_where():
    payload = schemas.example("child.changed.v1")
    payload["progress"]["grow"] = "yes"
    with pytest.raises(schemas.InvalidPayload, match="progress/grow"):
        schemas.validate("child.changed.v1", payload)
    with pytest.raises(schemas.InvalidPayload, match="payload"):
        schemas.validate("child.changed.v1", [])


def test_additive_fields_are_accepted():
    payload = {**schemas.example("child.changed.v1"), "school": "new optional field"}
    schemas.validate("child.changed.v1", payload)


def test_unknown_schema():
    with pytest.raises(KeyError):
        schemas.document("child.changed.v9")


def test_examples_are_copies():
    schemas.example("child.changed.v1")["user_id"] = "changed"
    assert schemas.example("child.changed.v1")["user_id"] != "changed"


# ── the envelope ───────────────────────────────────────────────────────────────


def _new(event_type: str = "child.changed", **overrides: Any) -> Event:
    fields: dict[str, Any] = {
        "producer": "children",
        "aggregate_id": CHILD,
        "location": "in",
        "version": 3,
        "region": "ap-south-1",
        "payload": schemas.example("child.changed.v1"),
        **overrides,
    }
    return Event.new(event_type, **fields)


def test_new_event():
    event = _new(traceparent="00-" + "a" * 32 + "-" + "b" * 16 + "-01")
    assert event.schema == "child.changed.v1"
    assert event.created_at.tzinfo is UTC
    assert event.message_attributes()["traceparent"]["StringValue"].startswith("00-")


@pytest.mark.parametrize(
    ("event_type", "overrides", "error", "message"),
    [
        ("child.exploded", {}, InvalidEvent, "unknown"),
        (
            "user.role_changed",
            {"producer": "auth", "payload": {"role": "admin"}},
            ReservedEvent,
            "reserved",
        ),
        ("child.changed", {"producer": "grow"}, InvalidEvent, "doesn't produce"),
        ("child.changed", {"payload": {"user_id": "x"}}, InvalidEvent, "is_deleted"),
        ("child.changed", {"location": "IN"}, InvalidEvent, "location"),
        ("child.changed", {"version": 0}, InvalidEvent, "version"),
        ("child.changed", {"version": True}, InvalidEvent, "version"),
        ("child.changed", {"region": "mars"}, InvalidEvent, "region"),
        ("child.changed", {"aggregate_id": ""}, InvalidEvent, "aggregate_id"),
        ("child.changed", {"traceparent": "nope"}, InvalidEvent, "traceparent"),
    ],
)
def test_new_event_is_checked(event_type, overrides, error, message):
    with pytest.raises(error, match=message):
        _new(event_type, **overrides)


def test_check_catches_hand_built_envelopes():
    good = _new()
    with pytest.raises(InvalidEvent, match="event_id"):
        Event(**{**good.__dict__, "event_id": "1"}).check()
    with pytest.raises(InvalidEvent, match="isn't a version"):
        Event(**{**good.__dict__, "schema": "discover.completed.v1"}).check()
    with pytest.raises(InvalidEvent, match="payload must be an object"):
        Event(**{**good.__dict__, "payload": []}).check()
    with pytest.raises(InvalidEvent, match="no schema"):
        Event(**{**good.__dict__, "schema": "child.changed.v7"}).check()


def test_message_round_trip():
    event = _new()
    again = Event.from_message(event.to_message())
    assert again == event


@pytest.mark.parametrize(
    "message",
    ["not json", "{}", json.dumps({"event_id": 1}), json.dumps({"occurred_at": "nope"})],
)
def test_malformed_messages(message):
    with pytest.raises(InvalidEvent, match="malformed"):
        Event.from_message(message)


def test_outbox_round_trip_with_naive_dates():
    event = _new()
    doc = event.to_outbox()
    assert doc["published_at"] is None and "traceparent" not in doc
    doc["created_at"] = doc["created_at"].replace(tzinfo=None)  # as MongoDB returns it
    assert Event.from_outbox(doc) == event
    traced = _new(traceparent="00-" + "c" * 32 + "-" + "d" * 16 + "-00")
    assert Event.from_outbox(traced.to_outbox()).traceparent == traced.traceparent


def test_example_event_for_the_any_producer_event():
    event = example_event("user.data_deleted")
    assert event.event_type == "user.data_deleted"


# ── topology ───────────────────────────────────────────────────────────────────


def test_plan():
    layout = topology.plan("superpower-dev")
    assert layout["topics"]["children"] == "superpower-dev-children-events"
    grow = layout["queues"]["grow"]
    assert grow["dlq"] == "superpower-dev-grow-events-dlq"
    assert grow["max_receive_count"] == 5
    assert grow["subscriptions"]["discover"] == ["discover.personality_finalised"]
    assert set(layout["queues"]) == set(catalogue.load().consumers())


def test_queue_policy_allows_only_the_subscribed_topics():
    policy = json.loads(topology.queue_policy("arn:q", ["arn:t2", "arn:t1"]))
    (statement,) = policy["Statement"]
    assert statement["Condition"]["ArnEquals"]["aws:SourceArn"] == ["arn:t1", "arn:t2"]
    assert statement["Action"] == "sqs:SendMessage"


def test_topology_cli(capsys):
    assert topology.main(["--prefix", "superpower-dev"]) == 0
    assert json.loads(capsys.readouterr().out) == topology.plan("superpower-dev")


def test_timestamps_are_utc():
    assert _new().created_at <= datetime.now(UTC)


def test_an_event_too_big_for_sns_is_refused_before_it_is_written(monkeypatch):
    event = example_event("child.changed")
    assert event.message_bytes() > len(event.to_message())  # the attributes count too
    monkeypatch.setattr(envelope, "SNS_MAX_BYTES", event.message_bytes() - 1)
    with pytest.raises(EventTooLarge):
        event.check()
