import json
import os
import urllib.error
import urllib.request

import boto3

# Seconds to wait for GitHub, well inside the function's 30 s. A dispatch that hangs fails
# once and is not retried (the function's async retries are off, lambda.tf), so a slow
# GitHub can't start the same apply or destroy twice (production-readiness review, SCH-01).
GITHUB_TIMEOUT_SECONDS = 10


def lambda_handler(event, context):
    secret_arn   = os.environ["GITHUB_PAT_SECRET_ARN"]
    repo_owner   = os.environ["GITHUB_REPO_OWNER"]
    repo_name    = os.environ["GITHUB_REPO_NAME"]
    workflow     = os.environ["GITHUB_WORKFLOW_FILE"]

    pat = boto3.client("secretsmanager").get_secret_value(
        SecretId=secret_arn
    )["SecretString"]

    url = (
        f"https://api.github.com/repos/{repo_owner}/{repo_name}"
        f"/actions/workflows/{workflow}/dispatches"
    )

    req = urllib.request.Request(
        url,
        data=json.dumps(event).encode(),
        headers={
            "Authorization":        f"Bearer {pat}",
            "Accept":               "application/vnd.github+json",
            "Content-Type":         "application/json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=GITHUB_TIMEOUT_SECONDS) as resp:
            print(f"GitHub API responded with HTTP {resp.status}")
            return {"statusCode": resp.status}
    except urllib.error.HTTPError as exc:
        print(f"GitHub API error {exc.code}: {exc.read().decode()}")
        raise
