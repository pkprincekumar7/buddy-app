"""Routes in app/routers/users.py, driven over HTTP against an in-memory Motor stand-in
that applies $set / $setOnInsert / $unset and upserts the way MongoDB does."""

import copy
import logging
from datetime import UTC, datetime, timedelta

import botocore.exceptions
import pytest
from fastapi.testclient import TestClient

import app.routers.users as users_router
from app import models
from app.auth_utils import create_access_token
from app.database import get_db
from app.limiter import user_limiter
from app.main import app
from app.settings import get_settings, settings

# ── an in-memory stand-in for the Motor collections these routes use ─────────


class _Cursor:
    def __init__(self, docs, log):
        self.docs, self.log = docs, log

    def sort(self, field, direction):
        self.log.append(("sort", field, direction))
        self.docs.sort(key=lambda d: d[field], reverse=direction == -1)
        return self

    def skip(self, n):
        self.log.append(("skip", n))
        self.docs = self.docs[n:]
        return self

    async def to_list(self, length):
        self.log.append(("to_list", length))
        return self.docs[:length]


def _set_path(doc, path, value):
    *parents, leaf = path.split(".")
    for part in parents:
        doc = doc.setdefault(part, {})
    doc[leaf] = value


class _Collection:
    def __init__(self, name, log):
        self.name, self.log = name, log
        self.docs: list[dict] = []

    def _call(self, method, *args):
        self.log.append((self.name, method, *args))

    def _matching(self, query):
        return [d for d in self.docs if all(d.get(k) == v for k, v in query.items())]

    def find(self, query):
        self._call("find", query)
        return _Cursor([copy.deepcopy(d) for d in self._matching(query)], self.log)

    async def find_one(self, query, projection=None):
        self._call("find_one", query)
        found = self._matching(query)
        return copy.deepcopy(found[0]) if found else None

    def _upsert(self, query, update, upsert):
        paths = [p for op in update.values() for p in op]
        assert len(paths) == len(set(paths)), f"conflicting update paths: {update}"
        found = self._matching(query)
        if found:
            doc = found[0]
        elif upsert:
            doc = {**query, **update.get("$setOnInsert", {})}
            self.docs.append(doc)
        else:
            return None
        for path, value in update.get("$set", {}).items():
            _set_path(doc, path, value)
        for path in update.get("$unset", {}):
            doc.pop(path, None)
        return doc

    async def find_one_and_update(self, query, update, upsert=False, return_document=False):
        self._call("find_one_and_update", query, update)
        assert return_document is True
        doc = self._upsert(query, update, upsert)
        return copy.deepcopy(doc) if doc else None

    async def update_one(self, query, update, upsert=False):
        self._call("update_one", query, update)
        self._upsert(query, update, upsert)

    async def delete_many(self, query):
        self._call("delete_many", query)
        self.docs = [d for d in self.docs if d not in self._matching(query)]


class _Db(dict):
    def __init__(self):
        super().__init__()
        self.log: list[tuple] = []

    def __missing__(self, name):
        self[name] = _Collection(name, self.log)
        return self[name]

    def calls(self, collection, method):
        return [c[2:] for c in self.log if c[:2] == (collection, method)]


PARENT = {"_id": "p1", "location": "eu", "role": "parent"}
OTHER = {"_id": "p2", "location": "eu", "role": "parent"}
ADMIN = {"_id": "a1", "location": "eu", "role": "admin"}
T0 = datetime(2026, 1, 1, tzinfo=UTC)


@pytest.fixture
def db():
    database = _Db()
    database[models.USERS].docs.extend(copy.deepcopy([PARENT, OTHER, ADMIN]))
    app.dependency_overrides[get_db] = lambda: database
    user_limiter.reset()
    try:
        yield database
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_settings, None)
        user_limiter.reset()


@pytest.fixture
def client():
    return TestClient(app)


def _auth(user=PARENT):
    return {"Authorization": f"Bearer {create_access_token(user['_id'], user['location'])}"}


def _child(db, _id="c1", *, user=PARENT, **fields):
    db[models.CHILDREN].docs.append(
        {
            "_id": _id,
            "user_id": user["_id"],
            "location": user["location"],
            "is_deleted": False,
            **fields,
        }  # fmt: skip
    )


