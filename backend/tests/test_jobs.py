"""Routes in app/routers/jobs.py, driven over HTTP against an in-memory Motor stand-in."""

import asyncio
import copy
import logging
import uuid
from datetime import UTC, datetime

import httpx
import pytest
from fastapi.testclient import TestClient

import app.routers.jobs as jobs
from app import models
from app.auth_utils import create_access_token
from app.database import get_db
from app.limiter import user_limiter
from app.main import app
from app.schemas.jobs import _ALLOWED_WRITE_BACK_FIELDS

# ── an in-memory stand-in for the Motor collections these routes use ─────────


def _matches(doc, query):
    for key, want in query.items():
        have = doc.get(key)
        if isinstance(want, dict) and "$in" in want:
            if have not in want["$in"]:
                return False
        elif have != want:
            return False
    return True


class _Collection:
    def __init__(self, name, log):
        self.name, self.log = name, log
        self.docs: list[dict] = []
        self.fail: dict[str, Exception] = {}
        self.count_delay = 0  # yield to the event loop inside count_documents

    def _call(self, method, *args):
        self.log.append((self.name, method, *args))
        if method in self.fail:
            raise self.fail[method]

    async def find_one(self, query, projection=None):
        self._call("find_one", query)
        doc = next((d for d in self.docs if _matches(d, query)), None)
        return copy.deepcopy(doc)

    async def count_documents(self, query):
        self._call("count_documents", query)
        count = sum(_matches(d, query) for d in self.docs)
        for _ in range(self.count_delay):
            await asyncio.sleep(0)
        return count

    async def insert_one(self, doc):
        self._call("insert_one", doc)
        self.docs.append(copy.deepcopy(doc))

    async def update_one(self, query, update):
        self._call("update_one", query, update)
        for doc in [d for d in self.docs if _matches(d, query)][:1]:
            for path, value in update["$set"].items():
                *parents, leaf = path.split(".")
                target = doc
                for part in parents:
                    target = target.setdefault(part, {})
                target[leaf] = value


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
URL = "/api/v1/jobs"


@pytest.fixture(autouse=True)
def fresh_locks(monkeypatch):
    monkeypatch.setattr(jobs, "_enqueue_locks", jobs.OrderedDict())


@pytest.fixture
def db():
    database = _Db()
    database[models.USERS].docs.extend([PARENT, OTHER, ADMIN])
    app.dependency_overrides[get_db] = lambda: database
    user_limiter.reset()
    try:
        yield database
    finally:
        app.dependency_overrides.pop(get_db, None)
        user_limiter.reset()


@pytest.fixture
def client():
    return TestClient(app)


def _auth(user=PARENT):
    return {"Authorization": f"Bearer {create_access_token(user['_id'], user['location'])}"}


def _child(db, _id="c1", *, user=PARENT, **fields):
    doc = {"_id": _id, "user_id": user["_id"], "location": user["location"], "is_deleted": False,
           **fields}  # fmt: skip
    db[models.CHILDREN].docs.append(doc)
    return doc


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


def _body(job_type="generate_personality_analysis", *, child_id="c1", **write_back):
    field = sorted(_ALLOWED_WRITE_BACK_FIELDS[job_type])[0]
    return {
        "type": job_type,
        "child_id": child_id,
        "payload": {
            "prompt": "Describe the child.",
            "response_json_schema": {"type": "object"},
            "provider": "openai",
        },  # fmt: skip
        "write_back": {"collection": "children", "filter": {}, "field": field, **write_back},
    }


def _enqueue(client, body=None, user=PARENT):
    return client.post(URL, json=body or _body(), headers=_auth(user))


def _jobs(db):
    return db[models.JOBS].docs


# ── access control ───────────────────────────────────────────────────────────


@pytest.mark.parametrize(("method", "path"), [("post", URL), ("get", f"{URL}/j1")])
def test_requires_a_token(db, client, method, path):
    res = client.request(method, path, json=_body())
    assert (res.status_code, res.json()["detail"]) == (401, "Not authenticated")


