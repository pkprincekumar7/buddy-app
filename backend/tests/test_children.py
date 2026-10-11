"""Routes in app/routers/children.py, driven over HTTP against an in-memory Motor stand-in."""

import copy
import logging
from datetime import UTC, datetime, timedelta

import botocore.exceptions
import pytest
from fastapi.testclient import TestClient

import app.routers.children as children
from app import models
from app.auth_utils import create_access_token
from app.database import get_db
from app.limiter import limiter, user_limiter
from app.main import app
from app.settings import get_settings, settings

# ── an in-memory stand-in for the Motor collections these routes use ─────────


def _get(doc, path):
    for part in path.split("."):
        if not isinstance(doc, dict) or part not in doc:
            return None
        doc = doc[part]
    return doc


def _project(doc, projection):
    """Inclusion projection with dotted paths (as Mongo does); _id always kept."""
    out: dict = {"_id": doc["_id"]}
    for path in projection:
        value = _get(doc, path)
        if value is None and not _has(doc, path):
            continue
        target = out
        *parents, leaf = path.split(".")
        for part in parents:
            target = target.setdefault(part, {})
        target[leaf] = copy.deepcopy(value)
    return out


def _has(doc, path):
    for part in path.split("."):
        if not isinstance(doc, dict) or part not in doc:
            return False
        doc = doc[part]
    return True


class _Cursor:
    def __init__(self, docs, log):
        self.docs, self.log = docs, log

    def sort(self, spec):
        self.log.append(("sort", spec))
        for field, direction in reversed(spec):
            self.docs.sort(key=lambda d: d.get(field) or "", reverse=direction == -1)
        return self

    async def to_list(self, length):
        self.log.append(("to_list", length))
        return self.docs[:length]


class _Collection:
    def __init__(self, name, log):
        self.name, self.log = name, log
        self.docs: list[dict] = []
        self.fail: dict[str, Exception] = {}

    def _call(self, method, *args):
        self.log.append((self.name, method, *args))
        if method in self.fail:
            raise self.fail[method]

    def _matching(self, query):
        return [d for d in self.docs if all(d.get(k) == v for k, v in query.items())]

    def find(self, query, projection):
        self._call("find", query, projection)
        return _Cursor([_project(d, projection) for d in self._matching(query)], self.log)

    async def count_documents(self, query):
        self._call("count_documents", query)
        return len(self._matching(query))

    async def find_one(self, query, projection=None):
        self._call("find_one", query, projection)
        [doc, *_] = self._matching(query) or [None]
        if doc is None:
            return None
        return _project(doc, projection) if projection else copy.deepcopy(doc)

    async def insert_one(self, doc):
        self._call("insert_one", doc)
        self.docs.append(copy.deepcopy(doc))

    @staticmethod
    def _apply(doc, update):
        for op, fields in update.items():
            for k, v in fields.items():
                if op == "$set":
                    doc[k] = v
                elif op == "$unset":
                    doc.pop(k, None)
                elif op == "$addToSet":
                    current = doc.setdefault(k, [])
                    current.extend(x for x in v["$each"] if x not in current)
                else:
                    raise AssertionError(f"unsupported operator {op}")

    async def find_one_and_update(self, query, update, return_document):
        self._call("find_one_and_update", query, update)
        assert return_document is True  # the routes always want the updated doc
        [doc, *_] = self._matching(query) or [None]
        if doc is None:
            return None
        self._apply(doc, update)
        return copy.deepcopy(doc)

    async def update_one(self, query, update):
        self._call("update_one", query, update)
        matched = self._matching(query)[:1]
        for doc in matched:
            self._apply(doc, update)
        return type("Result", (), {"matched_count": len(matched)})()

    async def update_many(self, query, update):
        self._call("update_many", query, update)
        for doc in self._matching(query):
            self._apply(doc, update)


class _Db(dict):
    def __init__(self):
        super().__init__()
        self.log: list[tuple] = []

    def __missing__(self, name):
        self[name] = _Collection(name, self.log)
        return self[name]

    def calls(self, collection, method):
        return [c[2:] for c in self.log if c[:2] == (collection, method)]


