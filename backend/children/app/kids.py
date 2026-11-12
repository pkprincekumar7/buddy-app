"""`children.kid_activity`: what a child does in child view (docs/child-view-build-plan.md, 2.1).

One document per child, `_id` the child's id, created by the child's first action and removed
with the child (the 30-day purge, and account deletion). It's the parent's data like the rest
of the child's: the parent's `{location, user_id}` own it, and only parents write it.

**Stars are the server's:** a client sends what the child did (`flip_power`, `try_power`,
`game_best`, `mood`), never a count, and each award is given once, keyed in `awards`:

- `power:<i>`: the first flip of power `i` (+1);
- `try:<i>:<date>`: "Try this today" for power `i`, once a day (+1);
- `badge:discover`: every power flipped (+3);
- `mood:<date>`: Release's check-in, once a day (+1);
- `quest:<interest>:<i>`: a Transform quest's first log (+1), from transform's
  `transform.quest_logged` (transform keeps the counts). Grow's worlds come the same way, from
  `grow.world_played` into `worlds_done` (children.app.lifecycle.record_child_view).

A mood note is the child's own words: capped, and never logged.

**Shown wins** (P.2, 4.1): child view doesn't share anywhere. "Show my grown-up" keeps the win
in `shown` (`<key>` → its title and when), and the parent shares it from parent view's
Connect. No stars; at most SHOWN_MAX wins are kept.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from datetime import UTC, date, datetime, timedelta
from typing import Any, Final, Literal

from pymongo import ASCENDING
from pymongo.asynchronous.client_session import AsyncClientSession

from common.events.store import Db, ensure_validated_collection

KID_ACTIVITY = "kid_activity"
SCHEMA_VERSION = 1

# Discover's powers: 2.5 maps the child's personality onto this many (the prototype's seven).
POWER_COUNT: Final = 7
GAMES: Final = ("focus", "curious", "order", "draw", "climb", "voice", "energy")
MOODS: Final = ("great", "good", "okay", "low", "upset")
# Transform's quest interests (transform/app/quests.json), three quests each.
QUEST_INTERESTS: Final = (
    "football", "drawing", "music", "building", "cooking", "space", "animals", "reading", "games",
)  # fmt: skip
NOTE_MAX: Final = 500
SHOWN_MAX: Final = 60
WIN_TITLE_MAX: Final = 80
# A win's key, made by the apps from what it's about (`badge:discover`, `quest:space:2`…).
WIN_KEY_PATTERN: Final = r"^[a-z]{1,12}(:[a-z0-9_-]{1,20}){0,3}$"
# A game's best time is a few seconds; anything outside this isn't a real finish.
BEST_MIN_SECONDS, BEST_MAX_SECONDS = 0.5, 600.0
# The child's own day (their clock, not the server's) may differ from UTC by a day.
DAY_SLACK: Final = timedelta(days=1)
# What GET returns of the moods: enough for the streak and a month's view.
MOODS_SHOWN_DAYS: Final = 62

STARS: Final[Mapping[str, int]] = {"power": 1, "try": 1, "badge": 3, "mood": 1, "quest": 1}
BADGE_DISCOVER: Final = "badge:discover"

DATE_PATTERN: Final = r"^\d{4}-\d{2}-\d{2}$"
_AWARD_KEY = re.compile(
    r"^(power:[0-6]|try:[0-6]:\d{4}-\d{2}-\d{2}|badge:discover|mood:\d{4}-\d{2}-\d{2}"
    rf"|quest:({'|'.join(QUEST_INTERESTS)}):[0-2])$"
)

# Child view opens its circles in its own order (decided 2026-11-11), from what the child has
# done there, apart from the parent's progress: Discover once the parent's chat is done (the
# powers need the personality), then each circle once the one before is done in child view.
CIRCLES: Final = ("discover", "grow", "transform", "release", "connect")
Circle = Literal["discover", "grow", "transform", "release", "connect"]
ACTION_CIRCLE: Final[Mapping[str, Circle]] = {
    "flip_power": "discover",
    "try_power": "discover",
    "game_best": "discover",
    "mood": "release",
    "show_win": "connect",
}
WORLD_COUNT: Final = 6

# The actions the kids events API takes. Grow's worlds and Transform's quests come from grow
# and transform instead (grow.world_played, transform.quest_logged: children.app.lifecycle).
Action = Literal["flip_power", "try_power", "game_best", "mood", "show_win"]

KID_ACTIVITY_VALIDATOR: dict[str, Any] = {
    "$jsonSchema": {
        "bsonType": "object",
        "required": [
            "_id", "user_id", "location", "stars", "awards", "flipped_powers", "best_times",
            "moods", "version", "created_at", "updated_at", "schema_version",
        ],
        "properties": {
            "_id": {"bsonType": "string"},
            "user_id": {"bsonType": "string"},
            "location": {"bsonType": "string"},
            "stars": {"bsonType": ["int", "long"], "minimum": 0},
            "awards": {"bsonType": "object", "additionalProperties": {"bsonType": "date"}},
            "flipped_powers": {
                "bsonType": "array",
                "maxItems": POWER_COUNT,
                "items": {"bsonType": ["int", "long"], "minimum": 0, "maximum": POWER_COUNT - 1},
            },
            "best_times": {
                "bsonType": "object",
                "additionalProperties": {
                    "bsonType": ["double", "int", "long"],
                    "minimum": BEST_MIN_SECONDS,
                    "maximum": BEST_MAX_SECONDS,
                },
            },
            "moods": {
                "bsonType": "object",
                "additionalProperties": {
                    "bsonType": "object",
                    "required": ["mood", "at"],
                    "properties": {
                        "mood": {"enum": list(MOODS)},
                        "note": {"bsonType": ["string", "null"], "maxLength": NOTE_MAX},
                        "at": {"bsonType": "date"},
                    },
                },
            },
            "worlds_done": {
                "bsonType": "array",
                "maxItems": WORLD_COUNT,
                "items": {"bsonType": ["int", "long"], "minimum": 0, "maximum": WORLD_COUNT - 1},
            },
            "shown": {
                "bsonType": "object",
                "maxProperties": SHOWN_MAX,
                "additionalProperties": {
                    "bsonType": "object",
                    "required": ["title", "at"],
                    "properties": {
                        "title": {"bsonType": "string", "maxLength": WIN_TITLE_MAX},
                        "at": {"bsonType": "date"},
                    },
                },
            },
            "version": {"bsonType": ["int", "long"], "minimum": 1},
            "created_at": {"bsonType": "date"},
            "updated_at": {"bsonType": "date"},
            "schema_version": {"bsonType": ["int", "long"]},
        },
    }
}  # fmt: skip


async def ensure_kid_activity(db: Db) -> None:
    """The collection with its validator and the account-deletion index. Safe on every start."""
    collection = await ensure_validated_collection(db, KID_ACTIVITY, KID_ACTIVITY_VALIDATOR)
    await collection.create_index([("location", ASCENDING), ("user_id", ASCENDING)])


def empty(child_id: str, user_id: str, location: str, now: datetime) -> dict[str, Any]:
    """A child's activity before their first action."""
    return {
        "_id": child_id,
        "user_id": user_id,
        "location": location,
        "stars": 0,
        "awards": {},
        "flipped_powers": [],
        "best_times": {},
        "moods": {},
        "version": 1,
        "created_at": now,
        "updated_at": now,
        "schema_version": SCHEMA_VERSION,
    }


