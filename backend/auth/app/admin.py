"""auth's admin endpoints (build plan 3.4; docs/auth-users-split-api.md).

Accounts: list, search by email, lock, unlock, role. The allow-list: list, search, add,
remove. Every route asks for a permission (11.2); each use is privileged and audited, and
the changes write a second audit event with the changed field **names**.

**Emails never travel in a URL:** searches are `POST`s with the email in the body, and an
allow-list entry is removed by its HMAC key. Nothing here logs an email.

**The last admin (10.3).** `admin_count {_id: "admins", active}` counts **unlocked** admins.
Taking an admin out of that count (locking, or demoting one who isn't locked) first does a
conditional `$inc: -1` that matches only while `active > 1`, so two admins demoting each
other at once leave one; if it matches nothing the answer is `409 last_admin`. Then the
account changes, matching exactly the state read; if that misses (something changed it
meanwhile) the counter is put back and the whole step retried. Unlocking an admin and
promoting an unlocked account add one back. The counter is cross-zone, so it's never
inside a zone's transaction.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Mapping
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from fastapi import Depends, HTTPException, Path, Query, Request, Response
from pydantic import BaseModel, Field
from pymongo import DESCENDING, ReturnDocument
from pymongo.errors import DuplicateKeyError

from auth.app.authz_cache import entry_from_account, write_entry
from auth.app.deps import Ready, error, per_user
from auth.app.runtime import Runtime
from auth.app.store import ADMIN_COUNT, ALLOWED_EMAILS, AUTH, EMAIL_INDEX, SESSIONS, authz_change
from auth.emails import is_valid_address, mask, normalise
from common.authz import Caller, require
from common.routers import PolicyRouter

ADMINS = "admins"
MAX_ATTEMPTS = 3
LOCATION_PATTERN = r"^[a-z0-9_-]{1,16}$"

_logger = logging.getLogger(__name__)

router = PolicyRouter(prefix="/api/v1/auth", tags=["admin"])
Limited = [Depends(per_user("60/minute"))]


# ── models ─────────────────────────────────────────────────────────────────────


class Account(BaseModel):
    id: str
    email: str
    role: Literal["parent", "admin"]
    auth_provider: Literal["password", "google"]
    location: str
    locked: bool
    deleting: bool
    created_at: datetime


class AccountPage(BaseModel):
    items: list[Account]
    total: int
    skip: int
    limit: int


class EmailBody(BaseModel):
    email: str = Field(max_length=255)


class LockState(BaseModel):
    id: str
    locked: bool


class RoleBody(BaseModel):
    role: Literal["parent", "admin"]


class RoleState(BaseModel):
    id: str
    role: Literal["parent", "admin"]


class AllowedEmail(BaseModel):
    key: str
    email_hint: str
    added_by: str
    created_at: datetime


class AllowedEmailPage(BaseModel):
    items: list[AllowedEmail]
    total: int
    skip: int
    limit: int


def _account(doc: Mapping[str, Any]) -> Account:
    return Account(
        id=doc["_id"],
        email=doc["email"],
        role=doc["role"],
        auth_provider=doc["auth_provider"],
        location=doc["location"],
        locked=bool(doc.get("is_locked")),
        deleting=bool(doc.get("is_being_deleted")),
        created_at=doc["created_at"],
    )


def _allowed(doc: Mapping[str, Any]) -> AllowedEmail:
    return AllowedEmail(
        key=doc["_id"],
        email_hint=doc["email_hint"],
        added_by=doc["added_by"],
        created_at=doc["created_at"],
    )


AccountId = Annotated[str, Path(description="The account's user id")]
LocationQuery = Annotated[
    str, Query(pattern=LOCATION_PATTERN, description="The account's location, from the listing")
]
Skip = Annotated[int, Query(ge=0)]
Limit = Annotated[int, Query(ge=1, le=100)]


def _not_found() -> HTTPException:
    return error(404, "account_not_found", "No such account.")


def _last_admin() -> HTTPException:
    return error(409, "last_admin", "This is the last active admin.")


# ── the admin counter (10.3) ───────────────────────────────────────────────────


async def take_admin_out(runtime: Runtime) -> None:
    """One active admin fewer, unless that would leave none: else 409 last_admin."""
    taken = await runtime.db[ADMIN_COUNT].update_one(
        {"_id": ADMINS, "active": {"$gt": 1}}, {"$inc": {"active": -1}}
    )
    if taken.modified_count != 1:
        raise _last_admin()


async def put_admin_back(runtime: Runtime) -> None:
    await runtime.db[ADMIN_COUNT].update_one({"_id": ADMINS}, {"$inc": {"active": 1}}, upsert=True)


# ── account changes ────────────────────────────────────────────────────────────


async def _read(runtime: Runtime, user_id: str, location: str) -> dict[str, Any]:
    doc = await runtime.db[AUTH].find_one({"_id": user_id, "location": location})
    if doc is None:
        raise _not_found()
    return doc


def _state(doc: Mapping[str, Any]) -> dict[str, Any]:
    """The exact state an update must still find: role and lock as read, not being deleted
    (a deletion took a counted admin off the counter, so a change now would count it again)."""
    return {
        "_id": doc["_id"],
        "location": doc["location"],
        "role": doc["role"],
        "is_locked": True if doc.get("is_locked") else {"$ne": True},
        "is_being_deleted": {"$ne": True},
    }


async def _apply(
    runtime: Runtime, doc: Mapping[str, Any], fields: Mapping[str, Any], *, end_sessions: bool
) -> dict[str, Any] | None:
    """Change the account if it's still as read; None if it changed meanwhile."""
    now = datetime.now(UTC)
    if end_sessions:
        fields = {**fields, "tokens_revoked_at": now}
    updated = await runtime.db[AUTH].find_one_and_update(
        _state(doc), authz_change(fields, now), return_document=ReturnDocument.AFTER
    )
    if updated is None:
        return None
    if end_sessions:
        await runtime.db[SESSIONS].delete_many({"location": doc["location"], "user_id": doc["_id"]})
    # This region at once; the other regions' workers from the change stream (9.3).
    await write_entry(runtime.cache, doc["_id"], entry_from_account(updated))
    return updated


