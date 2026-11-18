"""`discover.personalities`: one personality per child (docs/auth-users-split.md, 12.1).

`_id` is the child id, so the unique `{location, _id}` index (the future shard key, 14)
also allows one personality per child. No document means `not_started`. The job lock is
`active_job_id` (common.generation.jobs). `version` counts the result's writes (finalising,
then the reveal) and is carried by `discover.*` events (7.4).

`view_model` is what the Discover pages render, built by the server; `analysis` is the
raw LLM answer, kept for support and never returned to clients. Both describe a child:
never logged, deleted with the child or the account.
"""

from __future__ import annotations

from typing import Any, Final

from pymongo import ASCENDING

from common.events.store import Db, ensure_validated_collection

PERSONALITIES = "personalities"
STATUSES: tuple[str, ...] = ("not_started", "generating", "ready", "failed")
JOB_TYPE = "generate_personality_analysis"
KIND: Final = "personality"

_DATE = {"bsonType": "date"}

PERSONALITIES_VALIDATOR: dict[str, Any] = {
    "$jsonSchema": {
        "bsonType": "object",
        "required": [
            "_id", "user_id", "child_id", "location", "status", "source", "version",
            "created_at", "updated_at", "schema_version",
        ],
        "properties": {
            "_id": {"bsonType": "string"},
            "user_id": {"bsonType": "string"},
            "child_id": {"bsonType": "string"},
            "location": {"bsonType": "string"},
            "status": {"enum": list(STATUSES)},
            "view_model": {"bsonType": "object"},
            "analysis": {"bsonType": "object"},
            "source": {"enum": ["llm"]},
            "active_job_id": {"bsonType": "string"},
            "finalised_at": _DATE,
            "viewed_at": _DATE,
            "version": {"bsonType": ["int", "long"], "minimum": 1},
            "created_at": _DATE,
            "updated_at": _DATE,
            "schema_version": {"bsonType": ["int", "long"]},
        },
    }
}  # fmt: skip


async def ensure_personalities(db: Db) -> None:
    """The collection with its validator and indexes. Safe to run on every start."""
    personalities = await ensure_validated_collection(db, PERSONALITIES, PERSONALITIES_VALIDATOR)
    await personalities.create_index([("location", ASCENDING), ("_id", ASCENDING)], unique=True)
    # Account deletion removes every personality of a user.
    await personalities.create_index([("location", ASCENDING), ("user_id", ASCENDING)])
