"""Routes in app/routers/auth.py, driven over HTTP against an in-memory Motor stand-in.

Passwords are hashed with real bcrypt (at the minimum cost factor, for speed), so
"the stored hash verifies the password" is checked for real, not mocked.
"""

import logging
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import bcrypt
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from pymongo.errors import DuplicateKeyError

import app.routers.auth as auth
from app import models
from app.auth_utils import _encode, create_access_token, create_refresh_token, decode_token
from app.database import get_db
from app.limiter import limiter, user_limiter
from app.main import app
from app.routers.auth import GoogleAuthBody, LoginBody, RegisterBody

# ── an in-memory stand-in for the Motor collections these routes use ─────────


class _Collection:
    def __init__(self, name, log, docs=()):
        self.name, self.log = name, log
        self.docs = [dict(d) for d in docs]
        self.fail: dict[str, Exception] = {}  # method → exception to raise
        self.update_result = None  # forced update_one result (race simulations)

    def _call(self, method, arg):
        self.log.append((self.name, method, arg))
        if method in self.fail:
            raise self.fail[method]

    @staticmethod
    def _matches(doc, query):
        return all(doc.get(k) == v for k, v in query.items())

    async def find_one(self, query):
        self._call("find_one", query)
        return next((dict(d) for d in self.docs if self._matches(d, query)), None)

    async def insert_one(self, doc):
        self._call("insert_one", doc)
        if any(d["_id"] == doc["_id"] for d in self.docs):
            raise DuplicateKeyError("E11000 duplicate key")
        self.docs.append(dict(doc))

    async def update_one(self, query, update):
        self._call("update_one", (query, update))
        if self.update_result is not None:
            return self.update_result
        matched = [d for d in self.docs if self._matches(d, query)][:1]
        for d in matched:
            d.update(update["$set"])
        return SimpleNamespace(matched_count=len(matched), modified_count=len(matched))

    async def delete_one(self, query):
        self._call("delete_one", query)
        doomed = next((d for d in self.docs if self._matches(d, query)), None)
        self.docs = [d for d in self.docs if d is not doomed]

    async def delete_many(self, query):
        self._call("delete_many", query)
        self.docs = [d for d in self.docs if not self._matches(d, query)]


class _Db(dict):
    def __init__(self):
        super().__init__()
        self.log: list[tuple] = []  # every call, in order, across collections

    def __missing__(self, name):
        self[name] = _Collection(name, self.log)
        return self[name]

    def calls(self, collection, method):
        return [arg for c, m, arg in self.log if (c, m) == (collection, method)]


@pytest.fixture(autouse=True)
def cheap_bcrypt(monkeypatch):
    real_gensalt = bcrypt.gensalt
    monkeypatch.setattr(bcrypt, "gensalt", lambda rounds=12, prefix=b"2b": real_gensalt(4, prefix))
    monkeypatch.setattr(auth, "_DUMMY_HASH", bcrypt.hashpw(b"dummy", real_gensalt(4)).decode())


@pytest.fixture
def verified(monkeypatch):
    """Records the hash every password check is made against."""
    hashes: list[str] = []
    real = auth.async_verify_password

    async def spy(plain, hashed):
        hashes.append(hashed)
        return await real(plain, hashed)

    monkeypatch.setattr(auth, "async_verify_password", spy)
    return hashes


@pytest.fixture
def db():
    database = _Db()
    app.dependency_overrides[get_db] = lambda: database
    limiter.reset()
    user_limiter.reset()
    try:
        yield database
    finally:
        app.dependency_overrides.pop(get_db, None)
        limiter.reset()
        user_limiter.reset()


@pytest.fixture
def client():
    return TestClient(app)


PASSWORD = "s3cret-pass"
T0 = datetime(2026, 1, 1, tzinfo=UTC)


def _hash(password=PASSWORD):
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def _add_user(db, *, _id="u1", email="p@example.com", location="eu", **fields):
    user = {"_id": _id, "email": email, "location": location, "role": "parent", **fields}
    user.setdefault("password_hash", _hash())
    db[models.USERS].docs.append(user)
    db[models.EMAIL_INDEX].docs.append({"_id": email, "user_id": _id, "location": location})
    return user


def _allow(db, *emails):
    db[models.ALLOWED_EMAILS].docs.extend({"_id": e} for e in emails)


def _set_cookies(res):
    return res.headers.get_list("set-cookie")


def _cleared(res):
    cookies = _set_cookies(res)
    return all(
        any(c.startswith(f"{name}=") and "Max-Age=0" in c for c in cookies)
        for name in ("access_token", "refresh_token")
    )


def _assert_tokens_issued(res, db, *, user_id, location):
    """Both tokens returned and set as cookies, carrying the user and location,
    and the refresh token's jti stored as a session under that location."""
    body = res.json()
    access, refresh = decode_token(body["access_token"]), decode_token(body["refresh_token"])
    assert (access["sub"], access["type"], access["location"]) == (user_id, "access", location)
    assert (refresh["sub"], refresh["type"], refresh["location"]) == (user_id, "refresh", location)
    cookies = _set_cookies(res)
    assert any(c.startswith(f"access_token={body['access_token']};") for c in cookies)
    assert any(c.startswith(f"refresh_token={body['refresh_token']};") for c in cookies)
    session = next(d for d in db[models.SESSIONS].docs if d["_id"] == refresh["jti"])
    assert (session["user_id"], session["location"]) == (user_id, location)
    return refresh


# ── request models ───────────────────────────────────────────────────────────


