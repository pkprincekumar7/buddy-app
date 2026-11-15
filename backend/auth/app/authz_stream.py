"""The change stream that keeps a region's authz cache current (docs/auth-users-split.md, 9.3).

An auth-worker in **every** region watches **all** of `auth.auth`, not only its own
users: entries are written outside a user's home region (login runs in the bootstrap
region, an admin's lock lands in the admin's region, failover can serve a user anywhere).
For each change it rewrites `authz:{id}` through the versioned write, but **only if this
region already holds that key**, so regions don't fill up with every user. A deleted
account's entry is dropped.

The resume token is kept in `worker_state` after every change, so a restart picks up where
the last task stopped. It's saved only once the change is applied: if Valkey can't take a
write (a lock, a revocation), the stream stops and starts again from the last saved token
after a pause, so the change is applied again rather than skipped and left to the entry's
1 h TTL. With no token saved yet (the first start, or after a lost one), the token of the
stream as it opens is saved before any change is applied, so a failed first change is
resumed before too, not lost to a restart "from now". If the oplog no longer has the token
(the worker was down too long), the stream restarts from now: entries then expire within
their 1 h TTL at worst.

**A change that keeps failing.** A transient failure (Valkey, the network, a timeout) is
retried from the saved token for as long as it lasts. A change that fails for any other
reason (a malformed document, a bug) would stall the region's stream for good, so after
MAX_CHANGE_ATTEMPTS tries it's skipped: logged as `authz.stream.change_skipped` (ERROR, for
a log metric filter and alarm), and its user's entry deleted, so the next request reads
authz from Mongo (common.authz's fill) instead of trusting an entry the change never reached.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Mapping
from typing import Any

from pymongo.errors import OperationFailure
from redis.exceptions import RedisError

from auth.app.authz_cache import delete_entry, entry_from_account, write_entry
from auth.app.runtime import Runtime
from auth.app.store import AUTH, WORKER_STATE

# The server can't resume from the stored token: ChangeStreamHistoryLost and friends.
LOST_TOKEN_CODES = frozenset({260, 280, 286})
RETRY_SECONDS = 5.0
# Tries before a change that fails other than transiently is skipped (module doc).
MAX_CHANGE_ATTEMPTS = 3
# Retried from the saved token for as long as they last.
TRANSIENT_ERRORS: tuple[type[BaseException], ...] = (RedisError, OSError, TimeoutError)

_PIPELINE = [{"$match": {"operationType": {"$in": ["update", "replace", "delete"]}}}]

_logger = logging.getLogger(__name__)


class AuthzStream:
    def __init__(self, runtime: Runtime, region: str, *, max_await_ms: int = 1000) -> None:
        self.runtime = runtime
        self.state_id = f"authz-stream:{region or 'local'}"
        self.max_await_ms = max_await_ms
        # The change that last failed other than transiently, and how many times in a row.
        self._failing: tuple[str, int] | None = None

    async def load_token(self) -> Mapping[str, Any] | None:
        doc = await self.runtime.db[WORKER_STATE].find_one({"_id": self.state_id})
        return doc.get("resume_token") if doc else None

    async def save_token(self, token: Mapping[str, Any] | None) -> None:
        await self.runtime.db[WORKER_STATE].update_one(
            {"_id": self.state_id}, {"$set": {"resume_token": token}}, upsert=True
        )

    async def apply(self, change: Mapping[str, Any]) -> None:
        user_id = change["documentKey"]["_id"]
        # strict: a Valkey failure raises, so follow() doesn't save the token past it.
        if change["operationType"] == "delete":
            await delete_entry(self.runtime.cache, user_id, strict=True)
            return
        doc = change.get("fullDocument")
        if doc is None:  # deleted again before the lookup; its delete event follows
            return
        await write_entry(
            self.runtime.cache, user_id, entry_from_account(doc), only_existing=True, strict=True
        )

    async def apply_or_skip(self, change: Mapping[str, Any]) -> None:
        """`apply`; a transient error raises (retried from the saved token). Any other
        raises too, until the same change has failed MAX_CHANGE_ATTEMPTS times: then it's
        skipped, loudly, and its user's entry dropped (module doc)."""
        try:
            await self.apply(change)
        except TRANSIENT_ERRORS:
            raise
        except Exception as exc:
            key = repr(change.get("_id"))
            tries = self._failing[1] + 1 if self._failing and self._failing[0] == key else 1
            self._failing = (key, tries)
            if tries < MAX_CHANGE_ATTEMPTS:
                raise
            user_id = _user_id(change)
            _logger.error(
                "authz.stream.change_skipped user=%s op=%s error=%s tries=%d",
                user_id, change.get("operationType"), type(exc).__name__, tries,
            )  # fmt: skip
            if user_id is not None:
                # Strict: if Valkey is down this raises and the skip runs again on resume.
                await delete_entry(self.runtime.cache, user_id, strict=True)
        self._failing = None

    async def follow(self, stop: asyncio.Event) -> None:
        """Apply changes until `stop` is set (within one `max_await_ms`)."""
        token = await self.load_token()
        async with await self.runtime.db[AUTH].watch(
            _PIPELINE,
            full_document="updateLookup",
            resume_after=token,
            max_await_time_ms=self.max_await_ms,
        ) as stream:
            if token is None:
                # Nothing saved yet: keep the opening token, so a restart after a failed
                # first change resumes before it instead of from a later "now".
                token = stream.resume_token
                await self.save_token(token)
            while not stop.is_set():
                change = await stream.try_next()
                if change is not None:
                    await self.apply_or_skip(change)
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
            except TRANSIENT_ERRORS:
                # A change not applied: resume from the token saved before it (module doc).
                _logger.warning("authz stream: the cache is unreachable; resuming in a moment")
                await _pause(stop)
            except Exception:
                # Whatever else stops it, the stream starts again: a dead task would leave
                # this region's entries stale until their TTL. A change failing like this is
                # retried MAX_CHANGE_ATTEMPTS times, then skipped (apply_or_skip).
                _logger.exception("authz stream failed; retrying")
                await _pause(stop)


def _user_id(change: Mapping[str, Any]) -> str | None:
    key = change.get("documentKey")
    user_id = key.get("_id") if isinstance(key, Mapping) else None
    return user_id if isinstance(user_id, str) else None


async def _pause(stop: asyncio.Event) -> None:
    with contextlib.suppress(TimeoutError):
        await asyncio.wait_for(stop.wait(), RETRY_SECONDS)
