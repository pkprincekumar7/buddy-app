"""The growth areas' data and the generated sets' normalisers (docs/auth-users-split.md, 8, 12.1).

`area_data.json` is generated from the web app's `lib/growthAreaData.ts`
(tests/fixtures/regenerate.sh): the six areas, the parent questions per area and the
pronoun tokens (`copy_tokens`, `fill_template`: for the prompts, and the worlds'
suggestions they quote). The functions below are ports of the same module, so what grow
stores is what the apps render today:
- `normalize_questions` (`normalizeGeneratedQuestions`): the LLM's answer, repaired where
  cosmetic (word caps) and rejected (None) where it would break the page; ids are assigned
  here (`<area>_gq1`), never taken from the model.
- `normalize_recommendations` (`normalizeRecommendations`): `{title, detail, source?}` with
  word caps; `source` is kept only when it is one of RECOMMENDATION_SOURCES; a plain
  string is a title.

The apps' own normalisers still run on what they read, and give the same result again.
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping
from pathlib import Path
from typing import Any

_DATA: dict[str, Any] = json.loads((Path(__file__).parent / "area_data.json").read_text())

AREAS: dict[str, dict[str, str]] = {area["id"]: area for area in _DATA["areas"]}
QUESTIONS_PER_AREA: int = _DATA["parent_questions_per_area"]
_TOKENS: dict[str, dict[str, str]] = _DATA["copy_tokens"]

QUESTION_MAX_WORDS = 22
HINT_MAX_WORDS = 14
RECOMMENDATION_TITLE_MAX_WORDS = 10
RECOMMENDATION_DETAIL_MAX_WORDS = 25
# Where a recommendation comes from: the parent's answers and the child's games together,
# the games only, the answers only, or the next step (RECOMMENDATION_SOURCES).
RECOMMENDATION_SOURCES: tuple[str, ...] = ("both", "kid", "you", "step")


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
    """`{name}`, `{he}`, `{his}`, … in copy (fillTemplate); an unknown token is left as it is."""
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


def normalize_recommendations(raw: Any) -> list[dict[str, str]]:
    """`{title, detail, source?}` per recommendation, word-capped; plain strings are titles.
    An unknown or missing `source` is left out."""
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
            item_out = {
                "title": cap_words(title, RECOMMENDATION_TITLE_MAX_WORDS),
                "detail": cap_words(detail, RECOMMENDATION_DETAIL_MAX_WORDS),
            }
            source = entry.get("source")
            if isinstance(source, str) and source in RECOMMENDATION_SOURCES:
                item_out["source"] = source
            out.append(item_out)
    return out


def fit_sources(
    recs: list[dict[str, str]], *, answered: bool, played: bool
) -> list[dict[str, str]]:
    """Each recommendation's `source` as the job's inputs allow it: "kid" or "both" only when
    the child played the area's world, "you" or "both" only when the parent answered, "step"
    only on the last. A tag that can't be true falls back to what there was ("both" to the
    one input there is), or is left out; the app then shows no tag rather than a wrong one."""
    out: list[dict[str, str]] = []
    for i, rec in enumerate(recs):
        source = rec.get("source")
        if source == "both" and not (answered and played):
            source = "you" if answered else "kid" if played else None
        elif source == "kid" and not played:
            source = "you" if answered else None
        elif source == "you" and not answered:
            source = "kid" if played else None
        elif source == "step" and i != len(recs) - 1:
            source = None
        fitted = {k: v for k, v in rec.items() if k != "source"}
        if source:
            fitted["source"] = source
        out.append(fitted)
    return out
