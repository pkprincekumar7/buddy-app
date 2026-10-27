"""common.events.consumer: the TopicArn check, rejections and the polling loop (design 7.2)."""

import asyncio
import json
from typing import Any

import pytest

from common.events import catalogue
from common.events.consumer import Consumer, Outcome, Rejected
from common.events.envelope import ReceivedEvent
from common.events.testing import (
    assert_consumer_contract,
    example_event,
    sns_envelope,
    topic_arn,
)

PREFIX = "buddy-test"


def _grow() -> Consumer:
    return Consumer("grow", topic_prefix=PREFIX)


def _body(event_type: str = "child.changed", producer: str = "children", **kwargs: Any) -> str:
    return sns_envelope(example_event(event_type), topic_arn(PREFIX, producer), **kwargs)


def _tamper(body: str, **changes: Any) -> str:
    envelope = json.loads(body)
    envelope.update(changes)
    return json.dumps(envelope)


# ── accepted ───────────────────────────────────────────────────────────────────


def test_a_subscribed_event_from_its_producer_is_accepted():
    received = _grow().check(_body(), "m-1")
    assert (received.event_type, received.source_service, received.message_id) == (
        "child.changed",
        "children",
        "m-1",
    )
    assert received.payload["is_deleted"] is False


def test_data_deleted_names_the_confirming_service_from_the_topic():
    auth = Consumer("auth", topic_prefix=PREFIX)
    event = example_event("user.data_deleted", producer="users")
    received = auth.check(sns_envelope(event, topic_arn(PREFIX, "grow")))
    assert received.source_service == "grow"  # the topic, not the event's own producer


def test_the_traceparent_attribute_is_kept():
    trace = "00-" + "a" * 32 + "-" + "b" * 16 + "-01"
    event = example_event("child.changed", traceparent=trace)
    received = _grow().check(sns_envelope(event, topic_arn(PREFIX, "children")))
    assert received.event.traceparent == trace


# ── rejected ───────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("body", "reason"),
    [
        pytest.param("not json", "isn't JSON", id="not json"),
        pytest.param(json.dumps([]), "SNS notification", id="not an object"),
        pytest.param(
            json.dumps(json.loads(example_event("child.changed").to_message())),
            "SNS notification",
            id="raw delivery",
        ),
        pytest.param(_tamper(_body(), TopicArn="nope"), "unexpected topic", id="bad arn"),
        pytest.param(
            _tamper(_body(), TopicArn="arn:aws:sns:ap-south-1:123456789012:other-children-events"),
            "unexpected topic",
            id="other prefix",
        ),
        pytest.param(
            _tamper(_body(), TopicArn="arn:aws:sns:ap-south-1:123456789012:buddy-test--events"),
            "unexpected topic",
            id="empty service",
        ),
        pytest.param(
            _tamper(_body(), TopicArn="arn:aws:sns:ap-south-1:123456789012:buddy-test-children"),
            "unexpected topic",
            id="not an events topic",
        ),
        pytest.param(_tamper(_body(), MessageAttributes=["x"]), "attributes", id="bad attributes"),
        pytest.param(_tamper(_body(), Message=None), "no message", id="no message"),
        pytest.param(_tamper(_body(), Message="{}"), "malformed", id="malformed message"),
        pytest.param(
            _body(attribute_type="discover.completed"), "attribute doesn't match", id="attribute"
        ),
        pytest.param(_tamper(_body(), MessageAttributes={}), "attribute doesn't match", id="none"),
        pytest.param(_body(producer="discover"), "can't come from discover", id="wrong topic"),
        pytest.param(
            _body("discover.completed", "discover"), "doesn't subscribe", id="not subscribed"
        ),
    ],
)
def test_rejections(body, reason):
    with pytest.raises(Rejected, match=reason):
        _grow().check(body)


def _forged(event_type: str, schema: str, payload: dict[str, Any]) -> str:
    """A body a compromised producer could send: valid JSON, wrong catalogue facts."""
    good = example_event("child.changed")
    message = json.loads(good.to_message())
    message.update(event_type=event_type, schema=schema, payload=payload)
    envelope = json.loads(sns_envelope(good, topic_arn(PREFIX, "children")))
    envelope["Message"] = json.dumps(message)
    envelope["MessageAttributes"]["event_type"]["Value"] = event_type
    return json.dumps(envelope)


def test_an_unknown_event_type_is_rejected():
    with pytest.raises(Rejected, match="no schema"):
        _grow().check(_forged("child.exploded", "child.exploded.v1", {}))


def test_a_reserved_event_is_rejected():
    with pytest.raises(Rejected, match="reserved"):
        _grow().check(_forged("connect.visited", "connect.visited.v1", {}))


