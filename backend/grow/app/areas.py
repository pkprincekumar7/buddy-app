"""The growth areas' data and the generated sets' normalisers (docs/auth-users-split.md, 8, 12.1).

`area_data.json` is generated from the web app's `lib/growthAreaData.ts`
(tests/fixtures/regenerate.sh): the six areas, each area's archetypes (the tags a child
round may carry), the icon keys and the per-area counts. The functions below are ports of
the same module, so what grow stores is what the apps render today:
- `normalize_questions` / `normalize_rounds` (`normalizeGeneratedQuestions` /
  `normalizeGeneratedRounds`): the LLM's answer, repaired where cosmetic (word caps, a
  missing star) and rejected (None) where it would break the page; ids are assigned here
  (`<area>_gq1`, `<area>_gr1a`), never taken from the model. Icons stay keys: the apps
  resolve a key to its drawing.
- `normalize_recommendations` (`normalizeRecommendations`): `{title, detail}` with word caps;
  a plain string is a title.
- `fill_template`, `picked_options`, `top_archetype`: for the recommendations' prompt.

The apps' own normalisers still run on what they read, and give the same result again.
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

_DATA: dict[str, Any] = json.loads((Path(__file__).parent / "area_data.json").read_text())

AREAS: dict[str, dict[str, str]] = {area["id"]: area for area in _DATA["areas"]}
ARCHETYPES: dict[str, dict[str, dict[str, str]]] = _DATA["archetypes"]
ICON_KEYS: tuple[str, ...] = tuple(_DATA["icon_keys"])
QUESTIONS_PER_AREA: int = _DATA["parent_questions_per_area"]
ROUNDS_PER_AREA: int = _DATA["game_rounds_per_area"]
_TOKENS: dict[str, dict[str, str]] = _DATA["copy_tokens"]
FALLBACK_ICON = "spark"

QUESTION_MAX_WORDS = 22
HINT_MAX_WORDS = 14
OPTION_TEXT_MAX_WORDS = 12
STAR_MAX_CHARS = 14
RECOMMENDATION_TITLE_MAX_WORDS = 10
RECOMMENDATION_DETAIL_MAX_WORDS = 25


def tags_for_area(area_id: str) -> list[str]:
    """The tags a child round may carry: the area's archetype keys, in order."""
    return list(ARCHETYPES.get(area_id, {}))


def copy_tokens(gender: str | None) -> dict[str, str]:
    """Pronouns and verb agreement for the child's gender (copyTokensFor)."""
    value = (gender or "").strip().lower()
    return (
        _TOKENS["male"]
        if value == "male"
        else _TOKENS["female"]
        if value == "female"
        else _TOKENS["other"]
    )


def fill_template(text: str, name: str | None, gender: str | None) -> str:
    """`{name}`, `{he}`, `{his}`, … in archetype copy; an unknown token is left as it is."""
    tokens = copy_tokens(gender)
    child = name.strip() if name and name.strip() else "your child"

    def slot(match: re.Match[str]) -> str:
        key = match.group(1)
        return child if key == "name" else tokens.get(key, match.group(0))

    return re.sub(r"\{(\w+)\}", slot, text)


def cap_words(text: str, max_words: int) -> str:
    words = text.split()
    if len(words) <= max_words:
        return text
    return " ".join(words[:max_words]) + "…"