def _never(_: Mapping[str, Any]) -> bool:
    return False


async def _change(
    runtime: Runtime,
    user_id: str,
    location: str,
    fields: Mapping[str, Any],
    *,
    removes_active_admin: bool,
    adds_active_admin: Callable[[Mapping[str, Any]], bool],
    end_sessions: bool,
    expected: Mapping[str, Any],
) -> dict[str, Any]:
    """Read, guard the counter, apply; retried when the account changed in between."""
    for _ in range(MAX_ATTEMPTS):
        doc = await _read(runtime, user_id, location)
        if doc.get("is_being_deleted"):
            raise error(409, "account_deleting", "This account is being deleted.")
        if all(doc.get(k, False) == v for k, v in expected.items()):
            return doc  # already so: nothing to do
        removing = removes_active_admin and doc["role"] == "admin" and not doc.get("is_locked")
        adding = adds_active_admin(doc)
        if removing:
            await take_admin_out(runtime)
        updated = await _apply(runtime, doc, fields, end_sessions=end_sessions)
        if updated is None:
            if removing:
                await put_admin_back(runtime)
            continue
        if adding:
            await put_admin_back(runtime)
        return updated
    raise error(409, "account_changed", "The account changed while updating; try again.")


# ── accounts ───────────────────────────────────────────────────────────────────


@router.get(
    "/accounts",
    dependencies=Limited,
    description="Accounts, newest first. Admins (`accounts:list`); audited. No names: "
    "fetch a page's names from users (`GET /api/v1/users/profiles?ids=`).",
)
async def list_accounts(
    runtime: Ready,
    _caller: Annotated[Caller, Depends(require("accounts:list"))],
    role: Annotated[Literal["parent", "admin"] | None, Query()] = None,
    locked: Annotated[bool | None, Query()] = None,
    skip: Skip = 0,
    limit: Limit = 20,
) -> AccountPage:
    selector: dict[str, Any] = {}
    if role is not None:
        selector["role"] = role
    if locked is not None:
        selector["is_locked"] = True if locked else {"$ne": True}
    accounts = runtime.db[AUTH]
    total = await accounts.count_documents(selector)
    docs = (
        await accounts.find(selector)
        .sort("created_at", DESCENDING)
        .skip(skip)
        .limit(limit)
        .to_list(None)
    )
    return AccountPage(items=[_account(d) for d in docs], total=total, skip=skip, limit=limit)


