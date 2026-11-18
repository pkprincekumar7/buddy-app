"""The reservation reaper (docs/auth-users-split.md, 10.1).

A registration that died half-way leaves an `email_index` row still `reserved`, and maybe
its `auth.auth` document and users profile. Login needs an `active` row, so none of that can
be signed into, but the email stays blocked. Every minute the reaper takes reservations
older than 15 minutes and removes what they left, then the row:

1. **Claim** the row by deleting it, matching exactly the row read. A saga that was about
   to activate it now fails its conditional activation and undoes itself (registration
   answers 503), so an account can never be activated after its credentials are gone.
2. Delete the profile (users' idempotent `DELETE /internal/users/{id}`). If users can't
   confirm, put the row back as it was and retry on the next sweep.
3. Delete the credentials.

Each region's worker reaps only its own locations' rows (all of them locally), so regions
don't race each other over one row.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from datetime import UTC, datetime

from pymongo.errors import DuplicateKeyError

from auth.app.registration import STALE_AFTER, delete_profile
from auth.app.runtime import Runtime
from auth.app.store import AUTH, EMAIL_INDEX
from auth.emails import log_key

BATCH = 100
INTERVAL_SECONDS = 60.0

_logger = logging.getLogger(__name__)


class Reaper:
    def __init__(
        self,
        runtime: Runtime,
        locations: list[str] | None,
        *,
        interval: float = INTERVAL_SECONDS,
    ) -> None:
        self.runtime = runtime
        self.locations = locations
        self.interval = interval

    async def sweep(self) -> int:
        """Reap one batch; returns how many reservations were cleaned up."""
        rows = self.runtime.db[EMAIL_INDEX]
        selector: dict[str, object] = {
            "status": "reserved",
            "reserved_at": {"$lt": datetime.now(UTC) - STALE_AFTER},
        }
        if self.locations is not None:
            selector["location"] = {"$in": self.locations}
        reaped = 0
        for row in await rows.find(selector).limit(BATCH).to_list(None):
            claimed = await rows.delete_one(
                {
                    "_id": row["_id"],
                    "user_id": row["user_id"],
                    "status": "reserved",
                    "reserved_at": row["reserved_at"],
                }
            )
            if claimed.deleted_count != 1:
                continue  # activated, taken over or reaped elsewhere meanwhile
            if not await delete_profile(self.runtime, row["user_id"], row["location"]):
                with contextlib.suppress(DuplicateKeyError):  # a new registration took the key
                    await rows.insert_one(row)
                _logger.warning(
                    "reaper: users unreachable; retrying email_key=%s", log_key(row["_id"])
                )
                continue
            await self.runtime.db[AUTH].delete_one(
                {"_id": row["user_id"], "location": row["location"]}
            )
            _logger.info("reaper: removed a stale reservation email_key=%s", log_key(row["_id"]))
            reaped += 1
        return reaped

    async def run(self, stop: asyncio.Event) -> None:
        while not stop.is_set():
            try:
                await self.sweep()
            except Exception:
                _logger.exception("reaper sweep failed; retrying")
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(stop.wait(), self.interval)