def _user(db, _id="p1"):
    return next(u for u in db[models.USERS].docs if u["_id"] == _id)


GA = "/api/v1/user/completed-growth-areas"
OBS = "/api/v1/user/observations"
PLAN = "/api/v1/user/ninety-day-plan"
PREFS = "/api/v1/user/preferences"
PRESIGN = "/api/v1/user/ninety-day-plan/photo-presign"


# ── access control and rate limits ───────────────────────────────────────────

PARENT_ROUTES = [
    ("get", f"{GA}?child_id=c1", None, 60),
    ("post", f"{GA}?child_id=c1", {"area_id": "focus", "area_name": "Focus"}, 60),
    ("delete", f"{GA}?child_id=c1", None, 10),
    ("get", f"{OBS}?child_id=c1", None, 60),
    ("patch", f"{OBS}?child_id=c1", {"span": "2w"}, 20),
    ("get", f"{PLAN}?child_id=c1", None, 60),
    ("patch", f"{PLAN}?child_id=c1", {"ask": "x"}, 60),
    ("post", f"{PRESIGN}?child_id=c1", {"field_key": "ideas", "content_type": "image/png"}, 20),
]
ALL_ROUTES = [*PARENT_ROUTES, ("get", PREFS, None, 60), ("patch", PREFS, {"dark_mode": False}, 30)]


@pytest.mark.parametrize(("method", "path", "body", "_limit"), ALL_ROUTES)
def test_every_route_requires_a_token(db, client, method, path, body, _limit):
    res = client.request(method, path, json=body)
    assert (res.status_code, res.json()["detail"]) == (401, "Not authenticated")


@pytest.mark.parametrize(("method", "path", "body", "_limit"), PARENT_ROUTES)
def test_admins_cannot_use_child_data_routes(db, client, method, path, body, _limit):
    res = client.request(method, path, json=body, headers=_auth(ADMIN))
    assert (res.status_code, res.json()["detail"]) == (403, "Not available for admin accounts")


@pytest.mark.parametrize(("method", "path", "body", "limit"), ALL_ROUTES)
def test_rate_limits_reject_before_the_user_lookup(db, client, method, path, body, limit):
    for _ in range(limit):
        assert client.request(method, path, json=body, headers=_auth()).status_code != 429
    lookups = len(db.calls(models.USERS, "find_one"))
    assert client.request(method, path, json=body, headers=_auth()).status_code == 429
    assert len(db.calls(models.USERS, "find_one")) == lookups


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("post", f"{GA}?child_id=c1", {"area_id": "focus", "area_name": "Focus"}),
        ("delete", f"{GA}?child_id=c1", None),
        ("patch", f"{OBS}?child_id=c1", {"span": "2w"}),
        ("patch", f"{PLAN}?child_id=c1", {"ask": "x"}),
        ("post", f"{PRESIGN}?child_id=c1", {"field_key": "ideas", "content_type": "image/png"}),
    ],
)
@pytest.mark.parametrize(
    ("owner", "deleted"),
    [(OTHER, False), ({**PARENT, "location": "us"}, False), (PARENT, True)],
    ids=["other-parent", "other-location", "soft-deleted"],
)
def test_writes_require_this_parents_live_child(db, client, method, path, body, owner, deleted):
    _child(db, user=owner, is_deleted=deleted, discover_completed=True, transform_visited=True)
    app.dependency_overrides[get_settings] = lambda: _upload_settings()
    res = client.request(method, path, json=body, headers=_auth())
    assert (res.status_code, res.json()["detail"]) == (404, "Child not found")
    for collection in (models.GROWTH_AREAS, models.OBSERVATIONS, models.NINETY_DAY_PLANS):
        assert db[collection].docs == []


# ── preferences ──────────────────────────────────────────────────────────────


def test_preferences_default_when_unset(db, client):
    res = client.get(PREFS, headers=_auth())
    assert res.json() == {"tts_enabled": True, "dark_mode": True, "last_visited_path": None}


def test_preferences_are_read_from_the_user(db, client):
    _user(db)["preferences"] = {"tts_enabled": False, "last_visited_path": "/children/c1"}
    res = client.get(PREFS, headers=_auth())
    assert res.json() == {
        "tts_enabled": False,
        "dark_mode": True,
        "last_visited_path": "/children/c1",
    }


