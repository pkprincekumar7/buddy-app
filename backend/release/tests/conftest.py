"""Fixtures for release's tests; the helpers are in release_testkit.py, named so it can't
clash with another service's test modules."""

from release_testkit import (  # noqa: F401
    fake_aws_credentials,
    mongo_uri,
    pytest_runtest_makereport,
)
