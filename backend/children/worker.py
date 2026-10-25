"""children's worker (build plan 4.2): the outbox relay, the consumer and the 30-day purge.

    python -m children.worker

The consumer sets progress flags from the circles' completion events and deletes a user's
children on `user.deletion_requested`; the purge removes children deleted more than 30
days ago (children.app.lifecycle). Needs the service's configuration plus EVENTS_TOPIC_ARN
and EVENTS_QUEUE_URL.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import signal
import sys
from typing import Any

from children.app import lifecycle
from children.app.runtime import SERVICE, Runtime
from common.events import Consumer, ReceivedEvent, Relay, SnsPublisher
from common.logging import configure_logging
from common.regions import locations_for_region

PURGE_SECONDS = 3600.0

_logger = logging.getLogger(__name__)


def region_locations(runtime: Runtime) -> list[str] | None:
    """This region's locations; every location locally (one worker handles them all)."""
    if runtime.settings.app_env == "local":
        return None
    return locations_for_region(runtime.settings.aws_region)


def build_consumer(runtime: Runtime) -> Consumer:
    consumer = Consumer(SERVICE, topic_prefix=runtime.settings.events_prefix)

    async def on_completed(received: ReceivedEvent, _session: Any) -> None:
        await lifecycle.set_progress(runtime, received)

    for event_type in lifecycle.FLAG_FOR_EVENT:
        consumer.handler(event_type)(on_completed)

    @consumer.handler("user.deletion_requested")
    async def on_deletion_requested(received: ReceivedEvent, _session: Any) -> None:
        await lifecycle.delete_user(runtime, received)

    return consumer


async def run_purge(runtime: Runtime, stop: asyncio.Event, *, interval: float) -> None:
    locations = region_locations(runtime)
    while not stop.is_set():
        try:
            # Batches of 100 until none is left, then wait for the next round.
            while await lifecycle.purge(runtime, locations) == lifecycle.PURGE_BATCH:
                pass
        except Exception:
            _logger.exception("children purge failed; retrying")
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(stop.wait(), interval)


async def run(
    runtime: Runtime,
    stop: asyncio.Event,
    *,
    wait_seconds: int = 20,
    purge_interval: float = PURGE_SECONDS,
) -> None:
    settings = runtime.settings
    if not settings.events_topic_arn or not settings.events_queue_url:
        raise RuntimeError("children's worker needs EVENTS_TOPIC_ARN and EVENTS_QUEUE_URL")
    await runtime.prepare()
    relay = Relay(
        runtime.db, SnsPublisher(runtime.sns, settings.events_topic_arn), region=settings.aws_region
    )
    await asyncio.gather(
        relay.run(stop),
        build_consumer(runtime).run(
            runtime.sqs, settings.events_queue_url, stop, wait_seconds=wait_seconds
        ),
        run_purge(runtime, stop, interval=purge_interval),
    )


def main() -> int:  # pragma: no cover - the container's entry point; run() is tested
    runtime = Runtime.from_env()
    configure_logging(SERVICE, runtime.settings.log_level)

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
