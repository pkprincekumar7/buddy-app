"""Fixtures for discover's tests; the helpers are in discover_testkit.py, named so it can't
clash with another service's test modules."""

from discover_testkit import (  # noqa: F401
    fake_aws_credentials,
    mongo_uri,
    pytest_runtest_makereport,
)
