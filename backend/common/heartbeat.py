"""A worker's heartbeat file, for its container health check (production-readiness review, APP-06).

A worker has no port to probe, so it touches a file every `interval` seconds while its event
loop runs, and ECS's health check (infra-live-backend/terraform/services.tf) calls the task
unhealthy once the file is 60 s old. A worker whose loop has hung, or that is stuck in
blocking code, is then replaced instead of sitting there doing nothing.

    await asyncio.gather(relay.run(stop), consumer.run(...), heartbeat(stop))
"""

from __future__ import annotations

import asyncio
import contextlib
import tempfile
from pathlib import Path

INTERVAL_SECONDS = 15.0


def heartbeat_path() -> Path:
    """The file the health check reads: `<temp dir>/worker-heartbeat` (/tmp in the image)."""
    return Path(tempfile.gettempdir()) / "worker-heartbeat"


async def heartbeat(
    stop: asyncio.Event, *, path: Path | None = None, interval: float = INTERVAL_SECONDS
) -> None:
    """Touch the heartbeat file now and every `interval` seconds until `stop` is set."""
    target = path if path is not None else heartbeat_path()
    while True:
        target.touch()  # creates it, or sets an existing one's time to now
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(stop.wait(), interval)
        if stop.is_set():
            return
