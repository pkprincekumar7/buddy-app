"""`transform.plans`: one document per child (docs/auth-users-split.md, 12.1; today's
`ninety_day_plans`).

`_id` is the child id, so the unique `{location, _id}` index (the future shard key, 14)
allows one per child. The generated parts are written by transform's jobs only, each under
its own lock in `active_jobs`: `plan`, `track_steps`, and `life_pathway.<area_id>` (one lock
per area, `generate_life_pathway:<area_id>`). Everything else is the parent's, through
PATCH. `completed_at` is set once, when `plan` exists and the Day-90 event is set, and
publishes `transform.completed`. `version` counts every write that's carried by an event.

Everything here describes a child: never logged, deleted with the child or the account.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Final, Literal

from pymongo import ASCENDING

from common.events.store import Db, ensure_validated_collection

PLANS = "plans"
SCHEMA_VERSION = 1
MAX_BYTES = 64 * 1024  # the body and the whole document, as today
MAP_KEY_PATTERN = r"^[a-zA-Z0-9:_-]{1,100}$"
ASK_MAX = 2000
EVENT_NAME_MAX = 200

Kind = Literal["life_pathway", "plan", "event_tracker"]
JOB_TYPES: Final[dict[Kind, str]] = {
    "life_pathway": "generate_life_pathway",
    "plan": "generate_ninety_day_plan",
    "event_tracker": "generate_event_tracker",
}
KINDS: Final[dict[str, Kind]] = {job_type: kind for kind, job_type in JOB_TYPES.items()}


def lock_name(kind: Kind, area_id: str | None = None) -> str:
    """The `active_jobs` key: one per kind, and one per area for the Life Pathway."""
    return f"{JOB_TYPES[kind]}:{area_id}" if kind == "life_pathway" else JOB_TYPES[kind]


_DATE = {"bsonType": "date"}
_MAP = {"bsonType": "object"}

PLANS_VALIDATOR: dict[str, Any] = {
    "$jsonSchema": {
        "bsonType": "object",
        "required": [
            "_id", "user_id", "child_id", "location", "event_set", "version",
            "created_at", "updated_at", "schema_version",
        ],
        "properties": {
            "_id": {"bsonType": "string"},
            "user_id": {"bsonType": "string"},
            "child_id": {"bsonType": "string"},
            "location": {"bsonType": "string"},
            "life_pathway": _MAP,
            "ask": {"bsonType": ["string", "null"], "maxLength": ASK_MAX},
            "plan": _MAP,
            "track_steps": _MAP,
            "applied": _MAP,
            "act_inputs": _MAP,
            "act_counts": _MAP,
            "track_done": _MAP,
            "track_inputs": _MAP,
            "track_sittings": _MAP,
            "feedback": _MAP,
            "event_name": {"bsonType": ["string", "null"], "maxLength": EVENT_NAME_MAX},
            "event_date": {"bsonType": ["date", "null"]},
            "event_set": {"bsonType": "bool"},
            "photos": _MAP,
            "active_jobs": _MAP,
            "completed_at": _DATE,
            "version": {"bsonType": ["int", "long"], "minimum": 1},
            "created_at": _DATE,
            "updated_at": _DATE,
            "schema_version": {"bsonType": ["int", "long"]},
        },
    }
}  # fmt: skip


def new_plan(child_id: str, user_id: str, location: str, now: datetime) -> dict[str, Any]:
    """What a plan starts as, before the parent's first save or the first job."""
    return {
        "_id": child_id,
        "user_id": user_id,
        "child_id": child_id,
        "location": location,
        "event_set": False,
        "version": 1,
        "created_at": now,
        "updated_at": now,
        "schema_version": SCHEMA_VERSION,
    }


async def ensure_plans(db: Db) -> None:
    """The collection with its validator and indexes. Safe to run on every start."""
    plans = await ensure_validated_collection(db, PLANS, PLANS_VALIDATOR)
    await plans.create_index([("location", ASCENDING), ("_id", ASCENDING)], unique=True)
    await plans.create_index([("location", ASCENDING), ("user_id", ASCENDING)])