@router.post(
    "/accounts/search",
    dependencies=Limited,
    description="Find one account by email (in the body, never a URL). Admins "
    "(`accounts:list`); audited.",
)
async def search_account(
    body: EmailBody,
    runtime: Ready,
    _caller: Annotated[Caller, Depends(require("accounts:list"))],
) -> Account:
    email = normalise(body.email)
    for _, key in runtime.peppers.keys(email):
        row = await runtime.db[EMAIL_INDEX].find_one({"_id": key})
        if row is not None:
            doc = await runtime.db[AUTH].find_one(
                {"_id": row["user_id"], "location": row["location"]}
            )
            if doc is not None:
                return _account(doc)
            break
    raise _not_found()


@router.post(
    "/accounts/{id}/lock",
    dependencies=Limited,
    description="Lock an account: signed out everywhere, login blocked. Admins "
    "(`accounts:lock`); audited. Not yourself, and not the last active admin.",
)
async def lock_account(
    request: Request,
    id: AccountId,
    location: LocationQuery,
    runtime: Ready,
    caller: Annotated[Caller, Depends(require("accounts:lock"))],
) -> LockState:
    if id == caller.user_id:
        raise error(400, "cannot_lock_self", "You can't lock your own account.")
    doc = await _change(
        runtime, id, location, {"is_locked": True},
        removes_active_admin=True, adds_active_admin=_never, end_sessions=True,
        expected={"is_locked": True},
    )  # fmt: skip
    runtime.audit.action(request, caller, "accounts:lock", id, ("is_locked", "tokens_revoked_at"))
    _logger.info("admin.lock id=%s by=%s", id, caller.user_id)
    return LockState(id=doc["_id"], locked=True)


@router.post(
    "/accounts/{id}/unlock",
    dependencies=Limited,
    description="Unlock an account. `tokens_revoked_at` stays, so tokens from before the "
    "lock stay invalid: the user signs in again. Admins (`accounts:lock`); audited.",
)
async def unlock_account(
    request: Request,
    id: AccountId,
    location: LocationQuery,
    runtime: Ready,
    caller: Annotated[Caller, Depends(require("accounts:lock"))],
) -> LockState:
    doc = await _change(
        runtime, id, location, {"is_locked": False},
        removes_active_admin=False,
        adds_active_admin=lambda d: d["role"] == "admin",
        end_sessions=False, expected={"is_locked": False},
    )  # fmt: skip
    runtime.audit.action(request, caller, "accounts:lock", id, ("is_locked",))
    _logger.info("admin.unlock id=%s by=%s", id, caller.user_id)
    return LockState(id=doc["_id"], locked=False)


@router.patch(
    "/accounts/{id}/role",
    dependencies=Limited,
    description="Change an account's role. Its sessions end, so no token keeps the old "
    "role. Admins (`accounts:role`); audited and alarmed. Not the last active admin.",
)
async def change_role(
    request: Request,
    id: AccountId,
    location: LocationQuery,
    body: RoleBody,
    runtime: Ready,
    caller: Annotated[Caller, Depends(require("accounts:role"))],
) -> RoleState:
    promoting = body.role == "admin"
    doc = await _change(
        runtime, id, location, {"role": body.role},
        removes_active_admin=not promoting,
        adds_active_admin=(lambda d: not d.get("is_locked")) if promoting else _never,
        end_sessions=True, expected={"role": body.role},
    )  # fmt: skip
    runtime.audit.action(request, caller, "accounts:role", id, ("role", "tokens_revoked_at"))
    # The "any role change" alarm's log line (11.3).
    _logger.warning("audit.role_changed id=%s role=%s by=%s", id, body.role, caller.user_id)
    return RoleState(id=doc["_id"], role=body.role)