def test_admins_have_preferences_too(db, client):
    assert client.get(PREFS, headers=_auth(ADMIN)).status_code == 200
    assert client.patch(PREFS, json={"dark_mode": False}, headers=_auth(ADMIN)).status_code == 200
    assert _user(db, "a1")["preferences"] == {"dark_mode": False}


def test_patch_preferences_only_touches_the_sent_fields(db, client):
    _user(db)["preferences"] = {"tts_enabled": False, "dark_mode": False, "last_visited_path": "/a"}
    res = client.patch(PREFS, json={"dark_mode": True}, headers=_auth())
    assert res.json() == {"tts_enabled": False, "dark_mode": True, "last_visited_path": "/a"}
    assert _user(db)["updated_at"] > T0
    [(query, update)] = db.calls(models.USERS, "find_one_and_update")
    assert query == {"_id": "p1", "location": "eu"}
    assert set(update["$set"]) == {"updated_at", "preferences.dark_mode"}


def test_patch_preferences_can_set_and_clear_every_field(db, client):
    body = {"tts_enabled": False, "dark_mode": False, "last_visited_path": "/grow?tab=1"}
    assert client.patch(PREFS, json=body, headers=_auth()).json() == body
    res = client.patch(PREFS, json={"last_visited_path": None}, headers=_auth())
    assert res.json()["last_visited_path"] is None  # explicit null clears it
    assert _user(db)["preferences"]["last_visited_path"] is None


def test_patch_preferences_falls_back_to_the_loaded_user_if_it_vanished(db, client, monkeypatch):
    async def gone(*args, **kwargs):
        return None

    monkeypatch.setattr(db[models.USERS], "find_one_and_update", gone)
    res = client.patch(PREFS, json={"dark_mode": False}, headers=_auth())
    assert res.status_code == 200 and res.json()["dark_mode"] is True


@pytest.mark.parametrize(
    "path",
    [
        "//evil.example/x",
        "https://evil.example",
        "javascript:alert(1)",
        "relative/path",
        "/a\\b",
        "/a\nb",
        '/a"onload',
        "/<script>",
        "/" + "a" * 500,
    ],  # fmt: skip
)
def test_last_visited_path_must_be_a_safe_relative_path(db, client, path):
    res = client.patch(PREFS, json={"last_visited_path": path}, headers=_auth())
    assert res.status_code == 422
    assert "preferences" not in _user(db)


# ── completed growth areas ───────────────────────────────────────────────────


def _area(db, area_id, *, child_id="c1", user=PARENT, created_at=T0, **fields):
    db[models.GROWTH_AREAS].docs.append(
        {
            "_id": f"ga-{area_id}-{child_id}-{user['_id']}",
            "user_id": user["_id"],
            "child_id": child_id,
            "location": user["location"],
            "area_id": area_id,
            "area_name": area_id.title(),
            "created_at": created_at,
            **fields,
        }  # fmt: skip
    )


def _areas(db, child_id="c1"):
    return {d["area_id"]: d for d in db[models.GROWTH_AREAS].docs if d["child_id"] == child_id}


def test_list_growth_areas_oldest_first_scoped_to_this_parent(db, client):
    _area(db, "second", created_at=T0 + timedelta(days=1))
    _area(db, "first", created_at=T0)
    _area(db, "sibling", child_id="c2")
    _area(db, "theirs", user=OTHER)
    _area(db, "elsewhere", user={**PARENT, "location": "us"})
    res = client.get(f"{GA}?child_id=c1", headers=_auth())
    assert [a["area_id"] for a in res.json()["areas"]] == ["first", "second"]
    assert db.calls(models.GROWTH_AREAS, "find") == [
        ({"user_id": "p1", "child_id": "c1", "location": "eu"},)
    ]
    assert ("sort", "created_at", 1) in db.log


def test_list_growth_areas_pagination(db, client):
    for i in range(4):
        _area(db, f"a{i}", created_at=T0 + timedelta(days=i))
    res = client.get(f"{GA}?child_id=c1&offset=1&limit=2", headers=_auth())
    assert [a["area_id"] for a in res.json()["areas"]] == ["a1", "a2"]
    client.get(f"{GA}?child_id=c1", headers=_auth())
    assert ("skip", 0) in db.log and ("to_list", 50) in db.log  # defaults


