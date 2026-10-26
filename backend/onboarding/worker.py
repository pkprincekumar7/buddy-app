"""onboarding's worker (build plan 5.1): the outbox relay and the consumer.

    python -m onboarding.worker

The relay publishes `onboarding.conversation_completed` and `onboarding.answers_updated`;
the consumer keeps `child_access` from `child.changed`, and deletes on `child.deleted` and
`user.deletion_requested` (onboarding.app.lifecycle). Needs the service's configuration
plus EVENTS_TOPIC_ARN and EVENTS_QUEUE_URL.
"""

from __future__ import annotations

import asyncio
import signal
import sys
from typing import Any

from common.events import Consumer, ReceivedEvent, Relay, SnsPublisher
from common.metrics import outbox_metrics
from common.telemetry import setup_observability
from onboarding.app import lifecycle
from onboarding.app.runtime import SERVICE, Runtime


def build_consumer(runtime: Runtime) -> Consumer:
    consumer = Consumer(SERVICE, topic_prefix=runtime.settings.events_prefix)

    @consumer.handler("child.changed")
    async def on_child_changed(received: ReceivedEvent, _session: Any) -> None:
        await lifecycle.copy_child(runtime, received)

    @consumer.handler("child.deleted")
    async def on_child_deleted(received: ReceivedEvent, _session: Any) -> None:
        await lifecycle.delete_child(runtime, received)

    @consumer.handler("user.deletion_requested")
    async def on_deletion_requested(received: ReceivedEvent, _session: Any) -> None:
        await lifecycle.delete_user(runtime, received)

    return consumer


async def run(runtime: Runtime, stop: asyncio.Event, *, wait_seconds: int = 20) -> None:
    settings = runtime.settings
    if not settings.events_topic_arn or not settings.events_queue_url:
        raise RuntimeError("onboarding's worker needs EVENTS_TOPIC_ARN and EVENTS_QUEUE_URL")
    await runtime.prepare()
    relay = Relay(
        runtime.db,
        SnsPublisher(runtime.sns, settings.events_topic_arn),
        region=settings.aws_region,
        metrics=outbox_metrics(runtime.cloudwatch, service=SERVICE, environment=settings.app_env),
    )
    await asyncio.gather(
        relay.run(stop),
        build_consumer(runtime).run(
            runtime.sqs, settings.events_queue_url, stop, wait_seconds=wait_seconds
        ),
    )


def main() -> int:  # pragma: no cover - the container's entry point; run() is tested
    runtime = Runtime.from_env()
    setup_observability(SERVICE)

    async def go() -> None:
        stop = asyncio.Event()
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, stop.set)
        try:
            await run(runtime, stop)
        finally:
            await runtime.aclose()

    asyncio.run(go())
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
