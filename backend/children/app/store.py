"""`children.children`: one document per child (docs/auth-users-split.md, 12.1, 14).

The child's `_id` is its id everywhere; `user_id` is the parent's, and `location` the
parent's, copied at create and immutable (the future shard key `{location, _id}`). A
parent's queries filter by `{location, user_id}`, so someone else's child is never found
(12.3). `version` counts every write and is carried by `child.changed` (7.4).

`progress` has one one-way flag per journey stage (12.4). children sets `profile` itself
when `name`, `age` and `gender` are first all present; the others follow the circles'
completion events (the worker, build plan 4.2).
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from typing import Any

from pymongo import ASCENDING

from common.events.store import Db, ensure_validated_collection
from common.models import PROGRESS_FLAGS

CHILDREN = "children"
SCHEMA_VERSION = 1
MAX_CHILDREN = 10

NAME_MAX = 255
GENDER_MAX = 50
SCHOOL_MAX = 300
AVATAR_ID_MAX = 100
AGE_MIN, AGE_MAX = 0, 25

# What child.changed carries: the circles' child_access copy (4.1, 7.7).
SNAPSHOT_FIELDS: tuple[str, ...] = ("name", "age", "gender")

CHILDREN_VALIDATOR: dict[str, Any] = {
    "$jsonSchema": {
        "bsonType": "object",
        "required": [
            "_id", "user_id", "location", "name", "progress", "is_deleted", "version",
            "created_at", "updated_at", "schema_version",
        ],
        "properties": {
            "_id": {"bsonType": "string"},
            "user_id": {"bsonType": "string"},
            "location": {"bsonType": "string"},
            "name": {"bsonType": "string", "minLength": 1, "maxLength": NAME_MAX},
            "age": {"bsonType": ["int", "long", "null"], "minimum": AGE_MIN, "maximum": AGE_MAX},
            "gender": {"bsonType": ["string", "null"], "maxLength": GENDER_MAX},
            "school": {"bsonType": ["string", "null"], "maxLength": SCHOOL_MAX},
            "avatar_id": {"bsonType": ["string", "null"], "maxLength": AVATAR_ID_MAX},
            "avatar_key": {"bsonType": ["string", "null"]},
            "progress": {
                "bsonType": "object",
                "required": list(PROGRESS_FLAGS),
                "properties": {flag: {"bsonType": "bool"} for flag in PROGRESS_FLAGS},
            },
            "is_deleted": {"bsonType": "bool"},
            "deleted_at": {"bsonType": ["date", "null"]},
            "version": {"bsonType": ["int", "long"], "minimum": 1},
            "created_at": {"bsonType": "date"},
            "updated_at": {"bsonType": "date"},
            "schema_version": {"bsonType": ["int", "long"]},
        },
    }
}  # fmt: skip


async def ensure_children(db: Db) -> None:
    """The collection with its validator and section-14 indexes. Safe on every start."""
    children = await ensure_validated_collection(db, CHILDREN, CHILDREN_VALIDATOR)
    await children.create_index([("location", ASCENDING), ("_id", ASCENDING)], unique=True)
    # Home's one query (12.2), and the 10-children limit.
    await children.create_index(
        [("location", ASCENDING), ("user_id", ASCENDING), ("is_deleted", ASCENDING)]
    )
    # The 30-day purge, across all users (4.2).
    await children.create_index("deleted_at", partialFilterExpression={"is_deleted": True})


def profile_complete(doc: Mapping[str, Any]) -> bool:
    """The profile step is done once name, age and gender are all present (12.1)."""
    return all(doc.get(name) not in (None, "") for name in ("name", "age", "gender"))


def new_child(
    child_id: str, user_id: str, location: str, fields: Mapping[str, Any], now: datetime
) -> dict[str, Any]:
    doc: dict[str, Any] = {
        "_id": child_id,
        "user_id": user_id,
        "location": location,
        "name": fields["name"],
        **{name: fields.get(name) for name in ("age", "gender", "school", "avatar_id")},
        "avatar_key": None,
        "progress": dict.fromkeys(PROGRESS_FLAGS, False),
        "is_deleted": False,
        "deleted_at": None,
        "version": 1,
        "created_at": now,
        "updated_at": now,
        "schema_version": SCHEMA_VERSION,
    }
    doc["progress"]["profile"] = profile_complete(doc)
    return doc


def snapshot(doc: Mapping[str, Any]) -> dict[str, Any]:
    """child.changed's payload: the full child_access snapshot (7.4)."""
    return {
        "user_id": doc["user_id"],
        **{name: doc.get(name) for name in SNAPSHOT_FIELDS},
        "is_deleted": bool(doc.get("is_deleted")),
        "progress": {flag: bool(doc["progress"].get(flag)) for flag in PROGRESS_FLAGS},
    }