def check_day(day: str, now: datetime) -> date:
    """The child's day as sent: a real date within a day of the server's (ValueError if not)."""
    parsed = date.fromisoformat(day)
    today = now.astimezone(UTC).date()
    if abs(parsed - today) > DAY_SLACK:
        raise ValueError("that day isn't today")
    return parsed


def award_stars(key: str) -> int:
    """The stars an award key is worth (its kind's)."""
    if not _AWARD_KEY.match(key):
        raise ValueError(f"unknown award {key!r}")
    return STARS[key.split(":", 1)[0]]


async def ensure_doc(
    db: Db, child: Mapping[str, Any], now: datetime, session: AsyncClientSession | None = None
) -> None:
    """Create the child's activity if this is their first action."""
    await db[KID_ACTIVITY].update_one(
        {"_id": child["_id"], "location": child["location"]},
        {"$setOnInsert": empty(child["_id"], child["user_id"], child["location"], now)},
        upsert=True,
        session=session,
    )


async def give_award(
    db: Db,
    child: Mapping[str, Any],
    key: str,
    now: datetime,
    extra: Mapping[str, Any] | None = None,
    session: AsyncClientSession | None = None,
) -> bool:
    """Give `key`'s stars once: True if this call gave them, False if it was given before.

    The filter carries the award's absence, so two requests at once give it once."""
    result = await db[KID_ACTIVITY].update_one(
        {"_id": child["_id"], "location": child["location"], f"awards.{key}": {"$exists": False}},
        {
            "$set": {f"awards.{key}": now, "updated_at": now},
            "$inc": {"stars": award_stars(key), "version": 1},
            **(extra or {}),
        },
        session=session,
    )
    return result.modified_count == 1


def recent_moods(moods: Mapping[str, Any], today: date) -> dict[str, dict[str, Any]]:
    """The last MOODS_SHOWN_DAYS days' moods, newest first, for the streak and the month."""
    oldest = today - timedelta(days=MOODS_SHOWN_DAYS - 1)
    shown = {
        day: {"mood": value["mood"], "note": value.get("note")}
        for day, value in moods.items()
        if oldest <= date.fromisoformat(day) <= today + DAY_SLACK
    }
    return dict(sorted(shown.items(), reverse=True))


def tried_on(awards: Mapping[str, Any], day: str) -> list[int]:
    """The powers whose "Try this today" was done on `day`."""
    return sorted(
        int(key.split(":")[1])
        for key in awards
        if key.startswith("try:") and key.endswith(f":{day}")
    )


def circles_done(doc: Mapping[str, Any]) -> dict[str, bool]:
    """Which circles the child has done in child view: Discover's badge (every power open), a
    Grow world finished, a Transform quest logged, a Release check-in, a Connect win shown."""
    awards = doc.get("awards", {})
    return {
        "discover": BADGE_DISCOVER in awards,
        "grow": bool(doc.get("worlds_done")),
        "transform": any(key.startswith("quest:") for key in awards),
        "release": bool(doc.get("moods")),
        "connect": bool(doc.get("shown")),
    }


def circle_open(circle: str, progress: Mapping[str, Any], done: Mapping[str, bool]) -> bool:
    """Whether a circle is open in child view: Discover once the parent's chat is done, each
    other once the one before it is done in child view."""
    if circle == "discover":
        return bool(progress.get("conversation"))
    before = CIRCLES[CIRCLES.index(circle) - 1]
    return circle_open(before, progress, done) and done[before]