PARENT = {"_id": "p1", "location": "eu", "role": "parent", "email": "p@example.com"}
OTHER = {"_id": "p2", "location": "eu", "role": "parent", "email": "o@example.com"}
ADMIN = {"_id": "a1", "location": "eu", "role": "admin", "email": "a@example.com"}
T0 = datetime(2026, 1, 1, tzinfo=UTC)


@pytest.fixture
def db():
    database = _Db()
    database[models.USERS].docs.extend([PARENT, OTHER, ADMIN])
    app.dependency_overrides[get_db] = lambda: database
    limiter.reset()
    user_limiter.reset()
    try:
        yield database
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_settings, None)
        limiter.reset()
        user_limiter.reset()


@pytest.fixture
def client():
    return TestClient(app)


def _auth(user=PARENT):
    return {"Authorization": f"Bearer {create_access_token(user['_id'], user['location'])}"}


def _child(db, _id="c1", *, user=PARENT, **fields):
    doc = {
        "_id": _id,
        "user_id": user["_id"],
        "location": user["location"],
        "is_deleted": False,
        "deleted_at": None,
        "created_at": T0,
        "updated_at": T0,
        "name": "Mia",
        **fields,
    }
    db[models.CHILDREN].docs.append(doc)
    return doc


def _stored(db, _id="c1"):
    return next(d for d in db[models.CHILDREN].docs if d["_id"] == _id)


def _completed_growth_area(db, child_id="c1", user=PARENT):
    db[models.GROWTH_AREAS].docs.append(
        {
            "_id": f"ga-{child_id}",
            "user_id": user["_id"],
            "child_id": child_id,
            "location": user["location"],
            "status": "completed",
        }  # fmt: skip
    )


C = "/api/v1/children"


# ── access control ───────────────────────────────────────────────────────────

ROUTES = [
    ("get", C, None),
    ("post", C, {"name": "Mia"}),
    ("get", f"{C}/c1", None),
    ("patch", f"{C}/c1", {"name": "Zoe"}),
    ("post", f"{C}/c1/progress/onboarding_profile_completed", None),
    ("delete", f"{C}/c1", None),
    ("post", f"{C}/c1/avatar/presign", {"content_type": "image/png"}),
]


@pytest.mark.parametrize(("method", "path", "body"), ROUTES)
def test_every_route_requires_a_token(db, client, method, path, body):
    res = client.request(method, path, json=body)
    assert (res.status_code, res.json()["detail"]) == (401, "Not authenticated")


@pytest.mark.parametrize(("method", "path", "body"), ROUTES)
def test_admins_cannot_use_children_routes(db, client, method, path, body):
    res = client.request(method, path, json=body, headers=_auth(ADMIN))
    assert (res.status_code, res.json()["detail"]) == (403, "Not available for admin accounts")


@pytest.mark.parametrize(("method", "path", "body"), ROUTES[2:])
def test_another_parents_child_is_not_found(db, client, method, path, body):
    _child(db, user=OTHER)  # c1 belongs to p2
    before = dict(_stored(db))
    app.dependency_overrides[get_settings] = lambda: _upload_settings()  # presign gets past 503
    res = client.request(method, path, json=body, headers=_auth())
    assert (res.status_code, res.json()["detail"]) == (404, "Child not found")
    assert _stored(db) == before  # untouched


@pytest.mark.parametrize(
    ("method", "path", "body", "limit"),
    [
        ("get", C, None, 60),
        ("post", C, {"name": "Mia"}, 20),
        ("get", f"{C}/c1", None, 60),
        ("patch", f"{C}/c1", {"name": "Zoe"}, 30),
        ("post", f"{C}/c1/progress/onboarding_profile_completed", None, 30),
        ("delete", f"{C}/c1", None, 10),
        ("post", f"{C}/c1/avatar/presign", {"content_type": "image/png"}, 20),
    ],
)
def test_rate_limits_reject_before_the_user_lookup(db, client, method, path, body, limit):
    for _ in range(limit):
        assert client.request(method, path, json=body, headers=_auth()).status_code != 429
    lookups = len(db.calls(models.USERS, "find_one"))
    res = client.request(method, path, json=body, headers=_auth())
    assert res.status_code == 429
    assert len(db.calls(models.USERS, "find_one")) == lookups  # never reached the DB