def _register(**overrides):
    fields = {"email": "p@example.com", "password": PASSWORD, "country_code": "DE"}
    return RegisterBody(**{**fields, **overrides})


def test_register_body_normalises_email_and_country():
    body = _register(email="  p@EXAMPLE.com ", country_code=" de ")
    assert (body.email, body.country_code) == ("p@example.com", "DE")


@pytest.mark.parametrize(
    ("password", "error"),
    [
        ("aaaaaaaa", "single repeated character"),
        ("abcdefgh", "at least one digit"),
        ("12345678", "at least one letter"),
        ("short1", "at least 8 characters"),
    ],
)
def test_register_body_password_rules(password, error):
    with pytest.raises(ValidationError, match=error):
        _register(password=password)


def test_register_body_rejects_bad_email_and_unknown_country():
    with pytest.raises(ValidationError, match="email"):
        _register(email="not-an-email")
    with pytest.raises(ValidationError, match="Unsupported country_code 'ZZ'"):
        _register(country_code="zz")
    with pytest.raises(ValidationError):
        _register(country_code=12)  # non-strings skip normalisation and fail type checks


def test_blocked_countries_pass_validation_so_the_route_can_answer_403():
    assert _register(country_code="IR").country_code == "IR"
    assert GoogleAuthBody(id_token="t", country_code="ir").country_code == "IR"


def test_login_body_normalises_like_register_and_tolerates_invalid_addresses():
    assert LoginBody(email=" p@EXAMPLE.com ", password="x").email == "p@example.com"
    assert LoginBody(email="  Not An Email ", password="x").email == "not an email"


def test_google_body_country_is_optional_but_validated():
    assert GoogleAuthBody(id_token="t").country_code is None
    assert GoogleAuthBody(id_token="t", country_code=" us ").country_code == "US"
    with pytest.raises(ValidationError, match="Unsupported country_code"):
        GoogleAuthBody(id_token="t", country_code="ZZ")


# ── /auth/register ───────────────────────────────────────────────────────────

REGISTER = "/api/v1/auth/register"


def _post_register(client, **overrides):
    payload = {"email": "p@example.com", "password": PASSWORD, "country_code": "DE"}
    return client.post(REGISTER, json={**payload, **overrides})


def test_register_creates_the_account_on_the_countrys_location(db, client):
    _allow(db, "p@example.com")
    res = _post_register(client, email="P@Example.com", country_code="in", full_name="Asha")
    assert res.status_code == 201
    [user] = db[models.USERS].docs
    assert db[models.EMAIL_INDEX].docs == [
        {"_id": "P@example.com", "user_id": user["_id"], "location": "in"}
    ]
    assert bcrypt.checkpw(PASSWORD.encode(), user.pop("password_hash").encode())
    created = user.pop("created_at")
    assert created == user.pop("updated_at") and created.tzinfo is not None
    assert user == {
        "_id": user["_id"],
        "email": "P@example.com",
        "full_name": "Asha",
        "role": "parent",
        "country_code": "IN",
        "location": "in",
        "preferences": {"tts_enabled": True, "last_visited_path": None},
        "tokens_revoked_at": None,
        "is_being_deleted": False,
    }
    uuid.UUID(user["_id"])
    _assert_tokens_issued(res, db, user_id=user["_id"], location="in")
    # The email is reserved before the user document is written.
    order = [(c, m) for c, m, _ in db.log if m == "insert_one"]
    assert order[:2] == [(models.EMAIL_INDEX, "insert_one"), (models.USERS, "insert_one")]


def test_register_defaults_the_name(db, client):
    _allow(db, "p@example.com")
    assert _post_register(client).status_code == 201
    assert db[models.USERS].docs[0]["full_name"] == "Parent"


def test_register_requires_an_allowlisted_email(db, client):
    _allow(db, "someone-else@example.com")
    res = _post_register(client)
    assert (res.status_code, res.json()["detail"]) == (403, "Registration is not open.")
    assert db[models.EMAIL_INDEX].docs == [] and db[models.USERS].docs == []


def test_register_blocked_country_is_403_before_anything_is_written(db, client):
    _allow(db, "p@example.com")
    res = _post_register(client, country_code="IR")
    assert res.status_code == 403
    assert res.json()["detail"] == {
        "code": "country_not_supported",
        "msg": "This service is not available in your country.",
    }
    assert db[models.EMAIL_INDEX].docs == [] and db[models.USERS].docs == []


def test_register_weak_password_is_422(db, client):
    _allow(db, "p@example.com")
    assert _post_register(client, password="password").status_code == 422


def test_register_existing_account_is_409_with_constant_time_work(db, client, verified):
    _allow(db, "p@example.com")
    existing = _add_user(db)
    res = _post_register(client)
    assert (res.status_code, res.json()["detail"]) == (409, "Email already registered")
    assert verified == [auth._DUMMY_HASH]  # same bcrypt cost as a real registration
    assert db[models.USERS].docs == [existing]
    assert db[models.EMAIL_INDEX].docs[0]["user_id"] == "u1"


def test_register_reclaims_an_orphaned_email_reservation(db, client, caplog):
    _allow(db, "p@example.com")
    db[models.EMAIL_INDEX].docs.append(
        {"_id": "p@example.com", "user_id": "gone", "location": "us"}
    )
    with caplog.at_level(logging.INFO, logger="app.routers.auth"):
        res = _post_register(client)
    assert res.status_code == 201
    [user] = db[models.USERS].docs
    assert db[models.EMAIL_INDEX].docs == [
        {"_id": "p@example.com", "user_id": user["_id"], "location": "eu"}
    ]
    # The orphan check looked for the old user under the old location...
    assert {"_id": "gone", "location": "us"} in db.calls(models.USERS, "find_one")
    # ...and the reclaim only applies if the slot still names the old user (TOCTOU).
    [(query, _)] = db.calls(models.EMAIL_INDEX, "update_one")
    assert query == {"_id": "p@example.com", "user_id": "gone"}
    assert "reclaimed orphaned email_index entry" in caplog.text
    assert "p@example.com" not in caplog.text


