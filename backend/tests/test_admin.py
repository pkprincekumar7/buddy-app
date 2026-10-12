import hashlib
import logging
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from pymongo.errors import DuplicateKeyError

from app import models
from app.auth_utils import create_access_token
from app.database import get_db
from app.limiter import user_limiter
from app.main import app
from app.routers.admin import _sanitize_for_log

# ── a small in-memory stand-in for the Motor collections these routes use ──────


class _Cursor:
    def __init__(self, docs):
        self.docs = docs

    async def to_list(self, length):
        return self.docs[:length]


class _Collection:
    def __init__(self, docs=None, *, aggregate_result=None):
        self.docs = [dict(d) for d in docs or []]
        self.aggregate_result = aggregate_result
        self.calls: list[tuple] = []
        self.lookups: list[tuple] = []  # (query, projection) of each find_one

    @staticmethod
    def _matches(doc, query):
        return all(doc.get(k) == v for k, v in query.items())

    @staticmethod
    def _project(doc, projection):
        return {k: v for k, v in doc.items() if projection.get(k)}

    async def find_one(self, query, projection=None):
        self.calls.append(("find_one", query))
        self.lookups.append((query, projection))
        doc = next((d for d in self.docs if self._matches(d, query)), None)
        return self._project(doc, projection) if doc and projection else doc

    async def insert_one(self, doc):
        if any(d["_id"] == doc["_id"] for d in self.docs):
            raise DuplicateKeyError("E11000 duplicate key")
        self.docs.append(dict(doc))

    async def delete_one(self, query):
        before = len(self.docs)
        self.docs = [d for d in self.docs if not self._matches(d, query)]
        return SimpleNamespace(deleted_count=before - len(self.docs))

    async def update_one(self, query, update):
        self.calls.append(("update_one", query, update))
        matched = [d for d in self.docs if self._matches(d, query)]
        for d in matched[:1]:
            d.update(update["$set"])
        return SimpleNamespace(matched_count=len(matched[:1]))

    def aggregate(self, pipeline):
        self.calls.append(("aggregate", pipeline))
        if self.aggregate_result is not None:
            return _Cursor(self.aggregate_result)
        assert len(pipeline) == 1, pipeline  # these routes use a single $facet stage
        facet = pipeline[0]["$facet"]
        out = {}
        for name, stages in facet.items():
            docs = [dict(d) for d in self.docs]
            for stage in stages:
                [(op, arg)] = stage.items()
                if op == "$sort":
                    [(field, direction)] = arg.items()
                    docs.sort(key=lambda d: d.get(field) or datetime.min.replace(tzinfo=UTC))
                    if direction == -1:
                        docs.reverse()
                elif op == "$skip":
                    docs = docs[arg:]
                elif op == "$limit":
                    docs = docs[:arg]
                elif op == "$project":
                    docs = [self._project(d, arg) for d in docs]
                elif op == "$count":
                    docs = [{arg: len(docs)}] if docs else []
            out[name] = docs
        return _Cursor([out])


class _Db(dict):
    def __missing__(self, name):
        self[name] = _Collection()
        return self[name]


ADMIN = {"_id": "admin1", "location": "in", "role": "admin", "email": "admin@example.com"}
PARENT = {"_id": "parent1", "location": "eu", "role": "parent", "email": "p@example.com"}
T0 = datetime(2026, 1, 1, tzinfo=UTC)


@pytest.fixture
def db():
    database = _Db()
    database[models.USERS] = _Collection([ADMIN, PARENT])
    app.dependency_overrides[get_db] = lambda: database
    user_limiter.reset()  # rate-limit buckets must not leak between tests
    try:
        yield database
    finally:
        app.dependency_overrides.pop(get_db, None)
        user_limiter.reset()


@pytest.fixture
def client():
    return TestClient(app)


def _auth(user=ADMIN):
    return {"Authorization": f"Bearer {create_access_token(user['_id'], user['location'])}"}


ROUTES = [
    ("get", "/api/v1/admin/allowed-emails"),
    ("get", "/api/v1/admin/allowed-emails/a@example.com"),
    ("post", "/api/v1/admin/allowed-emails"),
    ("delete", "/api/v1/admin/allowed-emails/a@example.com"),
    ("get", "/api/v1/admin/users"),
    ("get", "/api/v1/admin/users/by-email/a@example.com"),
    ("patch", "/api/v1/admin/users/parent1/lock?location=eu"),
    ("patch", "/api/v1/admin/users/parent1/unlock?location=eu"),
]