# ── GET /children ────────────────────────────────────────────────────────────


def test_list_returns_only_this_parents_live_children_as_light_cards(db, client):
    _child(
        db,
        "c1",
        age=7,
        gender="girl",
        school="Elm",
        avatar_id="capper-girl",
        onboarding_completed=True,
        recommendations={"pathway_overview": "overview", "full": "heavy blob"},
        personality={"view_model": {"profile": {"name": "Explorer"}}, "scores": [1, 2, 3]},
        current_phase="grow",
    )
    _child(db, "deleted", is_deleted=True)
    _child(db, "theirs", user=OTHER)
    _child(db, "elsewhere", user={**PARENT, "location": "us"})
    res = client.get(C, headers=_auth())
    assert res.status_code == 200
    [card] = res.json()
    assert card["id"] == "c1" and card["created_date"] == "2026-01-01T00:00:00+00:00"
    assert (card["name"], card["age"], card["gender"], card["school"]) == ("Mia", 7, "girl", "Elm")
    assert card["avatar_id"] == "capper-girl" and card["onboarding_completed"] is True
    # Heavy sub-documents and current_phase are left out of the card view.
    assert card["personality"] == {"view_model": {"profile": {"name": "Explorer"}}}
    assert card["current_phase"] is None
    [(query, projection)] = db.calls(models.CHILDREN, "find")
    assert query == {"user_id": "p1", "location": "eu", "is_deleted": False}
    assert projection == children._LIST_PROJECTION


def test_list_projection_keeps_what_onboarding_resume_prefills():
    # Onboarding reuses this endpoint to resume the latest child — see the
    # comment on _LIST_PROJECTION. Dropping any of these blanks the resumed form.
    for field in ("name", "age", "gender", "school", "avatar_id", "avatar_url", "created_at"):
        assert children._LIST_PROJECTION.get(field) == 1


@pytest.mark.parametrize(
    ("sort", "spec", "order"),
    [
        (None, [("created_at", -1)], ["new", "mid", "old"]),
        ("-created_date", [("created_at", -1)], ["new", "mid", "old"]),
        ("created_date", [("created_at", 1)], ["old", "mid", "new"]),
        ("name", [("name", 1)], ["mid", "new", "old"]),
        ("-name", [("name", -1)], ["old", "new", "mid"]),
    ],
)
def test_list_sorting(db, client, sort, spec, order):
    _child(db, "old", name="Zed", created_at=T0)
    _child(db, "new", name="Kai", created_at=T0 + timedelta(days=2))
    _child(db, "mid", name="Ada", created_at=T0 + timedelta(days=1))
    params = {"sort": sort} if sort else {}
    res = client.get(C, params=params, headers=_auth())
    assert [c["id"] for c in res.json()] == order
    assert ("sort", spec) in db.log


def test_list_limit(db, client):
    for i in range(3):
        _child(db, f"c{i}")
    assert len(client.get(C, params={"limit": 2}, headers=_auth()).json()) == 2
    assert ("to_list", 50) not in db.log
    client.get(C, headers=_auth())
    assert ("to_list", 50) in db.log  # default page size


@pytest.mark.parametrize("query", ["limit=0", "limit=201", "sort=age"])
def test_list_rejects_bad_parameters(db, client, query):
    assert client.get(f"{C}?{query}", headers=_auth()).status_code == 422


# ── POST /children ───────────────────────────────────────────────────────────


def test_create_stores_the_child_under_the_parent(db, client):
    res = client.post(
        C, json={"name": "Mia", "age": "7 years", "favourite_colour": "teal"}, headers=_auth()
    )
    assert res.status_code == 201
    [doc] = db[models.CHILDREN].docs
    assert (doc["user_id"], doc["location"], doc["is_deleted"], doc["deleted_at"]) == (
        "p1",
        "eu",
        False,
        None,
    )
    assert doc["age"] == 7 and doc["favourite_colour"] == "teal"  # extras pass through
    assert doc["visited_tabs"] == [] and doc["onboarding_phase"] == 0
    assert doc["created_at"] == doc["updated_at"] and doc["created_at"].tzinfo is not None
    assert "school" not in doc  # unset optional fields aren't stored as null
    body = res.json()
    assert body["id"] == doc["_id"] and body["created_date"] == doc["created_at"].isoformat()
    assert body["name"] == "Mia" and body["visited_tabs"] == []


