"""Index builds off the startup path (production-readiness review, DB-03).

Every HTTP and worker task prepares its database at startup: the collections and their
validators must exist before it serves (a collection created inside a transaction, by the
first insert, conflicts with any concurrent create of it). Building the indexes there too
had every task of every region run every `createIndex` on every deploy, and a new index on
a large collection held up startup until it was built, so the health check failed and the
circuit breaker rolled the deploy back. An option conflict crash-looped every task.

`prepare_database` keeps the first part and moves the second off the startup path:

- It runs the service's `ensure_*` functions against a stand-in for the database that
  creates collections and validators for real but only records each `create_index`.
- Without a release (no GIT_SHA: local runs and tests) it then builds them at once, as
  before.
- With one, it starts a background task and returns. The first task of the release to
  claim `index_builds/<service>:<release>` (in the service's database, so once across
  every region and task) builds the indexes. The others wait until that build has finished,
  then check the indexes exist. A build left running for STALE_AFTER (its task stopped)
  is taken over, and so is a failed one: the next start retries it.
- A failed build, or an index still missing afterwards, is logged with a top-level
  `index_problem` field. The backend stack counts those lines and alarms. Nothing
  raises: the task keeps serving.

Startup rides out an Atlas election (production-readiness review, DB-05): the collection
step is retried with backoff for up to STARTUP_RETRY_SECONDS on a connection or "not
primary" error, inside the container's health-check allowance, instead of the task
exiting and ECS restarting it in a loop. Any other error stops startup at once.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable, Mapping
from datetime import UTC, datetime, timedelta
from typing import Any, Literal, cast

from pymongo import IndexModel
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import ConnectionFailure, DuplicateKeyError, OperationFailure

BUILDS = "index_builds"
STALE_AFTER = timedelta(minutes=30)
WAIT_POLL_SECONDS = 15.0
# GIT_SHA's value when an image is built without one (backend/Dockerfile).
NO_RELEASE = frozenset({"", "unknown"})
# An Atlas election takes about 10-12 s; a task's health check allows about 150 s
# (services.tf: startPeriod 60 s, then 3 x 30 s), the load balancer's grace 90 s.
STARTUP_RETRY_SECONDS = 60.0
STARTUP_FIRST_DELAY_SECONDS = 1.0
# Server errors of a replica set changing primary (not covered by ConnectionFailure, which
# includes NotPrimaryError, AutoReconnect and ServerSelectionTimeoutError).
_STEPPING_DOWN = frozenset({91, 189, 10107, 11600, 11602, 13435, 13436})

Doc = dict[str, Any]
Db = AsyncDatabase[Doc]
Indexes = dict[str, list[IndexModel]]
Outcome = Literal["built", "skipped", "failed"]

_logger = logging.getLogger(__name__)


class _RecordingCollection:
    """A collection whose `create_index` is recorded, not run. Everything else is real."""

    def __init__(self, collection: Any, indexes: Indexes) -> None:
        self._collection = collection
        self._indexes = indexes

    async def create_index(self, keys: Any, **kwargs: Any) -> str:
        model = IndexModel(keys, **kwargs)
        self._indexes.setdefault(self._collection.name, []).append(model)
        return str(model.document["name"])

    def __getattr__(self, name: str) -> Any:
        return getattr(self._collection, name)


class _RecordingDatabase:
    """The database, with every collection a `_RecordingCollection`."""

    def __init__(self, db: Db, indexes: Indexes) -> None:
        self._db = db
        self._indexes = indexes

    def __getitem__(self, name: str) -> _RecordingCollection:
        return _RecordingCollection(self._db[name], self._indexes)

    def get_collection(self, name: str, **kwargs: Any) -> _RecordingCollection:
        return _RecordingCollection(self._db.get_collection(name, **kwargs), self._indexes)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._db, name)


async def record_indexes(db: Db, ensure: Callable[[Db], Awaitable[None]]) -> Indexes:
    """Run `ensure` (the service's collections, validators and indexes): the collections
    and validators are made; the indexes are returned, per collection, unbuilt."""
    indexes: Indexes = {}
    await ensure(cast(Db, _RecordingDatabase(db, indexes)))
    return indexes


async def build_indexes(db: Db, indexes: Mapping[str, list[IndexModel]]) -> None:
    """One createIndexes per collection. An index that's already there is a no-op."""
    for name, models in indexes.items():
        await db[name].create_indexes(models)


async def missing_indexes(db: Db, indexes: Mapping[str, list[IndexModel]]) -> list[str]:
    """`collection.index_name` for every expected index the database doesn't have."""
    missing: list[str] = []
    for name, models in indexes.items():
        present = {index["name"] async for index in await db[name].list_indexes()}
        missing += [
            f"{name}.{model.document['name']}"
            for model in models
            if model.document["name"] not in present
        ]
    return missing


def _problem(kind: str, message: str, *args: Any) -> None:
    _logger.error(message, *args, extra={"index_problem": kind})


async def _claim(db: Db, release: str, now: datetime) -> bool:
    """True when this task is to build the release's indexes."""
    builds = db[BUILDS]
    try:
        await builds.insert_one({"_id": release, "status": "running", "started_at": now})
        return True
    except DuplicateKeyError:
        pass
    # A build whose task stopped part-way, or one that failed (so a restart, once the
    # cause is fixed, retries it): take it over. One task wins; the others wait for it.
    taken = await builds.update_one(
        {
            "_id": release,
            "$or": [
                {"status": "running", "started_at": {"$lt": now - STALE_AFTER}},
                {"status": "failed"},
            ],
        },
        {"$set": {"status": "running", "started_at": now}},
    )
    return taken.modified_count == 1


async def _wait_for_build(
    db: Db, release: str, sleep: Callable[[float], Awaitable[None]], clock: Callable[[], datetime]
) -> str:
    """The build's status once it's no longer running, or "running" if it outlasts
    STALE_AFTER."""
    deadline = clock() + STALE_AFTER
    while True:
        build = await db[BUILDS].find_one({"_id": release})
        status = str(build["status"]) if build else "missing"
        if status != "running" or clock() >= deadline:
            return status
        await sleep(WAIT_POLL_SECONDS)


async def run_index_build(
    db: Db,
    indexes: Mapping[str, list[IndexModel]],
    *,
    service: str,
    release: str,
    clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> Outcome:
    """Build the release's indexes if this task claims them, else wait for the build;
    then check every index exists. Logs a problem instead of raising."""
    try:
        if await _claim(db, release, clock()):
            try:
                await build_indexes(db, indexes)
            except Exception as exc:
                await db[BUILDS].update_one(
                    {"_id": release},
                    {"$set": {"status": "failed", "error": type(exc).__name__, "at": clock()}},
                )
                _problem("failed", "%s: index build for %s failed: %s", service, release, exc)
                return "failed"
            await db[BUILDS].update_one(
                {"_id": release}, {"$set": {"status": "done", "at": clock()}}
            )
            outcome: Outcome = "built"
        else:
            status = await _wait_for_build(db, release, sleep, clock)
            if status == "failed":
                return "failed"  # the task that built it has logged why
            outcome = "skipped"
        missing = await missing_indexes(db, indexes)
    except Exception as exc:
        _problem("failed", "%s: index check for %s failed: %s", service, release, exc)
        return "failed"
    if missing:
        _problem("missing", "%s: indexes missing for %s: %s", service, release, ", ".join(missing))
        return "failed"
    _logger.info("%s: indexes for %s %s", service, release, outcome)
    return outcome


async def prepare_database(
    db: Db,
    ensure: Callable[[Db], Awaitable[None]],
    *,
    service: str,
    release: str | None,
) -> asyncio.Task[Outcome] | None:
    """Make the collections and validators now; the indexes now without a release, else
    in a background task (returned, so the runtime can cancel it when it closes)."""
    indexes = await with_startup_retries(lambda: record_indexes(db, ensure), service=service)
    if (release or "") in NO_RELEASE:
        await with_startup_retries(lambda: build_indexes(db, indexes), service=service)
        return None
    return asyncio.create_task(
        run_index_build(db, indexes, service=service, release=f"{service}:{release}"),
        name=f"{service}-index-build",
    )


def is_transient(exc: BaseException) -> bool:
    """A connection error or a primary stepping down: worth retrying in a moment."""
    if isinstance(exc, ConnectionFailure):
        return True
    return isinstance(exc, OperationFailure) and (
        exc.code in _STEPPING_DOWN or exc.has_error_label("RetryableWriteError")
    )


async def with_startup_retries(
    step: Callable[[], Awaitable[Any]],
    *,
    service: str,
    clock: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> Any:
    """Run `step`, retrying a transient error with doubling waits (1 s, 2 s, 4 s...) until
    STARTUP_RETRY_SECONDS have passed; then, or for any other error, it raises."""
    deadline = clock() + STARTUP_RETRY_SECONDS
    delay = STARTUP_FIRST_DELAY_SECONDS
    while True:
        try:
            return await step()
        except Exception as exc:
            if not is_transient(exc) or clock() + delay > deadline:
                raise
            _logger.warning(
                "%s: MongoDB unavailable at startup (%s); retrying in %.0f s",
                service,
                type(exc).__name__,
                delay,
            )
            await sleep(delay)
            delay *= 2


def stop_index_build(task: asyncio.Task[Any] | None) -> None:
    """For a runtime's aclose: cancel the background build if it's still going. The server
    finishes an index already started; the next start of the release takes it over."""
    if task is not None and not task.done():
        task.cancel()
