import asyncio
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException, Request

from app.auth_utils import _encode, create_access_token, create_refresh_token
from app.deps import get_current_admin, get_current_parent, get_current_user, get_token_claims
from app.main import app


def _request(*, cookie: str | None = None, bearer: str | None = None) -> Request:
    headers = []
    if cookie:
        headers.append((b"cookie", f"access_token={cookie}".encode()))
    if bearer:
        headers.append((b"authorization", f"Bearer {bearer}".encode()))
    return Request({"type": "http", "headers": headers})


def _raises(coro, status: int, detail: str):
    with pytest.raises(HTTPException) as exc:
        asyncio.run(coro)
    assert (exc.value.status_code, exc.value.detail) == (status, detail)


class _Users:
    def __init__(self, user):
        self.user, self.queries = user, []

    async def find_one(self, query):
        self.queries.append(query)
        return self.user


def _db(user):
    users = _Users(user)
    return {"users": users}, users


def _claims(iat: datetime | None = None, **overrides):
    issued = iat or datetime.now(UTC)
    claims = {"sub": "u1", "type": "access", "location": "eu", "iat": int(issued.timestamp())}
    claims.update(overrides)
    return {k: v for k, v in claims.items() if v is not None}  # override=None drops a claim


USER = {"_id": "u1", "location": "eu", "role": "parent", "tokens_revoked_at": None}


# -- get_token_claims --------------------------------------------------------------


def test_token_claims_from_cookie_and_from_bearer():
    token = create_access_token("u1", "eu")
    for req in (_request(cookie=token), _request(bearer=token)):
        claims = asyncio.run(get_token_claims(req))
        assert (claims["sub"], claims["type"]) == ("u1", "access")


def test_token_claims_without_any_token_is_not_authenticated():
    _raises(get_token_claims(_request()), 401, "Not authenticated")


def test_token_claims_rejects_invalid_tokens():
    now = datetime.now(UTC)
    no_sub = _encode({"type": "access", "iat": now, "exp": now + timedelta(minutes=5)})
    refresh, _ = create_refresh_token("u1", "eu")
    for token in ("not-a-jwt", refresh, no_sub):
        _raises(get_token_claims(_request(bearer=token)), 401, "Invalid token")


def test_auth_schemes_are_advertised_in_openapi():
    schemes = app.openapi()["components"]["securitySchemes"]
    assert {s["type"] for s in schemes.values()} >= {"apiKey", "http"}
    assert any(
        s.get("in") == "cookie" and s.get("name") == "access_token" for s in schemes.values()
    )
    assert any(s.get("scheme") == "bearer" for s in schemes.values())


# -- get_current_user --------------------------------------------------------------


def test_current_user_is_looked_up_by_id_and_token_location():
    db, users = _db(USER)
    assert asyncio.run(get_current_user(_claims(), db)) is USER
    assert users.queries == [{"_id": "u1", "location": "eu"}]


def test_current_user_without_location_is_invalid_and_not_looked_up():
    db, users = _db(USER)
    _raises(get_current_user(_claims(location=None), db), 401, "Invalid token")
    assert users.queries == []


def test_current_user_not_found():
    db, _ = _db(None)
    _raises(get_current_user(_claims(), db), 401, "User not found")


def test_locked_user_is_forbidden():
    db, _ = _db({**USER, "is_locked": True})
    _raises(
        get_current_user(_claims(), db),
        403,
        "Your account has been locked. Please contact support.",
    )


def test_revoked_session_without_iat_is_rejected():
    db, _ = _db({**USER, "tokens_revoked_at": datetime.now(UTC)})
    claims = _claims()
    del claims["iat"]  # can't prove it was issued after the revocation
    _raises(get_current_user(claims, db), 401, "Session revoked")


@pytest.mark.parametrize("aware", [True, False], ids=["aware-datetime", "naive-datetime"])
def test_token_issued_before_or_at_revocation_is_rejected(aware):
    revoked = datetime.now(UTC).replace(microsecond=0)
    stored = revoked if aware else revoked.replace(tzinfo=None)  # Mongo returns naive UTC
    db, _ = _db({**USER, "tokens_revoked_at": stored})
    for issued in (revoked - timedelta(minutes=5), revoked):  # before, and exactly at
        _raises(get_current_user(_claims(iat=issued), db), 401, "Session revoked")


@pytest.mark.parametrize("aware", [True, False], ids=["aware-datetime", "naive-datetime"])
def test_token_issued_after_revocation_is_accepted(aware):
    revoked = datetime.now(UTC).replace(microsecond=0) - timedelta(minutes=5)
    stored = revoked if aware else revoked.replace(tzinfo=None)
    user = {**USER, "tokens_revoked_at": stored}
    db, _ = _db(user)
    assert asyncio.run(get_current_user(_claims(iat=revoked + timedelta(seconds=1)), db)) is user


# -- role checks -------------------------------------------------------------------


def test_admin_dependency():
    admin = {**USER, "role": "admin"}
    assert asyncio.run(get_current_admin(admin)) is admin
    for user in ({**USER, "role": "parent"}, {"_id": "u1"}):
        _raises(get_current_admin(user), 403, "Admin access required")


def test_parent_dependency():
    for user in ({**USER, "role": "parent"}, {"_id": "u1"}):
        assert asyncio.run(get_current_parent(user)) is user
    _raises(get_current_parent({**USER, "role": "admin"}), 403, "Not available for admin accounts")