def test_create_ignores_server_controlled_fields(db, client):
    forged = {
        "id": "x", "created_date": "x", "_id": "x", "user_id": "p2", "location": "us",
        "created_at": "x", "updated_at": "x", "is_deleted": True, "deleted_at": "x",
        "onboarding_profile_completed": True, "conversational_onboarding_completed": True,
        "discover_completed": True, "grow_completed": True, "transform_visited": True,
        "release_visited": True, "connect_visited": True,
    }  # fmt: skip
    assert set(forged) == children._CHILD_SYSTEM_FIELDS
    res = client.post(C, json={"name": "Mia", **forged}, headers=_auth())
    assert res.status_code == 201
    [doc] = db[models.CHILDREN].docs
    assert doc["_id"] != "x" and (doc["user_id"], doc["location"]) == ("p1", "eu")
    assert doc["is_deleted"] is False and doc["deleted_at"] is None
    assert isinstance(doc["created_at"], datetime)
    for flag in list(forged)[9:]:
        assert flag not in doc


def test_create_keeps_client_visited_tabs(db, client):
    client.post(C, json={"name": "Mia", "visited_tabs": ["discover"]}, headers=_auth())
    assert db[models.CHILDREN].docs[0]["visited_tabs"] == ["discover"]


def test_create_allows_ten_live_children_per_account(db, client):
    for i in range(9):
        _child(db, f"c{i}")
    _child(db, "gone", is_deleted=True)  # soft-deleted ones don't count
    _child(db, "theirs", user=OTHER)
    assert client.post(C, json={"name": "Tenth"}, headers=_auth()).status_code == 201
    res = client.post(C, json={"name": "Eleventh"}, headers=_auth())
    assert (res.status_code, res.json()["detail"]) == (
        422,
        "Maximum of 10 children allowed per account",
    )
    assert db.calls(models.CHILDREN, "count_documents")[-1] == (
        {"user_id": "p1", "location": "eu", "is_deleted": False},
    )


@pytest.mark.parametrize(
    "body",
    [
        {"avatar_url": "http://x.example/a.png"},
        {"avatar_id": "a", "avatar_url": "https://x.example/a.png"},
        {"$where": "1"},
        {"a.b": 1},
        {"age": "about seven"},
    ],
)
def test_create_validates_the_payload(db, client, body):
    assert client.post(C, json=body, headers=_auth()).status_code == 422
    assert db[models.CHILDREN].docs == []


# ── GET /children/{id} ───────────────────────────────────────────────────────


def test_get_returns_the_full_child(db, client):
    _child(db, personality={"scores": [1, 2]}, current_phase="grow")
    res = client.get(f"{C}/c1", headers=_auth())
    assert res.status_code == 200
    body = res.json()
    assert body["personality"] == {"scores": [1, 2]} and body["current_phase"] == "grow"
    assert body["grow_completed"] is False
    assert db.calls(models.CHILDREN, "find_one") == [
        ({"_id": "c1", "user_id": "p1", "location": "eu", "is_deleted": False}, None)
    ]


def test_get_derives_grow_completed_from_growth_areas_not_the_document(db, client):
    _child(db, grow_completed=True)  # a forged stored flag is ignored
    assert client.get(f"{C}/c1", headers=_auth()).json()["grow_completed"] is False
    db[models.GROWTH_AREAS].docs.append(
        {"_id": "ga0", "user_id": "p1", "child_id": "c1", "location": "eu", "status": "active"}
    )
    assert client.get(f"{C}/c1", headers=_auth()).json()["grow_completed"] is False
    _completed_growth_area(db)
    assert client.get(f"{C}/c1", headers=_auth()).json()["grow_completed"] is True


def test_get_soft_deleted_child_is_404(db, client):
    _child(db, is_deleted=True)
    assert client.get(f"{C}/c1", headers=_auth()).status_code == 404


def test_child_without_created_at_has_an_empty_created_date(db, client):
    _child(db, created_at=None)
    assert client.get(f"{C}/c1", headers=_auth()).json()["created_date"] == ""