@pytest.mark.parametrize("query", ["", "child_id=", "child_id=c1&limit=0", "child_id=c1&limit=201",
                                   "child_id=c1&offset=-1"])  # fmt: skip
def test_list_growth_areas_validates_parameters(db, client, query):
    assert client.get(f"{GA}?{query}", headers=_auth()).status_code == 422


def test_list_growth_areas_unknown_child_is_an_empty_list(db, client):
    assert client.get(f"{GA}?child_id=nope", headers=_auth()).json() == {"areas": []}


def test_list_returns_every_stored_field_including_worker_written_ones(db, client):
    worker_fields = {
        "pending_recommendations": {"r": 1},
        "pending_child_activity": {"a": 1},
        "parent_questions": {"q": [1]},
        "child_rounds": {"rounds": [1]},
        "life_pathway_milestones": {"y1": "copy"},
    }
    wizard = {
        "answers": {"q1": "yes"}, "recommendations": ["read"],
        "status": "in_progress", "step": "quiz", "selected_activity": {"id": 1},
        "parent_liked": True, "want_child_activity": False, "feedback": "good",
        "interactive_step": 2, "interactive_answers": {"a": 1}, "interactive_draft": {"d": 1},
        "generated_activity": {"g": 1}, "show_game": True, "child_activity_selections": ["x"],
        "ai_three_month_recommendations": ["m1"],
        "child_activity": {"selections": ["s"], "results": {"summary": "ok"}},
    }  # fmt: skip
    _area(db, "focus", **worker_fields, **wizard)
    [area] = client.get(f"{GA}?child_id=c1", headers=_auth()).json()["areas"]
    for key, value in {**worker_fields, **wizard}.items():
        if key != "child_activity":
            assert area[key] == value, key
    assert area["child_activity"] == {
        "selections": ["s"],
        "results": {"summary": "ok", "strengths": [], "suggested_activities": []},
    }


def test_list_defaults_missing_answers_and_activity(db, client):
    _area(db, "legacy")  # an old document with only the required fields
    [area] = client.get(f"{GA}?child_id=c1", headers=_auth()).json()["areas"]
    assert area["answers"] == {} and area["child_activity"] is None and area["status"] is None


def _save_area(client, child_id="c1", **body):
    return client.post(f"{GA}?child_id={child_id}", json={"area_id": "focus",
                       "area_name": "Focus", **body}, headers=_auth())  # fmt: skip


def test_saving_a_growth_area_requires_discover(db, client):
    _child(db)
    res = _save_area(client)
    assert (res.status_code, res.json()["detail"]) == (
        403,
        "Complete Discover before starting a growth area.",
    )
    assert db[models.GROWTH_AREAS].docs == []


def test_saving_a_new_growth_area_creates_it(db, client):
    _child(db, discover_completed=True)
    res = _save_area(client, answers={"q1": "often"}, status="in_progress", step="quiz",
                     child_activity={"selections": ["draw"]})  # fmt: skip
    assert res.status_code == 204 and res.content == b""
    [doc] = db[models.GROWTH_AREAS].docs
    assert (doc["user_id"], doc["child_id"], doc["location"], doc["area_id"]) == (
        "p1",
        "c1",
        "eu",
        "focus",
    )
    assert doc["_id"] != "focus" and doc["created_at"] == doc["updated_at"]
    assert doc["answers"] == {"q1": "often"} and doc["step"] == "quiz"
    assert doc["child_activity"] == {"selections": ["draw"], "results": None}
    assert "feedback" not in doc and "recommendations" not in doc  # unsent → not written


def test_saving_again_updates_the_same_document_without_nulling_unsent_fields(db, client):
    _child(db, discover_completed=True)
    _save_area(client, feedback="lovely", recommendations=["read"], parent_questions={"x": 1})
    [doc] = db[models.GROWTH_AREAS].docs
    first_id, created = doc["_id"], doc["created_at"]
    doc["parent_questions"] = {"q": "worker-written"}
    assert _save_area(client, area_name="Focus & attention", show_game=True).status_code == 204
    [doc] = db[models.GROWTH_AREAS].docs
    assert (doc["_id"], doc["created_at"]) == (first_id, created)  # $setOnInsert only once
    assert doc["area_name"] == "Focus & attention" and doc["show_game"] is True
    assert doc["feedback"] == "lovely" and doc["recommendations"] == ["read"]
    assert doc["parent_questions"] == {"q": "worker-written"}  # clients can't write these


