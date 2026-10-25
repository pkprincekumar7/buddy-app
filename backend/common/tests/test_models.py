"""common.models and common.deletion (design 4.1, 7.7, 10.3, 12.4, 14).

The build plan's 1.5 check: indexes are created on an empty local database, and the
validators reject malformed documents.
"""

from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from pymongo.errors import OperationFailure

from common import deletion, models
from common.events import catalogue, store
from common.events.consumer import Consumer
from common.events.testing import example_event, sns_envelope, topic_arn

CHILD = "9b1c6f64-2f4e-4d0e-8e2a-6c1f0d3a7b55"
USER = "3f6c2a1e-8b7d-4c5e-9f10-2a3b4c5d6e7f"
NOW = datetime(2026, 10, 25, tzinfo=UTC)


def _received(event_type: str, consumer: str, **fields: Any):
    spec = catalogue.load().spec(event_type)
    event = example_event(event_type, aggregate_id=CHILD, **fields)
    return Consumer(consumer, topic_prefix="t").check(
        sns_envelope(event, topic_arn("t", spec.producer))
    )


def _index_keys(info: dict[str, Any]) -> set[tuple[tuple[str, Any], ...]]:
    return {tuple(spec["key"]) for spec in info.values()}


# ── indexes (section 14) ───────────────────────────────────────────────────────

live = pytest.mark.live_service


@live
def test_indexes_are_created_on_an_empty_database(mongo_run):
    async def body(db, client):
        for _ in range(2):  # safe to repeat on every start
            await models.ensure_child_access(db)
            await models.ensure_inputs(db, models.INPUT_VALIDATORS)
            await models.ensure_jobs(db, "grow")
            await store.ensure_outbox(db)
            await store.ensure_tombstones(db)
            await store.ensure_inbox(db)
        shard_key = (("location", 1), ("_id", 1))
        for name in (
            models.CHILD_ACCESS,
            *models.INPUT_VALIDATORS,
            models.JOBS,
            store.OUTBOX,
            store.TOMBSTONES,
        ):
            info = await db[name].index_information()
            unique = [s for s in info.values() if tuple(s["key"]) == shard_key]
            assert unique and unique[0]["unique"], name
        assert (("location", 1), ("user_id", 1)) in _index_keys(
            await db.child_access.index_information()
        )
        assert (("location", 1), ("child_id", 1)) in _index_keys(
            await db.growth_inputs.index_information()
        )
        jobs = await db.jobs.index_information()
        assert {
            (("location", 1), ("child_id", 1), ("type", 1), ("status", 1)),
            (("location", 1), ("status", 1), ("retry_after", 1)),
            (("location", 1), ("user_id", 1)),
        } <= _index_keys(jobs)
        ttl = {
            tuple(s["key"]): s["expireAfterSeconds"]
            for s in jobs.values()
            if "expireAfterSeconds" in s
        }
        assert ttl == {(("completed_at", 1),): models.JOB_TTL_SECONDS}

    mongo_run(body)


# ── validators ─────────────────────────────────────────────────────────────────


def _child_access(**overrides: Any) -> dict[str, Any]:
    doc = {
        "_id": CHILD,
        "user_id": USER,
        "location": "in",
        "name": "Mira",
        "age": 7,
        "gender": None,
        "is_deleted": False,
        "progress": dict.fromkeys(models.PROGRESS_FLAGS, False),
        "version": 1,
        "updated_at": NOW,
        "schema_version": 1,
    }
    doc.update(overrides)
    return {k: v for k, v in doc.items() if v is not ...}


def _job(**overrides: Any) -> dict[str, Any]:
    doc = {
        "_id": "job-1",
        "user_id": USER,
        "child_id": CHILD,
        "location": "in",
        "type": "generate_recommendations",
        "status": "pending",
        "input_version": 3,
        "llm_attempt": 0,
        "max_llm_attempts": 3,
        "created_at": NOW,
        "updated_at": NOW,
        "schema_version": 1,
    }
    doc.update(overrides)
    return {k: v for k, v in doc.items() if v is not ...}


@live
@pytest.mark.parametrize(
    "doc",
    [
        pytest.param(_child_access(user_id=...), id="no user_id"),
        pytest.param(_child_access(version=0), id="version 0"),
        pytest.param(_child_access(is_deleted="no"), id="is_deleted not bool"),
        pytest.param(_child_access(age=-1), id="negative age"),
        pytest.param(_child_access(progress={"profile": True}), id="partial progress"),
        pytest.param(_child_access(confirmed={"shopping": True}), id="unknown confirmed stage"),
        pytest.param(_child_access(schema_version=...), id="no schema_version"),
        pytest.param(_child_access(updated_at="today"), id="updated_at not a date"),
    ],
)
def test_child_access_rejects_malformed_documents(mongo_run, doc):
    async def body(db, client):
        await models.ensure_child_access(db)
        with pytest.raises(OperationFailure, match="validation"):
            await db.child_access.insert_one(doc)

    mongo_run(body)


@live
def test_child_access_accepts_a_valid_copy_with_confirmations(mongo_run):
    async def body(db, client):
        await models.ensure_child_access(db)
        await db.child_access.insert_one(_child_access(confirmed={"discover": True}))

    mongo_run(body)