# ── PATCH /children/{id} ─────────────────────────────────────────────────────


def _patch(client, body, child_id="c1"):
    return client.patch(f"{C}/{child_id}", json=body, headers=_auth())


def test_patch_updates_fields_and_returns_the_child(db, client):
    _child(db, school="Elm")
    res = _patch(client, {"school": "Oak", "age": "8", "hobbies": ["chess"]})
    assert res.status_code == 200
    doc = _stored(db)
    assert (doc["school"], doc["age"], doc["hobbies"]) == ("Oak", 8, ["chess"])
    assert doc["updated_at"] > T0
    assert res.json()["school"] == "Oak" and res.json()["grow_completed"] is False
    [(query, _)] = db.calls(models.CHILDREN, "find_one_and_update")
    assert query == {"_id": "c1", "user_id": "p1", "location": "eu", "is_deleted": False}


def test_patch_ignores_server_controlled_fields(db, client):
    _child(db)
    forged = dict.fromkeys(children._CHILD_SYSTEM_FIELDS, True)
    forged.update({"location": "us", "user_id": "p2", "_id": "x", "id": "x"})
    assert _patch(client, {**forged, "school": "Oak"}).status_code == 200
    doc = _stored(db)
    assert (doc["_id"], doc["user_id"], doc["location"], doc["is_deleted"]) == (
        "c1",
        "p1",
        "eu",
        False,
    )
    assert doc["school"] == "Oak"
    for flag in ("discover_completed", "transform_visited", "connect_visited"):
        assert flag not in doc


def test_patch_null_name_is_ignored_but_other_nulls_clear(db, client):
    _child(db, school="Elm")
    assert _patch(client, {"name": None, "school": None}).status_code == 200
    assert (_stored(db)["name"], _stored(db)["school"]) == ("Mia", None)


def test_patch_visited_tabs_are_added_never_replaced(db, client):
    _child(db, visited_tabs=["discover"])
    _patch(client, {"visited_tabs": ["grow", "discover"]})
    assert _stored(db)["visited_tabs"] == ["discover", "grow"]
    [(_, update)] = db.calls(models.CHILDREN, "find_one_and_update")
    assert update["$addToSet"] == {"visited_tabs": {"$each": ["grow", "discover"]}}
    assert "visited_tabs" not in update["$set"]


@pytest.mark.parametrize("tabs", [None, []])
def test_patch_null_or_empty_visited_tabs_change_nothing(db, client, tabs):
    _child(db, visited_tabs=["discover"])
    _patch(client, {"visited_tabs": tabs})
    assert _stored(db)["visited_tabs"] == ["discover"]
    [(_, update)] = db.calls(models.CHILDREN, "find_one_and_update")
    assert set(update) == {"$set"}


def test_patch_committing_personality_clears_the_staged_copy(db, client):
    _child(db, pending_personality_vm={"draft": 1})
    res = _patch(client, {"personality": {"final": 1}, "pending_personality_vm": {"draft": 2}})
    assert res.status_code == 200
    assert "pending_personality_vm" not in _stored(db)
    assert _stored(db)["personality"] == {"final": 1}
    [(_, update)] = db.calls(models.CHILDREN, "find_one_and_update")
    # Never in both $set and $unset (Mongo rejects that as conflicting operators).
    assert "pending_personality_vm" not in update["$set"]
    assert update["$unset"] == {"pending_personality_vm": ""}


def test_patch_without_personality_keeps_the_staged_copy(db, client):
    _child(db, pending_personality_vm={"draft": 1})
    _patch(client, {"school": "Oak"})
    assert _stored(db)["pending_personality_vm"] == {"draft": 1}


@pytest.mark.parametrize(("profile_done", "marked"), [(True, True), (False, False), (None, False)])
def test_completing_onboarding_marks_conversational_onboarding(db, client, profile_done, marked):
    fields = {} if profile_done is None else {"onboarding_profile_completed": profile_done}
    _child(db, **fields)
    assert _patch(client, {"onboarding_completed": True}).status_code == 200
    assert _stored(db).get("conversational_onboarding_completed", False) is marked
    assert _stored(db)["onboarding_completed"] is True


