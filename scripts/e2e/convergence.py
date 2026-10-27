#!/usr/bin/env python3
"""Failure and convergence on the local stack (build plan 6.2, design 4.1, 10.2, 10.3).

Run with the backend venv against the compose `split` stack (it stops and starts workers):

    backend/.venv/bin/python scripts/e2e/convergence.py

Three scenarios, each on a new account (allow-listed here), each ending with stack.scan:

1. **Services killed mid-deletion.** Every participant's worker is killed (SIGKILL), then
   the account is deleted: the request waits in their queues. auth-worker is killed once
   it has relayed the request; the participants come back and delete and confirm; auth
   still holds the account (nobody counts the confirmations); auth-worker comes back and
   finishes. Nothing is left.
2. **A late event and a finishing job.** A growth area's questions are generating when the
   account is deleted; the job's result arrives after the deletion. Then a `child.changed`
   for the child, with a higher version than any before, arrives late, and every circle's
   queue drains with nothing dead-lettered. Neither stores anything: the tombstones stop
   both.
3. **A child deleted and purged.** A child walked through every circle is deleted: children
   hides it at once and each circle within moments. Its `deleted_at` is moved 31 days back
   and children-worker restarted (the purge runs at start): the child and every circle's
   data, copies, photos and outbox rows about it go.

The generations use the LLM keys in .env: a few provider calls per scenario. Exit code 0
when all three pass. Workers are started again even when a scenario fails.
"""

from __future__ import annotations

import sys
import time
from datetime import UTC, datetime, timedelta
from typing import Any

import boto3
import journey
from stack import (
    API,
    MOTO_URL,
    PARTICIPANT_WORKERS,
    REGION,
    ROOT,
    WalkFailed,
    auth_gone,
    check,
    compose,
    mongo,
    poll,
    report,
    scan,
    step,
)

sys.path.insert(0, str(ROOT / "backend"))
from common.events import Event  # noqa: E402

ACCOUNT = "123456789012"  # Moto's
EVENTS_PREFIX = "superpower-local"


def _delete_account(j: journey.Journey) -> None:
    check(
        j.http.request(
            "DELETE", f"{API}/auth/account", json={"confirm_email": j.email}
        ),
        202,
    )


def _deletion(user_id: str) -> dict[str, Any] | None:
    with mongo() as client:
        return client["auth"]["deletions"].find_one({"_id": user_id})


def _auth_outbox_published(user_id: str) -> bool:
    with mongo() as client:
        row = client["auth"]["outbox"].find_one(
            {"aggregate_id": user_id, "event_type": "user.deletion_requested"}
        )
    return row is not None and row.get("published_at") is not None


def _confirmed_by_all(user_id: str) -> bool:
    """Every participant's user.data_deleted row is published (it's in auth's queue)."""
    with mongo() as client:
        for worker in PARTICIPANT_WORKERS:
            row = client[worker.removesuffix("-worker")]["outbox"].find_one(
                {"aggregate_id": user_id, "event_type": "user.data_deleted"}
            )
            if row is None or row.get("published_at") is None:
                return False
    return True


# ── 1. services killed mid-deletion ────────────────────────────────────────────


def killed_mid_deletion() -> bool:
    step("1. services killed mid-deletion")
    j = journey.start()
    journey.onboarding(j)  # discover's worker starts generating; it's killed below
    time.sleep(2)
    try:
        compose("kill", *PARTICIPANT_WORKERS)
        _delete_account(j)
        poll(
            lambda: _auth_outbox_published(j.user_id),
            bool,
            "auth relayed the request",
            60,
        )
        time.sleep(3)
        deletion = _deletion(j.user_id)
        if deletion is None or deletion.get("confirmed"):
            raise WalkFailed(f"confirmed with every participant down: {deletion}")
        with mongo() as client:
            if client["children"]["children"].find_one({"_id": j.child_id}) is None:
                raise WalkFailed("children deleted while its worker was down")
        print("   participants down: the request waits in their queues")
        compose("kill", "auth-worker")
        compose("start", *PARTICIPANT_WORKERS)
        poll(
            lambda: _confirmed_by_all(j.user_id),
            bool,
            "every participant deleted and confirmed",
        )
        if auth_gone(j.user_id):
            raise WalkFailed("auth finished with auth-worker down")
        print("   auth-worker down: the account waits for it")
        compose("start", "auth-worker")
        poll(lambda: auth_gone(j.user_id), bool, "auth-worker back: auth finished", 120)
    finally:
        compose("start", *PARTICIPANT_WORKERS, "auth-worker")
    return report(*scan([j.user_id, j.child_id], [j.email]))


# ── 2. a late event and a finishing job ────────────────────────────────────────


