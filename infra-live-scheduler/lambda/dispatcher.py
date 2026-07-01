import json
import os
import urllib.error
import urllib.request

import boto3


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
        with urllib.request.urlopen(req) as resp:
            print(f"GitHub API responded with HTTP {resp.status}")
            return {"statusCode": resp.status}
    except urllib.error.HTTPError as exc:
        print(f"GitHub API error {exc.code}: {exc.read().decode()}")
        raise