def test_onboarding_completed_false_does_not_mark_anything(db, client):
    _child(db, onboarding_profile_completed=True)
    _patch(client, {"onboarding_completed": False})
    assert "conversational_onboarding_completed" not in _stored(db)
    assert db.calls(models.CHILDREN, "find_one") == []  # no extra read


def _pathway_area(db, area_id, *, user=PARENT, child_id="c1"):
    db[models.GROWTH_AREAS].docs.append(
        {
            "_id": area_id,
            "user_id": user["_id"],
            "child_id": child_id,
            "location": user["location"],
            "life_pathway_milestones": {"y1": "copy"},
        }  # fmt: skip
    )


def _milestones(db):
    return {d["_id"]: "life_pathway_milestones" in d for d in db[models.GROWTH_AREAS].docs}


@pytest.mark.parametrize("change", [{"age": 8}, {"gender": "boy"}, {"age": 7, "gender": ""}])
def test_changing_age_or_gender_drops_every_cached_life_pathway(db, client, change):
    _child(db, age=7, gender="girl")
    _pathway_area(db, "a1")
    _pathway_area(db, "a2")
    _pathway_area(db, "sibling", child_id="c2")
    _pathway_area(db, "theirs", user=OTHER)
    assert _patch(client, change).status_code == 200
    assert _milestones(db) == {"a1": False, "a2": False, "sibling": True, "theirs": True}
    # The child write lands before the cache is cleared.
    writes = [c[:2] for c in db.log if c[1] in ("find_one_and_update", "update_many")]
    assert writes == [
        (models.CHILDREN, "find_one_and_update"),
        (models.GROWTH_AREAS, "update_many"),
    ]


@pytest.mark.parametrize("patch", [{"age": 7, "gender": "girl"}, {"school": "Oak"}])
def test_unchanged_or_unrelated_fields_keep_the_life_pathway_cache(db, client, patch):
    _child(db, age=7, gender="girl")
    _pathway_area(db, "a1")
    assert _patch(client, patch).status_code == 200
    assert _milestones(db) == {"a1": True}
    assert db.calls(models.GROWTH_AREAS, "update_many") == []


def test_life_pathway_compares_raw_values_so_new_fields_count_as_changes(db, client):
    _child(db)  # no age stored yet
    _pathway_area(db, "a1")
    _patch(client, {"age": 7})
    assert _milestones(db) == {"a1": False}


def test_pathway_invalidation_failure_still_returns_the_update(db, client, caplog):
    _child(db, age=7)
    db[models.GROWTH_AREAS].fail["update_many"] = RuntimeError("shard down")
    with caplog.at_level(logging.ERROR, logger="app.routers.children"):
        res = _patch(client, {"age": 8})
    assert res.status_code == 200 and res.json()["age"] == 8
    assert _stored(db)["age"] == 8
    assert "life pathway cache invalidation failed child_id=c1" in caplog.text


def test_patch_missing_child_is_404_and_invalidates_nothing(db, client):
    _pathway_area(db, "a1")
    res = _patch(client, {"age": 8, "onboarding_completed": True})
    assert (res.status_code, res.json()["detail"]) == (404, "Child not found")
    assert _milestones(db) == {"a1": True}


def test_patch_soft_deleted_child_is_404(db, client):
    _child(db, is_deleted=True)
    assert _patch(client, {"name": "Zoe"}).status_code == 404
    assert _stored(db)["name"] == "Mia"


def test_patch_rejects_unsafe_payloads(db, client):
    _child(db)
    assert _patch(client, {"avatar_url": "http://x.example/a.png"}).status_code == 422
    assert db.calls(models.CHILDREN, "find_one_and_update") == []


# ── POST /children/{id}/progress/{flag} ──────────────────────────────────────


def _progress(client, flag, child_id="c1"):
    return client.post(f"{C}/{child_id}/progress/{flag}", headers=_auth())


@pytest.mark.parametrize(
    ("flag", "prerequisite"),
    [
        ("onboarding_profile_completed", {}),
        ("discover_completed", {"conversational_onboarding_completed": True}),
        ("release_visited", {"transform_visited": True}),
        ("connect_visited", {"release_visited": True}),
    ],
)
def test_progress_flag_is_set_once_its_prerequisite_is_met(db, client, flag, prerequisite):
    _child(db, **prerequisite)
    res = _progress(client, flag)
    assert res.status_code == 200 and res.json()[flag] is True
    assert _stored(db)[flag] is True and _stored(db)["updated_at"] > T0


