import asyncio
import logging
from types import SimpleNamespace

import pytest
from pymongo import ASCENDING, DESCENDING

from app import models
from app.database import get_db, init_indexes

A, D = ASCENDING, DESCENDING

# The full index contract. Changing an index in init_indexes() must be a
# deliberate change here too — this table is what a reviewer reads.
EXPECTED_INDEXES = [
    ("email_index", [("user_id", A)], {}),
    ("users", [("location", A), ("_id", A)], {"unique": True}),
    ("users", [("location", A), ("email", A)], {"unique": True}),
    ("users", [("location", A), ("role", A)], {}),
    ("sessions", [("location", A), ("_id", A)], {"unique": True}),
    ("sessions", [("location", A), ("expires_at", A)], {}),
    ("sessions", [("location", A), ("user_id", A)], {}),
    ("observations", [("location", A), ("_id", A)], {"unique": True}),
    ("ninety_day_plans", [("location", A), ("_id", A)], {"unique": True}),
    ("growth_areas", [("location", A), ("_id", A)], {"unique": True}),
    (
        "growth_areas",
        [("location", A), ("user_id", A), ("child_id", A), ("area_id", A)],
        {"unique": True},
    ),
    ("children", [("location", A), ("_id", A)], {"unique": True}),
    (
        "children",
        [("location", A), ("user_id", A), ("created_at", D)],
        {"partialFilterExpression": {"is_deleted": False}},
    ),
    (
        "children",
        [("location", A), ("user_id", A), ("name", A)],
        {"partialFilterExpression": {"is_deleted": False}},
    ),
    (
        "children",
        [("location", A), ("deleted_at", A)],
        {"partialFilterExpression": {"is_deleted": True}},
    ),
    ("jobs", [("location", A), ("status", A), ("retry_after", A), ("created_at", A)], {}),
    ("jobs", [("location", A), ("job_id", A), ("user_id", A)], {"unique": True}),
    (
        "jobs",
        [("location", A), ("user_id", A), ("child_id", A), ("type", A), ("status", A)],
        {},
    ),
    ("jobs", [("location", A), ("status", A), ("claimed_at", A)], {}),
    (
        "jobs",
        [("location", A), ("status", A), ("domain_write_attempt", A)],
        {"partialFilterExpression": {"status": "result_ready"}},
    ),
    (
        "jobs",
        [("completed_at", A)],
        {
            "expireAfterSeconds": 86400,
            "partialFilterExpression": {"status": {"$in": ["completed", "failed"]}},
        },
    ),
]


class _RecordingDb:
    """Stands in for AsyncIOMotorDatabase: records every create_index call."""

    def __init__(self):
        self.calls: list[tuple[str, list[tuple[str, int]], dict]] = []

    def __getitem__(self, collection: str):
        db = self

        class _Collection:
            async def create_index(self, keys, **options):
                # A bare field name is an ascending single-field index.
                spec = [(keys, ASCENDING)] if isinstance(keys, str) else list(keys)
                db.calls.append((collection, spec, options))
                return "index-name"

        return _Collection()


@pytest.fixture(scope="module")
def created():
    db = _RecordingDb()
    asyncio.run(init_indexes(db))
    return db.calls


def test_get_db_returns_the_apps_database():
    db = object()
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db=db)))
    assert get_db(request) is db


def test_init_indexes_creates_exactly_the_expected_indexes(created):
    assert created == EXPECTED_INDEXES


def test_every_collection_is_a_models_constant(created):
    known = {v for k, v in vars(models).items() if k.isupper() and isinstance(v, str)}
    assert {collection for collection, _, _ in created} <= known


def _is_ttl(options: dict) -> bool:
    return "expireAfterSeconds" in options


def test_user_data_indexes_lead_with_location(created):
    # Shard-key prefix for an Atlas Global Cluster; email_index is the one global
    # (unsharded) collection, and TTL indexes can't be compound.
    for collection, keys, options in created:
        if collection == models.EMAIL_INDEX or _is_ttl(options):
            continue
        assert keys[0] == ("location", ASCENDING), (collection, keys)


def test_unique_user_data_indexes_start_with_location(created):
    for collection, keys, options in created:
        if options.get("unique") and collection != models.EMAIL_INDEX:
            assert keys[0][0] == "location", (collection, keys)


def test_email_index_stays_global(created):
    email_keys = [keys for collection, keys, _ in created if collection == models.EMAIL_INDEX]
    assert email_keys and all(field != "location" for keys in email_keys for field, _ in keys)


def test_ttl_indexes_are_single_field_and_only_expire_finished_jobs(created):
    ttl = [(c, k, o) for c, k, o in created if _is_ttl(o)]
    assert ttl, "jobs must have a TTL index"
    for collection, keys, options in ttl:
        assert len(keys) == 1, (collection, keys)
        # pending/processing jobs must never be deleted by TTL
        assert options["partialFilterExpression"] == {"status": {"$in": ["completed", "failed"]}}


def test_init_indexes_logs_completion(caplog):
    with caplog.at_level(logging.INFO, logger="app.database"):
        asyncio.run(init_indexes(_RecordingDb()))
    assert "MongoDB indexes ensured" in caplog.text
