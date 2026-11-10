"""common.index_builds: indexes built off the startup path, once per release (DB-03)."""

import asyncio
import logging
from datetime import UTC, datetime, timedelta
from typing import Any, cast

import pytest
from pymongo import ASCENDING, IndexModel
from pymongo.errors import (
    AutoReconnect,
    NotPrimaryError,
    OperationFailure,
    ServerSelectionTimeoutError,
)

from common import index_builds
from common.events import store
from common.index_builds import (
    BUILDS,
    STALE_AFTER,
    missing_indexes,
    prepare_database,
    record_indexes,
    run_index_build,
    stop_index_build,
)

pytestmark = pytest.mark.live_service

INDEXES = {"things": [IndexModel([("location", ASCENDING), ("user_id", ASCENDING)])]}


async def ensure_things(db):
    things = await store.ensure_validated_collection(db, "things", {"bsonType": "object"})
    assert things.name == "things"  # anything but create_index is the real collection's
    await things.create_index([("location", ASCENDING), ("user_id", ASCENDING)])
    await db.get_collection("things").create_index("created_at", expireAfterSeconds=60)


def problems(caplog):
    return [
        getattr(r, "index_problem", None) for r in caplog.records if hasattr(r, "index_problem")
    ]


def test_recording_makes_the_collections_but_not_the_indexes(mongo_run):
    async def body(db, client):
        indexes = await record_indexes(db, ensure_things)
        assert "things" in await db.list_collection_names()
        assert list((await db["things"].index_information()).keys()) == ["_id_"]
        assert [m.document["name"] for m in indexes["things"]] == [
            "location_1_user_id_1",
            "created_at_1",
        ]
        # The service functions record as they built before: the outbox's four.
        outbox = await record_indexes(db, store.ensure_outbox)
        assert len(outbox[store.OUTBOX]) == 4

    mongo_run(body)


@pytest.mark.parametrize("release", [None, "", "unknown"])
def test_without_a_release_the_indexes_are_built_at_once(mongo_run, release):
    async def body(db, client):
        assert await prepare_database(db, ensure_things, service="t", release=release) is None
        assert set(await db["things"].index_information()) == {
            "_id_",
            "location_1_user_id_1",
            "created_at_1",
        }
        assert BUILDS not in await db.list_collection_names()

    mongo_run(body)


def test_with_a_release_one_task_builds_and_the_others_check(mongo_run, caplog, monkeypatch):
    caplog.set_level(logging.INFO)
    monkeypatch.setattr(index_builds, "WAIT_POLL_SECONDS", 0.05)  # the followers' poll

    async def started(db):
        task = await prepare_database(db, ensure_things, service="t", release="abc1234")
        assert task is not None  # a release: built in the background
        return task

    async def body(db, client):
        tasks = [await started(db) for _ in range(5)]
        outcomes = await asyncio.gather(*tasks)
        assert sorted(outcomes) == ["built", "skipped", "skipped", "skipped", "skipped"]
        assert "created_at_1" in await db["things"].index_information()
        build = await db[BUILDS].find_one({"_id": "t:abc1234"})
        assert build["status"] == "done"
        # The next start of the same release builds nothing.
        assert await (await started(db)) == "skipped"
        assert problems(caplog) == []

    mongo_run(body)


def test_a_failed_build_is_logged_not_raised(mongo_run, caplog):
    async def body(db, client):
        # The same name with other options: createIndexes refuses (an option conflict).
        await db["things"].create_index(
            [("location", ASCENDING), ("user_id", ASCENDING)], unique=True
        )
        outcome = await run_index_build(db, INDEXES, service="t", release="r1")
        assert outcome == "failed"
        build = await db[BUILDS].find_one({"_id": "r1"})
        assert build["status"] == "failed" and build["error"] == "OperationFailure"
        assert problems(caplog) == ["failed"]
        # The next start retries it: it fails again while the cause is there...
        assert await run_index_build(db, INDEXES, service="t", release="r1") == "failed"
        assert problems(caplog) == ["failed", "failed"]
        # ...and builds once it's fixed (a restart is the way to retry).
        await db["things"].drop_index("location_1_user_id_1")
        assert await run_index_build(db, INDEXES, service="t", release="r1") == "built"
        assert (await db[BUILDS].find_one({"_id": "r1"}))["status"] == "done"

    mongo_run(body)


def test_a_follower_of_a_build_that_fails_logs_nothing_more(mongo_run, caplog):
    async def body(db, client):
        await db[BUILDS].insert_one(
            {"_id": "r7", "status": "running", "started_at": datetime.now(UTC)}
        )

        async def sleep(seconds):  # meanwhile, the builder fails (and logs why)
            await db[BUILDS].update_one({"_id": "r7"}, {"$set": {"status": "failed"}})

        assert await run_index_build(db, INDEXES, service="t", release="r7", sleep=sleep) == (
            "failed"
        )
        assert problems(caplog) == []

    mongo_run(body)


def test_an_index_missing_after_the_build_is_a_problem(mongo_run, caplog):
    async def body(db, client):
        assert await run_index_build(db, INDEXES, service="t", release="r2") == "built"
        await db["things"].drop_index("location_1_user_id_1")
        assert await missing_indexes(db, INDEXES) == ["things.location_1_user_id_1"]
        assert await run_index_build(db, INDEXES, service="t", release="r2") == "failed"
        assert problems(caplog) == ["missing"]

    mongo_run(body)