def test_area_color_from_older_clients_is_ignored_not_rejected(db, client):
    # The field was removed; an older app build that still sends it must keep working.
    _child(db, discover_completed=True)
    assert _save_area(client, area_color="#fff").status_code == 204
    assert "area_color" not in db[models.GROWTH_AREAS].docs[0]
    [area] = client.get(f"{GA}?child_id=c1", headers=_auth()).json()["areas"]
    assert "area_color" not in area


def test_explicit_nulls_on_optional_fields_are_written(db, client):
    _child(db, discover_completed=True)
    _save_area(client, feedback="lovely")
    _save_area(client, feedback=None)
    assert db[models.GROWTH_AREAS].docs[0]["feedback"] is None


def test_completing_an_area_drops_wizard_and_staging_state(db, client):
    _child(db, discover_completed=True)
    _area(db, "focus", pending_child_activity={"a": 1}, pending_recommendations={"r": 1},
          interactive_draft={"d": 1}, step="quiz", selected_activity={"keep": True})  # fmt: skip
    res = _save_area(client, status="completed", step="done", interactive_step=3,
                     ai_three_month_recommendations=["m"])  # fmt: skip
    assert res.status_code == 204
    doc = _areas(db)["focus"]
    for transient in ("pending_child_activity", "pending_recommendations", "child_activity_selections",
                      "interactive_step", "interactive_answers", "interactive_draft", "step"):  # fmt: skip
        assert transient not in doc, transient
    assert doc["status"] == "completed" and doc["ai_three_month_recommendations"] == ["m"]
    assert doc["selected_activity"] == {"keep": True}
    [(_, update)] = db.calls(models.GROWTH_AREAS, "update_one")
    assert "step" not in update["$set"]  # never in both $set and $unset


def test_completed_area_unlocks_transform(db, client):
    _child(db, discover_completed=True)
    _save_area(client, status="completed")
    res = client.post("/api/v1/children/c1/progress/transform_visited", headers=_auth())
    assert res.status_code == 200 and res.json()["grow_completed"] is True


@pytest.mark.parametrize(
    "body",
    [
        {"area_name": "x" * 101},
        {"answers": {"q": "x" * 1001}},
        {"answers": {f"q{i}": "x" for i in range(101)}},
        {"recommendations": ["r"] * 51},
        {"generated_activity": {"blob": "x" * 70_000}},
        {"child_activity": {"selections": ["s"] * 51}},
    ],
)
def test_invalid_growth_areas_are_422(db, client, body):
    _child(db, discover_completed=True)
    assert _save_area(client, **body).status_code == 422
    assert db[models.GROWTH_AREAS].docs == []


def test_clearing_growth_areas_only_removes_this_childs(db, client):
    _child(db)
    _area(db, "a")
    _area(db, "b")
    _area(db, "sibling", child_id="c2")
    _area(db, "theirs", user=OTHER)
    res = client.delete(f"{GA}?child_id=c1", headers=_auth())
    assert res.status_code == 204
    assert sorted(d["area_id"] for d in db[models.GROWTH_AREAS].docs) == ["sibling", "theirs"]


# ── observations ─────────────────────────────────────────────────────────────


def _obs(db, child_id="c1", user=PARENT, **fields):
    db[models.OBSERVATIONS].docs.append(
        {"_id": child_id, "user_id": user["_id"], "location": user["location"], **fields}
    )


EMPTY_OBS = {"source": None, "items": [], "watching": [], "span": None, "started_at": None,
             "pending_observations": None}  # fmt: skip


def test_observations_default_to_empty(db, client):
    assert client.get(f"{OBS}?child_id=c1", headers=_auth()).json() == EMPTY_OBS


