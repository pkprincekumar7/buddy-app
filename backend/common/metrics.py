"""The custom CloudWatch metrics, published straight to CloudWatch (docs/auth-users-split.md, 15.5).

Only metrics an alarm or a scaling policy needs, 16 per environment per region:
- `PendingJobCount` (4 generating services): worker scaling and the "pending high" alarm;
  published by one leader per region in the circle's HTTP service (`RegionLeader`);
- `OldestRunningJobAgeSeconds` (4): the "processing stuck" alarm;
- `OldestUnpublishedOutboxAgeSeconds` (8): the "outbox stale" alarm, published by the relay;
  it publishes 0 when idle, so a missing datapoint means a dead relay.

They don't go through the OpenTelemetry collector, so losing it loses traces, not scaling
or alarms. Each service publishes to its own namespace, `Superpower/<service>`, which its
task role is limited to (the `cloudwatch:namespace` condition). The only dimension is
`Environment` (dev, sbx and stg share an account, as today's `Superpower/Worker` metrics
do): never a user or child id.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from common.events.store import OUTBOX, Db

NAMESPACE_PREFIX = "Superpower"
METRIC_NAMES: frozenset[str] = frozenset(
    {"PendingJobCount", "OldestRunningJobAgeSeconds", "OldestUnpublishedOutboxAgeSeconds"}
)
_UNITS = {
    "PendingJobCount": "Count",
    "OldestRunningJobAgeSeconds": "Seconds",
    "OldestUnpublishedOutboxAgeSeconds": "Seconds",
}
MAX_DATUMS_PER_CALL = 1000

_logger = logging.getLogger(__name__)


class MetricsPublisher:
    """Collects datapoints and sends them in one PutMetricData call per flush (once a minute)."""

    def __init__(self, cloudwatch: Any, *, service: str, environment: str) -> None:
        self.cloudwatch = cloudwatch
        self.namespace = f"{NAMESPACE_PREFIX}/{service}"
        self.dimensions = [{"Name": "Environment", "Value": environment}]
        self._pending: list[dict[str, Any]] = []

    def put(self, name: str, value: float) -> None:
        if name not in METRIC_NAMES:
            raise ValueError(f"{name!r} isn't one of the alarm or scaling metrics (15.5)")
        self._pending.append(
            {
                "MetricName": name,
                "Dimensions": self.dimensions,
                "Value": float(value),
                "Unit": _UNITS[name],
                "Timestamp": datetime.now(UTC),
            }
        )

    async def flush(self) -> int:
        """Send what's collected. A failure is logged and the batch dropped: next minute retries."""
        batch, self._pending = self._pending, []
        sent = 0
        for start in range(0, len(batch), MAX_DATUMS_PER_CALL):
            chunk = batch[start : start + MAX_DATUMS_PER_CALL]
            try:
                await asyncio.to_thread(
                    self.cloudwatch.put_metric_data, Namespace=self.namespace, MetricData=chunk
                )
            except Exception:
                _logger.warning(
                    "metrics: PutMetricData failed; dropping %d datapoints",
                    len(chunk),
                    exc_info=True,
                )
                continue
            sent += len(chunk)
        return sent


async def oldest_unpublished_outbox_age(db: Db, region: str) -> float:
    """Seconds since this region's oldest unpublished outbox row was written; 0 if none."""
    oldest = await db[OUTBOX].find_one(
        {"region": region, "published_at": None}, {"created_at": 1}, sort=[("created_at", 1)]
    )
    if oldest is None:
        return 0.0
    created = oldest["created_at"]
    if created.tzinfo is None:
        created = created.replace(tzinfo=UTC)
    return max(0.0, (datetime.now(UTC) - created).total_seconds())


# Renew or release only our own lock: the value is this holder's token.
_RENEW = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
"""
_RELEASE = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
"""


class RegionLeader:
    """One leader per region for a job that must run once (PendingJobCount, 15.5).

    `SET key token NX PX 120000`; the leader renews it, so a crashed leader is replaced
    within the lock's 2 minutes. Without Valkey every task leads (the metric is then sent
    by several tasks; the alarms use Maximum, so duplicates are harmless).
    """

    def __init__(self, redis: Any | None, key: str, *, ttl_ms: int = 120_000) -> None:
        self.redis = redis
        self.key = key
        self.ttl_ms = ttl_ms
        self.token = uuid.uuid4().hex
        self.leading = False

    async def try_lead(self) -> bool:
        """Become (or stay) the leader. Valkey errors mean "not leading" this round."""
        if self.redis is None:
            self.leading = True
            return True
        try:
            if self.leading:
                self.leading = bool(
                    await self.redis.eval(_RENEW, 1, self.key, self.token, self.ttl_ms)
                )
            if not self.leading:
                self.leading = bool(
                    await self.redis.set(self.key, self.token, nx=True, px=self.ttl_ms)
                )
        except Exception:
            _logger.warning("leader lock %s unreachable", self.key, exc_info=True)
            self.leading = False
        return self.leading

    async def release(self) -> None:
        if self.redis is None or not self.leading:
            return
        with contextlib.suppress(Exception):
            await self.redis.eval(_RELEASE, 1, self.key, self.token)
        self.leading = False