def test_register_orphan_claimed_concurrently_is_409(db, client, verified):
    _allow(db, "p@example.com")
    db[models.EMAIL_INDEX].docs.append(
        {"_id": "p@example.com", "user_id": "gone", "location": "us"}
    )
    db[models.EMAIL_INDEX].update_result = SimpleNamespace(modified_count=0)
    res = _post_register(client)
    assert (res.status_code, res.json()["detail"]) == (409, "Email already registered")
    assert verified == [auth._DUMMY_HASH]
    assert db[models.USERS].docs == []


def test_register_reservation_vanishing_mid_race_is_409(db, client):
    _allow(db, "p@example.com")
    db[models.EMAIL_INDEX].fail["insert_one"] = DuplicateKeyError("E11000")  # but no doc left
    res = _post_register(client)
    assert res.status_code == 409
    assert db[models.USERS].docs == []


def test_register_releases_the_reservation_if_the_user_insert_fails(db, client, caplog):
    _allow(db, "p@example.com")
    db[models.USERS].fail["insert_one"] = RuntimeError("shard down")
    with caplog.at_level(logging.ERROR, logger="app.routers.auth"):
        res = _post_register(client)
    assert res.status_code == 500
    assert res.json()["detail"] == "Registration failed — please try again"
    assert db[models.EMAIL_INDEX].docs == []  # the address can be retried
    assert "released email reservation" in caplog.text
    assert "p@example.com" not in caplog.text  # only a hash is logged
    assert db[models.SESSIONS].docs == []


def test_register_failure_to_release_is_logged_and_still_500(db, client, caplog):
    _allow(db, "p@example.com")
    db[models.USERS].fail["insert_one"] = RuntimeError("shard down")
    db[models.EMAIL_INDEX].fail["delete_one"] = RuntimeError("primary down")
    with caplog.at_level(logging.ERROR, logger="app.routers.auth"):
        res = _post_register(client)
    assert res.status_code == 500
    assert "failed to release email_index reservation" in caplog.text
    assert "orphaned entry will be reclaimed" in caplog.text


def test_register_is_limited_to_5_per_minute(db, client):
    for _ in range(5):
        assert _post_register(client).status_code == 403  # not allowlisted, still counted
    assert _post_register(client).status_code == 429


# ── /auth/login ──────────────────────────────────────────────────────────────

LOGIN = "/api/v1/auth/login"


def _login(client, email="p@example.com", password=PASSWORD):
    return client.post(LOGIN, json={"email": email, "password": password})


def test_login_issues_tokens_for_the_users_location(db, client):
    _add_user(db, location="us")
    res = _login(client, email=" p@EXAMPLE.com ")
    assert res.status_code == 200 and res.json()["status"] == "ok"
    _assert_tokens_issued(res, db, user_id="u1", location="us")
    # Two-phase lookup: email_index, then the user's own shard.
    assert db.calls(models.EMAIL_INDEX, "find_one") == [{"_id": "p@example.com"}]
    assert db.calls(models.USERS, "find_one") == [{"_id": "u1", "location": "us"}]


def test_login_normalises_like_registration_not_by_lowercasing(db, client):
    # Registration stores email_validator's normalised form, which keeps the local
    # part's case — login must look up that same key, not a lowercased one.
    _add_user(db, email="Parent@example.com")
    assert _login(client, email="Parent@EXAMPLE.com").status_code == 200


def test_login_wrong_password_is_401_and_logs_only_a_hash(db, client, caplog):
    _add_user(db)
    with caplog.at_level(logging.WARNING, logger="app.routers.auth"):
        res = _login(client, password="wrong-pass1")
    assert (res.status_code, res.json()["detail"]) == (401, "Invalid email or password")
    assert "auth.login.failed email_hash=" in caplog.text
    assert "p@example.com" not in caplog.text
    assert db[models.SESSIONS].docs == []


def test_login_unknown_email_does_the_same_bcrypt_work(db, client, verified):
    res = _login(client, email="nobody@example.com")
    assert (res.status_code, res.json()["detail"]) == (401, "Invalid email or password")
    assert verified == [auth._DUMMY_HASH]
    assert db.calls(models.USERS, "find_one") == []


def test_login_dangling_email_index_entry_is_401(db, client, verified):
    db[models.EMAIL_INDEX].docs.append(
        {"_id": "p@example.com", "user_id": "gone", "location": "eu"}
    )
    assert _login(client).status_code == 401
    assert verified == [auth._DUMMY_HASH]


@pytest.mark.parametrize(
    ("password_hash", "checked_against"),
    [("", ""), (None, "dummy")],  # empty hash: checked as-is (fails), not swapped for dummy
)
def test_login_malformed_password_hash_is_401(db, client, verified, password_hash, checked_against):
    _add_user(db, password_hash=password_hash)
    assert _login(client).status_code == 401
    assert verified == [auth._DUMMY_HASH if checked_against == "dummy" else ""]