# ── access control ───────────────────────────────────────────────────────────


@pytest.mark.parametrize(("method", "path"), ROUTES)
def test_every_admin_route_requires_a_token(db, client, method, path):
    res = client.request(method, path, json={"email": "a@example.com"})
    assert (res.status_code, res.json()["detail"]) == (401, "Not authenticated")


@pytest.mark.parametrize(("method", "path"), ROUTES)
def test_every_admin_route_rejects_non_admins(db, client, method, path):
    res = client.request(method, path, json={"email": "a@example.com"}, headers=_auth(PARENT))
    assert (res.status_code, res.json()["detail"]) == (403, "Admin access required")


def test_rate_limit_rejects_before_the_admin_lookup(db, client):
    for _ in range(60):
        assert client.get("/api/v1/admin/users", headers=_auth()).status_code == 200
    lookups = len([c for c in db[models.USERS].calls if c[0] == "find_one"])
    res = client.get("/api/v1/admin/users", headers=_auth())
    assert res.status_code == 429
    # The over-limit request never reached get_current_admin's DB lookup.
    assert len([c for c in db[models.USERS].calls if c[0] == "find_one"]) == lookups


def test_tokenless_requests_are_rejected_before_they_count_against_the_rate_limit(db, client):
    # The router-level token check runs before every route's rate_limit, so
    # anonymous traffic can't drain the bucket (and new routes are safe by default).
    for _ in range(61):
        assert client.get("/api/v1/admin/users").status_code == 401


# ── allowed emails: list ─────────────────────────────────────────────────────


def test_list_allowed_emails_paginates(db, client):
    db[models.ALLOWED_EMAILS] = _Collection(
        [
            {"_id": "a@example.com", "added_at": T0},
            {"_id": "b@example.com"},  # legacy record without added_at
            {"_id": "c@example.com", "added_at": T0},
        ]
    )
    res = client.get("/api/v1/admin/allowed-emails?skip=1&limit=1", headers=_auth())
    assert res.status_code == 200
    assert res.json() == {
        "items": [{"email": "b@example.com", "added_at": None}],
        "total": 3,
        "skip": 1,
        "limit": 1,
    }
    res = client.get("/api/v1/admin/allowed-emails?limit=1", headers=_auth())
    assert res.json()["items"] == [{"email": "a@example.com", "added_at": "2026-01-01T00:00:00Z"}]


def test_list_allowed_emails_empty(db, client):
    res = client.get("/api/v1/admin/allowed-emails", headers=_auth())
    assert res.json() == {"items": [], "total": 0, "skip": 0, "limit": 20}


def test_list_allowed_emails_handles_an_empty_aggregation_result(db, client):
    db[models.ALLOWED_EMAILS] = _Collection(aggregate_result=[])
    assert client.get("/api/v1/admin/allowed-emails", headers=_auth()).json()["total"] == 0


@pytest.mark.parametrize("query", ["skip=-1", "limit=0", "limit=101"])
def test_list_pagination_is_validated(db, client, query):
    for path in ("/api/v1/admin/allowed-emails", "/api/v1/admin/users"):
        assert client.get(f"{path}?{query}", headers=_auth()).status_code == 422


# ── allowed emails: get / add / remove ──────────────────────────────────────


def test_get_allowed_email_normalizes_the_address(db, client):
    db[models.ALLOWED_EMAILS] = _Collection([{"_id": "foo@example.com", "added_at": T0}])
    res = client.get("/api/v1/admin/allowed-emails/ Foo@Example.COM ", headers=_auth())
    assert res.status_code == 200
    assert res.json()["email"] == "foo@example.com"


def test_get_allowed_email_not_found(db, client):
    res = client.get("/api/v1/admin/allowed-emails/nobody@example.com", headers=_auth())
    assert (res.status_code, res.json()["detail"]) == (404, "Email not found in allowlist")


@pytest.mark.parametrize("method", ["get", "delete"])
def test_invalid_email_path_parameter_is_422(db, client, method):
    res = client.request(method, "/api/v1/admin/allowed-emails/not-an-email", headers=_auth())
    assert (res.status_code, res.json()["detail"]) == (422, "Invalid email address")


def test_add_allowed_email_stores_it_normalized_and_logs_only_a_hash(db, client, caplog):
    with caplog.at_level(logging.INFO, logger="app.routers.admin"):
        res = client.post(
            "/api/v1/admin/allowed-emails", json={"email": " New@Example.COM "}, headers=_auth()
        )
    assert res.status_code == 201
    assert res.json()["email"] == "new@example.com"
    [stored] = db[models.ALLOWED_EMAILS].docs
    assert stored["_id"] == "new@example.com" and stored["added_at"] is not None
    assert hashlib.sha256(b"new@example.com").hexdigest()[:16] in caplog.text
    assert "new@example.com" not in caplog.text  # no PII in logs