def test_observations_are_read_for_this_parents_child_only(db, client):
    _obs(db, user=OTHER, source="theirs")
    assert client.get(f"{OBS}?child_id=c1", headers=_auth()).json() == EMPTY_OBS
    _obs(db, source="onboarding", items=[{"id": "o1"}], watching=["o1"], span="2w",
         started_at="2026-01-01", pending_observations={"items": []})  # fmt: skip
    assert client.get(f"{OBS}?child_id=c1", headers=_auth()).json() == {
        "source": "onboarding",
        "items": [{"id": "o1"}],
        "watching": ["o1"],
        "span": "2w",
        "started_at": "2026-01-01",
        "pending_observations": {"items": []},
    }


def test_malformed_stored_observations_are_coerced_not_500(db, client):
    _obs(db, items=[{"id": i} for i in range(12)], watching=["a", 7, None, "b"])
    body = client.get(f"{OBS}?child_id=c1", headers=_auth()).json()
    assert len(body["items"]) == 8  # truncated to the cap
    assert body["watching"] == ["a", "b"]  # non-strings dropped
    db[models.OBSERVATIONS].docs[0]["watching"] = "o1"  # not even a list
    assert client.get(f"{OBS}?child_id=c1", headers=_auth()).json()["watching"] == []


def _patch_obs(client, **body):
    return client.patch(f"{OBS}?child_id=c1", json=body, headers=_auth())


def test_observations_require_transform(db, client):
    _child(db)
    res = _patch_obs(client, span="2w")
    assert (res.status_code, res.json()["detail"]) == (
        403,
        "Visit Transform (Life Pathway) before recording Observations.",
    )
    assert db[models.OBSERVATIONS].docs == []


def test_first_observations_patch_creates_the_document(db, client):
    _child(db, transform_visited=True)
    res = _patch_obs(client, source="onboarding", items=[{"id": "o1"}], watching=["o1"])
    assert res.json() == {**EMPTY_OBS, "source": "onboarding", "items": [{"id": "o1"}],
                          "watching": ["o1"]}  # fmt: skip
    [doc] = db[models.OBSERVATIONS].docs
    assert (doc["_id"], doc["user_id"], doc["location"]) == ("c1", "p1", "eu")
    assert doc["created_at"] == doc["updated_at"]


def test_observations_patch_only_changes_sent_non_null_fields(db, client):
    _child(db, transform_visited=True)
    _obs(db, source="onboarding", items=[{"id": "o1"}], span="2w", created_at=T0)
    res = _patch_obs(client, watching=["o1"], span=None, items=None)
    assert res.json()["items"] == [{"id": "o1"}] and res.json()["span"] == "2w"
    doc = db[models.OBSERVATIONS].docs[0]
    assert doc["watching"] == ["o1"] and doc["created_at"] == T0


def test_committing_items_clears_the_staged_set(db, client):
    _child(db, transform_visited=True)
    _obs(db, pending_observations={"items": [{"id": "o1"}]})
    _patch_obs(client, watching=["o1"])
    assert "pending_observations" in db[models.OBSERVATIONS].docs[0]  # not yet promoted
    _patch_obs(client, items=[{"id": "o1"}])
    assert "pending_observations" not in db[models.OBSERVATIONS].docs[0]


def test_observations_patch_response_when_the_upsert_returns_nothing(db, client, monkeypatch):
    _child(db, transform_visited=True)

    async def nothing(*args, **kwargs):
        return None

    monkeypatch.setattr(db[models.OBSERVATIONS], "find_one_and_update", nothing)
    assert _patch_obs(client, span="2w").json() == EMPTY_OBS


@pytest.mark.parametrize(
    "body",
    [
        {"items": [{}] * 9},
        {"watching": ["w"] * 9},
        {"watching": ["x" * 101]},
        {"items": [{"blob": "x" * 70_000}]},
        {"source": "x" * 51},
    ],
)
def test_invalid_observations_are_422(db, client, body):
    _child(db, transform_visited=True)
    assert _patch_obs(client, **body).status_code == 422
    assert db[models.OBSERVATIONS].docs == []


# ── 90-day plan ──────────────────────────────────────────────────────────────

EMPTY_PLAN = {
    "ask": None, "plan": None, "track_steps": None, "applied": {}, "act_inputs": {},
    "act_counts": {}, "feedback": {}, "event_name": None, "event_date": None, "event_set": False,
    "track_done": {}, "track_inputs": {}, "track_sittings": {}, "photos": {},
}  # fmt: skip


