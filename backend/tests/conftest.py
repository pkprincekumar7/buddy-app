"""Shared pytest hooks."""

import os
from pathlib import Path

import pytest


def pytest_configure(config):
    """Mutation runs are manual-only and take a long time: refuse to let one start
    inside Claude Code. mutmut runs the suite from its backend/mutants/ copy, so a
    conftest loaded from there means a mutation run (docs/mutation-testing.md)."""
    if Path(__file__).resolve().parents[1].name == "mutants" and os.environ.get("CLAUDECODE"):
        pytest.exit(
            "Refusing to run mutation testing inside Claude Code — run it yourself in a "
            "terminal (see docs/mutation-testing.md).",
            returncode=2,
        )


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    """With REQUIRE_LIVE_SERVICES=1 (set in CI), a skipped `live_service` test is a
    failure: it means the MongoDB/Redis service wasn't reachable, and the run would
    otherwise pass without ever exercising the real server."""
    outcome = yield
    report = outcome.get_result()
    if (
        report.skipped
        and not hasattr(report, "wasxfail")  # an expected failure is reported as a skip
        and os.environ.get("REQUIRE_LIVE_SERVICES") == "1"
        and item.get_closest_marker("live_service")
    ):
        reason = report.longrepr[-1] if isinstance(report.longrepr, tuple) else report.longrepr
        report.outcome = "failed"
        report.longrepr = f"live service required (REQUIRE_LIVE_SERVICES=1) but skipped: {reason}"