@pytest.mark.parametrize(
    ("flag", "detail"),
    [
        ("discover_completed", "Complete onboarding before Discover."),
        ("transform_visited", "Complete a growth area before visiting Transform."),
        ("release_visited", "Visit Transform before Release."),
        ("connect_visited", "Visit Release before Connect."),
    ],
)
def test_progress_flag_is_refused_before_its_prerequisite(db, client, flag, detail):
    _child(db, onboarding_profile_completed=True)
    res = _progress(client, flag)
    assert (res.status_code, res.json()["detail"]) == (403, detail)
    assert flag not in _stored(db)


def test_transform_requires_a_really_completed_growth_area(db, client):
    _child(db, grow_completed=True)  # a stored flag isn't enough
    assert _progress(client, "transform_visited").status_code == 403
    _completed_growth_area(db, child_id="c2")  # another child's doesn't count
    assert _progress(client, "transform_visited").status_code == 403
    _completed_growth_area(db)
    res = _progress(client, "transform_visited")
    assert res.status_code == 200
    assert res.json()["transform_visited"] is True and res.json()["grow_completed"] is True


@pytest.mark.parametrize("flag", ["grow_completed", "conversational_onboarding_completed", "x"])
def test_flags_outside_the_chain_cannot_be_set(db, client, flag):
    _child(db)
    assert _progress(client, flag).status_code == 422
    assert flag not in _stored(db)


def test_progress_on_a_missing_or_deleted_child_is_404(db, client):
    _child(db, is_deleted=True)
    res = _progress(client, "onboarding_profile_completed")
    assert (res.status_code, res.json()["detail"]) == (404, "Child not found")


def test_progress_child_deleted_between_check_and_write_is_404(db, client, monkeypatch):
    _child(db)

    async def vanished(*args, **kwargs):
        return None

    monkeypatch.setattr(db[models.CHILDREN], "find_one_and_update", vanished)
    res = _progress(client, "onboarding_profile_completed")
    assert (res.status_code, res.json()["detail"]) == (404, "Child not found")


# ── DELETE /children/{id} ────────────────────────────────────────────────────


def test_delete_soft_deletes_the_child(db, client):
    _child(db)
    _completed_growth_area(db)
    res = client.delete(f"{C}/c1", headers=_auth())
    assert res.status_code == 204 and res.content == b""
    doc = _stored(db)
    assert doc["is_deleted"] is True
    assert doc["deleted_at"] == doc["updated_at"] and doc["deleted_at"] > T0
    assert len(db[models.GROWTH_AREAS].docs) == 1  # related data kept for the retention window
    assert client.get(C, headers=_auth()).json() == []


def test_delete_twice_is_404(db, client):
    _child(db)
    assert client.delete(f"{C}/c1", headers=_auth()).status_code == 204
    deleted_at = _stored(db)["deleted_at"]
    res = client.delete(f"{C}/c1", headers=_auth())
    assert (res.status_code, res.json()["detail"]) == (404, "Child not found")
    assert _stored(db)["deleted_at"] == deleted_at  # retention clock not reset


# ── POST /children/{id}/avatar/presign ───────────────────────────────────────


def _upload_settings(**overrides):
    values = {"uploads_bucket_name": "buddy-uploads", "aws_region": "eu-west-1",
              "uploads_cdn_domain": "", **overrides}  # fmt: skip
    return settings.model_copy(update=values)


class _S3:
    def __init__(self, error=None):
        self.error, self.calls = error, []

    def generate_presigned_url(self, method, Params, ExpiresIn):  # noqa: N803 — boto3's names
        self.calls.append((method, Params, ExpiresIn))
        if self.error:
            raise self.error
        return f"https://signed.example/{Params['Key']}?sig=1"


@pytest.fixture
def s3(monkeypatch):
    fake, regions = _S3(), []

    def get_client(region):
        regions.append(region)
        return fake

    monkeypatch.setattr(children, "get_s3_client", get_client)
    fake.regions = regions
    return fake


