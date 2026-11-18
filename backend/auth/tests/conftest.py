"""Fixtures for auth's tests; the helpers are in auth_testkit.py, named so it can't clash
with another service's test modules."""

import os

# common.cookies picks the session cookies' names from APP_ENV once, at import (a task's
# environment never changes), and these tests expect the local names: pinned before anything
# imports it. CI runs the tests under APP_ENV=dev to show nothing else reads the environment.
os.environ["APP_ENV"] = "local"

from auth_testkit import (  # noqa: E402, F401
    fake_aws_credentials,
    mongo_uri,
    pytest_runtest_makereport,
    redis_url,
)
