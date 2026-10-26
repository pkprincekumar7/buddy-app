"""users' worker: relays its outbox to its topic and consumes its queue (build plan 3.1).

    python -m users.worker

Its one event is `user.deletion_requested` (10.3). The handler deletes the profile, writes
a `user:` tombstone and queues `user.data_deleted`, in one transaction, so the
confirmation is published only if the deletion committed. It's safe to run twice (7.4):
the second run deletes nothing and confirms again, which auth's `$addToSet` ignores. It
always confirms, even with no profile (a registration that failed half-way), or auth
would wait forever.

Needs the service's configuration plus EVENTS_TOPIC_ARN and EVENTS_QUEUE_URL.
"""

from __future__ import annotations

import asyncio
import signal
import sys
from typing import Any

from pymongo.asynchronous.client_session import AsyncClientSession

from common.events import (
    Consumer,
    Event,
    ReceivedEvent,
    Relay,
    SnsPublisher,
    add_to_outbox,
    delete_user_events,
    tombstone_key,
    write_tombstone,
)
from common.metrics import outbox_metrics
from common.telemetry import current_traceparent, setup_observability
from users.app.runtime import SERVICE, Runtime
from users.app.store import USERS


async def delete_user_data(runtime: Runtime, received: ReceivedEvent) -> None:
    """Everything users holds for the account, then the confirmation, in one transaction."""
    event = received.event
    user_id, location = event.aggregate_id, event.location
    confirmation = Event.new(
        "user.data_deleted",
        producer=SERVICE,
        aggregate_id=user_id,
        location=location,
        # The account's authz_version, as the request carried it (4.1).
        version=event.version,
        region=runtime.settings.aws_region,
        traceparent=current_traceparent(),
    )

    async def write(session: AsyncClientSession) -> None:
        await runtime.db[USERS].delete_one({"_id": user_id, "location": location}, session=session)
        await write_tombstone(
            runtime.db,
            tombstone_key("user", user_id),
            location=location,
            version=event.version,
            session=session,
        )
        await delete_user_events(runtime.db, location=location, user_id=user_id, session=session)
        await add_to_outbox(runtime.db, confirmation, session)

    # with_transaction retries a transient conflict instead of failing the message.
    async with runtime.client.start_session() as session:
        await session.with_transaction(write)


def build_consumer(runtime: Runtime) -> Consumer:
    consumer = Consumer(SERVICE, topic_prefix=runtime.settings.events_prefix)

    @consumer.handler("user.deletion_requested")
    async def on_deletion_requested(received: ReceivedEvent, _session: Any) -> None:
        await delete_user_data(runtime, received)

    return consumer


async def run(runtime: Runtime, stop: asyncio.Event, *, wait_seconds: int = 20) -> None:
    settings = runtime.settings
    if not settings.events_topic_arn or not settings.events_queue_url:
        raise RuntimeError("users' worker needs EVENTS_TOPIC_ARN and EVENTS_QUEUE_URL")
    await runtime.prepare()
    relay = Relay(
        runtime.db,
        SnsPublisher(runtime.sns, settings.events_topic_arn),
        region=settings.aws_region,
        metrics=outbox_metrics(runtime.cloudwatch, service=SERVICE, environment=settings.app_env),
    )
    consumer = build_consumer(runtime)
    await asyncio.gather(
        relay.run(stop),
        consumer.run(runtime.sqs, settings.events_queue_url, stop, wait_seconds=wait_seconds),
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
