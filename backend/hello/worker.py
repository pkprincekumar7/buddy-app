"""hello's worker: relays its outbox to its topic and consumes its own queue (Gate 1 demo).

    python -m hello.worker

Needs the demo's configuration plus EVENTS_TOPIC_ARN and EVENTS_QUEUE_URL.
"""

from __future__ import annotations

import asyncio
import signal
import sys
from typing import Any

from common.events import (
    Consumer,
    ReceivedEvent,
    Relay,
    SnsPublisher,
    ensure_outbox,
    versioned_upsert,
)
from common.metrics import outbox_metrics
from common.telemetry import setup_observability
from hello.app.demo import PING_COPIES, SERVICE, Demo


def build_consumer(demo: Demo) -> Consumer:
    consumer = Consumer(SERVICE, topic_prefix=demo.settings.events_prefix)

    @consumer.handler("hello.pinged")
    async def on_pinged(event: ReceivedEvent, session: Any) -> None:
        # A version-checked copy: a duplicate or an older event changes nothing (7.4).
        await versioned_upsert(
            demo.db,
            PING_COPIES,
            doc_id=event.event.aggregate_id,
            location=event.event.location,
            version=event.event.version,
            fields={"user_id": event.payload["user_id"], "message": event.payload["message"]},
            session=session,
        )

    return consumer


async def run(demo: Demo, stop: asyncio.Event, *, wait_seconds: int = 20) -> None:
    settings = demo.settings
    if not settings.events_topic_arn or not settings.events_queue_url:
        raise RuntimeError("hello's worker needs EVENTS_TOPIC_ARN and EVENTS_QUEUE_URL")
    await ensure_outbox(demo.db)
    relay = Relay(
        demo.db,
        SnsPublisher(demo.sns, settings.events_topic_arn),
        region=settings.aws_region,
        metrics=outbox_metrics(demo.cloudwatch, service=SERVICE, environment=settings.app_env),
    )
    consumer = build_consumer(demo)
    await asyncio.gather(
        relay.run(stop),
        consumer.run(demo.sqs, settings.events_queue_url, stop, wait_seconds=wait_seconds),
    )


def main() -> int:  # pragma: no cover - the container's entry point; run() is tested
    demo = Demo.from_env()
    setup_observability(SERVICE)

    async def go() -> None:
        stop = asyncio.Event()
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, stop.set)
        try:
            await run(demo, stop)
        finally:
            await demo.aclose()

    asyncio.run(go())
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
