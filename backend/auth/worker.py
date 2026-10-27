"""auth's worker: the authz change stream, the reservation reaper (3.3), and account
deletion's events (3.5): the outbox relay, which publishes `user.deletion_requested`, the
`user.data_deleted` consumer, and the stuck-deletion report.

    python -m auth.worker

One per region. Needs the service's configuration plus EVENTS_TOPIC_ARN and
EVENTS_QUEUE_URL.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import signal
import sys
from typing import Any

from auth.app import deletion
from auth.app.authz_stream import AuthzStream
from auth.app.reaper import Reaper
from auth.app.runtime import SERVICE, Runtime
from common.events import Consumer, ReceivedEvent, Relay, SnsPublisher
from common.metrics import outbox_metrics
from common.regions import locations_for_region
from common.telemetry import setup_observability

STUCK_CHECK_SECONDS = 600.0

_logger = logging.getLogger(__name__)


def region_locations(runtime: Runtime) -> list[str] | None:
    """This region's locations; every location locally (one worker handles them all)."""
    if runtime.settings.app_env == "local":
        return None
    return locations_for_region(runtime.settings.aws_region)


def build_consumer(runtime: Runtime) -> Consumer:
    consumer = Consumer(SERVICE, topic_prefix=runtime.settings.events_prefix)

    @consumer.handler("user.data_deleted")
    async def on_data_deleted(received: ReceivedEvent, _session: Any) -> None:
        # Who confirmed comes from the topic (received.source_service), never the payload.
        await deletion.confirm(runtime, received)

    return consumer


async def report_stuck(runtime: Runtime, stop: asyncio.Event, *, interval: float) -> None:
    locations = region_locations(runtime)
    while not stop.is_set():
        try:
            await deletion.report_stuck(runtime, locations)
        except Exception:
            _logger.exception("stuck-deletion check failed; retrying")
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(stop.wait(), interval)


async def run(
    runtime: Runtime,
    stop: asyncio.Event,
    *,
    wait_seconds: int = 20,
    stuck_interval: float = STUCK_CHECK_SECONDS,
) -> None:
    settings = runtime.settings
    if not settings.events_topic_arn or not settings.events_queue_url:
        raise RuntimeError("auth's worker needs EVENTS_TOPIC_ARN and EVENTS_QUEUE_URL")
    await runtime.prepare()
    relay = Relay(
        runtime.db,
        SnsPublisher(runtime.sns, settings.events_topic_arn),
        region=settings.aws_region,
        metrics=outbox_metrics(runtime.cloudwatch, service=SERVICE, environment=settings.app_env),
    )
    await asyncio.gather(
        AuthzStream(runtime, settings.aws_region).run(stop),
        Reaper(runtime, region_locations(runtime)).run(stop),
        relay.run(stop),
        build_consumer(runtime).run(
            runtime.sqs, settings.events_queue_url, stop, wait_seconds=wait_seconds
        ),
        report_stuck(runtime, stop, interval=stuck_interval),
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
