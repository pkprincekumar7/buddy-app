"""common.heartbeat: a worker touches its heartbeat file while its loop runs (APP-06)."""

import asyncio
import os
import tempfile
import time
from pathlib import Path

from common.heartbeat import heartbeat, heartbeat_path


def test_the_file_is_touched_until_stop(tmp_path: Path):
    path = tmp_path / "worker-heartbeat"

    async def main() -> list[int]:
        stop = asyncio.Event()
        task = asyncio.create_task(heartbeat(stop, path=path, interval=0.05))
        seen = []
        for _ in range(3):
            await asyncio.sleep(0.06)
            seen.append(path.stat().st_mtime_ns)
        stop.set()
        await asyncio.wait_for(task, 1)  # stops at once, not after a whole interval
        return seen

    seen = asyncio.run(main())
    assert len(set(seen)) >= 2  # refreshed while running


def test_an_old_file_is_refreshed_at_once(tmp_path: Path):
    path = tmp_path / "worker-heartbeat"
    path.touch()
    old = time.time() - 600
    os.utime(path, (old, old))

    async def main() -> None:
        stop = asyncio.Event()
        stop.set()
        await heartbeat(stop, path=path)

    asyncio.run(main())
    assert time.time() - path.stat().st_mtime < 5


def test_the_default_file_is_the_one_the_health_check_reads():
    # services.tf's check: os.path.join(tempfile.gettempdir(), 'worker-heartbeat').
    assert heartbeat_path() == Path(tempfile.gettempdir()) / "worker-heartbeat"
