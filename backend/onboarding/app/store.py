"""`onboarding.conversations`: one finished conversation per child (docs/auth-users-split.md, 12.1).

`_id` is the child id, so the unique `{location, _id}` index (the future shard key, 14)
also allows only one conversation per child. The document exists only once the chat is
finished: the app keeps the answers until the seventh, then sends all seven at once, so
there's no "in progress" state here. `version` counts every write and is carried by the
`onboarding.*` events (7.4).

The answers are about a child: never logged, deleted with the child or the account.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from typing import Any

from pymongo import ASCENDING

from common.events.store import Db, ensure_validated_collection
from common.models import ANSWER_FIELDS

CONVERSATIONS = "conversations"
SCHEMA_VERSION = 1

# The API's limits (docs/auth-users-split-api.md, PUT …/onboarding).
LIST_FIELDS: tuple[str, ...] = ("strengths", "hobbies")
TEXT_FIELDS: tuple[str, ...] = tuple(f for f in ANSWER_FIELDS if f not in LIST_FIELDS)
LIST_MAX_ITEMS = 20
ITEM_MAX = 200
TEXT_MAX = 500

_LIST = {
    "bsonType": "array",
    "minItems": 1,
    "maxItems": LIST_MAX_ITEMS,
    "items": {"bsonType": "string", "minLength": 1, "maxLength": ITEM_MAX},
}
_TEXT = {"bsonType": "string", "minLength": 1, "maxLength": TEXT_MAX}

CONVERSATIONS_VALIDATOR: dict[str, Any] = {
    "$jsonSchema": {
        "bsonType": "object",
        "required": [
            "_id", "user_id", "child_id", "location", "answers", "completed_at",
            "version", "created_at", "updated_at", "schema_version",
        ],
        "properties": {
            "_id": {"bsonType": "string"},
            "user_id": {"bsonType": "string"},
            "child_id": {"bsonType": "string"},
            "location": {"bsonType": "string"},
            "answers": {
                "bsonType": "object",
                "required": list(ANSWER_FIELDS),
                "additionalProperties": False,
                "properties": {
                    **dict.fromkeys(LIST_FIELDS, _LIST),
                    **dict.fromkeys(TEXT_FIELDS, _TEXT),
                },
            },
            "completed_at": {"bsonType": "date"},
            "version": {"bsonType": ["int", "long"], "minimum": 1},
            "created_at": {"bsonType": "date"},
            "updated_at": {"bsonType": "date"},
            "schema_version": {"bsonType": ["int", "long"]},
        },
    }
}  # fmt: skip


async def ensure_conversations(db: Db) -> None:
    """The collection with its validator and indexes. Safe to run on every start."""
    conversations = await ensure_validated_collection(db, CONVERSATIONS, CONVERSATIONS_VALIDATOR)
    await conversations.create_index([("location", ASCENDING), ("_id", ASCENDING)], unique=True)
    # Account deletion removes every conversation of a user.
    await conversations.create_index([("location", ASCENDING), ("user_id", ASCENDING)])


def to_millis(moment: datetime) -> datetime:
    """MongoDB keeps dates to the millisecond: a response shows what a later GET will."""
    return moment.replace(microsecond=moment.microsecond // 1000 * 1000)


def new_conversation(
    child_id: str, user_id: str, location: str, answers: Mapping[str, Any], now: datetime
) -> dict[str, Any]:
    return {
        "_id": child_id,
        "user_id": user_id,
        "child_id": child_id,
        "location": location,
        "answers": dict(answers),
        "completed_at": now,
        "version": 1,
        "created_at": now,
        "updated_at": now,
        "schema_version": SCHEMA_VERSION,
    }