def _late_child_changed(j: journey.Journey) -> None:
    """A snapshot children could have sent before the deletion, delivered only now."""
    event = Event.new(
        "child.changed",
        producer="children",
        aggregate_id=j.child_id,
        location=j.location,
        version=1000,
        region=REGION,
        payload={
            "user_id": j.user_id, "name": journey.CHILD_NAME, "age": 8, "gender": "boy",
            "is_deleted": False,
            "progress": dict.fromkeys(
                ("profile", "conversation", "discover", "grow", "transform", "release", "connect"),
                True,
            ),
        },
    )  # fmt: skip
    sns = boto3.client(
        "sns", endpoint_url=MOTO_URL, region_name=REGION,
        aws_access_key_id="local", aws_secret_access_key="local",
    )  # fmt: skip
    sns.publish(
        TopicArn=f"arn:aws:sns:{REGION}:{ACCOUNT}:{EVENTS_PREFIX}-children-events",
        Message=event.to_message(),
        MessageAttributes=event.message_attributes(),
    )


CIRCLES = ("onboarding", "discover", "grow", "transform", "release")


def _queues_drained() -> bool:
    """Every circle's queue is empty, nothing in flight, and nothing dead-lettered."""
    sqs = boto3.client(
        "sqs", endpoint_url=MOTO_URL, region_name=REGION,
        aws_access_key_id="local", aws_secret_access_key="local",
    )  # fmt: skip
    names = ("ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible")
    for circle in CIRCLES:
        for suffix in ("", "-dlq"):
            url = f"{MOTO_URL}/{ACCOUNT}/{EVENTS_PREFIX}-{circle}-events{suffix}"
            got = sqs.get_queue_attributes(QueueUrl=url, AttributeNames=list(names))
            if any(int(got["Attributes"][name]) for name in names):
                return False
    return True


def _job_ended(job_id: str) -> bool:
    with mongo() as client:
        job = client["grow"]["jobs"].find_one({"_id": job_id})
    return job is not None and job["status"] in ("completed", "failed")


def late_event_and_job() -> bool:
    step("2. a late event and a finishing job")
    j = journey.start()
    journey.onboarding(j)
    journey.discover(j)
    job_id = journey.start_grow(j)  # the LLM call takes a few seconds
    _delete_account(j)
    poll(lambda: auth_gone(j.user_id), bool, "auth finished while the job ran", 120)
    poll(lambda: _job_ended(job_id), bool, "the job ended after the deletion", 180)
    _late_child_changed(j)
    poll(_queues_drained, bool, "the late event consumed by every circle", 60)
    with mongo() as client:
        job = client["grow"]["jobs"].find_one({"_id": job_id})
    print(f"   job: {job['status']} ({job.get('error')})")
    # The deletion caught it running: cancelled, and its late result dropped.
    if (job["status"], job.get("error")) != ("failed", "cancelled"):
        raise WalkFailed(f"the deletion didn't cancel the job: {job['status']}")
    return report(*scan([j.user_id, j.child_id], [j.email]))


# ── 3. a child deleted and purged ──────────────────────────────────────────────

CIRCLE_PATHS = (
    "onboarding",
    "personality",
    "growth-areas",
    "transform",
    "observations",
)


def _circles_hide(j: journey.Journey) -> bool:
    return all(
        j.http.get(f"{j.child}/{path}").status_code == 404 for path in CIRCLE_PATHS
    )


def _purged_everywhere(child_id: str) -> bool:
    with mongo() as client:
        if client["children"]["children"].find_one({"_id": child_id}) is not None:
            return False
        stone = f"child:{child_id}"
        circles = ("onboarding", "discover", "grow", "transform", "release")
        return all(
            client[name]["tombstones"].find_one({"_id": stone}) for name in circles
        )


def child_purge() -> bool:
    step("3. a child deleted and purged")
    j = journey.walk()
    check(j.http.delete(j.child), 204)
    check(j.http.get(j.child), 404)  # at once
    poll(lambda: _circles_hide(j), bool, "every circle hides it", 30)
    with mongo() as client:
        client["children"]["children"].update_one(
            {"_id": j.child_id},
            {"$set": {"deleted_at": datetime.now(UTC) - timedelta(days=31)}},
        )
    compose("restart", "children-worker")
    poll(
        lambda: _purged_everywhere(j.child_id),
        bool,
        "purged, and every circle dropped it",
        120,
    )
    ok = report(*scan([j.child_id]))
    _delete_account(j)  # tidy: the account itself
    poll(lambda: auth_gone(j.user_id), bool, "the account deleted too", 120)
    return ok


def main() -> int:
    results: dict[str, bool] = {}
    for scenario in (killed_mid_deletion, late_event_and_job, child_purge):
        try:
            results[scenario.__name__] = scenario()
        except WalkFailed as exc:
            print(f"!! {exc}")
            results[scenario.__name__] = False
    print()
    for name, ok in results.items():
        print(f"{'PASS' if ok else 'FAIL'}  {name}")
    if all(results.values()):
        print("\nCONVERGENCE PASSED")
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