def _string(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _items(raw: Any, key: str) -> list[Any] | None:
    """`{key: [...]}` or a bare list."""
    if isinstance(raw, list):
        return raw
    if not isinstance(raw, Mapping):
        return None
    nested = raw.get(key)
    return nested if isinstance(nested, list) else None


def _object(value: Any) -> Mapping[str, Any] | None:
    """JavaScript's `typeof value === 'object'` with a value: arrays count, with no fields."""
    if isinstance(value, Mapping):
        return value
    if isinstance(value, list):
        return {}
    return None


# ── the generated sets ─────────────────────────────────────────────────────────


def normalize_questions(raw: Any, area_id: str) -> list[dict[str, str]] | None:
    """The parent's reflections, with ids; None unless every slot has a question."""
    items = _items(raw, "questions")
    if items is None:
        return None
    out: list[dict[str, str]] = []
    for item in items[:QUESTIONS_PER_AREA]:
        entry = _object(item)
        if entry is None:
            break
        question = _string(entry.get("question"))
        if not question:
            break
        out.append(
            {
                "id": f"{area_id}_gq{len(out) + 1}",
                "question": cap_words(question, QUESTION_MAX_WORDS),
                "hint": cap_words(_string(entry.get("hint")), HINT_MAX_WORDS),
            }
        )
    return out if len(out) == QUESTIONS_PER_AREA else None


def _option(
    raw: Any, area_id: str, round_index: int, side: str, allowed: set[str]
) -> dict[str, str] | None:
    entry = _object(raw)
    if entry is None:
        return None
    text, tag = _string(entry.get("text")), _string(entry.get("tag"))
    if not text or tag not in allowed:
        return None
    star = _string(entry.get("star")) or text.split()[0]
    icon = entry.get("icon")
    return {
        "id": f"{area_id}_gr{round_index + 1}{side}",
        "text": cap_words(text, OPTION_TEXT_MAX_WORDS),
        "tag": tag,
        "star": star[:STAR_MAX_CHARS],
        "icon": icon if isinstance(icon, str) and icon in ICON_KEYS else FALLBACK_ICON,
    }


def normalize_rounds(raw: Any, area_id: str) -> list[dict[str, dict[str, str]]] | None:
    """The child's either/or rounds, with ids; None unless all are complete and tagged."""
    items = _items(raw, "rounds")
    if items is None:
        return None
    allowed = set(tags_for_area(area_id))
    if not allowed:
        return None
    out: list[dict[str, dict[str, str]]] = []
    for item in items[:ROUNDS_PER_AREA]:
        entry = _object(item)
        if entry is None:
            break
        a = _option(entry.get("a"), area_id, len(out), "a", allowed)
        b = _option(entry.get("b"), area_id, len(out), "b", allowed)
        if a is None or b is None:
            break
        out.append({"a": a, "b": b})
    return out if len(out) == ROUNDS_PER_AREA else None


def normalize_recommendations(raw: Any) -> list[dict[str, str]]:
    """`{title, detail}` per recommendation, word-capped; plain strings are titles."""
    if not isinstance(raw, list):
        return []
    out: list[dict[str, str]] = []
    for item in raw:
        if isinstance(item, str):
            if item.strip():
                out.append({"title": item.strip(), "detail": ""})
            continue
        entry = _object(item)
        if entry is None:
            continue
        title = entry.get("title") if isinstance(entry.get("title"), str) else entry.get("t")
        detail = entry.get("detail") if isinstance(entry.get("detail"), str) else entry.get("b")
        title = title.strip() if isinstance(title, str) else ""
        detail = detail.strip() if isinstance(detail, str) else ""
        if title or detail:
            out.append(
                {
                    "title": cap_words(title, RECOMMENDATION_TITLE_MAX_WORDS),
                    "detail": cap_words(detail, RECOMMENDATION_DETAIL_MAX_WORDS),
                }
            )
    return out


# ── the child's picks ──────────────────────────────────────────────────────────


def picked_options(rounds: Sequence[Mapping[str, Any]], picked_ids: Any) -> list[Mapping[str, Any]]:
    """The options the child picked, in order; unknown ids are dropped."""
    if not isinstance(picked_ids, list):
        return []
    options = {option["id"]: option for r in rounds for option in (r["a"], r["b"])}
    return [options[i] for i in picked_ids if isinstance(i, str) and i in options]


def top_archetype(
    area_id: str, rounds: Sequence[Mapping[str, Any]], picked_ids: Any
) -> dict[str, str] | None:
    """The most-picked tag's archetype; a tie goes to the tag that got there first."""
    options = picked_options(rounds, picked_ids)
    if not options:
        return None
    counts: dict[str, int] = {}
    for option in options:
        counts[option["tag"]] = counts.get(option["tag"], 0) + 1
    best = max(counts, key=lambda tag: counts[tag])  # max keeps the first of a tie
    return ARCHETYPES.get(area_id, {}).get(best)
