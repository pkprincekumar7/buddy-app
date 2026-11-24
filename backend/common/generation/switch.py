"""The generation kill switch (production-readiness review, JOB-03).

One SSM parameter per backend stack, `/<app>/<env>/backend/<region>/llm_generation_enabled`,
made by Terraform with the value `true` (and not reset by later applies). Setting it to `false`
in the console or with `aws ssm put-parameter` stops LLM spend within about a minute,
with no deploy:
- the generating services refuse new generations with `503 generation_paused`;
- their workers stop claiming jobs. A job already running finishes, and jobs waiting
  are taken once it's `true` again.

Every task reads the parameter at most once a minute (`ttl`). If it can't be read, the
last value read is kept, and before any read the switch is on: a broken read mustn't
stop generation on its own. Without LLM_SWITCH_PARAMETER (local runs, tests) it's always on.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Callable
from typing import Any

TTL_SECONDS = 60.0

_logger = logging.getLogger(__name__)


class GenerationSwitch:
    def __init__(
        self,
        parameter: str | None,
        ssm: Any = None,
        *,
        ttl: float = TTL_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.parameter = parameter
        self.ssm = ssm
        self.ttl = ttl
        self.clock = clock
        self._enabled = True
        self._read_at: float | None = None

    @classmethod
    def always_on(cls) -> GenerationSwitch:
        return cls(None)

    async def enabled(self) -> bool:
        """Whether generation may run now (re-read from SSM once `ttl` has passed)."""
        if not self.parameter or self.ssm is None:
            return True
        now = self.clock()
        if self._read_at is not None and now - self._read_at < self.ttl:
            return self._enabled
        self._read_at = now
        try:
            answer = await asyncio.to_thread(self.ssm.get_parameter, Name=self.parameter)
            value = str(answer["Parameter"]["Value"]).strip().lower()
        except Exception as exc:
            _logger.warning(
                "generation switch: %s unreadable (%s); keeping %s",
                self.parameter,
                type(exc).__name__,
                "on" if self._enabled else "off",
            )
            return self._enabled
        enabled = value != "false"
        if enabled != self._enabled:
            _logger.warning(
                "generation switch: %s is now %s", self.parameter, "on" if enabled else "off"
            )
        self._enabled = enabled
        return enabled
