"""Signing in: tokens, the session row, cookies and the cache (docs/auth-users-split.md, 9.1).

Every sign-in (register, login, Google, refresh) ends here: a token pair, a `sessions` row
for the refresh token (its `jti`, in a rotation `family_id`), the HttpOnly cookies for the
web app (the mobile app takes the tokens from the body), and the account's authz entry
written to Valkey so the first request doesn't miss.

The session is checked once it's written: if the account's `authz_version` moved since the
caller read it (a logout-all, lock, role change or deletion in between, each of which ends
the sessions it can see), the new session is deleted and the sign-in refused, so none
outlives the change that should have ended it.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from fastapi import Response
from pydantic import BaseModel

from auth.app.authz_cache import entry_from_account, write_entry
from auth.app.deps import error
from auth.app.runtime import Runtime
from auth.app.store import AUTH, SESSIONS
from auth.app.tokens import IssuedTokens

ACCESS_COOKIE = "access_token"
REFRESH_COOKIE = "refresh_token"
REFRESH_COOKIE_PATH = "/api/v1/auth/"


class TokenResponse(BaseModel):
    status: str = "ok"
    access_token: str
    refresh_token: str


@dataclass(frozen=True)
class SignedIn:
    body: TokenResponse
    jti: str  # the new session's id (refresh marks the old session `replaced_by` it)


def _cookie_options(runtime: Runtime) -> dict[str, Any]:
    settings = runtime.settings
    return {
        "httponly": True,
        "secure": settings.cookie_secure,
        "samesite": settings.cookie_samesite,
        "domain": settings.cookie_domain,
    }


def set_cookies(runtime: Runtime, response: Response, tokens: IssuedTokens) -> None:
    options = _cookie_options(runtime)
    response.set_cookie(
        ACCESS_COOKIE,
        tokens.access_token,
        max_age=runtime.issuer.access_max_age,
        path="/",
        **options,
    )
    response.set_cookie(
        REFRESH_COOKIE,
        tokens.refresh_token,
        max_age=runtime.issuer.refresh_max_age,
        path=REFRESH_COOKIE_PATH,
        **options,
    )


def clear_cookies(runtime: Runtime, response: Response) -> None:
    options = _cookie_options(runtime)
    response.delete_cookie(ACCESS_COOKIE, path="/", **options)
    response.delete_cookie(REFRESH_COOKIE, path=REFRESH_COOKIE_PATH, **options)


async def sign_in(
    runtime: Runtime,
    response: Response,
    account: Mapping[str, Any],
    *,
    family_id: str | None = None,
) -> SignedIn:
    """Tokens, a session (a new family unless `family_id`), cookies, and the cache entry."""
    user_id, location = account["_id"], account["location"]
    tokens = runtime.issuer.issue(user_id, location, account["role"], family_id)
    await runtime.db[SESSIONS].insert_one(
        {
            "_id": tokens.jti,
            "user_id": user_id,
            "location": location,
            "family_id": tokens.family_id,
            "expires_at": tokens.refresh_expires_at,
            "rotated_at": None,
            "replaced_by": None,
            "created_at": datetime.now(UTC),
        }
    )
    current = await runtime.db[AUTH].find_one(
        {"_id": user_id, "location": location}, {"authz_version": 1}
    )
    if current is None or current.get("authz_version") != account.get("authz_version"):
        await runtime.db[SESSIONS].delete_one({"_id": tokens.jti, "location": location})
        raise error(401, "session_revoked", "Your account changed while signing in; sign in again.")
    set_cookies(runtime, response, tokens)
    # Best effort: a missed write only means the first request fills from auth (9.3).
    await write_entry(runtime.cache, user_id, entry_from_account(account))
    return SignedIn(
        TokenResponse(access_token=tokens.access_token, refresh_token=tokens.refresh_token),
        tokens.jti,
    )
