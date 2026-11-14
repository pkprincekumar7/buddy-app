"""`transform.kid_quests`: the child's quests in child view (docs/child-view-build-plan.md, 3.1).

One document per child, `_id` the child's id, created by the child's first pick or log and
removed with the child and the account. A sibling of `plans`, not part of it: the plan's
validator, `version` and events stay the parent's.

- `quests.json`: the nine interests, each with three quests (a title, how, and a target
  count) and the keywords that read an interest from the parent's plan `ask` (the web app's
  `readInterest`, `lib/startJourneyPlans.ts`, with `gaming` as the quests' `games`).
- `interests`: the ones the child added; `current`: the one on screen.
- `logs`: `interest:quest` → how many times it's been done, up to its target; `log_days`: the
  child's day of its last log. A quest is logged at most once a day.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any, Final, Literal, cast

from pymongo import ASCENDING

from common.events.store import Db, ensure_validated_collection

KID_QUESTS = "kid_quests"
# The interests' keys, as the API types them (quests.json's, checked by the tests).
QuestInterest = Literal[
    "football", "drawing", "music", "building", "cooking", "space", "animals", "reading", "games"
]  # fmt: skip
SCHEMA_VERSION = 1
QUESTS_PER_INTEREST: Final = 3
# The child's own day (their clock, not the server's) may differ from UTC by a day.
DAY_SLACK: Final = timedelta(days=1)

_DATA: dict[str, Any] = json.loads((Path(__file__).parent / "quests.json").read_text())
INTERESTS: Final[list[dict[str, Any]]] = _DATA["interests"]
INTEREST_KEYS: Final[tuple[str, ...]] = tuple(i["key"] for i in INTERESTS)
_BY_KEY: Final[dict[str, dict[str, Any]]] = {i["key"]: i for i in INTERESTS}

_LOG_KEY = r"^[a-z]{1,20}:[0-2]$"
_DAY = r"^\d{4}-\d{2}-\d{2}$"

KID_QUESTS_VALIDATOR: dict[str, Any] = {
    "$jsonSchema": {
        "bsonType": "object",
        "required": [
            "_id", "user_id", "location", "interests", "current", "logs", "log_days",
            "version", "created_at", "updated_at", "schema_version",
        ],
        "properties": {
            "_id": {"bsonType": "string"},
            "user_id": {"bsonType": "string"},
            "location": {"bsonType": "string"},
            "interests": {
                "bsonType": "array",
                "maxItems": len(INTEREST_KEYS),
                "items": {"enum": list(INTEREST_KEYS)},
            },
            "current": {"enum": [*INTEREST_KEYS, None]},
            "logs": {
                "bsonType": "object",
                "patternProperties": {_LOG_KEY: {"bsonType": ["int", "long"], "minimum": 0}},
                "additionalProperties": False,
            },
            "log_days": {
                "bsonType": "object",
                "patternProperties": {_LOG_KEY: {"bsonType": "string", "pattern": _DAY}},
                "additionalProperties": False,
            },
            "version": {"bsonType": ["int", "long"], "minimum": 1},
            "created_at": {"bsonType": "date"},
            "updated_at": {"bsonType": "date"},
            "schema_version": {"bsonType": ["int", "long"]},
        },
    }
}  # fmt: skip


async def ensure_kid_quests(db: Db) -> None:
    """The collection with its validator and the account-deletion index. Safe on every start."""
    collection = await ensure_validated_collection(db, KID_QUESTS, KID_QUESTS_VALIDATOR)
    await collection.create_index([("location", ASCENDING), ("user_id", ASCENDING)])


def empty(child_id: str, user_id: str, location: str, now: datetime) -> dict[str, Any]:
    """A child's quests before their first pick or log."""
    return {
        "_id": child_id,
        "user_id": user_id,
        "location": location,
        "interests": [],
        "current": None,
        "logs": {},
        "log_days": {},
        "version": 1,
        "created_at": now,
        "updated_at": now,
        "schema_version": SCHEMA_VERSION,
    }


def check_day(day: str, now: datetime) -> date:
    """The child's day as sent: a real date within a day of the server's (ValueError if not)."""
    parsed = date.fromisoformat(day)
    if abs(parsed - now.astimezone(UTC).date()) > DAY_SLACK:
        raise ValueError("that day isn't today")
    return parsed


def default_interest(ask: str | None) -> QuestInterest | None:
    """The interest the parent's plan `ask` names (its first keyword match), or None."""
    text = (ask or "").lower()
    for interest in INTERESTS:
        if any(word in text for word in interest["match"]):
            return cast(QuestInterest, interest["key"])
    return None


def target(interest: str, quest: int) -> int:
    """How many times a quest is done to finish it (KeyError/IndexError if there's no such)."""
    return int(_BY_KEY[interest]["quests"][quest]["target"])


def log_key(interest: str, quest: int) -> str:
    return f"{interest}:{quest}"


def catalog() -> list[dict[str, Any]]:
    """Every interest and its quests, as the kids page shows them."""
    return [
        {"key": i["key"], "label": i["label"], "quests": [dict(q) for q in i["quests"]]}
        for i in INTERESTS
    ]


def logged_on(log_days: Mapping[str, str], day: str) -> list[str]:
    """The quests done for `day`: logged on it, or on a later day (a clock moved back),
    which a log on `day` can't pass either."""
    return sorted(key for key, logged in log_days.items() if logged >= day)