def _grow_with(events: dict[str, catalogue.EventSpec]) -> Consumer:
    """grow's consumer over a hand-made catalogue (the packaged one is cached and shared)."""
    real = catalogue.load()
    cat = catalogue.Catalogue(events=events, data_services=real.data_services)
    consumer = Consumer("grow", topic_prefix=PREFIX, catalogue=cat)
    consumer.subscriptions = frozenset({"child.changed"})
    return consumer


def test_an_event_missing_from_the_catalogue_is_rejected():
    with pytest.raises(Rejected, match="unknown event type"):
        _grow_with({}).check(_body())


def test_a_schema_version_the_catalogue_doesnt_name_is_rejected():
    spec = catalogue.load().spec("child.changed")
    newer = catalogue.EventSpec(
        spec.event_type, spec.producer, spec.consumers, "child.changed.v2", False
    )
    with pytest.raises(Rejected, match="isn't the catalogue's"):
        _grow_with({"child.changed": newer}).check(_body())


def test_an_invalid_payload_is_rejected():
    payload = example_event("child.changed").payload | {"is_deleted": "no"}
    with pytest.raises(Rejected, match="is_deleted"):
        _grow().check(_forged("child.changed", "child.changed.v1", payload))


def test_source_service_needs_a_string():
    assert _grow().source_service(None) is None


# ── registration and handling ─────────────────────────────────────────────────


def test_registration_rules():
    consumer = _grow()
    with pytest.raises(ValueError, match="doesn't subscribe"):
        consumer.handler("discover.completed")
    with pytest.raises(ValueError, match="db and client"):
        consumer.handler("child.changed", dedupe=True)

    @consumer.handler("child.changed")
    async def on_child(event: ReceivedEvent, session: Any) -> None:
        return None  # pragma: no cover - not called

    with pytest.raises(ValueError, match="already has a handler"):
        consumer.handler("child.changed")
    assert "child.changed" not in consumer.missing_handlers()


def test_handle_body_runs_the_handler_and_reports_rejections():
    consumer = _grow()
    seen: list[ReceivedEvent] = []

    @consumer.handler("child.changed")
    async def on_child(event: ReceivedEvent, session: Any) -> None:
        assert session is None
        seen.append(event)

    assert asyncio.run(consumer.handle_body(_body())) is Outcome.HANDLED
    assert asyncio.run(consumer.handle_body("junk")) is Outcome.REJECTED
    assert len(seen) == 1


def test_a_subscribed_event_without_a_handler_fails_loudly():
    with pytest.raises(LookupError, match="no handler for child.changed"):
        asyncio.run(_grow().handle_body(_body()))


def test_the_contract_harness_requires_every_handler():
    consumer = Consumer("children", topic_prefix=PREFIX)
    with pytest.raises(AssertionError, match="no handler for"):
        assert_consumer_contract(consumer)
    for event_type in consumer.missing_handlers():

        async def handle(event: ReceivedEvent, session: Any) -> None:
            return None  # pragma: no cover - not called

        consumer.handler(event_type)(handle)
    assert_consumer_contract(consumer)
    auth = Consumer("auth", topic_prefix=PREFIX)
    auth.handler("user.data_deleted")(handle)
    assert_consumer_contract(auth)  # the any-producer event


class FakeSqs:
    def __init__(self, bodies: list[str]) -> None:
        self.messages = [
            {"MessageId": f"m{i}", "ReceiptHandle": f"r{i}", "Body": body}
            for i, body in enumerate(bodies)
        ]
        self.deleted: list[str] = []
        self.fail = False

    def receive_message(self, **kwargs: Any) -> dict[str, Any]:
        if self.fail:
            raise ConnectionError("sqs down")
        batch, self.messages = self.messages, []
        return {"Messages": batch} if batch else {}

    def delete_message(self, **kwargs: str) -> None:
        self.deleted.append(kwargs["ReceiptHandle"])


def test_poll_once_deletes_only_handled_messages():
    consumer = _grow()

    @consumer.handler("child.changed")
    async def on_child(event: ReceivedEvent, session: Any) -> None:
        if event.event.version == 2:
            raise RuntimeError("database down")

    sqs = FakeSqs(
        [
            _body(),
            "forged",
            sns_envelope(example_event("child.changed", version=2), topic_arn(PREFIX, "children")),
        ]
    )
    assert asyncio.run(consumer.poll_once(sqs, "q", wait_seconds=0)) == 1
    assert sqs.deleted == ["r0"]  # the rejected and the failed one stay for retry / the DLQ


def test_run_survives_a_failing_poll_and_stops():
    consumer = _grow()
    sqs = FakeSqs([])
    sqs.fail = True

    async def main() -> None:
        stop = asyncio.Event()
        task = asyncio.create_task(consumer.run(sqs, "q", stop))
        await asyncio.sleep(0.05)
        stop.set()
        await asyncio.wait_for(task, 2)

    asyncio.run(main())
