#!/usr/bin/env python3
"""Account deletion end to end on the local stack (build plan 6.1, design 10.3).

Run with the backend venv against the compose `split` stack:

    backend/.venv/bin/python scripts/e2e/account-deletion.py

It walks one child through every circle (journey.py), so every participant holds data,
copies and outbox rows for the account, plus an avatar and a 90-day-plan photo in S3. Then
it deletes the account (`DELETE /api/v1/auth/account`), waits for auth to finish the saga,
and checks that nothing of the user or the child is left in any split service's database,
in Valkey or in the uploads bucket.

What may stay, by design (stack.scan): `tombstones`; the ids-only `user.data_deleted` and
`user.deletion_requested` outbox rows (gone 7 days after publishing); cancelled or finished
`jobs` (ids only, gone 7 days after they end); auth's `audit` (the agreed retention); and
Valkey's rate-limit and LLM-hour counters (ids only, expiring within the hour). Those are
listed, not failed. Exit code 0 when clean.
"""

from __future__ import annotations

import sys
import time

from journey import walk
from stack import API, WalkFailed, auth_gone, check, poll, report, scan, step


def main() -> int:
    try:
        j = walk(sys.argv[1] if len(sys.argv) > 1 else None)
        before, _ = scan([j.user_id, j.child_id], [j.email])
        print(
            f"\n   before deletion: {len(before)} rows and objects hold the account's data"
        )
        if not any(item.startswith("s3 ") for item in before):
            raise WalkFailed(
                "the photos never reached S3, so the S3 check would prove nothing"
            )

        step("delete the account")
        started = time.monotonic()
        body = {"confirm_email": j.email}
        check(j.http.request("DELETE", f"{API}/auth/account", json=body), 202)
        poll(
            lambda: auth_gone(j.user_id),
            bool,
            "every service confirmed; auth finished",
            180,
        )
        print(f"   took {time.monotonic() - started:.1f}s")
    except WalkFailed as exc:
        print(f"!! {exc}")
        return 1

    step("scan every database, Valkey and the uploads bucket")
    if not report(*scan([j.user_id, j.child_id], [j.email])):
        return 1
    print("\nACCOUNT DELETION PASSED: nothing of the account is left")
    return 0


if __name__ == "__main__":
    sys.exit(main())