def _plan(db, child_id="c1", user=PARENT, **fields):
    db[models.NINETY_DAY_PLANS].docs.append(
        {"_id": child_id, "user_id": user["_id"], "location": user["location"], **fields}
    )


def test_plan_defaults_to_empty_and_is_scoped_to_this_parent(db, client):
    _plan(db, user=OTHER, ask="theirs")
    assert client.get(f"{PLAN}?child_id=c1", headers=_auth()).json() == EMPTY_PLAN


def test_plan_returns_every_field(db, client):
    stored = {
        "ask": "patience", "plan": {"months": [1]}, "track_steps": {"steps": [1]},
        "applied": {"a": True}, "act_inputs": {"a": "x"}, "act_counts": {"a": 2},
        "feedback": {"a": {"tag": "fun"}}, "event_name": "Recital", "event_date": "2026-06-01",
        "event_set": True, "track_done": {"s1": True}, "track_inputs": {"s1": "x"},
        "track_sittings": {"s1": False}, "photos": {"ideas": ["https://cdn/x.png"]},
    }  # fmt: skip
    _plan(db, **stored)
    assert client.get(f"{PLAN}?child_id=c1", headers=_auth()).json() == stored


def _patch_plan(client, **body):
    return client.patch(f"{PLAN}?child_id=c1", json=body, headers=_auth())


def test_plan_requires_transform(db, client):
    _child(db)
    res = _patch_plan(client, ask="x")
    assert (res.status_code, res.json()["detail"]) == (
        403,
        "Visit Transform (Life Pathway) before starting the 90-day plan.",
    )


def test_plan_patch_creates_then_updates_only_sent_fields(db, client):
    _child(db, transform_visited=True)
    res = _patch_plan(client, ask="patience", applied={"a": True})
    assert res.json() == {**EMPTY_PLAN, "ask": "patience", "applied": {"a": True}}
    [doc] = db[models.NINETY_DAY_PLANS].docs
    assert (doc["_id"], doc["user_id"], doc["location"]) == ("c1", "p1", "eu")
    created = doc["created_at"]
    doc["plan"] = {"months": [1]}  # worker-written
    res = _patch_plan(client, event_name="Recital", event_set=True, ask=None)
    body = res.json()
    assert (body["ask"], body["applied"], body["plan"]) == (
        "patience",
        {"a": True},
        {"months": [1]},
    )
    assert (body["event_name"], body["event_set"]) == ("Recital", True)
    assert db[models.NINETY_DAY_PLANS].docs[0]["created_at"] == created


def test_plan_patch_cannot_write_worker_fields(db, client):
    _child(db, transform_visited=True)
    _plan(db, plan={"months": [1]}, track_steps={"steps": [1]})
    _patch_plan(client, plan={"forged": 1}, track_steps={"forged": 1}, user_id="p2")
    doc = db[models.NINETY_DAY_PLANS].docs[0]
    assert doc["plan"] == {"months": [1]} and doc["track_steps"] == {"steps": [1]}
    assert doc["user_id"] == "p1"


def test_retargeting_the_event_clears_the_old_tracker(db, client):
    _child(db, transform_visited=True)
    _plan(db, track_steps={"steps": [1]})
    _patch_plan(client, event_name="Recital")
    assert "track_steps" in db[models.NINETY_DAY_PLANS].docs[0]
    res = _patch_plan(client, event_name="Match", clear_track_steps=True)
    assert res.json()["track_steps"] is None
    assert "track_steps" not in db[models.NINETY_DAY_PLANS].docs[0]


@pytest.mark.parametrize(
    "body",
    [
        {"ask": "x" * 2001},
        {"event_name": "x" * 201},
        {"act_counts": {"a": "many"}},
        {"photos": {"k": "not-a-list"}},
        {"feedback": {"a": {"blob": "x" * 70_000}}},
    ],
)
def test_invalid_plan_patches_are_422(db, client, body):
    _child(db, transform_visited=True)
    assert _patch_plan(client, **body).status_code == 422
    assert db[models.NINETY_DAY_PLANS].docs == []


# ── 90-day plan photo presign ────────────────────────────────────────────────


