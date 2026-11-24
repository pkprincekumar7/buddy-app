"""`grow.world_runs`: the child's world runs in child view (docs/child-view-build-plan.md, P.3, 3.4).

The worlds are the child's input to Grow: there is one world per growth area, matched by
name (`worlds[i].name` is `AREAS[area_id]["name"]`), and an area's recommendations are
written from the parent's reflections plus the latest run of its world (3.6, as built).
One document per child, `_id` the child's id, created by the first run and removed with
the child and the account.

- `worlds.json`: the prototype's six worlds, each with three games (`type`, the words, the
  game's settings in `cfg`) and a "Build on" and a "Support" suggestion per game, written
  with the app's `{He}` / `{his}` / `{s}` tokens. The suggestions aren't served: they ground
  the recommendations' prompt (the best game's "Build on", the weakest game's "Support"). The
  score bands ("Super strong", "Growing well", "Keep practising") are there too.
- `runs.<world>`: the last RUNS_KEPT runs of that world, oldest first, each the three games'
  scores (0 to 100), their rounded mean (`total`) and when.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from datetime import datetime
from pathlib import Path
from typing import Any, Final

from pymongo import ASCENDING

from common.events.store import Db, ensure_validated_collection
from grow.app.areas import AREAS, fill_template

WORLD_RUNS = "world_runs"
SCHEMA_VERSION = 1
GAMES_PER_WORLD: Final = 3
RUNS_KEPT: Final = 10
GAME_TYPES: Final = ("dash", "sort", "timing", "catch", "memory", "spark", "react")

_DATA: dict[str, Any] = json.loads((Path(__file__).parent / "worlds.json").read_text())
WORLDS: Final[list[dict[str, Any]]] = _DATA["worlds"]
BANDS: Final[list[dict[str, Any]]] = _DATA["bands"]
WORLD_COUNT: Final = len(WORLDS)

_RUN = {
    "bsonType": "object",
    "required": ["total", "scores", "at"],
    "properties": {
        "total": {"bsonType": ["int", "long"], "minimum": 0, "maximum": 100},
        "scores": {
            "bsonType": "array",
            "minItems": GAMES_PER_WORLD,
            "maxItems": GAMES_PER_WORLD,
            "items": {"bsonType": ["int", "long"], "minimum": 0, "maximum": 100},
        },
        "at": {"bsonType": "date"},
    },
}
WORLD_RUNS_VALIDATOR: dict[str, Any] = {
    "$jsonSchema": {
        "bsonType": "object",
        "required": [
            "_id", "user_id", "location", "runs", "version", "created_at", "updated_at",
            "schema_version",
        ],
        "properties": {
            "_id": {"bsonType": "string"},
            "user_id": {"bsonType": "string"},
            "location": {"bsonType": "string"},
            "runs": {
                "bsonType": "object",
                "patternProperties": {
                    rf"^[0-{WORLD_COUNT - 1}]$": {
                        "bsonType": "array",
                        "maxItems": RUNS_KEPT,
                        "items": _RUN,
                    }
                },
                "additionalProperties": False,
            },
            "version": {"bsonType": ["int", "long"], "minimum": 1},
            "created_at": {"bsonType": "date"},
            "updated_at": {"bsonType": "date"},
            "schema_version": {"bsonType": ["int", "long"]},
        },
    }
}  # fmt: skip


async def ensure_world_runs(db: Db) -> None:
    """The collection with its validator and the account-deletion index. Safe on every start."""
    collection = await ensure_validated_collection(db, WORLD_RUNS, WORLD_RUNS_VALIDATOR)
    await collection.create_index([("location", ASCENDING), ("user_id", ASCENDING)])


def empty(child_id: str, user_id: str, location: str, now: datetime) -> dict[str, Any]:
    """A child's world runs before their first."""
    return {
        "_id": child_id,
        "user_id": user_id,
        "location": location,
        "runs": {},
        "version": 1,
        "created_at": now,
        "updated_at": now,
        "schema_version": SCHEMA_VERSION,
    }


def total(scores: Sequence[int]) -> int:
    """A run's score: its games' mean, rounded half up (the prototype's Math.round)."""
    return int(sum(scores) / len(scores) + 0.5)


def band(score: int) -> dict[str, Any]:
    """The band a score falls in (BANDS is highest first)."""
    return next(b for b in BANDS if score >= b["min"])


def world_for(area_id: str) -> int | None:
    """The area's world, by name; None for an area with no world."""
    name = AREAS.get(area_id, {}).get("name")
    return next((i for i, world in enumerate(WORLDS) if world["name"] == name), None)


def runs_for(doc: Mapping[str, Any] | None, area_id: str) -> list[Mapping[str, Any]]:
    """The child's kept runs of the area's world, oldest first."""
    index = world_for(area_id)
    if index is None or not doc:
        return []
    return list((doc.get("runs") or {}).get(str(index)) or [])


def game_lines(area_id: str, run: Mapping[str, Any]) -> list[str]:
    """The run's games as the child evidence Release's observations read, one line per game:
    `Played {title} ({skill}): {score} of 100, {band label}`. Empty for an area with no world."""
    index = world_for(area_id)
    if index is None:
        return []
    return [
        f"Played {game['title']} ({game['skill']}): {score} of 100, {band(score)['label']}"
        for game, score in zip(WORLDS[index]["games"], run["scores"], strict=True)
    ]


def latest_run(
    area_id: str,
    runs: Sequence[Mapping[str, Any]],
    now: datetime,
    *,
    name: str | None = None,
    gender: str | None = None,
) -> dict[str, Any] | None:
    """The latest run as the recommendations' prompt reads it, or None before the first:
    each game's skill, title, score and band, the total, the tries kept, the change in
    total since the run before (None on a first try) and the days since it was played; and
    the best game's "Build on" and the weakest game's "Support" suggestion (the first of a
    tie), their tokens filled for the child."""
    index = world_for(area_id)
    if index is None or not runs:
        return None
    last = runs[-1]
    games = WORLDS[index]["games"]
    scores = list(last["scores"])
    best = scores.index(max(scores))
    weakest = scores.index(min(scores))

    def suggestion(game: Mapping[str, Any], tag: str) -> dict[str, str]:
        text = game[tag]
        return {
            "game": game["skill"],
            "title": fill_template(text["title"], name, gender),
            "body": fill_template(text["body"], name, gender),
        }

    return {
        "games": [
            {
                "skill": game["skill"],
                "title": game["title"],
                "score": score,
                "band": band(score)["label"],
            }
            for game, score in zip(games, scores, strict=True)
        ],
        "total": last["total"],
        "tries": len(runs),
        "change_since_previous_run": last["total"] - runs[-2]["total"] if len(runs) > 1 else None,
        "days_since_played": max((now - last["at"]).days, 0),
        "build_on": suggestion(games[best], "build_on"),
        "support": suggestion(games[weakest], "support"),
    }