def test_login_to_an_account_being_deleted_is_a_generic_401(db, client, verified):
    _add_user(db, is_being_deleted=True)
    res = _login(client)  # correct password
    assert (res.status_code, res.json()["detail"]) == (401, "Invalid email or password")
    assert verified == [auth._DUMMY_HASH]
    assert db[models.SESSIONS].docs == []


def test_login_to_a_locked_account_is_403(db, client, verified):
    _add_user(db, is_locked=True)
    res = _login(client)
    assert (res.status_code, res.json()["detail"]) == (
        403,
        "Your account has been locked. Please contact support.",
    )
    assert verified == [auth._DUMMY_HASH]
    assert db[models.SESSIONS].docs == []


def test_login_is_limited_to_10_per_minute(db, client):
    for _ in range(10):
        assert _login(client).status_code == 401
    assert _login(client).status_code == 429


# ── /auth/refresh ────────────────────────────────────────────────────────────

REFRESH = "/api/v1/auth/refresh"


def _session(db, jti, *, user_id="u1", location="eu", expires_at=None):
    expires_at = expires_at or datetime.now(UTC) + timedelta(hours=1)
    db[models.SESSIONS].docs.append(
        {"_id": jti, "user_id": user_id, "location": location, "expires_at": expires_at}
    )


def _refresh_token(db=None, *, sub="u1", location="eu", **session):
    token, jti = create_refresh_token(sub, location)
    if db is not None:
        _session(db, jti, user_id=sub, location=location, **session)
    return token, jti


def _cookies(**tokens):
    return {"Cookie": "; ".join(f"{k}={v}" for k, v in tokens.items())}


def _refresh(client, refresh_token, access_token=None):
    tokens = {"refresh_token": refresh_token}
    if access_token:
        tokens["access_token"] = access_token
    return client.post(REFRESH, headers=_cookies(**tokens))


def test_refresh_rotates_the_session(db, client):
    _add_user(db)
    token, old_jti = _refresh_token(db)
    res = _refresh(client, token)
    assert res.status_code == 200
    new = _assert_tokens_issued(res, db, user_id="u1", location="eu")
    assert [s["_id"] for s in db[models.SESSIONS].docs] == [new["jti"]]  # old one deleted
    # The new session is written before the old one is deleted (crash-safe order).
    session_ops = [(m, a) for c, m, a in db.log if c == models.SESSIONS and m != "find_one"]
    assert [m for m, _ in session_ops] == ["insert_one", "delete_one"]
    assert session_ops[1][1] == {"_id": old_jti, "location": "eu"}


