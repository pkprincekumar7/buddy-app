"""Fixtures for common's tests that need a real MongoDB replica set (transactions, change streams).

They run against MONGODB_TEST_URI, never MONGODB_URI, so a local run can't touch a real
cluster: point it at the compose replica set,

    MONGODB_TEST_URI="mongodb://localhost:27017/?directConnection=true" pytest common/tests

Without it they skip; with REQUIRE_LIVE_SERVICES=1 (CI) a skip is a failure, as in
tests/conftest.py, so CI can't pass without exercising the real server.
"""

import asyncio
import os
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

MONGO_URI = os.environ.get("MONGODB_TEST_URI")

Body = Callable[[AsyncDatabase[dict[str, Any]], AsyncMongoClient[dict[str, Any]]], Awaitable[Any]]


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    report = outcome.get_result()
    if (
        report.skipped
        and not hasattr(report, "wasxfail")
        and os.environ.get("REQUIRE_LIVE_SERVICES") == "1"
        and item.get_closest_marker("live_service")
    ):
        reason = report.longrepr[-1] if isinstance(report.longrepr, tuple) else report.longrepr
        report.outcome = "failed"
        report.longrepr = f"live service required (REQUIRE_LIVE_SERVICES=1) but skipped: {reason}"


@pytest.fixture
def mongo_run() -> Callable[[Body], Any]:
    """Run `body(db, client)` against a fresh, throwaway database; dropped afterwards."""
    if not MONGO_URI:
        pytest.skip("MONGODB_TEST_URI not set (a throwaway replica set, e.g. docker compose mongo)")

    def run(body: Body) -> Any:
        async def main() -> Any:
            client: AsyncMongoClient[dict[str, Any]] = AsyncMongoClient(
                MONGO_URI, serverSelectionTimeoutMS=5000, tz_aware=True
            )
            db = client[f"common_test_{uuid.uuid4().hex[:12]}"]
            try:
                return await body(db, client)
            finally:
                await client.drop_database(db.name)
                await client.close()

        return asyncio.run(main())

    return run
