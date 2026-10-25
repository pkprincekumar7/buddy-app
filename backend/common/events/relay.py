"""The outbox relay and the SNS publisher (docs/auth-users-split.md, 7.3).

The relay runs in the service's worker. It watches `outbox` with a change stream, publishes
each new row to the service's own SNS topic and sets `published_at`. It also polls on an
interval and on start, so a row missed while the stream was down still goes out; and when
the stream can't be opened, it falls back to polling until it can. Delivery is at least
once: a crash between publishing and marking means the row is published again.

Each region's relay handles only rows with its own `region`, so a global database doesn't
get every event published once per region.

A row SNS could never take (unreadable, or over its size limit) is set aside
(`set_aside_at`) and logged as `outbox.row.set_aside`, which alarms, so the rows behind it
still go out. Any other failure, an SNS error included, is retried: it may be passing.

With `metrics`, the relay also reports `OldestUnpublishedOutboxAgeSeconds` every minute,
0 when idle, so a missing datapoint means a dead relay (15.5).
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from datetime import UTC, datetime
from typing import Any, Protocol

from pymongo import ASCENDING

from common.events.envelope import SNS_MAX_BYTES, Event
from common.events.store import OUTBOX, Db

_logger = logging.getLogger(__name__)


class Publisher(Protocol):
    async def publish(self, event: Event) -> None: ...


class SnsPublisher:
    """Publishes to the service's own topic; IAM allows it no other (7.2)."""

    def __init__(self, client: Any, topic_arn: str) -> None:
        self.client = client
        self.topic_arn = topic_arn

    async def publish(self, event: Event) -> None:
        # boto3 is synchronous; a thread keeps the event loop free.
        await asyncio.to_thread(
            self.client.publish,
            TopicArn=self.topic_arn,
            Message=event.to_message(),
            MessageAttributes=event.message_attributes(),
        )


class Metrics(Protocol):
    """What the relay needs from common.metrics.MetricsPublisher."""

    def put(self, name: str, value: float) -> None: ...

    async def flush(self) -> int: ...


class Relay:
    def __init__(
        self,
        db: Db,
        publisher: Publisher,
        *,
        region: str,
        batch_size: int = 100,
        poll_interval: float = 5.0,
        max_await_ms: int = 1000,
        metrics: Metrics | None = None,
        report_interval: float = 60.0,
    ) -> None:
        self.db = db
        self.publisher = publisher
        self.region = region
        self.batch_size = batch_size
        self.poll_interval = poll_interval
        self.max_await_ms = max_await_ms
        self.metrics = metrics
        self.report_interval = report_interval

    async def publish_pending(self) -> int:
        """Publish this region's unpublished rows, oldest first, one batch. Returns how many."""
        cursor = (
            self.db[OUTBOX]
            .find({"region": self.region, "published_at": None, "set_aside_at": None})
            .sort("created_at", ASCENDING)
            .limit(self.batch_size)
        )
        published = 0
        async for doc in cursor:
            if await self._publish(doc):
                published += 1
        return published

    async def _publish(self, doc: dict[str, Any]) -> bool:
        try:
            event = Event.from_outbox(doc)
        except (KeyError, TypeError, AttributeError, ValueError) as exc:
            return await self._set_aside(doc, f"unreadable row ({type(exc).__name__})")
        if event.message_bytes() > SNS_MAX_BYTES:
            return await self._set_aside(doc, "over SNS's size limit")
        await self.publisher.publish(event)
        result = await self.db[OUTBOX].update_one(
            {"_id": doc["_id"], "published_at": None},
            {"$set": {"published_at": datetime.now(UTC)}},
        )
        return result.modified_count == 1

    async def _set_aside(self, doc: dict[str, Any], reason: str) -> bool:
        await self.db[OUTBOX].update_one(
            {"_id": doc["_id"], "published_at": None},
            {"$set": {"set_aside_at": datetime.now(UTC), "set_aside_reason": reason}},
        )
        _logger.error(
            "outbox.row.set_aside",
            extra={"event_id": doc["_id"], "event_type": doc.get("event_type"), "reason": reason},
        )
        return False

    async def run(self, stop: asyncio.Event) -> None:
        """Relay until `stop` is set, and report the outbox's age if there are `metrics`."""
        if self.metrics is None:
            await self._relay(stop)
        else:
            await asyncio.gather(self._relay(stop), self._report(stop, self.metrics))

    async def _report(self, stop: asyncio.Event, metrics: Metrics) -> None:
        # Here, not at the top: common.metrics imports common.events.
        from common.metrics import oldest_unpublished_outbox_age

        while not stop.is_set():
            try:
                age = await oldest_unpublished_outbox_age(self.db, self.region)
                metrics.put("OldestUnpublishedOutboxAgeSeconds", age)
                await metrics.flush()
            except Exception:
                _logger.exception("outbox relay: couldn't report the outbox's age")
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(stop.wait(), self.report_interval)

    async def _relay(self, stop: asyncio.Event) -> None:
        """Any failure falls back to polling, then retries the stream."""
        while not stop.is_set():
            try:
                await self._watch(stop)
            except Exception:
                _logger.exception("outbox relay: stream or publish failed; polling, then retrying")
                await self._wait(stop)
                try:
                    await self.publish_pending()
                except Exception:
                    _logger.exception("outbox relay: polling failed")

    async def _watch(self, stop: asyncio.Event) -> None:
        pipeline = [{"$match": {"operationType": "insert", "fullDocument.region": self.region}}]
        outbox = self.db[OUTBOX]
        async with await outbox.watch(pipeline, max_await_time_ms=self.max_await_ms) as stream:
            # The backlog, once the stream is open, so no row falls between the two.
            await self.publish_pending()
            last_poll = time.monotonic()
            while not stop.is_set():
                change = await stream.try_next()
                if change is not None:
                    await self._publish(change["fullDocument"])
                if time.monotonic() - last_poll >= self.poll_interval:
                    await self.publish_pending()
                    last_poll = time.monotonic()

    async def _wait(self, stop: asyncio.Event) -> None:
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(stop.wait(), self.poll_interval)
