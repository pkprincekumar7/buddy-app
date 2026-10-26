"""The shared collections that several services keep with one shape (docs/auth-users-split.md, 4.1, 14).

- `child_access`: every circle's copy of the child, fed by `child.changed` / `child.deleted`;
- `onboarding_inputs`, `personality_inputs`, `growth_inputs`: copies of other circles' data;
- `jobs`: every generating service's job queue (section 8).

(`outbox`, `tombstones` and `inbox` are in common.events.store.)

Each has a `$jsonSchema` validator, so a buggy writer can't store a malformed document, and
the section-14 indexes, starting with the future shard key `{location, _id}`. The copy
builders turn an event into the fields `versioned_upsert` writes, so every consumer stores
the same shape.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

from pymongo import ASCENDING

from common.events.envelope import ReceivedEvent
from common.events.store import Db, ensure_validated_collection

SCHEMA_VERSION = 1

# The journey, in order (12.4); `progress` has one flag per stage, all one-way.
PROGRESS_FLAGS: tuple[str, ...] = (
    "profile",
    "conversation",
    "discover",
    "grow",
    "transform",
    "release",
    "connect",
)

CHILD_ACCESS = "child_access"
ONBOARDING_INPUTS = "onboarding_inputs"
PERSONALITY_INPUTS = "personality_inputs"
GROWTH_INPUTS = "growth_inputs"
JOBS = "jobs"

ANSWER_FIELDS: tuple[str, ...] = (
    "strengths",
    "hobbies",
    "thinking_pattern",
    "communication_style",
    "energy_level",
    "social_behaviour",
    "emotional_behaviour",
)
GROWTH_FIELDS: tuple[str, ...] = (
    "area_name",
    "answers",
    "child_activity_results",
    "recommendations",
    "ai_three_month_recommendations",
    # Added for release's observations (0.13.0): the questions with their answers, and the
    # child's picks as "Chose “X” over “Y”" lines. Optional: older events lack them.
    "reflections",
    "child_choices",
)

# Each generating service's own job types (4.1, today's names).
JOB_TYPES: dict[str, tuple[str, ...]] = {
    "discover": ("generate_personality_analysis",),
    "grow": (
        "generate_growth_parent_questions",
        "generate_growth_child_rounds",
        "generate_recommendations",
    ),
    "transform": ("generate_life_pathway", "generate_ninety_day_plan", "generate_event_tracker"),
    "release": ("generate_observations",),
}
JOB_STATUSES: tuple[str, ...] = ("pending", "processing", "completed", "failed")
JOB_TTL_SECONDS = 7 * 24 * 3600  # after completed_at (section 14)

_STRING = {"bsonType": "string"}
_NULLABLE_STRING = {"bsonType": ["string", "null"]}
_INT = {"bsonType": ["int", "long"]}
_DATE = {"bsonType": "date"}
_COPY_BASE_REQUIRED = ["_id", "user_id", "location", "version", "updated_at", "schema_version"]
_COPY_BASE_PROPERTIES: dict[str, Any] = {
    "_id": _STRING,
    "user_id": _STRING,
    "location": _STRING,
    "version": {"bsonType": ["int", "long"], "minimum": 1},
    "updated_at": _DATE,
    "schema_version": _INT,
}


def _schema(required: list[str], properties: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "$jsonSchema": {"bsonType": "object", "required": required, "properties": dict(properties)}
    }


# ── validators ─────────────────────────────────────────────────────────────────

CHILD_ACCESS_VALIDATOR = _schema(
    [*_COPY_BASE_REQUIRED, "progress", "is_deleted"],
    {
        **_COPY_BASE_PROPERTIES,
        "name": _NULLABLE_STRING,
        "age": {"bsonType": ["int", "long", "null"], "minimum": 0},
        "gender": _NULLABLE_STRING,
        "is_deleted": {"bsonType": "bool"},
        "progress": {
            "bsonType": "object",
            "required": list(PROGRESS_FLAGS),
            "properties": {flag: {"bsonType": "bool"} for flag in PROGRESS_FLAGS},
        },
        # Unlocks confirmed with the circle that owns them (7.5); never touches `version`.
        "confirmed": {
            "bsonType": "object",
            "additionalProperties": False,
            "properties": {flag: {"bsonType": "bool"} for flag in PROGRESS_FLAGS},
        },
    },
)

ONBOARDING_INPUTS_VALIDATOR = _schema(
    _COPY_BASE_REQUIRED,
    {
        **_COPY_BASE_PROPERTIES,
        "strengths": {"bsonType": ["array", "null"], "items": _STRING},
        "hobbies": {"bsonType": ["array", "null"], "items": _STRING},
        **{f: _NULLABLE_STRING for f in ANSWER_FIELDS if f not in ("strengths", "hobbies")},
    },
)

PERSONALITY_INPUTS_VALIDATOR = _schema(
    [*_COPY_BASE_REQUIRED, "traits", "strengths"],
    {
        **_COPY_BASE_PROPERTIES,
        "traits": {"bsonType": ["array", "object", "string", "null"]},
        "strengths": {"bsonType": ["array", "null"], "items": _STRING},
    },
)

GROWTH_INPUTS_VALIDATOR = _schema(
    [*_COPY_BASE_REQUIRED, "child_id", "area_id", "area_name"],
    {
        **_COPY_BASE_PROPERTIES,
        "child_id": _STRING,
        "area_id": _STRING,
        "area_name": _STRING,
        "answers": {"bsonType": ["object", "null"]},
        "child_activity_results": {"bsonType": ["array", "object", "null"]},
        "recommendations": {"bsonType": ["array", "null"]},
        "ai_three_month_recommendations": {"bsonType": ["array", "null"]},
        "reflections": {"bsonType": ["array", "null"]},
        "child_choices": {"bsonType": ["array", "null"], "items": _STRING},
    },
)


def jobs_validator(service: str) -> dict[str, Any]:
    """`jobs` for `service`: only its own job types are accepted (4.1)."""
    return _schema(
        [
            "_id", "user_id", "child_id", "location", "type", "status", "input_version",
            "llm_attempt", "max_llm_attempts", "created_at", "updated_at", "schema_version",
        ],
        {
            "_id": _STRING,
            "user_id": _STRING,
            "child_id": _STRING,
            "location": _STRING,
            "type": {"enum": list(JOB_TYPES[service])},
            "target": {"bsonType": "object"},
            "status": {"enum": list(JOB_STATUSES)},
            "input_version": {"bsonType": ["int", "long"], "minimum": 0},
            "llm_attempt": {"bsonType": ["int", "long"], "minimum": 0},
            "max_llm_attempts": {"bsonType": ["int", "long"], "minimum": 1},
            "retry_after": _DATE,
            "claimed_at": _DATE,
            # A short reason only: never the prompt or user data.
            "error": {"bsonType": "string", "maxLength": 500},
            "created_at": _DATE,
            "updated_at": _DATE,
            "completed_at": _DATE,
            "schema_version": _INT,
        },
    )  # fmt: skip


INPUT_VALIDATORS: dict[str, dict[str, Any]] = {
    ONBOARDING_INPUTS: ONBOARDING_INPUTS_VALIDATOR,
    PERSONALITY_INPUTS: PERSONALITY_INPUTS_VALIDATOR,
    GROWTH_INPUTS: GROWTH_INPUTS_VALIDATOR,
}


# ── collections and indexes (section 14) ──────────────────────────────────────


async def _copy_indexes(db: Db, name: str) -> None:
    coll = db[name]
    await coll.create_index([("location", ASCENDING), ("_id", ASCENDING)], unique=True)
    await coll.create_index([("location", ASCENDING), ("user_id", ASCENDING)])  # user deletion


async def ensure_child_access(db: Db) -> None:
    await ensure_validated_collection(db, CHILD_ACCESS, CHILD_ACCESS_VALIDATOR)
    await _copy_indexes(db, CHILD_ACCESS)


async def ensure_inputs(db: Db, names: Iterable[str]) -> None:
    """The `*_inputs` copies a service keeps (7.7), e.g. grow: onboarding and personality."""
    for name in names:
        await ensure_validated_collection(db, name, INPUT_VALIDATORS[name])
        await _copy_indexes(db, name)
        if name == GROWTH_INPUTS:
            await db[name].create_index([("location", ASCENDING), ("child_id", ASCENDING)])


async def ensure_jobs(db: Db, service: str) -> None:
    await ensure_validated_collection(db, JOBS, jobs_validator(service))
    jobs = db[JOBS]
    await jobs.create_index([("location", ASCENDING), ("_id", ASCENDING)], unique=True)
    await jobs.create_index(
        [
            ("location", ASCENDING),
            ("child_id", ASCENDING),
            ("type", ASCENDING),
            ("status", ASCENDING),
        ]
    )
    # The claim query and the pending count, region-scoped.
    await jobs.create_index(
        [("location", ASCENDING), ("status", ASCENDING), ("retry_after", ASCENDING)]
    )
    await jobs.create_index([("location", ASCENDING), ("user_id", ASCENDING)])
    await jobs.create_index("completed_at", expireAfterSeconds=JOB_TTL_SECONDS)


# ── copies from events (7.7) ───────────────────────────────────────────────────


def child_access_fields(received: ReceivedEvent) -> dict[str, Any]:
    """What `child.changed` puts in `child_access`. `confirmed` is left alone (7.5)."""
    payload = received.payload
    progress = payload["progress"]
    return {
        "user_id": payload["user_id"],
        "name": payload.get("name"),
        "age": payload.get("age"),
        "gender": payload.get("gender"),
        "is_deleted": payload["is_deleted"],
        "progress": {flag: bool(progress.get(flag, False)) for flag in PROGRESS_FLAGS},
        "schema_version": SCHEMA_VERSION,
    }


def onboarding_inputs_fields(received: ReceivedEvent, user_id: str) -> dict[str, Any]:
    """From `onboarding.conversation_completed` / `onboarding.answers_updated`."""
    return {
        "user_id": user_id,
        **{field: received.payload.get(field) for field in ANSWER_FIELDS},
        "schema_version": SCHEMA_VERSION,
    }


def personality_inputs_fields(received: ReceivedEvent, user_id: str) -> dict[str, Any]:
    """From `discover.personality_finalised`."""
    return {
        "user_id": user_id,
        "traits": received.payload["traits"],
        "strengths": received.payload["strengths"],
        "schema_version": SCHEMA_VERSION,
    }


def growth_inputs_id(child_id: str, area_id: str) -> str:
    return f"{child_id}:{area_id}"


def growth_inputs_fields(received: ReceivedEvent, user_id: str) -> dict[str, Any]:
    """From `grow.area_completed` / `grow.area_updated`; `_id` is growth_inputs_id(...)."""
    payload = received.payload
    return {
        "user_id": user_id,
        "child_id": received.event.aggregate_id,
        "area_id": payload["area_id"],
        **{field: payload.get(field) for field in GROWTH_FIELDS},
        "schema_version": SCHEMA_VERSION,
    }


# ── unlock checks (12.4) ───────────────────────────────────────────────────────


def stage_done(child_access: Mapping[str, Any] | None, stage: str) -> bool:
    """True if `stage` is done in this copy: its progress flag, or a confirmed unlock (7.5).

    False can mean the copy is behind: confirm with the owning circle before refusing.
    """
    if stage not in PROGRESS_FLAGS:
        raise ValueError(f"unknown stage {stage!r}")
    if child_access is None:
        return False
    return bool(
        child_access.get("progress", {}).get(stage) or child_access.get("confirmed", {}).get(stage)
    )
