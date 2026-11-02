"""Tests for dispatcher.py, with no AWS or GitHub access (standard library only).

    python3 infra-live-scheduler/lambda/test_dispatcher.py
"""

import io
import json
import os
import sys
import types
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

# boto3 isn't needed: the function only reads the PAT through it.
_boto3 = types.ModuleType("boto3")
_boto3.client = lambda name: types.SimpleNamespace(  # type: ignore[attr-defined]
    get_secret_value=lambda SecretId: {"SecretString": "test-pat"}
)
sys.modules.setdefault("boto3", _boto3)
sys.path.insert(0, str(Path(__file__).resolve().parent))

import dispatcher  # noqa: E402

ENV = {
    "GITHUB_PAT_SECRET_ARN": "arn:aws:secretsmanager:ap-south-1:1:secret:pat",
    "GITHUB_REPO_OWNER": "owner",
    "GITHUB_REPO_NAME": "repo",
    "GITHUB_WORKFLOW_FILE": "terraform-live-all.yml",
}
EVENT = {"ref": "main", "inputs": {"action": "apply", "environment": "dev"}}


class _Response(io.BytesIO):
    status = 204

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


@mock.patch.dict(os.environ, ENV)
class DispatcherTest(unittest.TestCase):
    def test_dispatches_the_event_with_a_timeout(self):
        with mock.patch.object(dispatcher.urllib.request, "urlopen", return_value=_Response()) as urlopen:
            self.assertEqual(dispatcher.lambda_handler(EVENT, None), {"statusCode": 204})
        request = urlopen.call_args.args[0]
        self.assertEqual(
            request.full_url,
            "https://api.github.com/repos/owner/repo/actions/workflows/terraform-live-all.yml/dispatches",
        )
        self.assertEqual(json.loads(request.data), EVENT)
        self.assertEqual(request.get_header("Authorization"), "Bearer test-pat")
        # SCH-01: never wait on GitHub without a limit.
        self.assertEqual(urlopen.call_args.kwargs["timeout"], dispatcher.GITHUB_TIMEOUT_SECONDS)
        self.assertLess(dispatcher.GITHUB_TIMEOUT_SECONDS, 30)  # the function's own timeout

    def test_a_github_error_fails_the_invocation(self):
        error = urllib.error.HTTPError("u", 422, "Unprocessable", {}, io.BytesIO(b'{"message":"bad"}'))
        with mock.patch.object(dispatcher.urllib.request, "urlopen", side_effect=error):
            with self.assertRaises(urllib.error.HTTPError):
                dispatcher.lambda_handler(EVENT, None)

    def test_a_timeout_fails_the_invocation(self):
        with mock.patch.object(dispatcher.urllib.request, "urlopen", side_effect=TimeoutError("timed out")):
            with self.assertRaises(TimeoutError):
                dispatcher.lambda_handler(EVENT, None)


if __name__ == "__main__":
    unittest.main()