def test_add_duplicate_allowed_email_is_409(db, client):
    db[models.ALLOWED_EMAILS] = _Collection([{"_id": "dup@example.com"}])
    res = client.post(
        "/api/v1/admin/allowed-emails", json={"email": "dup@example.com"}, headers=_auth()
    )
    assert (res.status_code, res.json()["detail"]) == (409, "Email already in allowlist")


def test_add_invalid_email_is_422(db, client):
    res = client.post("/api/v1/admin/allowed-emails", json={"email": "nope"}, headers=_auth())
    assert res.status_code == 422


def test_remove_allowed_email(db, client, caplog):
    db[models.ALLOWED_EMAILS] = _Collection([{"_id": "gone@example.com"}])
    with caplog.at_level(logging.INFO, logger="app.routers.admin"):
        res = client.delete("/api/v1/admin/allowed-emails/Gone@Example.com", headers=_auth())
    assert res.status_code == 204
    assert db[models.ALLOWED_EMAILS].docs == []
    assert "gone@example.com" not in caplog.text
    assert hashlib.sha256(b"gone@example.com").hexdigest()[:16] in caplog.text


def test_remove_unknown_allowed_email_is_404(db, client):
    res = client.delete("/api/v1/admin/allowed-emails/x@example.com", headers=_auth())
    assert (res.status_code, res.json()["detail"]) == (404, "Email not found in allowlist")


# ── registered users ─────────────────────────────────────────────────────────


def _users(*extra):
    return _Collection([ADMIN, *extra])


def test_list_users_newest_first_without_secrets(db, client):
    old = {"_id": "u-old", "email": "o@example.com", "location": "us", "created_at": T0,
           "password_hash": "$2b$secret", "is_locked": True}  # fmt: skip
    new = {"_id": "u-new", "email": "n@example.com", "location": "eu",
           "created_at": T0 + timedelta(days=1), "password_hash": "$2b$secret"}  # fmt: skip
    db[models.USERS] = _users(old, new)
    res = client.get("/api/v1/admin/users?limit=2", headers=_auth())
    body = res.json()
    assert res.status_code == 200
    assert [u["id"] for u in body["items"]] == ["u-new", "u-old"]
    assert body["total"] == 3 and body["limit"] == 2
    assert body["items"][1]["locked"] is True and body["items"][0]["locked"] is False
    assert "password_hash" not in res.text
    [aggregate] = [c for c in db[models.USERS].calls if c[0] == "aggregate"]
    projection = aggregate[1][0]["$facet"]["items"][-1]["$project"]
    assert "password_hash" not in projection
    assert body["items"][0] == {
        "id": "u-new",
        "email": "n@example.com",
        "full_name": None,
        "location": "eu",
        "created_at": "2026-01-02T00:00:00Z",
        "locked": False,
    }


def test_list_users_skip_and_default_page_size(db, client):
    db[models.USERS] = _users(
        *({"_id": f"u{i}", "created_at": T0 + timedelta(days=i)} for i in range(1, 25))
    )
    default = client.get("/api/v1/admin/users", headers=_auth()).json()
    assert (default["limit"], len(default["items"]), default["total"]) == (20, 20, 25)
    page = client.get("/api/v1/admin/users?skip=22&limit=5", headers=_auth()).json()
    assert [u["id"] for u in page["items"]] == ["u2", "u1", "admin1"]  # newest first


def test_list_users_handles_an_empty_aggregation_result(db, client):
    db[models.USERS] = _Collection([ADMIN], aggregate_result=[])
    assert client.get("/api/v1/admin/users", headers=_auth()).json()["items"] == []


def test_get_user_by_email_resolves_through_email_index(db, client):
    db[models.EMAIL_INDEX] = _Collection(
        [{"_id": "p@example.com", "user_id": "parent1", "location": "eu"}]
    )
    db[models.USERS] = _users({**PARENT, "password_hash": "$2b$secret", "created_at": T0})
    res = client.get("/api/v1/admin/users/by-email/P@Example.com", headers=_auth())
    assert res.status_code == 200
    assert res.json() == {
        "id": "parent1",
        "email": "p@example.com",
        "full_name": None,
        "location": "eu",
        "created_at": "2026-01-01T00:00:00Z",
        "locked": False,
    }
    assert "password_hash" not in res.text
    # Targeted lookup under the user's own location (no scatter-gather), and the
    # hash is never even read from the database.
    query, projection = db[models.USERS].lookups[-1]
    assert query == {"_id": "parent1", "location": "eu"}
    assert "password_hash" not in projection


