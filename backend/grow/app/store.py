"""`grow.growth_areas`: one document per child per area (docs/auth-users-split.md, 12.1, 14).

`_id` is `{child_id}:{area_id}`, so the unique `{location, _id}` index (the future shard
key) allows one per area. `status` is the parent's wizard (`in_progress` / `completed`);
jobs never change it. The generated parts (`parent_questions`, `child_rounds`,
`ai_three_month_recommendations`) are written by grow's jobs only, each under its own lock
in `active_jobs` (one generation per kind per area). `version` counts the parent's saves
and the recommendations' results, and is carried by `grow.*` events (7.4).

Everything here describes a child: never logged, deleted with the child or the account.
"""

from __future__ import annotations

import re
from typing import Any, Final, Literal

from pymongo import ASCENDING

from common.events.store import Db, ensure_validated_collection

GROWTH_AREAS = "growth_areas"
SCHEMA_VERSION = 1
MAX_AREA_BYTES = 64 * 1024  # the whole area, as today's request cap

# area_id: today's ids, and never one of the circles' path words, which the ALB's
# mid-path patterns would send to the wrong service (13.1).
AREA_ID_PATTERN = r"^[a-z0-9_-]{1,50}$"
RESERVED_PREFIXES: tuple[str, ...] = (
    "onboarding", "personality", "growth-areas", "transform", "observations", "connect",
)  # fmt: skip
NAME_MAX = 100
STEP_MAX = 100
ANSWERS_MAX_KEYS = 100
ANSWER_MAX = 1000
SELECTIONS_MAX = 50
SUMMARY_MAX = 2000
LIST_MAX = 20
RECOMMENDATIONS_MAX = 50
FEEDBACK_MAX = 2000

# The API's kinds and today's job types (4.1).
Kind = Literal["parent_questions", "child_rounds", "recommendations"]
JOB_TYPES: Final[dict[Kind, str]] = {
    "parent_questions": "generate_growth_parent_questions",
    "child_rounds": "generate_growth_child_rounds",
    "recommendations": "generate_recommendations",
}
KINDS: Final[dict[str, Kind]] = {job_type: kind for kind, job_type in JOB_TYPES.items()}
# Where each kind's result goes on the area.
FIELDS: Final[dict[Kind, str]] = {
    "parent_questions": "parent_questions",
    "child_rounds": "child_rounds",
    "recommendations": "ai_three_month_recommendations",
}

_DATE = {"bsonType": "date"}

GROWTH_AREAS_VALIDATOR: dict[str, Any] = {
    "$jsonSchema": {
        "bsonType": "object",
        "required": [
            "_id", "user_id", "child_id", "location", "area_id", "area_name", "status",
            "answers", "version", "created_at", "updated_at", "schema_version",
        ],
        "properties": {
            "_id": {"bsonType": "string"},
            "user_id": {"bsonType": "string"},
            "child_id": {"bsonType": "string"},
            "location": {"bsonType": "string"},
            "area_id": {"bsonType": "string", "pattern": AREA_ID_PATTERN},
            "area_name": {"bsonType": "string", "minLength": 1, "maxLength": NAME_MAX},
            "status": {"enum": ["in_progress", "completed"]},
            "step": {"bsonType": ["string", "null"], "maxLength": STEP_MAX},
            "parent_questions": {"bsonType": "object"},
            "child_rounds": {"bsonType": "object"},
            "answers": {"bsonType": "object"},
            "child_activity": {"bsonType": ["object", "null"]},
            "recommendations": {"bsonType": ["array", "null"], "maxItems": RECOMMENDATIONS_MAX},
            "ai_three_month_recommendations": {"bsonType": "array"},
            "feedback": {"bsonType": ["string", "null"], "maxLength": FEEDBACK_MAX},
            "active_jobs": {"bsonType": "object"},
            "completed_at": _DATE,
            "version": {"bsonType": ["int", "long"], "minimum": 1},
            "created_at": _DATE,
            "updated_at": _DATE,
            "schema_version": {"bsonType": ["int", "long"]},
        },
    }
}  # fmt: skip


def area_doc_id(child_id: str, area_id: str) -> str:
    return f"{child_id}:{area_id}"


def valid_area_id(area_id: str) -> bool:
    return bool(re.fullmatch(AREA_ID_PATTERN, area_id)) and not area_id.startswith(
        RESERVED_PREFIXES
    )


async def ensure_growth_areas(db: Db) -> None:
    """The collection with its validator and indexes. Safe to run on every start."""
    areas = await ensure_validated_collection(db, GROWTH_AREAS, GROWTH_AREAS_VALIDATOR)
    await areas.create_index([("location", ASCENDING), ("_id", ASCENDING)], unique=True)
    await areas.create_index([("location", ASCENDING), ("user_id", ASCENDING)])
    # A child's areas in one query (GET, the first-completed check, the internal reads).
    await areas.create_index(
        [("location", ASCENDING), ("child_id", ASCENDING), ("created_at", ASCENDING)]
    )
