"""The change stream that keeps a region's authz cache current (docs/auth-users-split.md, 9.3).

An auth-worker in **every** region watches **all** of `auth.auth`, not only its own
users: entries are written outside a user's home region (login runs in the bootstrap
region, an admin's lock lands in the admin's region, failover can serve a user anywhere).
For each change it rewrites `authz:{id}` through the versioned write, but **only if this
region already holds that key**, so regions don't fill up with every user. A deleted
account's entry is dropped.

The resume token is kept in `worker_state` after every change, so a restart picks up where
the last task stopped. If the oplog no longer has it (the worker was down too long), the
stream restarts from now: entries then expire within their 1 h TTL at worst.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Mapping
from typing import Any

from pymongo.errors import OperationFailure, PyMongoError

from auth.app.authz_cache import delete_entry, entry_from_account, write_entry
from auth.app.runtime import Runtime
from auth.app.store import AUTH, WORKER_STATE

# The server can't resume from the stored token: ChangeStreamHistoryLost and friends.
LOST_TOKEN_CODES = frozenset({260, 280, 286})
RETRY_SECONDS = 5.0

_PIPELINE = [{"$match": {"operationType": {"$in": ["update", "replace", "delete"]}}}]

_logger = logging.getLogger(__name__)


class AuthzStream:
    def __init__(self, runtime: Runtime, region: str, *, max_await_ms: int = 1000) -> None:
        self.runtime = runtime
        self.state_id = f"authz-stream:{region or 'local'}"
        self.max_await_ms = max_await_ms

    async def load_token(self) -> Mapping[str, Any] | None:
        doc = await self.runtime.db[WORKER_STATE].find_one({"_id": self.state_id})
        return doc.get("resume_token") if doc else None

    async def save_token(self, token: Mapping[str, Any] | None) -> None:
        await self.runtime.db[WORKER_STATE].update_one(
            {"_id": self.state_id}, {"$set": {"resume_token": token}}, upsert=True
        )

    async def apply(self, change: Mapping[str, Any]) -> None:
        user_id = change["documentKey"]["_id"]
        if change["operationType"] == "delete":
            await delete_entry(self.runtime.cache, user_id)
            return
        doc = change.get("fullDocument")
        if doc is None:  # deleted again before the lookup; its delete event follows
            return
        await write_entry(self.runtime.cache, user_id, entry_from_account(doc), only_existing=True)

    async def follow(self, stop: asyncio.Event) -> None:
        """Apply changes until `stop` is set (within one `max_await_ms`)."""
        token = await self.load_token()
        async with await self.runtime.db[AUTH].watch(
            _PIPELINE,
            full_document="updateLookup",
            resume_after=token,
            max_await_time_ms=self.max_await_ms,
        ) as stream:
            while not stop.is_set():
                change = await stream.try_next()
                if change is not None:
                    await self.apply(change)
                # Saved even with no change: the token advances with the cluster's time.
                if stream.resume_token != token:
                    token = stream.resume_token
                    await self.save_token(token)

    async def run(self, stop: asyncio.Event) -> None:
        while not stop.is_set():
            try:
                await self.follow(stop)
            except OperationFailure as exc:
                if exc.code not in LOST_TOKEN_CODES:
                    _logger.exception("authz stream failed; retrying")
                else:
                    _logger.warning("authz stream can't resume (%s); restarting from now", exc.code)
                    await self.save_token(None)
                await _pause(stop)
            except PyMongoError:
                _logger.exception("authz stream failed; retrying")
                await _pause(stop)


async def _pause(stop: asyncio.Event) -> None:
    with contextlib.suppress(TimeoutError):
        await asyncio.wait_for(stop.wait(), RETRY_SECONDS)