@pytest.mark.parametrize(("method", "path"), [("post", URL), ("get", f"{URL}/j1")])
def test_admins_cannot_use_jobs(db, client, method, path):
    _child(db, user=ADMIN)
    res = client.request(method, path, json=_body(), headers=_auth(ADMIN))
    assert (res.status_code, res.json()["detail"]) == (403, "Not available for admin accounts")
    assert _jobs(db) == []


@pytest.mark.parametrize(("method", "path", "limit"), [("post", URL, 30), ("get", f"{URL}/j1", 60)])
def test_rate_limits_reject_before_the_user_lookup(db, client, method, path, limit):
    for _ in range(limit):
        assert client.request(method, path, json=_body(), headers=_auth()).status_code == 404
    lookups = len(db.calls(models.USERS, "find_one"))
    res = client.request(method, path, json=_body(), headers=_auth())
    assert res.status_code == 429
    assert len(db.calls(models.USERS, "find_one")) == lookups


# ── POST /jobs ───────────────────────────────────────────────────────────────


def test_enqueue_stores_a_claimable_pending_job(db, client, caplog):
    _child(db)
    with caplog.at_level(logging.INFO, logger="app.routers.jobs"):
        res = _enqueue(client)
    assert res.status_code == 201
    job_id = res.json()["job_id"]
    uuid.UUID(job_id)
    [job] = _jobs(db)
    now = job["created_at"]
    assert now.tzinfo is not None
    assert job == {
        "job_id": job_id,
        "user_id": "p1",
        "child_id": "c1",
        "location": "eu",
        "type": "generate_personality_analysis",
        "payload": {
            "prompt": "Describe the child.",
            "response_json_schema": {"type": "object"},
            "provider": "openai",
        },  # fmt: skip
        "write_back": {
            "collection": "children",
            "filter": {"_id": "c1", "user_id": "p1", "location": "eu"},
            "field": "pending_personality_vm",
        },
        "status": "pending",
        "result": None,
        "error": None,
        "llm_attempt": 0,
        "domain_write_attempt": 0,
        "max_llm_attempts": 3,
        "max_domain_attempts": 5,
        "retry_after": now,  # immediately claimable
        "created_at": now,
        "updated_at": now,
        "claimed_at": None,
        "completed_at": None,
    }
    # Every device can resume polling from the child's active_jobs.
    child = db[models.CHILDREN].docs[0]
    assert child["active_jobs"] == {"generate_personality_analysis": job_id}
    assert child["updated_at"] == now
    assert db.calls(models.CHILDREN, "update_one")[0][0] == {"_id": "c1", "location": "eu"}
    assert f"job.enqueued job_id={job_id} type=generate_personality_analysis child_id=c1" in (
        caplog.text
    )


def test_write_back_filter_is_pinned_to_this_users_child(db, client):
    _child(db)
    forged = {"_id": "victim-child", "user_id": "p2", "location": "us", "area_id": "focus"}
    _enqueue(client, _body(filter=forged))
    assert _jobs(db)[0]["write_back"]["filter"] == {
        "_id": "c1",  # the child's own primary key, not the client's
        "user_id": "p1",
        "location": "eu",
        "area_id": "focus",  # other client keys are kept
    }


def test_growth_area_write_back_is_scoped_by_child_id_field(db, client):
    _child(db, discover_completed=True)
    body = _body(
        "generate_growth_parent_questions",
        collection="growth_areas",
        filter={"area_id": "focus", "child_id": "victim-child", "_id": "ga-x"},
    )
    assert _enqueue(client, body).status_code == 201
    assert _jobs(db)[0]["write_back"]["filter"] == {
        "area_id": "focus",
        "child_id": "c1",
        "_id": "ga-x",  # growth_areas use UUID _ids; child_id is what scopes them
        "user_id": "p1",
        "location": "eu",
    }