def test_a_follower_waits_for_the_running_build(mongo_run):
    async def body(db, client):
        await db[BUILDS].insert_one(
            {"_id": "r3", "status": "running", "started_at": datetime.now(UTC)}
        )
        waits = []

        async def sleep(seconds):
            waits.append(seconds)
            await index_builds.build_indexes(db, INDEXES)
            await db[BUILDS].update_one({"_id": "r3"}, {"$set": {"status": "done"}})

        assert await run_index_build(db, INDEXES, service="t", release="r3", sleep=sleep) == (
            "skipped"
        )
        assert waits == [index_builds.WAIT_POLL_SECONDS]

    mongo_run(body)


def test_a_stale_build_is_taken_over(mongo_run):
    async def body(db, client):
        old = datetime.now(UTC) - STALE_AFTER - timedelta(minutes=1)
        await db[BUILDS].insert_one({"_id": "r4", "status": "running", "started_at": old})
        assert await run_index_build(db, INDEXES, service="t", release="r4") == "built"
        assert (await db[BUILDS].find_one({"_id": "r4"}))["status"] == "done"

    mongo_run(body)


def test_a_follower_stops_waiting_after_stale_after(mongo_run, caplog):
    async def body(db, client):
        now = [datetime.now(UTC)]
        await db[BUILDS].insert_one({"_id": "r5", "status": "running", "started_at": now[0]})

        async def sleep(seconds):
            now[0] += STALE_AFTER  # the build never finishes

        outcome = await run_index_build(
            db, INDEXES, service="t", release="r5", sleep=sleep, clock=lambda: now[0]
        )
        assert outcome == "failed"  # it checked, and the index isn't there
        assert problems(caplog) == ["missing"]

    mongo_run(body)


def test_a_check_that_fails_is_logged_not_raised(mongo_run, caplog, monkeypatch):
    async def broken(db, indexes):
        raise ConnectionError("mongo gone")

    monkeypatch.setattr(index_builds, "missing_indexes", broken)

    async def body(db, client):
        assert await run_index_build(db, INDEXES, service="t", release="r6") == "failed"
        assert problems(caplog) == ["failed"]

    mongo_run(body)


def test_stopping_cancels_a_running_build_only():
    async def main():
        stop_index_build(None)
        running = asyncio.create_task(asyncio.sleep(10))
        stop_index_build(running)
        with pytest.raises(asyncio.CancelledError):
            await running
        done = asyncio.create_task(asyncio.sleep(0, result="built"))
        await done
        stop_index_build(done)
        assert done.result() == "built"

    asyncio.run(main())


# ── startup through an Atlas election (DB-05) ─────────────────────────────────


class Election:
    """A clock and a sleep that move it, so the retries' waits take no real time."""

    def __init__(self) -> None:
        self.now = 0.0
        self.waits: list[float] = []

    def clock(self) -> float:
        return self.now

    async def sleep(self, seconds: float) -> None:
        self.waits.append(seconds)
        self.now += seconds


def test_startup_rides_out_an_election(caplog):
    election, calls = Election(), []

    async def step():
        calls.append(1)
        if len(calls) < 4:
            raise NotPrimaryError("not primary")
        return "ready"

    result = asyncio.run(
        index_builds.with_startup_retries(
            step, service="t", clock=election.clock, sleep=election.sleep
        )
    )
    assert result == "ready" and election.waits == [1.0, 2.0, 4.0]
    assert "t: MongoDB unavailable at startup (NotPrimaryError); retrying in 1 s" in caplog.text


def test_startup_gives_up_after_the_retry_window():
    election = Election()

    async def step():
        raise ServerSelectionTimeoutError("no primary")

    with pytest.raises(ServerSelectionTimeoutError):
        asyncio.run(
            index_builds.with_startup_retries(
                step, service="t", clock=election.clock, sleep=election.sleep
            )
        )
    assert sum(election.waits) <= index_builds.STARTUP_RETRY_SECONDS
    assert election.waits == [1.0, 2.0, 4.0, 8.0, 16.0]  # the next, 32 s, would pass 60 s


def test_any_other_error_stops_startup_at_once():
    election = Election()

    async def step():
        raise OperationFailure("bad validator", code=2)

    with pytest.raises(OperationFailure):
        asyncio.run(
            index_builds.with_startup_retries(
                step, service="t", clock=election.clock, sleep=election.sleep
            )
        )
    assert election.waits == []


@pytest.mark.parametrize(
    ("exc", "transient"),
    [
        (AutoReconnect("reset"), True),
        (OperationFailure("stepped down", code=189), True),
        (OperationFailure("interrupted", code=11602), True),
        (OperationFailure("x", code=1, details={"errorLabels": ["RetryableWriteError"]}), True),
        (OperationFailure("unauthorized", code=13), False),
        (ValueError("bug"), False),
    ],
)
def test_which_errors_are_retried(exc, transient):
    assert index_builds.is_transient(exc) is transient


def test_prepare_database_retries_its_collection_step(monkeypatch):
    attempts = []

    async def flaky(db):
        attempts.append(1)
        if len(attempts) == 1:
            raise AutoReconnect("election")

    async def no_wait(seconds):
        return None

    monkeypatch.setattr(index_builds.asyncio, "sleep", no_wait)
    db = cast(Any, object())  # no index to build, so it's never touched
    assert asyncio.run(prepare_database(db, flaky, service="t", release=None)) is None
    assert len(attempts) == 2
