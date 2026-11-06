"""The registration saga (docs/auth-users-split.md, 10.1; API reference, register steps 4–7).

Shared by password registration and Google sign-up, after the allow-list and country
checks:

4. **Reserve** the email: an `email_index` row `{status: reserved}` keyed by its HMAC. A
   stale reservation (older than 15 minutes) is taken over, and what that attempt left
   (its `auth.auth` and profile) deleted first.
5. **Credentials:** insert `auth.auth`.
6. **Profile:** users' `PUT /internal/users/{id}` (an upsert, so retries are harmless).
7. **Activate:** the reservation becomes `active`, and login can find it.

Each failure undoes the steps before it, in reverse. If an undo can't finish (users
unreachable), what's left is kept for the auth-worker's reaper, which works from the
`reserved` row; login needs an `active` row, so a half-made account can't sign in.

`email_index` is unsharded and `auth.auth` is sharded, so no step shares a transaction
with another (14).
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError, PyMongoError

from auth.app.runtime import Runtime
from auth.app.store import AUTH, EMAIL_INDEX, new_credentials
from auth.app.tokens import async_check_password
from auth.emails import log_key
from common.internal_client import InternalUnavailable

STALE_AFTER = timedelta(minutes=15)

_logger = logging.getLogger(__name__)


def _error(
    status: int, code: str, msg: str, headers: dict[str, str] | None = None
) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "msg": msg}, headers=headers)


def email_taken() -> HTTPException:
    return _error(409, "email_taken", "An account with this email already exists.")


def unavailable() -> HTTPException:
    return _error(
        503,
        "registration_unavailable",
        "Registration is temporarily unavailable. Please try again.",
        headers={"Retry-After": "5"},
    )


async def delete_profile(runtime: Runtime, user_id: str, location: str) -> bool:
    """users' idempotent `DELETE /internal/users/{id}`. True when users confirmed it."""
    try:
        response = await runtime.internal.delete(
            "users", f"/internal/users/{user_id}?location={location}"
        )
    except (InternalUnavailable, httpx.HTTPError):
        return False
    return response.status_code == 204


async def _release(runtime: Runtime, key: str, user_id: str) -> None:
    """Drop this attempt's reservation (only if it's still this attempt's)."""
    await runtime.db[EMAIL_INDEX].delete_one({"_id": key, "user_id": user_id})


async def _undo_from_profile(runtime: Runtime, key: str, user_id: str, location: str) -> None:
    """Undo steps 6, 5 and 4, in that order. If users can't confirm the profile is gone,
    stop: the reservation and credentials stay for the reaper to clean up from."""
    if not await delete_profile(runtime, user_id, location):
        _logger.error(
            "register: profile undo failed; left for the reaper email_key=%s", log_key(key)
        )
        return
    await runtime.db[AUTH].delete_one({"_id": user_id, "location": location})
    await _release(runtime, key, user_id)


async def reserve(runtime: Runtime, email: str, user_id: str, location: str) -> str:
    """Step 4. Returns the reserved key, or raises 409 email_taken (or 503)."""
    rows = runtime.db[EMAIL_INDEX]
    current = runtime.peppers.current
    # During a pepper rotation, a row under any older version means the email is taken (6.5).
    for version, old_key in runtime.peppers.keys(email):
        if version != current and await rows.find_one({"_id": old_key}, {"_id": 1}):
            await async_check_password("", None)
            raise email_taken()

    key = runtime.peppers.key(email)
    now = datetime.now(UTC)
    row = {
        "_id": key,
        "key_version": current,
        "user_id": user_id,
        "location": location,
        "status": "reserved",
        "reserved_at": now,
    }
    try:
        await rows.insert_one(row)
        return key
    except DuplicateKeyError:
        existing = await rows.find_one({"_id": key})
    if existing is None or existing["status"] == "active":
        # Active (or just removed by the reaper: retrying is the client's call). The dummy
        # check keeps the timing from saying more than the status code does.
        await async_check_password("", None)
        raise email_taken()
    if existing["reserved_at"] > now - STALE_AFTER:
        raise email_taken()  # another registration for this email is in progress

    # A stale attempt: take it over, matching exactly the row read, so two takeovers can't
    # both win.
    taken = await rows.update_one(
        {
            "_id": key,
            "user_id": existing["user_id"],
            "reserved_at": existing["reserved_at"],
            "status": "reserved",
        },
        {
            "$set": {
                "user_id": user_id,
                "location": location,
                "reserved_at": now,
                "key_version": current,
            }
        },
    )
    if taken.modified_count != 1:
        raise email_taken()
    old_id, old_location = existing["user_id"], existing["location"]
    _logger.info("register: took over a stale reservation email_key=%s", log_key(key))
    if not await delete_profile(runtime, old_id, old_location):
        # Put the stale row back as it was, so the reaper still finds the old attempt's
        # leftovers from it.
        await rows.update_one(
            {"_id": key, "user_id": user_id},
            {
                "$set": {
                    k: existing[k] for k in ("user_id", "location", "reserved_at", "key_version")
                }
            },
        )
        raise unavailable()
    await runtime.db[AUTH].delete_one({"_id": old_id, "location": old_location})
    return key


async def create_account(
    runtime: Runtime,
    *,
    email: str,
    password_hash: str,
    country_code: str,
    location: str,
    auth_provider: str,
    profile: Mapping[str, Any],
) -> dict[str, Any]:
    """Steps 4–7. Returns the new `auth.auth` document, ready to sign in."""
    user_id = str(uuid.uuid4())
    key = await reserve(runtime, email, user_id, location)

    account = new_credentials(
        user_id=user_id,
        email=email,
        password_hash=password_hash,
        country_code=country_code,
        location=location,
        auth_provider=auth_provider,
        now=datetime.now(UTC),
    )
    try:
        await runtime.db[AUTH].insert_one(account)
    except PyMongoError as exc:
        await _release(runtime, key, user_id)
        _logger.error("register: credentials not saved email_key=%s", log_key(key))
        raise _error(500, "registration_failed", "The account couldn't be created.") from exc

    # Names, location and address: never the email (5.3).
    try:
        response = await runtime.internal.put(
            "users", f"/internal/users/{user_id}", json={**profile, "location": location}
        )
        failed = response.status_code not in (200, 201)
    except (InternalUnavailable, httpx.HTTPError):
        response, failed = None, True
    if failed:
        # users may have created the profile before the call failed, so undo it too.
        await _undo_from_profile(runtime, key, user_id, location)
        status = response.status_code if response is not None else None
        _logger.error("register: profile failed (%s) email_key=%s", status, log_key(key))
        if status is not None and status < 500:
            raise _error(500, "registration_failed", "The account couldn't be created.")
        raise unavailable()

    activated = await runtime.db[EMAIL_INDEX].update_one(
        {"_id": key, "user_id": user_id, "status": "reserved"}, {"$set": {"status": "active"}}
    )
    if activated.modified_count != 1:
        # The reaper took the reservation in the meantime: undo, and let the client retry.
        await _undo_from_profile(runtime, key, user_id, location)
        _logger.error("register: reservation lost before activation email_key=%s", log_key(key))
        raise unavailable()

    _logger.info("user.register id=%s location=%s", user_id, location)
    return account