@pytest.mark.parametrize(
    "child",
    [
        None,
        {"user": OTHER},
        {"is_deleted": True},
        {"user": {**PARENT, "location": "us"}},
    ],
)
def test_child_must_be_this_parents_live_child(db, client, child):
    if child is not None:
        _child(db, **child)
    res = _enqueue(client)
    assert (res.status_code, res.json()["detail"]) == (404, "Child not found")
    assert _jobs(db) == []


def test_life_pathway_requires_a_really_completed_growth_area(db, client):
    _child(db, grow_completed=True, discover_completed=True)  # stored flag is not trusted
    body = _body("generate_life_pathway", collection="growth_areas")
    res = _enqueue(client, body)
    assert (res.status_code, res.json()["detail"]) == (
        403,
        "Complete a growth area before generating the Life Pathway.",
    )
    _completed_growth_area(db, child_id="c2")  # another child's
    assert _enqueue(client, body).status_code == 403
    _completed_growth_area(db)
    assert _enqueue(client, body).status_code == 201


@pytest.mark.parametrize(
    ("job_type", "requirement"), sorted(jobs._PROGRESSION_REQUIREMENTS.items())
)
def test_gated_job_types_need_their_journey_step(db, client, job_type, requirement):
    flag, message = requirement
    _child(db, **{f: True for f, _ in jobs._PROGRESSION_REQUIREMENTS.values() if f != flag})
    res = _enqueue(client, _body(job_type))
    assert (res.status_code, res.json()["detail"]) == (403, message)
    assert _jobs(db) == []
    db[models.CHILDREN].docs[0][flag] = True
    assert _enqueue(client, _body(job_type)).status_code == 201


def test_progression_gates_match_the_journey_order():
    gates = {t: f for t, (f, _) in jobs._PROGRESSION_REQUIREMENTS.items()}
    assert gates == {
        "generate_growth_parent_questions": "discover_completed",
        "generate_growth_child_rounds": "discover_completed",
        "generate_recommendations": "discover_completed",
        "generate_activity": "discover_completed",
        "generate_observations": "transform_visited",
        "generate_ninety_day_plan": "transform_visited",
        "generate_event_tracker": "transform_visited",
    }


def test_personality_analysis_is_not_gated(db, client):
    _child(db)  # no journey flags at all
    assert _enqueue(client).status_code == 201


# -- in-flight cap ---------------------------------------------------------------


def _job(db, status, *, job_type="generate_personality_analysis", child_id="c1", user=PARENT):
    db[models.JOBS].docs.append(
        {
            "job_id": str(uuid.uuid4()),
            "user_id": user["_id"],
            "child_id": child_id,
            "location": user["location"],
            "type": job_type,
            "status": status,
        }  # fmt: skip
    )


@pytest.mark.parametrize("statuses", [["pending", "processing"], ["result_ready", "pending"]])
def test_at_most_two_in_flight_jobs_per_child_and_type(db, client, statuses):
    _child(db)
    for status in statuses:
        _job(db, status)
    res = _enqueue(client)
    assert (res.status_code, res.json()["detail"]) == (
        429,
        "Too many pending jobs for this child and type (max 2)",
    )
    assert len(_jobs(db)) == 2


def test_finished_jobs_and_other_buckets_do_not_count_towards_the_cap(db, client):
    _child(db)
    _job(db, "pending")
    _job(db, "completed")
    _job(db, "failed")
    _job(db, "pending", job_type="generate_activity")
    _job(db, "pending", child_id="c2")
    _job(db, "pending", user=OTHER)
    _job(db, "pending", user={**PARENT, "location": "us"})
    assert _enqueue(client).status_code == 201
    [(query,)] = db.calls(models.JOBS, "count_documents")
    assert query == {
        "location": "eu",
        "user_id": "p1",
        "child_id": "c1",
        "type": "generate_personality_analysis",
        "status": {"$in": ["pending", "processing", "result_ready"]},
    }