def test_get_user_by_email_reports_a_locked_account(db, client):
    db[models.EMAIL_INDEX] = _Collection(
        [{"_id": "p@example.com", "user_id": "parent1", "location": "eu"}]
    )
    db[models.USERS] = _users({**PARENT, "is_locked": True})
    res = client.get("/api/v1/admin/users/by-email/p@example.com", headers=_auth())
    assert res.json()["locked"] is True


def test_get_user_by_email_not_in_index_is_404(db, client):
    res = client.get("/api/v1/admin/users/by-email/x@example.com", headers=_auth())
    assert (res.status_code, res.json()["detail"]) == (404, "User not found")


def test_get_user_by_email_orphaned_index_entry_is_404(db, client):
    db[models.EMAIL_INDEX] = _Collection(
        [{"_id": "ghost@example.com", "user_id": "ghost", "location": "us"}]
    )
    res = client.get("/api/v1/admin/users/by-email/ghost@example.com", headers=_auth())
    assert (res.status_code, res.json()["detail"]) == (404, "User not found")


def test_get_user_by_invalid_email_is_422(db, client):
    res = client.get("/api/v1/admin/users/by-email/not-an-email", headers=_auth())
    assert res.status_code == 422


# ── lock / unlock ─────────────────────────────────────────────────────────────


def test_lock_user_revokes_sessions(db, client):
    res = client.patch("/api/v1/admin/users/parent1/lock?location=eu", headers=_auth())
    assert (res.status_code, res.json()) == (200, {"id": "parent1", "locked": True})
    parent = next(d for d in db[models.USERS].docs if d["_id"] == "parent1")
    assert parent["is_locked"] is True
    assert isinstance(parent["tokens_revoked_at"], datetime)
    assert parent["updated_at"] == parent["tokens_revoked_at"]


def test_admin_cannot_lock_themselves(db, client):
    res = client.patch("/api/v1/admin/users/admin1/lock?location=in", headers=_auth())
    assert (res.status_code, res.json()["detail"]) == (400, "Cannot lock your own account")
    assert not any(c[0] == "update_one" for c in db[models.USERS].calls)


@pytest.mark.parametrize("action", ["lock", "unlock"])
def test_lock_and_unlock_unknown_user_or_wrong_location_is_404(db, client, action):
    for path in (f"/users/nobody/{action}?location=eu", f"/users/parent1/{action}?location=us"):
        res = client.patch(f"/api/v1/admin{path}", headers=_auth())
        assert (res.status_code, res.json()["detail"]) == (404, "User not found")


@pytest.mark.parametrize("action", ["lock", "unlock"])
def test_lock_and_unlock_require_location(db, client, action):
    assert client.patch(f"/api/v1/admin/users/parent1/{action}", headers=_auth()).status_code == 422


def test_unlock_user_clears_lock_and_revocation(db, client):
    db[models.USERS] = _users({**PARENT, "is_locked": True, "tokens_revoked_at": T0})
    res = client.patch("/api/v1/admin/users/parent1/unlock?location=eu", headers=_auth())
    assert (res.status_code, res.json()) == (200, {"id": "parent1", "locked": False})
    parent = next(d for d in db[models.USERS].docs if d["_id"] == "parent1")
    # tokens_revoked_at must be cleared too, or refresh keeps failing after unlock.
    assert parent["is_locked"] is False and parent["tokens_revoked_at"] is None


@pytest.mark.parametrize("action", ["lock", "unlock"])
def test_lock_and_unlock_logs_cannot_be_forged(db, client, caplog, action):
    db[models.USERS] = _users({**PARENT, "location": "eu\r\nadmin.users.lock FORGED"})
    with caplog.at_level(logging.INFO, logger="app.routers.admin"):
        res = client.patch(
            f"/api/v1/admin/users/parent1/{action}",
            params={"location": "eu\r\nadmin.users.lock FORGED"},
            headers=_auth(),
        )
    assert res.status_code == 200
    [line] = [r.getMessage() for r in caplog.records if r.name == "app.routers.admin"]
    assert "\n" not in line and "\r" not in line


def test_sanitize_for_log_strips_line_breaks():
    assert _sanitize_for_log("a\r\nb\nc\rd") == "abcd"