@live
@pytest.mark.parametrize(
    "doc",
    [
        pytest.param(_job(type="generate_personality_analysis"), id="another service's type"),
        pytest.param(_job(status="done"), id="unknown status"),
        pytest.param(_job(max_llm_attempts=0), id="no attempts"),
        pytest.param(_job(error="x" * 501), id="error too long"),
        pytest.param(_job(input_version=...), id="no input_version"),
    ],
)
def test_jobs_rejects_malformed_documents(mongo_run, doc):
    async def body(db, client):
        await models.ensure_jobs(db, "grow")
        with pytest.raises(OperationFailure, match="validation"):
            await db.jobs.insert_one(doc)

    mongo_run(body)


@live
def test_jobs_accepts_its_own_types(mongo_run):
    async def body(db, client):
        await models.ensure_jobs(db, "grow")
        await db.jobs.insert_one(
            _job(target={"area_id": "focus"}, retry_after=NOW, error="timeout")
        )

    mongo_run(body)


@live
@pytest.mark.parametrize(
    ("name", "doc"),
    [
        (models.ONBOARDING_INPUTS, {"strengths": "curious"}),
        (models.PERSONALITY_INPUTS, {"traits": {"summary": "x"}}),  # no strengths
        (models.GROWTH_INPUTS, {"child_id": CHILD, "area_id": "focus"}),  # no area_name
    ],
)
def test_inputs_reject_malformed_documents(mongo_run, name, doc):
    async def body(db, client):
        await models.ensure_inputs(db, [name])
        base = {
            "_id": CHILD,
            "user_id": USER,
            "location": "in",
            "version": 1,
            "updated_at": NOW,
            "schema_version": 1,
        }
        with pytest.raises(OperationFailure, match="validation"):
            await db[name].insert_one({**base, **doc})

    mongo_run(body)


# ── copies from events, through the validators ───────────────────────────────


@live
def test_each_copy_built_from_its_event_passes_its_validator(mongo_run):
    async def body(db, client):
        await models.ensure_child_access(db)
        await models.ensure_inputs(db, models.INPUT_VALIDATORS)

        changed = _received("child.changed", "grow", version=4)
        fields = models.child_access_fields(changed)
        assert await store.versioned_upsert(
            db, models.CHILD_ACCESS, doc_id=CHILD, location="in", version=4, fields=fields
        )

        answers = _received("onboarding.answers_updated", "grow", version=2)
        assert await store.versioned_upsert(
            db,
            models.ONBOARDING_INPUTS,
            doc_id=CHILD,
            location="in",
            version=2,
            fields=models.onboarding_inputs_fields(answers, USER),
        )

        personality = _received("discover.personality_finalised", "grow")
        assert await store.versioned_upsert(
            db,
            models.PERSONALITY_INPUTS,
            doc_id=CHILD,
            location="in",
            version=1,
            fields=models.personality_inputs_fields(personality, USER),
        )

        area = _received("grow.area_completed", "transform")
        growth_id = models.growth_inputs_id(CHILD, area.payload["area_id"])
        assert growth_id == f"{CHILD}:focus"
        assert await store.versioned_upsert(
            db,
            models.GROWTH_INPUTS,
            doc_id=growth_id,
            location="in",
            version=1,
            fields=models.growth_inputs_fields(area, USER),
        )

        copy = await db.child_access.find_one({"_id": CHILD})
        assert copy["progress"]["profile"] is True and copy["version"] == 4
        assert (await db.growth_inputs.find_one({}))["child_id"] == CHILD

    mongo_run(body)


def test_child_access_fields_leave_confirmed_alone():
    fields = models.child_access_fields(_received("child.changed", "grow"))
    assert "confirmed" not in fields
    assert set(fields["progress"]) == set(models.PROGRESS_FLAGS)


# ── unlock checks (12.4) ───────────────────────────────────────────────────────


def test_stage_done_takes_progress_or_a_confirmed_unlock():
    copy = {"progress": {"discover": False, "grow": True}, "confirmed": {"discover": True}}
    assert models.stage_done(copy, "discover")  # confirmed while the copy was behind
    assert models.stage_done(copy, "grow")
    assert not models.stage_done(copy, "transform")
    assert not models.stage_done(None, "grow")  # no copy yet: read through, don't refuse
    with pytest.raises(ValueError, match="unknown stage"):
        models.stage_done(copy, "shopping")


def test_job_types_belong_to_the_generating_services():
    assert set(models.JOB_TYPES) == {"discover", "grow", "transform", "release"}
    every = [t for types in models.JOB_TYPES.values() for t in types]
    assert len(every) == len(set(every)) == 8
    assert "generate_activity" not in every  # dropped (section 8)


# ── deletion participants (10.3) ───────────────────────────────────────────────


def test_participants_match_the_event_catalogue():
    cat = catalogue.load()
    assert set(deletion.PARTICIPANTS) == cat.data_services
    assert set(deletion.PARTICIPANTS) == set(cat.spec("user.deletion_requested").consumers)
    assert not set(deletion.PARTICIPANTS) & set(deletion.NOT_PARTICIPANTS)


def test_every_backend_service_is_a_participant_or_says_why_not():
    # A new service with user data that isn't listed would keep deleted users' data.
    backend = Path(__file__).resolve().parents[2]
    services = {p.name for p in backend.iterdir() if (p / "requirements.txt").is_file()}
    unlisted = services - set(deletion.PARTICIPANTS) - set(deletion.NOT_PARTICIPANTS)
    assert not unlisted, (
        f"add to common.deletion.PARTICIPANTS (or NOT_PARTICIPANTS, with a reason): {sorted(unlisted)}"
    )