def test_concurrent_enqueues_cannot_both_slip_under_the_cap(db):
    # Real concurrency in one event loop: count_documents yields, so without the
    # per-key lock both requests would read 1 < 2 and both insert.
    _child(db)
    _job(db, "pending")
    db[models.JOBS].count_delay = 5

    async def race():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
            return await asyncio.gather(
                *(c.post(URL, json=_body(), headers=_auth()) for _ in range(2))
            )

    statuses = sorted(r.status_code for r in asyncio.run(race()))
    assert statuses == [201, 429]
    assert len(_jobs(db)) == 2


def test_enqueue_locks_are_per_key_and_lru_bounded(monkeypatch):
    monkeypatch.setattr(jobs, "_ENQUEUE_LOCKS_MAX", 2)
    a = jobs._get_enqueue_lock(("u", "c", "a"))
    assert jobs._get_enqueue_lock(("u", "c", "a")) is a
    b = jobs._get_enqueue_lock(("u", "c", "b"))
    assert b is not a
    jobs._get_enqueue_lock(("u", "c", "a"))  # touch a — b is now least recently used
    jobs._get_enqueue_lock(("u", "c", "new"))
    assert list(jobs._enqueue_locks) == [("u", "c", "a"), ("u", "c", "new")]
    assert jobs._get_enqueue_lock(("u", "c", "a")) is a


# -- failures --------------------------------------------------------------------


@pytest.mark.parametrize("method", ["count_documents", "insert_one"])
def test_queue_failure_is_a_generic_503(db, client, caplog, method):
    _child(db)
    db[models.JOBS].fail[method] = RuntimeError("mongo: connection reset by 10.0.0.5")
    with caplog.at_level(logging.ERROR, logger="app.routers.jobs"):
        res = _enqueue(client)
    assert (res.status_code, res.json()["detail"]) == (503, "Job queue is temporarily unavailable.")
    assert "10.0.0.5" not in res.text
    assert "job.enqueue_failed" in caplog.text and "connection reset" in caplog.text
    assert "active_jobs" not in db[models.CHILDREN].docs[0]


def test_active_jobs_failure_still_enqueues(db, client, caplog):
    _child(db)
    db[models.CHILDREN].fail["update_one"] = RuntimeError("shard down")
    with caplog.at_level(logging.WARNING, logger="app.routers.jobs"):
        res = _enqueue(client)
    assert res.status_code == 201
    assert [j["job_id"] for j in _jobs(db)] == [res.json()["job_id"]]
    assert "job.active_jobs_update_failed" in caplog.text and "child_id=c1" in caplog.text


def test_log_lines_cannot_be_forged_through_the_child_id(db, client, caplog):
    _child(db, _id="c1\r\nFORGED")
    with caplog.at_level(logging.INFO, logger="app.routers.jobs"):
        assert _enqueue(client, _body(child_id="c1\r\nFORGED")).status_code == 201
    assert "child_id=c1FORGED" in caplog.text
    assert "\nFORGED" not in caplog.text


# -- request validation (app/schemas/jobs.py, through the route) -------------------


@pytest.mark.parametrize(
    "patch",
    [
        {"type": "generate_everything"},
        {"write_back": {"collection": "users", "filter": {}, "field": "pending_personality_vm"}},
        {"write_back": {"collection": "children", "filter": {}, "field": "user_id"}},
        {"write_back": {"collection": "children", "filter": {}, "field": "plan"}},  # other type's
        {"write_back": {"collection": "children", "filter": {}, "field": "1bad"}},
        {
            "write_back": {
                "collection": "children",
                "filter": {"$where": "1"},
                "field": "pending_personality_vm",
            }
        },  # fmt: skip
        {
            "write_back": {
                "collection": "children",
                "filter": {"a": {"$ne": 1}},
                "field": "pending_personality_vm",
            }
        },  # fmt: skip
        {
            "write_back": {
                "collection": "children",
                "filter": {"a": [{"$gt": 1}]},
                "field": "pending_personality_vm",
            }
        },  # fmt: skip
        {
            "write_back": {
                "collection": "children",
                "filter": {"a": {"b": {"c": {"d": {"e": 1}}}}},
                "field": "pending_personality_vm",
            }
        },  # fmt: skip
        {
            "write_back": {
                "collection": "children",
                "filter": {f"k{i}": i for i in range(21)},
                "field": "pending_personality_vm",
            }
        },  # fmt: skip
        {"payload": {"prompt": "x" * 32001}},
        {"payload": {"prompt": "x", "response_json_schema": {"d": "x" * 4000}}},
        {"payload": {"prompt": "x", "response_json_schema": {"$ref": "https://evil.example/s"}}},
        {"payload": {"prompt": "x", "response_json_schema": {"$ref": "//evil.example/s"}}},
        {"child_id": "c" * 101},
    ],
)
def test_unsafe_or_malformed_requests_are_422(db, client, patch):
    _child(db)
    res = _enqueue(client, {**_body(), **patch})
    assert res.status_code == 422
    assert _jobs(db) == []


