"""Shared pytest hooks."""

import os

import pytest


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    """With REQUIRE_LIVE_SERVICES=1 (set in CI), a skipped `live_service` test is a
    failure: it means the MongoDB/Redis service wasn't reachable, and the run would
    otherwise pass without ever exercising the real server."""
    outcome = yield
    report = outcome.get_result()
    if (
        report.skipped
        and os.environ.get("REQUIRE_LIVE_SERVICES") == "1"
        and item.get_closest_marker("live_service")
    ):
        reason = report.longrepr[-1] if isinstance(report.longrepr, tuple) else report.longrepr
        report.outcome = "failed"
        report.longrepr = f"live service required (REQUIRE_LIVE_SERVICES=1) but skipped: {reason}"
