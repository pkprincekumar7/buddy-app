"""What the e2e scripts share: the local stack's addresses, HTTP checks, the compose
containers, and the scan for anything left of an account or a child.

The stack is the compose `split` profile with Moto on the host (docs/getting-started.md).
"""

from __future__ import annotations

import json
import os
import subprocess
import time
import uuid
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any

import boto3
import httpx
import pymongo
import redis

ROOT = Path(__file__).resolve().parents[2]
GATEWAY = os.environ.get("LOCAL_GATEWAY_URL", "http://localhost:8088")
API = f"{GATEWAY}/api/v1"
MOTO_URL = os.environ.get("LOCAL_MOTO_URL", "http://localhost:5050")
MONGO_URI = os.environ.get(
    "LOCAL_MONGO_URI", "mongodb://localhost:27017/?directConnection=true"
)
VALKEY_URL = os.environ.get("LOCAL_VALKEY_URL", "redis://localhost:6379")
UPLOADS_BUCKET = os.environ.get(
    "UPLOADS_BUCKET_NAME", "person-local-uploads-bucket-ap-south-1"
)
REGION = "ap-south-1"
# Every split service with a database; connect joins when it exists.
DATABASES = (
    "auth",
    "users",
    "children",
    "onboarding",
    "discover",
    "grow",
    "transform",
    "release",
)
PARTICIPANT_WORKERS = tuple(
    f"{name}-worker" for name in DATABASES if name != "auth"
)  # users … release


class WalkFailed(Exception):
    pass


def step(name: str) -> None:
    print(f"\n== {name}", flush=True)


def check(response: httpx.Response, *ok: int) -> Any:
    line = f"{response.request.method} {response.request.url.path} -> {response.status_code}"
    if response.status_code not in ok:
        raise WalkFailed(f"{line}\n{response.text[:1500]}")
    print(f"   {line}")
    return response.json() if response.content else {}


def poll(
    read: Callable[[], Any],
    done: Callable[[Any], bool],
    what: str,
    timeout: float = 240,
) -> Any:
    deadline = time.monotonic() + timeout
    while True:
        body = read()
        if done(body):
            print(f"   {what}: done")
            return body
        if time.monotonic() > deadline:
            raise WalkFailed(f"{what}: timed out; last: {str(body)[:1500]}")
        time.sleep(2)


# ── the compose stack ──────────────────────────────────────────────────────────


def compose(*args: str) -> str:
    result = subprocess.run(
        ["docker", "compose", "--profile", "split", *args],
        cwd=ROOT, capture_output=True, text=True, check=False,
    )  # fmt: skip
    if result.returncode != 0:
        raise WalkFailed(
            f"docker compose {' '.join(args)}: {result.stderr.strip()[-500:]}"
        )
    return result.stdout


def seed_email() -> str:
    """A new allow-listed test address (auth.seed in the running auth container)."""
    email = f"e2e-{uuid.uuid4().hex[:12]}@example.com"
    compose(
        "exec",
        "-T",
        "-e",
        f"LOCAL_ALLOWED_EMAIL={email}",
        "auth",
        "python",
        "-m",
        "auth.seed",
    )
    return email


def mongo() -> pymongo.MongoClient[dict[str, Any]]:
    return pymongo.MongoClient(MONGO_URI, tz_aware=True)


def auth_gone(user_id: str) -> bool:
    with mongo() as client:
        auth = client["auth"]
        return auth["auth"].find_one({"_id": user_id}) is None and (
            auth["deletions"].find_one({"_id": user_id}) is None
        )


# ── what's left ────────────────────────────────────────────────────────────────

# Ids-only rows that outlive a deletion by design: the confirmations and requests (gone 7
# days after publishing), and the purge's announcement.
ID_ONLY_EVENTS = {"user.data_deleted", "user.deletion_requested", "child.deleted"}


def _allowed(db: str, collection: str, doc: dict[str, Any]) -> bool:
    if collection in ("tombstones", "jobs"):  # deletion markers; ids-only, 7-day TTL
        return True
    if collection == "outbox":
        return doc.get("event_type") in ID_ONLY_EVENTS
    return db == "auth" and collection == "audit"  # the agreed retention


def scan(
    ids: Iterable[str], needles: Iterable[str] = ()
) -> tuple[list[str], list[str]]:
    """Every row, Valkey key and upload that mentions one of `ids` (or `needles`, such as
    an email): (left behind, allowed by design)."""
    ids, needles = list(ids), [*ids, *needles]
    left, allowed = [], []
    with mongo() as client:
        for name in DATABASES:
            db = client[name]
            for collection in db.list_collection_names():
                for doc in db[collection].find({}):
                    text = json.dumps(doc, default=str)
                    if any(needle in text for needle in needles):
                        where = f"{name}.{collection} {doc['_id']}"
                        (allowed if _allowed(name, collection, doc) else left).append(
                            where
                        )
    cache = redis.Redis.from_url(VALKEY_URL)
    for key in cache.scan_iter(count=1000):
        text = key.decode(errors="replace")
        if not any(i in text for i in ids):
            continue
        # Rate-limit and LLM-hour counters: ids only, and they expire within the hour.
        ttl = cache.ttl(key)
        counter = text.startswith(("LIMITS:", "llm:hourly:")) and 0 < ttl <= 3600
        (allowed if counter else left).append(f"valkey {text}")
    for key in uploads():
        if any(i in key for i in ids):
            left.append(f"s3 {key}")
    return left, allowed


def uploads() -> list[str]:
    s3 = boto3.client(
        "s3", endpoint_url=MOTO_URL, region_name=REGION,
        aws_access_key_id="local", aws_secret_access_key="local",
    )  # fmt: skip
    keys = []
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=UPLOADS_BUCKET):
        keys.extend(item["Key"] for item in page.get("Contents", []))
    return keys


def report(left: list[str], allowed: list[str]) -> bool:
    kinds: dict[str, int] = {}
    for item in allowed:
        kind = "valkey counters" if item.startswith("valkey") else item.split(" ")[0]
        kinds[kind] = kinds.get(kind, 0) + 1
    print(f"   allowed by design: {kinds}")
    for item in left:
        print(f"!! left behind: {item}")
    return not left
