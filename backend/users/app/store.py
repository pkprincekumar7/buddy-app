"""`users.users`: one profile per account (docs/auth-users-split.md, 5.3, 14).

Its `_id` is the account's id in auth, and `location` is the account's, fixed for life: every
read and write is filtered by both, so the future shard key `{location, _id}` targets each.
`version` counts every write (7.4). There's no `email` (auth holds it), no `full_name` (the
apps join the name parts) and no `dark_mode` or `last_visited_path` (5.3).

Address lines are personal data: never logged, deleted with the account.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from typing import Any

from pymongo import ASCENDING

from common.events.store import Db, ensure_validated_collection

USERS = "users"
SCHEMA_VERSION = 1

NAME_MAX = 100
ADDRESS_MAX = 200
NAME_FIELDS: tuple[str, ...] = ("first_name", "middle_name", "last_name")
ADDRESS_FIELDS: tuple[str, ...] = ("address_line_one", "address_line_two", "address_line_three")
PROFILE_FIELDS: tuple[str, ...] = NAME_FIELDS + ADDRESS_FIELDS

DEFAULT_PREFERENCES: dict[str, Any] = {"tts_enabled": True}

_OPTIONAL_NAME = {"bsonType": ["string", "null"], "maxLength": NAME_MAX}
_OPTIONAL_ADDRESS = {"bsonType": ["string", "null"], "maxLength": ADDRESS_MAX}

USERS_VALIDATOR: dict[str, Any] = {
    "$jsonSchema": {
        "bsonType": "object",
        "required": [
            "_id", "location", "version", "first_name", "preferences",
            "created_at", "updated_at", "schema_version",
        ],
        "properties": {
            "_id": {"bsonType": "string"},
            "location": {"bsonType": "string"},
            "version": {"bsonType": ["int", "long"], "minimum": 1},
            "first_name": {"bsonType": "string", "minLength": 1, "maxLength": NAME_MAX},
            "middle_name": _OPTIONAL_NAME,
            "last_name": _OPTIONAL_NAME,
            "address_line_one": _OPTIONAL_ADDRESS,
            "address_line_two": _OPTIONAL_ADDRESS,
            "address_line_three": _OPTIONAL_ADDRESS,
            "preferences": {
                "bsonType": "object",
                "required": ["tts_enabled"],
                "properties": {"tts_enabled": {"bsonType": "bool"}},
            },
            "created_at": {"bsonType": "date"},
            "updated_at": {"bsonType": "date"},
            "schema_version": {"bsonType": ["int", "long"]},
        },
    }
}  # fmt: skip


async def ensure_users(db: Db) -> None:
    """The collection with its validator and indexes. Safe to run on every start."""
    users = await ensure_validated_collection(db, USERS, USERS_VALIDATOR)
    await users.create_index([("location", ASCENDING), ("_id", ASCENDING)], unique=True)


def new_profile(
    user_id: str, location: str, fields: Mapping[str, str | None], now: datetime
) -> dict[str, Any]:
    """A new profile document: the given name and address fields, default preferences."""
    return {
        "_id": user_id,
        "location": location,
        "version": 1,
        **{name: fields.get(name) for name in PROFILE_FIELDS},
        "preferences": dict(DEFAULT_PREFERENCES),
        "created_at": now,
        "updated_at": now,
        "schema_version": SCHEMA_VERSION,
    }


def profile_view(doc: Mapping[str, Any]) -> dict[str, Any]:
    """What `GET …/profile` returns: no preferences, no internal counters."""
    return {
        "id": doc["_id"],
        **{name: doc.get(name) for name in PROFILE_FIELDS},
        "location": doc["location"],
        "created_at": doc["created_at"],
        "updated_at": doc["updated_at"],
    }


def preferences_view(doc: Mapping[str, Any]) -> dict[str, Any]:
    stored = doc.get("preferences") or {}
    return {key: stored.get(key, default) for key, default in DEFAULT_PREFERENCES.items()}