def test_refresh_accepts_a_bearer_token_from_mobile_clients(db, client):
    _add_user(db)
    token, _ = _refresh_token(db)
    res = client.post(REFRESH, headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200


def test_refresh_without_a_token_is_401(db, client):
    res = client.post(REFRESH)
    assert (res.status_code, res.json()["detail"]) == (401, "Missing refresh token")


@pytest.mark.parametrize("kind", ["garbage", "access", "expired"])
def test_refresh_with_an_invalid_token_is_401_and_clears_cookies(db, client, caplog, kind):
    past = datetime.now(UTC) - timedelta(days=30)
    token = {
        "garbage": "not-a-jwt",
        "access": create_access_token("u1", "eu"),  # wrong type
        "expired": _encode({"sub": "u1", "type": "refresh", "jti": "j", "location": "eu",
                            "iat": past, "exp": past + timedelta(hours=1)}),
    }[kind]  # fmt: skip
    with caplog.at_level(logging.WARNING, logger="app.routers.auth"):
        res = _refresh(client, token)
    assert (res.status_code, res.json()["detail"]) == (401, "Invalid token")
    assert _cleared(res)
    assert "reason=invalid_refresh_token" in caplog.text


def test_refresh_rejects_an_access_token_for_another_user(db, client):
    _add_user(db)
    token, jti = _refresh_token(db)
    res = _refresh(client, token, access_token=create_access_token("intruder", "eu"))
    assert (res.status_code, res.json()["detail"]) == (401, "Token mismatch")
    assert _cleared(res)
    assert [s["_id"] for s in db[models.SESSIONS].docs] == [jti]  # nothing rotated


def test_refresh_accepts_an_expired_access_token_for_the_same_user(db, client):
    _add_user(db)
    token, _ = _refresh_token(db)
    past = datetime.now(UTC) - timedelta(hours=2)
    expired = _encode({"sub": "u1", "type": "access", "location": "eu",
                       "iat": past, "exp": past + timedelta(minutes=1)})  # fmt: skip
    assert _refresh(client, token, access_token=expired).status_code == 200
    # An unreadable access cookie is ignored, not treated as a mismatch.
    token, _ = _refresh_token(db)
    assert _refresh(client, token, access_token="garbage").status_code == 200


@pytest.mark.parametrize("missing", ["jti", "sub"])
def test_refresh_token_without_jti_or_sub_is_401(db, client, missing):
    now = datetime.now(UTC)
    claims = {"sub": "u1", "jti": "j1", "type": "refresh", "location": "eu",
              "iat": now, "exp": now + timedelta(hours=1)}  # fmt: skip
    del claims[missing]
    _session(db, "j1")
    res = _refresh(client, _encode(claims))
    assert (res.status_code, res.json()["detail"]) == (401, "Invalid token")
    assert _cleared(res)
    assert db.calls(models.SESSIONS, "find_one") == []


@pytest.mark.parametrize("location", [None, "EU; drop"])
def test_refresh_token_without_a_valid_location_is_401(db, client, caplog, location):
    now = datetime.now(UTC)
    claims = {"sub": "u1", "jti": "j1", "type": "refresh", "iat": now,
              "exp": now + timedelta(hours=1)}  # fmt: skip
    if location:
        claims["location"] = location
    _session(db, "j1")
    with caplog.at_level(logging.WARNING, logger="app.routers.auth"):
        res = _refresh(client, _encode(claims))
    assert (res.status_code, res.json()["detail"]) == (401, "Invalid token")
    assert _cleared(res)
    assert "reason=invalid_location sub=u1" in caplog.text
    assert db.calls(models.SESSIONS, "find_one") == []


def test_refresh_requires_the_session_to_belong_to_this_user_and_location(db, client, caplog):
    _add_user(db)
    token, jti = _refresh_token()
    _session(db, jti, user_id="someone-else")
    with caplog.at_level(logging.WARNING, logger="app.routers.auth"):
        res = _refresh(client, token)
    assert (res.status_code, res.json()["detail"]) == (
        401,
        "Session expired or already logged out",
    )
    assert _cleared(res)
    assert db.calls(models.SESSIONS, "find_one") == [
        {"_id": jti, "user_id": "u1", "location": "eu"}
    ]
    assert "reason=jti_not_found sub=u1" in caplog.text


@pytest.mark.parametrize("naive", [False, True])  # Mongo hands datetimes back naive
def test_refresh_with_an_expired_session_is_401_and_deletes_it(db, client, naive):
    _add_user(db)
    expires = datetime.now(UTC) - timedelta(seconds=5)
    token, jti = _refresh_token(db, expires_at=expires.replace(tzinfo=None) if naive else expires)
    res = _refresh(client, token)
    assert (res.status_code, res.json()["detail"]) == (401, "Session expired")
    assert _cleared(res)
    assert db[models.SESSIONS].docs == []
    assert db.calls(models.SESSIONS, "delete_one") == [{"_id": jti, "location": "eu"}]


def test_refresh_with_a_live_naive_session_expiry_succeeds(db, client):
    _add_user(db)
    future = (datetime.now(UTC) + timedelta(hours=1)).replace(tzinfo=None)
    token, _ = _refresh_token(db, expires_at=future)
    assert _refresh(client, token).status_code == 200


def test_refresh_for_a_deleted_user_is_401(db, client):
    token, _ = _refresh_token(db)
    res = _refresh(client, token)
    assert (res.status_code, res.json()["detail"]) == (401, "User not found")
    assert _cleared(res)
    assert db.calls(models.USERS, "find_one") == [{"_id": "u1", "location": "eu"}]


def test_refresh_for_a_locked_user_is_403_and_ends_the_session(db, client):
    _add_user(db, is_locked=True, tokens_revoked_at=datetime.now(UTC))
    token, _ = _refresh_token(db)
    res = _refresh(client, token)
    # Locked wins over revoked: the clearer message.
    assert (res.status_code, res.json()["detail"]) == (
        403,
        "Your account has been locked. Please contact support.",
    )
    assert _cleared(res)
    assert db[models.SESSIONS].docs == []


@pytest.mark.parametrize("naive", [False, True])
def test_refresh_token_issued_before_revocation_is_rejected(db, client, naive):
    revoked = datetime.now(UTC) + timedelta(seconds=5)
    _add_user(db, tokens_revoked_at=revoked.replace(tzinfo=None) if naive else revoked)
    token, _ = _refresh_token(db)
    res = _refresh(client, token)
    assert (res.status_code, res.json()["detail"]) == (401, "Session revoked")
    assert _cleared(res)
    assert db[models.SESSIONS].docs == []


def test_refresh_token_issued_at_the_revocation_instant_is_rejected(db, client):
    now = datetime.now(UTC).replace(microsecond=0)
    _add_user(db, tokens_revoked_at=now)
    claims = {"sub": "u1", "jti": "j1", "type": "refresh", "location": "eu",
              "iat": now, "exp": now + timedelta(hours=1)}  # fmt: skip
    _session(db, "j1")
    assert _refresh(client, _encode(claims)).json()["detail"] == "Session revoked"


def test_refresh_token_issued_after_revocation_is_accepted(db, client):
    _add_user(db, tokens_revoked_at=datetime.now(UTC) - timedelta(minutes=5))
    token, _ = _refresh_token(db)
    assert _refresh(client, token).status_code == 200


def test_refresh_token_without_iat_is_rejected_once_tokens_were_revoked(db, client):
    _add_user(db, tokens_revoked_at=T0)
    claims = {"sub": "u1", "jti": "j1", "type": "refresh", "location": "eu",
              "exp": datetime.now(UTC) + timedelta(hours=1)}  # fmt: skip
    _session(db, "j1")
    res = _refresh(client, _encode(claims))
    assert (res.status_code, res.json()["detail"]) == (401, "Session revoked")
    assert db[models.SESSIONS].docs == []


def test_refresh_is_limited_to_20_per_minute(db, client):
    for _ in range(20):
        assert client.post(REFRESH).status_code == 401
    assert client.post(REFRESH).status_code == 429


# ── /auth/logout ─────────────────────────────────────────────────────────────

LOGOUT = "/api/v1/auth/logout"


def test_logout_deletes_the_session_and_clears_cookies(db, client):
    token, jti = _refresh_token(db)
    _refresh_token(db)  # another device's session survives
    res = client.post(LOGOUT, headers=_cookies(refresh_token=token))
    assert res.status_code == 204
    assert _cleared(res)
    assert jti not in [s["_id"] for s in db[models.SESSIONS].docs]
    assert len(db[models.SESSIONS].docs) == 1


@pytest.mark.parametrize("token", [None, "garbage"])
def test_logout_without_a_usable_token_still_clears_cookies(db, client, token):
    res = client.post(LOGOUT, headers=_cookies(refresh_token=token) if token else {})
    assert res.status_code == 204
    assert _cleared(res)
    assert db.calls(models.SESSIONS, "delete_one") == []


def test_logout_refresh_token_without_jti_deletes_nothing(db, client):
    now = datetime.now(UTC)
    token = _encode({"sub": "u1", "type": "refresh", "location": "eu", "iat": now,
                     "exp": now + timedelta(hours=1)})  # fmt: skip
    res = client.post(LOGOUT, headers=_cookies(refresh_token=token))
    assert res.status_code == 204
    assert db.calls(models.SESSIONS, "delete_one") == []


def test_logout_rejects_an_access_token_for_another_user(db, client):
    token, jti = _refresh_token(db)
    res = client.post(
        LOGOUT,
        headers=_cookies(refresh_token=token, access_token=create_access_token("intruder", "eu")),
    )
    assert (res.status_code, res.json()["detail"]) == (401, "Token mismatch")
    assert _cleared(res)
    assert [s["_id"] for s in db[models.SESSIONS].docs] == [jti]  # victim's session kept


def test_logout_with_the_same_users_access_token_succeeds(db, client):
    token, _ = _refresh_token(db)
    access = create_access_token("u1", "eu")
    res = client.post(LOGOUT, headers=_cookies(refresh_token=token, access_token=access))
    assert res.status_code == 204
    assert db[models.SESSIONS].docs == []


def test_logout_is_limited_to_20_per_minute(db, client):
    for _ in range(20):
        assert client.post(LOGOUT).status_code == 204
    assert client.post(LOGOUT).status_code == 429


# ── /auth/google ─────────────────────────────────────────────────────────────

GOOGLE = "/api/v1/auth/google"


@pytest.fixture
def google(monkeypatch):
    """The verified Google ID-token payload the route will see."""
    info = {"email": "g@example.com", "email_verified": True, "name": "Gita"}
    seen: list[str] = []

    def verify(token):
        seen.append(token)
        return info

    monkeypatch.setattr(auth, "verify_google_token", verify)
    info["_seen"] = seen
    return info


def _google(client, **body):
    return client.post(GOOGLE, json={"id_token": "google-id-token", **body})


def test_google_signs_in_an_existing_user_without_creating_anything(db, client, google):
    # Same _id on another shard, locked: only the email_index's location may match.
    db[models.USERS].docs.append({"_id": "u1", "location": "eu", "is_locked": True})
    _add_user(db, email="g@example.com", location="us")
    google["email"] = "  g@EXAMPLE.com "
    res = _google(client)
    assert res.status_code == 200
    assert google["_seen"] == ["google-id-token"]
    _assert_tokens_issued(res, db, user_id="u1", location="us")
    assert len(db[models.USERS].docs) == 2  # the decoy and the user — nothing created
    assert db.calls(models.EMAIL_INDEX, "insert_one") == []


@pytest.mark.parametrize(
    ("info", "detail"),
    [
        ({"email": "  ", "email_verified": True}, "Google did not return an email"),
        ({"email_verified": True}, "Google did not return an email"),
        (
            {"email": "g@example.com", "email_verified": False},
            "Google account email is not verified",
        ),
        ({"email": "not-an-email", "email_verified": True}, "Google did not return a valid email"),
    ],
)
def test_google_rejects_unusable_identities(db, client, google, info, detail):
    google.clear()
    google.update(info, _seen=[])
    res = _google(client)
    assert (res.status_code, res.json()["detail"]) == (400, detail)
    assert db.log == []


@pytest.mark.parametrize(
    ("flag", "status", "detail"),
    [
        (
            "is_being_deleted",
            409,
            "This account is temporarily unavailable. Please try again shortly.",
        ),
        ("is_locked", 403, "Your account has been locked. Please contact support."),
    ],
)
def test_google_existing_user_that_cannot_sign_in(db, client, google, flag, status, detail):
    _add_user(db, email="g@example.com", **{flag: True})
    res = _google(client)
    assert (res.status_code, res.json()["detail"]) == (status, detail)
    assert db[models.SESSIONS].docs == []


def test_google_creates_a_new_account(db, client, google):
    _allow(db, "g@example.com")
    res = _google(client, country_code="in")
    assert res.status_code == 200
    [user] = db[models.USERS].docs
    assert db[models.EMAIL_INDEX].docs == [
        {"_id": "g@example.com", "user_id": user["_id"], "location": "in"}
    ]
    # A random, unguessable password — the account can't be logged into by password.
    assert bcrypt.checkpw(b"", user["password_hash"].encode()) is False
    assert user["password_hash"].startswith("$2b$")
    for key in ("password_hash", "created_at", "updated_at"):
        user.pop(key)
    assert user == {
        "_id": user["_id"],
        "email": "g@example.com",
        "full_name": "Gita",
        "role": "parent",
        "country_code": "IN",
        "location": "in",
        "preferences": {"tts_enabled": True, "last_visited_path": None},
        "tokens_revoked_at": None,
        "is_being_deleted": False,
    }
    _assert_tokens_issued(res, db, user_id=user["_id"], location="in")


def test_google_new_accounts_get_a_fresh_random_password(db, client, google, monkeypatch):
    _allow(db, "g@example.com", "h@example.com")
    hashed: list[str] = []
    real = auth.async_hash_password

    async def spy(password):
        hashed.append(password)
        return await real(password)

    monkeypatch.setattr(auth, "async_hash_password", spy)
    for email in ("g@example.com", "h@example.com"):
        google["email"] = email
        assert _google(client, country_code="US").status_code == 200
    assert len(set(hashed)) == 2 and all(len(p) >= 40 for p in hashed)  # 32 random bytes


@pytest.mark.parametrize(
    ("name", "full_name"),
    [
        ("  Gita\r\nAdmin\x7f ", "GitaAdmin"),  # control characters stripped
        (None, "g"),  # no name → the email's local part
        ("\x00\x01", "g"),  # nothing left after stripping → local part
        ("x" * 300, "x" * 255),  # capped to the schema's max length
    ],
)
def test_google_new_account_name(db, client, google, name, full_name):
    _allow(db, "g@example.com")
    google["name"] = name
    assert _google(client, country_code="US").status_code == 200
    assert db[models.USERS].docs[0]["full_name"] == full_name


def test_google_new_account_requires_an_allowlisted_email(db, client, google):
    _allow(db, "other@example.com")
    res = _google(client, country_code="US")
    assert (res.status_code, res.json()["detail"]) == (403, "Registration is not open.")
    assert db[models.USERS].docs == []


def test_google_new_account_requires_a_country(db, client, google):
    _allow(db, "g@example.com")
    res = _google(client)
    assert res.status_code == 422
    assert res.json()["detail"]["code"] == "country_code_required"
    assert db[models.USERS].docs == [] and db[models.EMAIL_INDEX].docs == []


def test_google_new_account_from_a_blocked_country_is_403(db, client, google):
    _allow(db, "g@example.com")
    res = _google(client, country_code="RU")
    assert res.status_code == 403 and res.json()["detail"]["code"] == "country_not_supported"
    assert db[models.USERS].docs == []


def _race(db, *, winner=None, orphan=None):
    """email_index insert hits a duplicate; the slot names `winner` (live) or `orphan`."""
    _allow(db, "g@example.com")
    entry_owner = winner or orphan
    if winner:
        db[models.USERS].docs.append(winner)

    async def index_insert(doc):
        db.log.append((models.EMAIL_INDEX, "insert_one", doc))
        if entry_owner:
            db[models.EMAIL_INDEX].docs.append(
                {
                    "_id": "g@example.com",
                    "user_id": entry_owner["_id"],
                    "location": entry_owner["location"],
                }  # fmt: skip
            )
        raise DuplicateKeyError("E11000")

    db[models.EMAIL_INDEX].insert_one = index_insert


@pytest.mark.parametrize(("flag", "status"), [("is_being_deleted", 409), ("is_locked", 403)])
def test_google_race_winner_that_cannot_sign_in(db, client, google, flag, status):
    _race(db, winner={"_id": "w", "location": "in", "email": "g@example.com", flag: True})
    assert _google(client, country_code="US").status_code == status
    assert db[models.SESSIONS].docs == []


def test_google_race_winner_is_signed_in(db, client, google):
    db[models.USERS].docs.append({"_id": "w", "location": "eu", "is_locked": True})  # other shard
    _race(db, winner={"_id": "w", "location": "in", "email": "g@example.com"})
    res = _google(client, country_code="US")
    assert res.status_code == 200
    _assert_tokens_issued(res, db, user_id="w", location="in")
    assert [u["location"] for u in db[models.USERS].docs] == ["eu", "in"]  # no new account


def test_google_race_with_an_orphaned_reservation_reclaims_it(db, client, google, caplog):
    _race(db, orphan={"_id": "gone", "location": "us"})
    with caplog.at_level(logging.INFO, logger="app.routers.auth"):
        res = _google(client, country_code="DE")
    assert res.status_code == 200
    [user] = db[models.USERS].docs
    assert db[models.EMAIL_INDEX].docs == [
        {"_id": "g@example.com", "user_id": user["_id"], "location": "eu"}
    ]
    [(query, _)] = db.calls(models.EMAIL_INDEX, "update_one")
    assert query == {"_id": "g@example.com", "user_id": "gone"}  # TOCTOU guard
    assert "reclaimed orphaned email_index entry" in caplog.text
    assert "g@example.com" not in caplog.text


def test_google_race_orphan_claimed_concurrently_is_500(db, client, google):
    _race(db, orphan={"_id": "gone", "location": "us"})
    db[models.EMAIL_INDEX].update_result = SimpleNamespace(modified_count=0)
    res = _google(client, country_code="DE")
    assert (res.status_code, res.json()["detail"]) == (500, "Sign-in failed — please try again")
    assert db[models.USERS].docs == []


def test_google_race_with_the_reservation_gone_is_500(db, client, google):
    _race(db)  # duplicate key, but the entry vanished before we could read it
    res = _google(client, country_code="DE")
    assert (res.status_code, res.json()["detail"]) == (500, "Sign-in failed — please try again")
    assert db[models.USERS].docs == []


def test_google_rolls_back_the_reservation_if_the_user_insert_fails(db, client, google, caplog):
    _allow(db, "g@example.com")
    db[models.USERS].fail["insert_one"] = RuntimeError("shard down")
    with caplog.at_level(logging.ERROR, logger="app.routers.auth"):
        res = _google(client, country_code="DE")
    assert (res.status_code, res.json()["detail"]) == (500, "Sign-in failed — please try again")
    assert db[models.EMAIL_INDEX].docs == []
    assert "rolled back email_index" in caplog.text and "g@example.com" not in caplog.text
    assert db[models.SESSIONS].docs == []


def test_google_is_limited_to_5_per_minute(db, client, google):
    for _ in range(5):
        assert _google(client).status_code == 403
    assert _google(client).status_code == 429


# ── /auth/me ─────────────────────────────────────────────────────────────────

ME = "/api/v1/auth/me"


def _bearer(user_id="u1", location="eu"):
    return {"Authorization": f"Bearer {create_access_token(user_id, location)}"}


def test_me_returns_the_profile(db, client):
    _add_user(db, full_name="Asha", role="admin", location="in")
    res = client.get(ME, headers=_bearer(location="in"))
    assert res.json() == {
        "id": "u1",
        "email": "p@example.com",
        "full_name": "Asha",
        "role": "admin",
    }


def test_me_fills_in_missing_name_and_role(db, client):
    user = _add_user(db, full_name=None)
    del user["role"]
    assert client.get(ME, headers=_bearer()).json() == {
        "id": "u1",
        "email": "p@example.com",
        "full_name": "",
        "role": "parent",
    }


def test_me_requires_authentication(db, client):
    assert client.get(ME).status_code == 401


def test_me_is_limited_to_60_per_minute(db, client):
    _add_user(db)
    for _ in range(60):
        assert client.get(ME, headers=_bearer()).status_code == 200
    assert client.get(ME, headers=_bearer()).status_code == 429


# ── DELETE /user/me ──────────────────────────────────────────────────────────

DELETE_ME = "/api/v1/user/me"
OWNED = (models.CHILDREN, models.GROWTH_AREAS, models.OBSERVATIONS, models.NINETY_DAY_PLANS)


def _delete_me(client, confirm="p@example.com", headers=None):
    return client.request(
        "DELETE", DELETE_ME, json={"confirm_email": confirm}, headers=headers or _bearer()
    )


def _populate(db):
    _add_user(db)
    _add_user(db, _id="u2", email="other@example.com")
    _session(db, "mine")
    _session(db, "theirs", user_id="u2")
    for name in OWNED:
        db[name].docs.extend(
            [
                {"_id": f"{name}-mine", "user_id": "u1", "location": "eu"},
                {"_id": f"{name}-theirs", "user_id": "u2", "location": "eu"},
            ]
        )


def test_delete_account_removes_only_this_users_data(db, client):
    _populate(db)
    res = _delete_me(client, confirm="  p@EXAMPLE.com ")
    assert res.status_code == 204
    assert _cleared(res)
    assert [u["_id"] for u in db[models.USERS].docs] == ["u2"]
    assert [e["_id"] for e in db[models.EMAIL_INDEX].docs] == ["other@example.com"]
    assert [s["_id"] for s in db[models.SESSIONS].docs] == ["theirs"]
    for name in OWNED:
        assert [d["_id"] for d in db[name].docs] == [f"{name}-theirs"]
        assert db.calls(name, "delete_many") == [{"user_id": "u1", "location": "eu"}]


def test_delete_account_revokes_tokens_before_deleting_anything(db, client):
    _populate(db)
    db.log.clear()
    _delete_me(client)
    writes = [(c, m, a) for c, m, a in db.log if m != "find_one"]
    collection, method, (query, update) = writes[0]
    assert (collection, method, query) == (
        models.USERS,
        "update_one",
        {"_id": "u1", "location": "eu"},
    )
    assert update["$set"]["is_being_deleted"] is True
    assert update["$set"]["tokens_revoked_at"] is not None
    assert update["$set"]["updated_at"] == update["$set"]["tokens_revoked_at"]
    assert writes[1] == (models.SESSIONS, "delete_many", {"user_id": "u1", "location": "eu"})
    # The email slot is released last, after the user document is gone.
    assert writes[-2] == (models.USERS, "delete_one", {"_id": "u1", "location": "eu"})
    assert writes[-1] == (models.EMAIL_INDEX, "delete_one", {"_id": "p@example.com"})


@pytest.mark.parametrize("confirm", ["other@example.com", "p@example.co", "Not An Email"])
def test_delete_account_requires_the_matching_email(db, client, confirm):
    _populate(db)
    db.log.clear()
    res = _delete_me(client, confirm=confirm)
    assert (res.status_code, res.json()["detail"]) == (400, "Email confirmation does not match")
    assert [c for c in db.log if c[1] != "find_one"] == []


def test_delete_account_confirmation_falls_back_to_lowercasing(db, client):
    # A stored address that email_validator wouldn't accept still matches its own
    # lowercased confirmation.
    _add_user(db, email="legacy address")
    assert _delete_me(client, confirm=" Legacy Address ").status_code == 204


def test_delete_account_succeeds_even_if_the_email_slot_cannot_be_released(db, client, caplog):
    _populate(db)
    db[models.EMAIL_INDEX].fail["delete_one"] = RuntimeError("primary down")
    with caplog.at_level(logging.ERROR, logger="app.routers.auth"):
        res = _delete_me(client)
    assert res.status_code == 204
    assert _cleared(res)
    assert [u["_id"] for u in db[models.USERS].docs] == ["u2"]
    assert "failed to remove email_index entry for user_id=u1" in caplog.text


def test_delete_account_requires_authentication(db, client):
    res = client.request("DELETE", DELETE_ME, json={"confirm_email": "p@example.com"})
    assert res.status_code == 401


def test_delete_account_is_limited_to_3_per_minute(db, client):
    _add_user(db)
    for _ in range(3):
        assert _delete_me(client, confirm="nope@example.com").status_code == 400
    assert _delete_me(client, confirm="nope@example.com").status_code == 429