def _upload_settings(**overrides):
    values = {"uploads_bucket_name": "buddy-uploads", "aws_region": "eu-west-1",
              "uploads_cdn_domain": "", **overrides}  # fmt: skip
    return settings.model_copy(update=values)


class _S3:
    def __init__(self):
        self.error, self.calls = None, []

    def generate_presigned_url(self, method, Params, ExpiresIn):  # noqa: N803 — boto3's names
        self.calls.append((method, Params, ExpiresIn))
        if self.error:
            raise self.error
        return f"https://signed.example/{Params['Key']}?sig=1"


@pytest.fixture
def s3(monkeypatch):
    fake = _S3()
    monkeypatch.setattr(users_router, "get_s3_client", lambda region: fake)
    return fake


def _presign(client, field_key="act:m101:sketch", content_type="image/webp"):
    return client.post(f"{PRESIGN}?child_id=c1", json={"field_key": field_key,
                       "content_type": content_type}, headers=_auth())  # fmt: skip


def test_presign_returns_a_put_url_namespaced_by_field(db, client, s3):
    _child(db, transform_visited=True)
    app.dependency_overrides[get_settings] = lambda: _upload_settings()
    res = _presign(client)
    assert res.status_code == 200
    [(method, params, expires)] = s3.calls
    assert (method, expires) == ("put_object", 300)
    assert (params["Bucket"], params["ContentType"]) == ("buddy-uploads", "image/webp")
    assert params["Key"].startswith("uploads/eu/c1/ninety-day-plan/act:m101:sketch/")
    assert params["Key"].endswith(".webp")
    assert res.json() == {
        "upload_url": f"https://signed.example/{params['Key']}?sig=1",
        "photo_url": f"https://buddy-uploads.s3.eu-west-1.amazonaws.com/{params['Key']}",
    }


def test_presign_uses_the_cdn_when_configured(db, client, s3):
    _child(db, transform_visited=True)
    app.dependency_overrides[get_settings] = lambda: _upload_settings(uploads_cdn_domain="cdn.x")
    res = _presign(client)
    assert res.json()["photo_url"] == f"https://cdn.x/{s3.calls[0][1]['Key']}"


def test_presign_requires_transform(db, client, s3):
    _child(db)
    app.dependency_overrides[get_settings] = lambda: _upload_settings()
    assert _presign(client).status_code == 403
    assert s3.calls == []


@pytest.mark.parametrize("overrides", [{"uploads_bucket_name": ""}, {"aws_region": ""}])
def test_presign_not_configured_is_503(db, client, s3, overrides):
    _child(db, transform_visited=True)
    app.dependency_overrides[get_settings] = lambda: _upload_settings(**overrides)
    res = _presign(client)
    assert res.status_code == 503 and "UPLOADS_BUCKET_NAME / AWS_REGION" in res.json()["detail"]


def test_presign_rejects_non_image_types(db, client, s3):
    _child(db, transform_visited=True)
    app.dependency_overrides[get_settings] = lambda: _upload_settings()
    res = _presign(client, content_type="image/svg+xml")
    assert (res.status_code, res.json()["detail"]) == (
        415,
        "Unsupported image type. Allowed: image/gif, image/jpeg, image/png, image/webp",
    )


@pytest.mark.parametrize("field_key", ["../etc", "a/b", "a b", "", "k" * 101])
def test_presign_field_key_cannot_manipulate_the_s3_path(db, client, s3, field_key):
    _child(db, transform_visited=True)
    app.dependency_overrides[get_settings] = lambda: _upload_settings()
    assert _presign(client, field_key=field_key).status_code == 422
    assert s3.calls == []


def test_presign_s3_failure_is_a_generic_502(db, client, s3, caplog):
    _child(db, transform_visited=True)
    s3.error = botocore.exceptions.ClientError({"Error": {"Code": "AccessDenied"}}, "PutObject")
    app.dependency_overrides[get_settings] = lambda: _upload_settings()
    with caplog.at_level(logging.WARNING, logger="app.routers.users"):
        res = _presign(client)
    assert (res.status_code, res.json()["detail"]) == (
        502,
        "Failed to generate upload URL. Please try again.",
    )
    assert "photo_presign.s3_error child=c1 field_key=act:m101:sketch" in caplog.text
