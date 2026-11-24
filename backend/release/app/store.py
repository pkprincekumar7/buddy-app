"""`release.observations`: one document per child (docs/auth-users-split.md, 12.1).

`_id` is the child id, so the unique `{location, _id}` index (the future shard key, 14)
allows one per child. No document means `not_started`. `items` are written by release's job
only, already normalised (release.app.observations); the parent sets `watching` and `span`.
`completed_at` is set the first time `watching` is non-empty, and publishes
`release.completed`. `version` counts every write.

Everything here describes a child: never logged, deleted with the child or the account.
"""

from __future__ import annotations

from typing import Any, Final

from pymongo import ASCENDING

from common.events.store import Db, ensure_validated_collection

OBSERVATIONS = "observations"
SCHEMA_VERSION_DEFAULT = 1
STATUSES: tuple[str, ...] = ("not_started", "generating", "ready", "failed")
JOB_TYPE = "generate_observations"
KIND: Final = "observations"
WATCHING_MAX = 8
PATTERN_ID_MAX = 100
SPAN_MAX = 50

_DATE = {"bsonType": "date"}

OBSERVATIONS_VALIDATOR: dict[str, Any] = {
    "$jsonSchema": {
        "bsonType": "object",
        "required": [
            "_id", "user_id", "child_id", "location", "status", "version",
            "created_at", "updated_at", "schema_version",
        ],
        "properties": {
            "_id": {"bsonType": "string"},
            "user_id": {"bsonType": "string"},
            "child_id": {"bsonType": "string"},
            "location": {"bsonType": "string"},
            "status": {"enum": list(STATUSES)},
            "source": {"bsonType": "string", "maxLength": 50},
            "items": {"bsonType": "array", "maxItems": 8},
            "watching": {
                "bsonType": "array",
                "maxItems": WATCHING_MAX,
                "items": {"bsonType": "string", "maxLength": PATTERN_ID_MAX},
            },
            "span": {"bsonType": ["string", "null"], "maxLength": SPAN_MAX},
            "started_at": _DATE,
            "active_job_id": {"bsonType": "string"},
            "completed_at": _DATE,
            "version": {"bsonType": ["int", "long"], "minimum": 1},
            "created_at": _DATE,
            "updated_at": _DATE,
            "schema_version": {"bsonType": ["int", "long"]},
        },
    }
}  # fmt: skip


async def ensure_observations(db: Db) -> None:
    """The collection with its validator and indexes. Safe to run on every start."""
    observations = await ensure_validated_collection(db, OBSERVATIONS, OBSERVATIONS_VALIDATOR)
    await observations.create_index([("location", ASCENDING), ("_id", ASCENDING)], unique=True)
    await observations.create_index([("location", ASCENDING), ("user_id", ASCENDING)])
