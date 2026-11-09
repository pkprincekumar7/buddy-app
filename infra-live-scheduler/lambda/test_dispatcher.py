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

# What lambda.tf sets on the stg function.
ENV = {
    "GITHUB_PAT_SECRET_ARN": "arn:aws:secretsmanager:ap-south-1:1:secret:pat",
    "GITHUB_REPO_OWNER": "owner",
    "GITHUB_REPO_NAME": "repo",
    "GITHUB_WORKFLOW_FILE": "terraform-live-all.yml",
    "DISPATCH_REF": "main",
    "DISPATCH_ENVIRONMENT": "stg",
    "DISPATCH_BACKEND_REGIONS": '["ap-south-1"]',
}
# What scheduler.tf's schedules send.
START = {"action": "apply"}
STOP = {"action": "destroy"}
START_DISPATCH = {
    "ref": "main",
    "inputs": {
        "action": "apply",
        "environment": "stg",
        "backend_regions": '["ap-south-1"]',
        "deploy": "true",
    },
}
TITLE = 'Full Stack (apply, stg, ["ap-south-1"])'


class _Response(io.BytesIO):
    status = 204

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _runs(*titles):
    return _Response(json.dumps({"workflow_runs": [{"display_title": t} for t in titles]}).encode())


def _no_runs_then_dispatched():
    return [_runs(), _Response()]


@mock.patch.dict(os.environ, ENV)
class DispatcherTest(unittest.TestCase):
    def test_the_start_dispatch_is_built_from_the_stack_not_the_event(self):
        with mock.patch.object(dispatcher.urllib.request, "urlopen", side_effect=_no_runs_then_dispatched()) as urlopen:
            self.assertEqual(dispatcher.lambda_handler(START, None), {"statusCode": 204})
        request = urlopen.call_args.args[0]
        self.assertEqual(
            request.full_url,
            "https://api.github.com/repos/owner/repo/actions/workflows/terraform-live-all.yml/dispatches",
        )
        self.assertEqual(json.loads(request.data), START_DISPATCH)
        self.assertEqual(request.get_header("Authorization"), "Bearer test-pat")
        # SCH-01: never wait on GitHub without a limit.
        self.assertEqual(urlopen.call_args.kwargs["timeout"], dispatcher.GITHUB_TIMEOUT_SECONDS)
        self.assertLess(dispatcher.GITHUB_TIMEOUT_SECONDS, 30)  # the function's own timeout

    def test_the_stop_dispatch_destroys_without_deploying(self):
        with mock.patch.object(dispatcher.urllib.request, "urlopen", side_effect=_no_runs_then_dispatched()) as urlopen:
            dispatcher.lambda_handler(STOP, None)
        inputs = json.loads(urlopen.call_args.args[0].data)["inputs"]
        self.assertEqual((inputs["action"], inputs["environment"], inputs["deploy"]), ("destroy", "stg", "false"))

    def test_a_github_error_fails_the_invocation(self):
        error = urllib.error.HTTPError("u", 422, "Unprocessable", {}, io.BytesIO(b'{"message":"bad"}'))
        with mock.patch.object(dispatcher.urllib.request, "urlopen", side_effect=[_runs(), error]):
            with self.assertRaises(urllib.error.HTTPError):
                dispatcher.lambda_handler(START, None)

    def test_a_timeout_fails_the_invocation(self):
        with mock.patch.object(dispatcher.urllib.request, "urlopen", side_effect=[_runs(), TimeoutError("timed out")]):
            with self.assertRaises(TimeoutError):
                dispatcher.lambda_handler(START, None)


@mock.patch.dict(os.environ, ENV)
class RefusedEventTest(unittest.TestCase):
    """SEC-03 fix 2: an invoke chooses the action only, and prod is never dispatched."""

    def _assert_refused(self, event):
        with mock.patch.object(dispatcher.urllib.request, "urlopen") as urlopen, mock.patch.object(
            dispatcher.boto3, "client"
        ) as client:
            with self.assertRaises(dispatcher.RefusedEvent):
                dispatcher.lambda_handler(event, None)
        urlopen.assert_not_called()  # nothing reaches GitHub
        client.assert_not_called()  # the token isn't even read

    def test_a_forged_prod_destroy_is_refused(self):
        self._assert_refused({"inputs": {"environment": "prod", "action": "destroy"}})

    def test_an_event_naming_its_own_environment_or_ref_is_refused(self):
        self._assert_refused({"action": "destroy", "environment": "prod"})
        self._assert_refused({"action": "apply", "ref": "attacker-branch"})

    def test_an_unknown_action_is_refused(self):
        for event in ({"action": "plan-destroy"}, {"action": "APPLY"}, {"action": None}, {}, [], "apply", None):
            with self.subTest(event=event):
                self._assert_refused(event)

    def test_a_function_configured_for_prod_refuses_even_a_valid_event(self):
        with mock.patch.dict(os.environ, {"DISPATCH_ENVIRONMENT": "prod"}):
            self._assert_refused(START)


@mock.patch.dict(os.environ, ENV)
class DuplicateTest(unittest.TestCase):
    """SCH-01 fix 3: a schedule delivered twice dispatches once."""

    def test_the_title_is_terraform_live_alls_run_name(self):
        workflow = Path(__file__).resolve().parents[2] / ".github/workflows/terraform-live-all.yml"
        run_name = next(
            line.split(":", 1)[1].strip().strip('"')
            for line in workflow.read_text().splitlines()
            if line.startswith("run-name:")
        )
        self.assertEqual(
            run_name.replace("${{ inputs.", "{").replace(" }}", "}"), dispatcher.RUN_TITLE
        )
        self.assertEqual(dispatcher.RUN_TITLE.format(**START_DISPATCH["inputs"]), TITLE)

    def test_a_run_with_the_same_title_in_the_window_skips_the_dispatch(self):
        with mock.patch.object(dispatcher.urllib.request, "urlopen", return_value=_runs(TITLE)) as urlopen:
            self.assertEqual(dispatcher.lambda_handler(START, None), {"statusCode": 200, "skipped": True})
        self.assertEqual(urlopen.call_count, 1)  # the list only
        listed = urlopen.call_args.args[0]
        self.assertEqual(listed.get_method(), "GET")
        self.assertIn("/actions/workflows/terraform-live-all.yml/runs?", listed.full_url)
        self.assertIn("event=workflow_dispatch", listed.full_url)
        self.assertIn("created=%3E%3D", listed.full_url)  # created>=<an hour ago>
        self.assertEqual(urlopen.call_args.kwargs["timeout"], dispatcher.GITHUB_TIMEOUT_SECONDS)

    def test_other_runs_dont_count(self):
        responses = [_runs('Full Stack (destroy, stg, ["ap-south-1"])', "Full Stack (apply, dev, x)"), _Response()]
        with mock.patch.object(dispatcher.urllib.request, "urlopen", side_effect=responses) as urlopen:
            self.assertEqual(dispatcher.lambda_handler(START, None), {"statusCode": 204})
        self.assertEqual(urlopen.call_args.args[0].get_method(), "POST")

    def test_runs_that_cant_be_listed_dont_stop_the_dispatch(self):
        responses = [urllib.error.URLError("down"), _Response()]
        with mock.patch.object(dispatcher.urllib.request, "urlopen", side_effect=responses):
            self.assertEqual(dispatcher.lambda_handler(START, None), {"statusCode": 204})


if __name__ == "__main__":
    unittest.main()