def _presign(client, content_type="image/png", child_id="c1"):
    return client.post(
        f"{C}/{child_id}/avatar/presign", json={"content_type": content_type}, headers=_auth()
    )


@pytest.mark.parametrize(
    ("content_type", "ext"),
    [("image/jpeg", "jpg"), ("image/png", "png"), ("image/webp", "webp"), ("image/gif", "gif")],
)
def test_presign_returns_a_short_lived_put_url_under_the_childs_prefix(
    db, client, s3, content_type, ext
):
    _child(db)
    app.dependency_overrides[get_settings] = lambda: _upload_settings()
    res = _presign(client, content_type)
    assert res.status_code == 200
    [(method, params, expires)] = s3.calls
    assert (method, expires) == ("put_object", 300)
    assert params["Bucket"] == "buddy-uploads" and params["ContentType"] == content_type
    assert params["Key"].startswith("uploads/eu/c1/") and params["Key"].endswith(f".{ext}")
    assert s3.regions == ["eu-west-1"]
    assert res.json() == {
        "upload_url": f"https://signed.example/{params['Key']}?sig=1",
        "avatar_url": f"https://buddy-uploads.s3.eu-west-1.amazonaws.com/{params['Key']}",
    }


def test_presign_uses_the_cdn_domain_when_configured(db, client, s3):
    _child(db)
    app.dependency_overrides[get_settings] = lambda: _upload_settings(
        uploads_cdn_domain="cdn.example.com"
    )
    res = _presign(client)
    key = s3.calls[0][1]["Key"]
    assert res.json()["avatar_url"] == f"https://cdn.example.com/{key}"


def test_presign_keys_are_unique_per_upload(db, client, s3):
    _child(db)
    app.dependency_overrides[get_settings] = lambda: _upload_settings()
    _presign(client)
    _presign(client)
    assert s3.calls[0][1]["Key"] != s3.calls[1][1]["Key"]


@pytest.mark.parametrize("overrides", [{"uploads_bucket_name": ""}, {"aws_region": ""}])
def test_presign_without_upload_configuration_is_503(db, client, s3, overrides):
    _child(db)
    app.dependency_overrides[get_settings] = lambda: _upload_settings(**overrides)
    res = _presign(client)
    assert res.status_code == 503
    assert "UPLOADS_BUCKET_NAME / AWS_REGION not set" in res.json()["detail"]
    assert s3.calls == []


@pytest.mark.parametrize("content_type", ["image/svg+xml", "text/html", "IMAGE/PNG"])
def test_presign_rejects_non_allowlisted_types(db, client, s3, content_type):
    _child(db)
    app.dependency_overrides[get_settings] = lambda: _upload_settings()
    res = _presign(client, content_type)
    assert (res.status_code, res.json()["detail"]) == (
        415,
        "Unsupported image type. Allowed: image/gif, image/jpeg, image/png, image/webp",
    )
    assert s3.calls == []


def test_presign_for_a_deleted_child_is_404(db, client, s3):
    _child(db, is_deleted=True)
    app.dependency_overrides[get_settings] = lambda: _upload_settings()
    assert _presign(client).status_code == 404
    assert s3.calls == []


@pytest.mark.parametrize(
    "error",
    [
        botocore.exceptions.NoCredentialsError(),
        botocore.exceptions.ClientError({"Error": {"Code": "AccessDenied"}}, "PutObject"),
    ],
)
def test_presign_s3_failure_is_a_generic_502(db, client, s3, caplog, error):
    _child(db)
    s3.error = error
    app.dependency_overrides[get_settings] = lambda: _upload_settings()
    with caplog.at_level(logging.WARNING, logger="app.routers.children"):
        res = _presign(client)
    assert (res.status_code, res.json()["detail"]) == (
        502,
        "Failed to generate upload URL. Please try again.",
    )
    assert "avatar.presign.s3_error child=c1" in caplog.text


def test_presign_content_type_length_is_bounded(db, client, s3):
    _child(db)
    app.dependency_overrides[get_settings] = lambda: _upload_settings()
    assert _presign(client, "image/" + "x" * 100).status_code == 422
