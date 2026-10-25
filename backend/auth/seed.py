"""Add a test email to the **local** allow-list, so registration works end to end locally.

    cd backend && python -m auth.seed

Reads LOCAL_ALLOWED_EMAIL (from the environment or `.env`, never committed), plus auth's
own MONGODB_URI, MONGODB_DB_NAME and EMAIL_HMAC_PEPPER. Only the email's HMAC key and a
masked hint are stored, as for any allow-list entry (5.2). Refuses to run unless
APP_ENV=local: deployed allow-lists are managed by admins (build plan 3.4).
"""

from __future__ import annotations

import asyncio
import os
import sys
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any

from dotenv import dotenv_values
from pymongo import AsyncMongoClient

from auth.app.store import ALLOWED_EMAILS, ensure_collections
from auth.emails import Peppers, is_valid_address, log_key, mask, normalise

# Not a real account: the allow-list row's `added_by` for entries made by this script.
SEED_ACTOR = "00000000-0000-4000-8000-000000000000"


def settings_from(environ: Mapping[str, str]) -> dict[str, str]:
    """The script's settings: the environment over `.env`; every one is required."""
    merged = {**{k: v for k, v in dotenv_values(".env").items() if v is not None}, **environ}
    names = (
        "APP_ENV",
        "LOCAL_ALLOWED_EMAIL",
        "MONGODB_URI",
        "MONGODB_DB_NAME",
        "EMAIL_HMAC_PEPPER",
    )
    missing = [name for name in names if not merged.get(name)]
    if missing:
        raise SystemExit(f"auth.seed: set {', '.join(missing)} (in .env or the environment)")
    if merged["APP_ENV"] != "local":
        raise SystemExit("auth.seed: only for APP_ENV=local")
    if not is_valid_address(merged["LOCAL_ALLOWED_EMAIL"]):
        raise SystemExit("auth.seed: LOCAL_ALLOWED_EMAIL isn't a valid address")
    return {name: merged[name] for name in names}


async def seed(settings: Mapping[str, str]) -> str:
    """Upsert the allow-list row; returns its key."""
    peppers = Peppers.parse(settings["EMAIL_HMAC_PEPPER"])
    email = normalise(settings["LOCAL_ALLOWED_EMAIL"])
    key = peppers.key(email)
    client: AsyncMongoClient[dict[str, Any]] = AsyncMongoClient(settings["MONGODB_URI"])
    try:
        db = client[settings["MONGODB_DB_NAME"]]
        await ensure_collections(db)
        await db[ALLOWED_EMAILS].update_one(
            {"_id": key},
            {
                "$setOnInsert": {
                    "key_version": peppers.current,
                    "email_hint": mask(email),
                    "added_by": SEED_ACTOR,
                    "created_at": datetime.now(UTC),
                }
            },
            upsert=True,
        )
    finally:
        await client.close()
    return key


def main(environ: Mapping[str, str] = os.environ) -> int:
    key = asyncio.run(seed(settings_from(environ)))
    print(f"auth.seed: allow-listed email_key={log_key(key)}")
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