def test_filter_limits_are_inclusive(db, client):
    _child(db)
    deep = {"a": {"b": {"c": {"d": 1}}}}  # depth 4 is allowed
    many = {f"k{i}": i for i in range(20)}  # 20 keys are allowed
    for flt in (deep, many):
        assert _enqueue(client, _body(filter=flt)).status_code == 201
        _jobs(db).clear()


def test_schema_is_optional_and_plain_lists_are_fine_in_filters(db, client):
    _child(db)
    body = _body(filter={"tags": ["a", ["b"]]})
    body["payload"] = {"prompt": "x"}
    assert _enqueue(client, body).status_code == 201
    body["payload"] = {"prompt": "x", "response_json_schema": None}  # explicit null too
    assert _enqueue(client, body).status_code == 201
    for job in _jobs(db):
        assert job["payload"] == {"prompt": "x", "response_json_schema": None, "provider": None}
    job = _jobs(db)[0]
    assert job["write_back"]["filter"]["tags"] == ["a", ["b"]]


def test_internal_refs_in_the_schema_are_allowed(db, client):
    _child(db)
    body = _body()
    body["payload"]["response_json_schema"] = {"$ref": "#/definitions/x", "definitions": {"x": {}}}
    assert _enqueue(client, body).status_code == 201


# ── GET /jobs/{job_id} ───────────────────────────────────────────────────────


def test_job_status_is_returned_to_its_owner(db, client):
    db[models.JOBS].docs.append(
        {
            "job_id": "j1",
            "user_id": "p1",
            "location": "eu",
            "status": "failed",
            "error": "provider timeout",
            "created_at": T0,
            "result": {"secret": 1},
        }  # fmt: skip
    )
    res = client.get(f"{URL}/j1", headers=_auth())
    assert res.status_code == 200
    assert res.json() == {
        "job_id": "j1",
        "status": "failed",
        "error": "provider timeout",
        "created_at": "2026-01-01T00:00:00Z",
    }
    # Index-shaped query: (location, job_id, user_id).
    assert db.calls(models.JOBS, "find_one") == [
        ({"location": "eu", "job_id": "j1", "user_id": "p1"},)
    ]


def test_job_status_without_an_error(db, client):
    db[models.JOBS].docs.append(
        {"job_id": "j1", "user_id": "p1", "location": "eu", "status": "pending", "created_at": T0}
    )
    assert client.get(f"{URL}/j1", headers=_auth()).json()["error"] is None


@pytest.mark.parametrize(
    "owner", [{"user_id": "p2", "location": "eu"}, {"user_id": "p1", "location": "us"}]
)
def test_someone_elses_job_is_not_found(db, client, owner):
    db[models.JOBS].docs.append({"job_id": "j1", "status": "pending", "created_at": T0, **owner})
    res = client.get(f"{URL}/j1", headers=_auth())
    assert (res.status_code, res.json()["detail"]) == (404, "Job not found")


def test_job_id_length_is_bounded(db, client):
    assert client.get(f"{URL}/{'j' * 101}", headers=_auth()).status_code == 422
