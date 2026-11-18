"""The child's seven powers in child view (docs/child-view-build-plan.md, P.4 and 2.5).

A fixed mapping, with no LLM call: `powers.json` holds the powers (the prototype's seven, each
with its mini game, in the order the kids page and `kid_activity.flipped_powers` use) and the
archetypes each one comes from. A power's level (3 to 5) is its strongest archetype's score in
the stored view model (`scores`: the dominant style 100, the secondaries 42 to 96, the rest 14),
against the thresholds in `levels`. A score that's missing or not a number counts as none, so a
power always has a level.

The text is written for the child, and is the same for every child; only the levels follow the
child's result.
"""

from __future__ import annotations

import json
import math
from collections.abc import Mapping
from pathlib import Path
from typing import Any, Final

from discover.app.personality import PERSONALITY_TYPES

_DATA: dict[str, Any] = json.loads((Path(__file__).parent / "powers.json").read_text())
POWERS: Final[list[dict[str, Any]]] = _DATA["powers"]
# Each archetype's line for the child, under "You are The <style>".
STYLE_LINES: Final[dict[str, str]] = _DATA["styles"]
# The level each threshold gives, highest first; below every threshold is the lowest level.
_THRESHOLDS: Final[list[tuple[int, float]]] = sorted(
    ((int(level), float(score)) for level, score in _DATA["levels"].items()), reverse=True
)
LOWEST_LEVEL: Final = 3


def _score(scores: Mapping[str, Any], style: str) -> float:
    value = scores.get(style)
    if isinstance(value, bool) or not isinstance(value, int | float) or not math.isfinite(value):
        return 0.0
    return float(value)


def level(scores: Mapping[str, Any], styles: list[str]) -> int:
    """The level a power's archetypes give: its strongest one's score against the thresholds."""
    best = max((_score(scores, style) for style in styles), default=0.0)
    return next((lvl for lvl, at_least in _THRESHOLDS if best >= at_least), LOWEST_LEVEL)


def powers(model: Mapping[str, Any]) -> list[dict[str, Any]]:
    """The seven powers for a ready personality's view model, in the page's order."""
    raw = model.get("scores")
    scores: Mapping[str, Any] = raw if isinstance(raw, Mapping) else {}
    return [
        {
            "name": power["name"],
            "game": power["game"],
            "level": level(scores, power["from"]),
            "line": power["line"],
            "try_this": power["try_this"],
        }
        for power in POWERS
    ]


def style_line(style: str) -> str:
    """The child's line for their archetype (every archetype has one; checked by the tests)."""
    return STYLE_LINES.get(style, "")


def check_table() -> None:
    """The table's own rules (run by the tests): every archetype feeds a power and has a
    line, and each power names known archetypes."""
    if set(STYLE_LINES) != set(PERSONALITY_TYPES):
        raise ValueError("every archetype needs exactly one line in powers.json")
    used = {style for power in POWERS for style in power["from"]}
    unknown = used - set(PERSONALITY_TYPES)
    if unknown:
        raise ValueError(f"unknown archetypes in powers.json: {sorted(unknown)}")
    unused = set(PERSONALITY_TYPES) - used
    if unused:
        raise ValueError(f"archetypes no power uses: {sorted(unused)}")