# ── the allow-list ─────────────────────────────────────────────────────────────


@router.get(
    "/allowed-emails",
    dependencies=Limited,
    description="The registration allow-list, newest first: HMAC keys and masked hints, "
    "never emails. Admins (`allowed_emails:read`).",
)
async def list_allowed_emails(
    runtime: Ready,
    _caller: Annotated[Caller, Depends(require("allowed_emails:read"))],
    skip: Skip = 0,
    limit: Limit = 20,
) -> AllowedEmailPage:
    entries = runtime.db[ALLOWED_EMAILS]
    total = await entries.count_documents({})
    docs = (
        await entries.find({}).sort("created_at", DESCENDING).skip(skip).limit(limit).to_list(None)
    )
    return AllowedEmailPage(items=[_allowed(d) for d in docs], total=total, skip=skip, limit=limit)


@router.post(
    "/allowed-emails/search",
    dependencies=Limited,
    description="Is this email on the allow-list? The email is in the body, never a URL. "
    "Admins (`allowed_emails:read`).",
)
async def search_allowed_email(
    body: EmailBody,
    runtime: Ready,
    _caller: Annotated[Caller, Depends(require("allowed_emails:read"))],
) -> AllowedEmail:
    keys = [key for _, key in runtime.peppers.keys(normalise(body.email))]
    doc = await runtime.db[ALLOWED_EMAILS].find_one({"_id": {"$in": keys}})
    if doc is None:
        raise error(404, "not_allowed", "This email isn't on the allow-list.")
    return _allowed(doc)


@router.post(
    "/allowed-emails",
    status_code=201,
    dependencies=Limited,
    description="Allow an email to register. Only its HMAC key and a masked hint are "
    "stored. Admins (`allowed_emails:write`); audited.",
)
async def add_allowed_email(
    request: Request,
    body: EmailBody,
    runtime: Ready,
    caller: Annotated[Caller, Depends(require("allowed_emails:write"))],
) -> AllowedEmail:
    email = normalise(body.email)
    if not is_valid_address(email):
        raise error(422, "invalid_email", "Not a valid email address.")
    entries = runtime.db[ALLOWED_EMAILS]
    # During a pepper rotation, an entry under any version already allows it (6.5).
    keys = [key for _, key in runtime.peppers.keys(email)]
    if await entries.find_one({"_id": {"$in": keys}}, {"_id": 1}) is not None:
        raise error(409, "already_allowed", "This email is already on the allow-list.")
    entry_key = runtime.peppers.key(email)
    doc = {
        "_id": entry_key,
        "key_version": runtime.peppers.current,
        "email_hint": mask(email),
        "added_by": caller.user_id,
        "created_at": datetime.now(UTC),
    }
    try:
        await entries.insert_one(doc)
    except DuplicateKeyError as exc:  # another admin added it at the same moment
        raise error(409, "already_allowed", "This email is already on the allow-list.") from exc
    runtime.audit.action(request, caller, "allowed_emails:write", entry_key)
    return _allowed(doc)


@router.delete(
    "/allowed-emails/{key}",
    status_code=204,
    response_model=None,
    dependencies=Limited,
    description="Remove an entry by its HMAC key (so no email is in the URL). Existing "
    "accounts aren't affected. Admins (`allowed_emails:write`); audited.",
)
async def remove_allowed_email(
    request: Request,
    key: Annotated[str, Path(pattern="^[0-9a-f]{64}$", description="The entry's HMAC key")],
    runtime: Ready,
    caller: Annotated[Caller, Depends(require("allowed_emails:write"))],
) -> Response:
    removed = await runtime.db[ALLOWED_EMAILS].delete_one({"_id": key})
    if removed.deleted_count != 1:
        raise error(404, "not_allowed", "No such allow-list entry.")
    runtime.audit.action(request, caller, "allowed_emails:write", key)
    return Response(status_code=204)
