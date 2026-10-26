"""transform's worker (build plan 5.4): the outbox relay, the consumer and the generation jobs.

    python -m transform.worker

The relay publishes `transform.completed`; the consumer keeps the copies, clears Life Pathway
milestones whose inputs changed, and deletes on `child.deleted` and `user.deletion_requested`
(transform.app.lifecycle); the job loop claims this region's transform jobs and calls the
LLM (transform.app.generation). Only this runtime has LLM keys. Needs the service's configuration plus EVENTS_TOPIC_ARN and
EVENTS_QUEUE_URL, and one of OPENAI_API_KEY, ANTHROPIC_API_KEY or GEMINI_API_KEY (without
one, every job fails at once with a clear error).
"""

from __future__ import annotations

import asyncio
import signal
import sys
from typing import Any

from common.events import Consumer, ReceivedEvent, Relay, SnsPublisher
from common.generation.llm import LlmClient, LlmConfig
from common.metrics import outbox_metrics
from common.telemetry import setup_observability
from transform.app import generation, lifecycle
from transform.app.runtime import SERVICE, Runtime


def build_consumer(runtime: Runtime) -> Consumer:
    consumer = Consumer(SERVICE, topic_prefix=runtime.settings.events_prefix)

    @consumer.handler("child.changed")
    async def on_child_changed(received: ReceivedEvent, _session: Any) -> None:
        await lifecycle.copy_child(runtime, received)

    async def on_inputs(received: ReceivedEvent, _session: Any) -> None:
        await lifecycle.copy_inputs(runtime, received)

    for event_type in (
        "onboarding.conversation_completed",
        "onboarding.answers_updated",
        "discover.personality_finalised",
        "grow.area_completed",
        "grow.area_updated",
    ):
        consumer.handler(event_type)(on_inputs)

    @consumer.handler("child.deleted")
    async def on_child_deleted(received: ReceivedEvent, _session: Any) -> None:
        await lifecycle.delete_child(runtime, received)

    @consumer.handler("user.deletion_requested")
    async def on_deletion_requested(received: ReceivedEvent, _session: Any) -> None:
        await lifecycle.delete_user(runtime, received)

    return consumer


async def run(
    runtime: Runtime,
    llm: LlmClient,
    stop: asyncio.Event,
    *,
    wait_seconds: int = 20,
    poll: float = generation.POLL_SECONDS,
) -> None:
    settings = runtime.settings
    if not settings.events_topic_arn or not settings.events_queue_url:
        raise RuntimeError("transform's worker needs EVENTS_TOPIC_ARN and EVENTS_QUEUE_URL")
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
        generation.run_jobs(runtime, llm, stop, poll=poll),
    )


def main() -> int:  # pragma: no cover - the container's entry point; run() is tested
    runtime = Runtime.from_env()
    setup_observability(SERVICE)
    llm = LlmClient(LlmConfig.from_env(), circle=SERVICE)

    async def go() -> None:
        stop = asyncio.Event()
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, stop.set)
        try:
            await run(runtime, llm, stop)
        finally:
            await llm.aclose()
            await runtime.aclose()

    asyncio.run(go())
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
