"""Make an environment's first admin (docs/auth-users-split.md, 11.4; build plan 3.6).

    python -m auth.promote_admin --user-id <uuid>
    echo jane@example.com | python -m auth.promote_admin --email-stdin     (local)

Runs once per environment, in the auth image (a one-off ECS task with this command, since
ECS Exec is off in prod), with auth's own MONGODB_URI, MONGODB_DB_NAME and
EMAIL_HMAC_PEPPER. Later admins are promoted by an admin, with `PATCH
/api/v1/auth/accounts/{id}/role` (3.4).

- **Once:** it refuses if an admin exists. The admin counter is the gate: the run claims it
  from 0 to 1 (an insert, or a conditional update), so two runs at once can't both promote.
- **The account** must exist, be a parent, and be neither locked nor being deleted. It's
  given by user id, so no email is in a command line, task override or CloudTrail;
  locally the email can come on standard input instead.
- **The change** goes through `authz_change` (a new authz_version), revokes the account's
  tokens and ends its sessions, so the next sign-in carries the admin role. Each region's
  auth-worker updates its cached entry from the change stream.
- **Audited:** an `audit` row (actor `promote-admin`) and the `audit.role_changed` log line
  the role-change alarm watches (11.3).
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
import uuid
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from typing import IO, Any

from dotenv import dotenv_values
from pymongo import AsyncMongoClient, ReturnDocument
from pymongo.errors import DuplicateKeyError

from auth.app.store import (
    ADMIN_COUNT,
    AUDIT,
    AUTH,
    EMAIL_INDEX,
    SESSIONS,
    authz_change,
    ensure_collections,
)
from auth.emails import Peppers, normalise
from common.events.store import Db

ACTOR = "promote-admin"
ADMINS = "admins"

_logger = logging.getLogger("auth.promote_admin")


class Refused(Exception):
    """Why the run did nothing; printed, exit status 1."""


def settings_from(environ: Mapping[str, str]) -> dict[str, str]:
    merged = {**{k: v for k, v in dotenv_values(".env").items() if v is not None}, **environ}
    names = ("MONGODB_URI", "MONGODB_DB_NAME", "EMAIL_HMAC_PEPPER")
    missing = [name for name in names if not merged.get(name)]
    if missing:
        raise Refused(f"set {', '.join(missing)} (auth's own, in .env or the environment)")
    return {name: merged[name] for name in names}


async def _find(db: Db, peppers: Peppers, user_id: str | None, email: str | None) -> dict[str, Any]:
    if user_id is not None:
        account = await db[AUTH].find_one({"_id": user_id})
    else:
        account = None
        for _, key in peppers.keys(normalise(email or "")):
            row = await db[EMAIL_INDEX].find_one({"_id": key, "status": "active"})
            if row is not None:
                account = await db[AUTH].find_one(
                    {"_id": row["user_id"], "location": row["location"]}
                )
                break
    if account is None:
        raise Refused("no such account (it must sign up first)")
    if account.get("is_locked") or account.get("is_being_deleted"):
        raise Refused("that account is locked or being deleted")
    if account["role"] != "parent":
        raise Refused("that account is already an admin")
    return account


async def _claim_first_admin(db: Db) -> None:
    """0 → 1 on the admin counter, atomically; Refused if an admin already exists."""
    if await db[AUTH].find_one({"role": "admin"}, {"_id": 1}) is not None:
        raise Refused("an admin already exists: promote others from the admin screen")
    try:
        await db[ADMIN_COUNT].insert_one({"_id": ADMINS, "active": 1})
        return
    except DuplicateKeyError:
        pass
    claimed = await db[ADMIN_COUNT].update_one(
        {"_id": ADMINS, "active": {"$lt": 1}}, {"$set": {"active": 1}}
    )
    if claimed.modified_count != 1:
        raise Refused("an admin already exists: promote others from the admin screen")


async def promote(
    settings: Mapping[str, str], *, user_id: str | None, email: str | None
) -> dict[str, Any]:
    """Promote the account; returns it as updated, or raises Refused."""
    client: AsyncMongoClient[dict[str, Any]] = AsyncMongoClient(
        settings["MONGODB_URI"], tz_aware=True
    )
    try:
        db = client[settings["MONGODB_DB_NAME"]]
        await ensure_collections(db)
        account = await _find(db, Peppers.parse(settings["EMAIL_HMAC_PEPPER"]), user_id, email)
        await _claim_first_admin(db)
        now = datetime.now(UTC)
        updated = await db[AUTH].find_one_and_update(
            {"_id": account["_id"], "location": account["location"], "role": "parent",
             "is_locked": {"$ne": True}, "is_being_deleted": {"$ne": True}},
            authz_change({"role": "admin", "tokens_revoked_at": now}, now),
            return_document=ReturnDocument.AFTER,
        )  # fmt: skip
        if updated is None:
            # Changed since it was read: give the counter back.
            await db[ADMIN_COUNT].update_one({"_id": ADMINS}, {"$set": {"active": 0}})
            raise Refused("the account changed meanwhile; run again")
        await db[SESSIONS].delete_many({"location": account["location"], "user_id": account["_id"]})
        await db[AUDIT].insert_one(
            {
                "_id": str(uuid.uuid4()),
                "actor_id": ACTOR,
                "actor_role": "tool",
                "location": account["location"],
                "permission": "accounts:role",
                "subject_id": account["_id"],
                "privileged": True,
                "outcome": "allowed",
                "status_code": 200,
                "request_id": None,
                "source_ip": None,
                "route": "auth.promote_admin",
                "changed_fields": ["role", "tokens_revoked_at"],
                "created_at": now,
            }
        )
        _logger.warning("audit.role_changed id=%s role=admin by=%s", account["_id"], ACTOR)
        return updated
    finally:
        await client.close()


def main(
    argv: Sequence[str] | None = None,
    environ: Mapping[str, str] = os.environ,
    stdin: IO[str] = sys.stdin,
) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m auth.promote_admin", description=__doc__.split("\n\n")[0]
    )
    who = parser.add_mutually_exclusive_group(required=True)
    who.add_argument("--user-id", help="the account's user id (from GET /api/v1/auth/me)")
    who.add_argument(
        "--email-stdin", action="store_true", help="read the account's email from stdin"
    )
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    email = stdin.readline().strip() if args.email_stdin else None
    try:
        settings = settings_from(environ)
        account = asyncio.run(promote(settings, user_id=args.user_id, email=email))
    except Refused as exc:
        print(f"promote-admin: refused: {exc}", file=sys.stderr)
        return 1
    print(f"promote-admin: {account['_id']} is now an admin; it signs in again to use it.")
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
