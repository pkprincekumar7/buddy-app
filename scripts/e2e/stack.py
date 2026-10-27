"""What the e2e scripts share: the local stack's addresses, HTTP checks, the compose
containers, and the scan for anything left of an account or a child.

The stack is the compose `split` profile with Moto on the host (docs/getting-started.md).
"""

from __future__ import annotations

import json
import os
import secrets
import subprocess
import time
import uuid
from datetime import UTC, datetime
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


def _redacted(response: httpx.Response) -> str:
    """The body for an error message, without what was sent: a 422 echoes each refused
    field's `input`, which for a registration is the password."""
    try:
        body = response.json()
    except ValueError:
        return response.text[:1500]
    detail = body.get("detail") if isinstance(body, dict) else None
    if isinstance(detail, list):
        for item in detail:
            if isinstance(item, dict) and "input" in item:
                item["input"] = "(redacted)"
    return json.dumps(body)[:1500]


def check(response: httpx.Response, *ok: int) -> Any:
    line = f"{response.request.method} {response.request.url.path} -> {response.status_code}"
    if response.status_code not in ok:
        raise WalkFailed(f"{line}\n{_redacted(response)}")
    print(f"   {line}")
    return response.json() if response.content else {}


def new_password() -> str:
    """A throwaway password that always meets the rules (a letter and a digit, 8+)."""
    return f"{secrets.token_urlsafe(18)}a7"


def register(
    client: httpx.Client | None, email: str, password: str, first_name: str
) -> dict[str, Any]:
    """POST /auth/register, waiting out the 5-a-minute limit per address when the e2e runs
    have used it up (they run back to back in check.sh)."""
    body = {
        "email": email,
        "password": password,
        "first_name": first_name,
        "country_code": "IN",
    }
    post = client.post if client is not None else httpx.post
    for _ in range(4):
        response = post(f"{API}/auth/register", json=body)
        if response.status_code != 429:
            break
        wait = int(response.headers.get("retry-after", "60"))
        print(f"   registration limit reached: waiting {wait}s")
        time.sleep(min(wait, 65))
    return check(response, 201)  # type: ignore[no-any-return]


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


def tombstoned_everywhere(key: str, databases: Iterable[str]) -> list[str]:
    """The databases in `databases` with no `key` tombstone (empty when every one has it)."""
    with mongo() as client:
        return [
            name
            for name in databases
            if not client[name]["tombstones"].find_one({"_id": key})
        ]


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
    if collection in (
        "tombstones",
        "guards",
    ):  # deletion markers and their write guards
        return True
    if collection == "jobs":  # ids only, gone 7 days after they end: ended ones only
        return doc.get("status") in ("completed", "failed")
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


# ── a local admin for the admin scenarios ──────────────────────────────────────


def local_admin(user_id: str, location: str, *, admin: bool) -> None:
    """Make (or unmake) `user_id` an admin in the local auth database, as
    `auth.promote_admin` does: the role through a new authz_version, the account's tokens
    revoked and sessions ended, and the admin counter moved. That command works once per
    environment; this keeps the e2e runs repeatable, and every run undoes its own admin.
    Local stack only: it writes straight to the local Mongo."""
    now = datetime.now(UTC)
    with mongo() as client:
        auth = client["auth"]
        changed = auth["auth"].update_one(
            {
                "_id": user_id,
                "location": location,
                "role": "parent" if admin else "admin",
            },
            {
                "$set": {
                    "role": "admin" if admin else "parent",
                    "tokens_revoked_at": now,
                    "updated_at": now,
                },
                "$inc": {"authz_version": 1},
            },
        )
        if changed.modified_count != 1:
            raise WalkFailed(f"couldn't {'promote' if admin else 'demote'} {user_id}")
        auth["sessions"].delete_many({"location": location, "user_id": user_id})
        auth["admin_count"].update_one(
            {"_id": "admins"}, {"$inc": {"active": 1 if admin else -1}}, upsert=True
        )
