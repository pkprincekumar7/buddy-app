"""hello's demo tests run against MONGODB_TEST_URI (a throwaway replica set), never MONGODB_URI.

    MONGODB_TEST_URI="mongodb://localhost:27017/?directConnection=true" pytest hello/tests

Without it they skip; with REQUIRE_LIVE_SERVICES=1 a skip is a failure, as in common/tests.
"""

import os

import pytest

MONGO_URI = os.environ.get("MONGODB_TEST_URI")


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
def mongo_uri() -> str:
    if not MONGO_URI:
        pytest.skip("MONGODB_TEST_URI not set (a throwaway replica set, e.g. docker compose mongo)")
    return MONGO_URI
