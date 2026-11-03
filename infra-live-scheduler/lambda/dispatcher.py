import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

import boto3

# Seconds to wait for GitHub, well inside the function's 30 s. A dispatch that hangs fails
# once and is not retried (the function's async retries are off, lambda.tf), so a slow
# GitHub can't start the same apply or destroy twice (production-readiness review, SCH-01).
GITHUB_TIMEOUT_SECONDS = 10

# Before dispatching, a run of the workflow with this dispatch's title started this
# recently means it was already dispatched (a schedule delivered twice): skip it (SCH-01,
# fix 3). RUN_TITLE is terraform-live-all.yml's run-name, filled from the inputs; the
# tests check the two match.
DUPLICATE_WINDOW_MINUTES = 60
RUN_TITLE = "Full Stack ({action}, {environment}, {backend_regions})"


def _github(url, pat, data=None):
    return urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization":        f"Bearer {pat}",
            "Accept":               "application/vnd.github+json",
            "Content-Type":         "application/json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
        method="POST" if data is not None else "GET",
    )


def already_dispatched(workflow_url, pat, event, now):
    """True when a run with this dispatch's title started within the window. If the runs
    can't be listed, False: a missed start or stop is worse than a duplicate, which the
    workflow's own concurrency group runs one after the other anyway."""
    try:
        title = RUN_TITLE.format(**event.get("inputs", {}))
    except KeyError:
        return False
    since = (now - timedelta(minutes=DUPLICATE_WINDOW_MINUTES)).strftime("%Y-%m-%dT%H:%M:%SZ")
    query = urllib.parse.urlencode(
        {"event": "workflow_dispatch", "created": f">={since}", "per_page": 50}
    )
    try:
        with urllib.request.urlopen(
            _github(f"{workflow_url}/runs?{query}", pat), timeout=GITHUB_TIMEOUT_SECONDS
        ) as resp:
            runs = json.loads(resp.read()).get("workflow_runs", [])
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        print(f"Couldn't list recent runs ({type(exc).__name__}); dispatching anyway")
        return False
    return any(run.get("display_title") == title for run in runs)


def lambda_handler(event, context):
    secret_arn   = os.environ["GITHUB_PAT_SECRET_ARN"]
    repo_owner   = os.environ["GITHUB_REPO_OWNER"]
    repo_name    = os.environ["GITHUB_REPO_NAME"]
    workflow     = os.environ["GITHUB_WORKFLOW_FILE"]

    pat = boto3.client("secretsmanager").get_secret_value(
        SecretId=secret_arn
    )["SecretString"]

    workflow_url = (
        f"https://api.github.com/repos/{repo_owner}/{repo_name}/actions/workflows/{workflow}"
    )
    if already_dispatched(workflow_url, pat, event, datetime.now(timezone.utc)):
        print(f"Already dispatched within {DUPLICATE_WINDOW_MINUTES} minutes; skipping")
        return {"statusCode": 200, "skipped": True}

    req = _github(f"{workflow_url}/dispatches", pat, data=json.dumps(event).encode())

    try:
        with urllib.request.urlopen(req, timeout=GITHUB_TIMEOUT_SECONDS) as resp:
            print(f"GitHub API responded with HTTP {resp.status}")
            return {"statusCode": resp.status}
    except urllib.error.HTTPError as exc:
        print(f"GitHub API error {exc.code}: {exc.read().decode()}")
        raise
