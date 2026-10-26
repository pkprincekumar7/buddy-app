"""The Life Pathway: one area's six age milestones (docs/auth-users-split.md, 8, 12.1).

Ported from the web app: `lifePathwayAreaSchema` and `buildLifePathwayAreaPrompt`
(`lib/lifePathwayPrompt.ts`), and `normalizeLifePathwayArea` (`lib/lifePathwayData.ts`), which
the apps run on what they read. The answer is normalised here before it's stored, and stored
keyed by slot (`y1`, `y2`, … `y10`, offsets from the child's age), so the apps' normaliser
reads it back to the same milestones. The parent's and child's data go in data blocks.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from common.generation.prompts import render

# The years after the child's current age that the chart shows (lifePathwayData.ts).
AGE_OFFSETS: tuple[int, ...] = (1, 2, 3, 5, 8, 10)
SLOTS: tuple[str, ...] = tuple(f"y{offset}" for offset in AGE_OFFSETS)
DEFAULT_AGE = 10  # as today, when the child's age isn't a number
_MAX_SLOT_DEPTH = len(SLOTS) + 2


def child_age(child: Mapping[str, Any]) -> int:
    """The child's age as the prompt uses it: parseInt, else 10 (useLifePathwayArea)."""
    value = child.get("age")
    if isinstance(value, bool):
        return DEFAULT_AGE
    if isinstance(value, int) and value:
        return value
    try:
        return int(str(value).strip().split(".")[0]) or DEFAULT_AGE
    except ValueError:
        return DEFAULT_AGE


# ── the normaliser ─────────────────────────────────────────────────────────────


def _text(value: Any, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    trimmed = value.strip()
    return f"{trimmed[:limit].rstrip()}…" if len(trimmed) > limit else trimmed


def _milestone(item: Any) -> dict[str, str] | None:
    """One milestone, or None if it's too incomplete to render (power is optional)."""
    if not isinstance(item, Mapping):
        return None
    title, guided, drift = (
        _text(item.get("title"), 90),
        _text(item.get("guided"), 320),
        _text(item.get("drift"), 240),
    )
    if not title or not guided or not drift:
        return None
    return {
        "title": title,
        "guided": guided,
        "power": _text(item.get("power"), 240),
        "drift": drift,
    }


def _collect(root: Mapping[str, Any]) -> dict[str, dict[str, str]]:
    """Slots wherever they sit: a provider has nested each one inside the previous."""
    found: dict[str, dict[str, str]] = {}

    def walk(node: Mapping[str, Any], depth: int) -> None:
        if depth > _MAX_SLOT_DEPTH:
            return
        for slot in SLOTS:
            child = node.get(slot)
            if not isinstance(child, Mapping):
                continue
            if slot not in found:
                milestone = _milestone(child)
                if milestone:
                    found[slot] = milestone
            walk(child, depth + 1)

    walk(root, 0)
    return found


def normalize(raw: Any, ages: list[int]) -> list[dict[str, str] | None] | None:
    """The milestones in slot order (None where a slot is unusable); None if none is."""
    if not isinstance(raw, Mapping):
        return None
    legacy = raw.get("milestones")
    if isinstance(legacy, list):
        by_age: dict[str, dict[str, str]] = {}
        for item in legacy:
            milestone = _milestone(item)
            age = _text(item.get("age"), 4) if isinstance(item, Mapping) else ""
            if milestone and age and age not in by_age:
                by_age[age] = milestone
        if not by_age:
            return None
        return [by_age.get(str(age)) for age in ages]
    found = _collect(raw)
    return [found.get(slot) for slot in SLOTS] if found else None


def to_slots(milestones: list[dict[str, str] | None]) -> dict[str, dict[str, str]]:
    """What's stored: the usable milestones keyed by slot."""
    return {slot: m for slot, m in zip(SLOTS, milestones, strict=True) if m is not None}


# ── the prompt ─────────────────────────────────────────────────────────────────


def schema() -> dict[str, Any]:
    milestone = {
        "type": "object",
        "required": ["title", "guided", "power", "drift"],
        "additionalProperties": False,
        "properties": {name: {"type": "string"} for name in ("title", "guided", "power", "drift")},
    }
    return {
        "type": "object",
        "required": list(SLOTS),
        "additionalProperties": False,
        "properties": dict.fromkeys(SLOTS, milestone),
    }


def _pronouns(gender: str | None) -> tuple[str, str, str]:
    value = (gender or "").strip().lower()
    if value == "male":
        return "he", "his", "him"
    if value == "female":
        return "she", "her", "her"
    return "they", "their", "them"


def _recommendation_lines(raw: Any) -> list[str]:
    """normalizeRecommendations, flattened: plain strings, or `{title, detail}`."""
    lines = []
    for item in raw if isinstance(raw, list) else []:
        if isinstance(item, str) and item.strip():
            lines.append(item.strip())
        elif isinstance(item, Mapping):
            title = str(item.get("title") or item.get("t") or "").strip()
            detail = str(item.get("detail") or item.get("b") or "").strip()
            if title or detail:
                lines.append(f"{title} — {detail}" if detail else title)
    return lines


def prompt(
    child: Mapping[str, Any], personality: Mapping[str, Any] | None, area: Mapping[str, Any]
) -> str:
    """The milestones prompt for one completed area (a `growth_inputs` copy)."""
    age = child_age(child)
    ages = [age + offset for offset in AGE_OFFSETS]
    subj, poss, obj = _pronouns(child.get("gender"))
    traits = (personality or {}).get("traits")
    summary = traits if isinstance(traits, Mapping) else {}
    profile: dict[str, Any] = {"name": (child.get("name") or "").strip() or "the child", "age": age}
    if summary.get("dominant_style"):
        profile["personality_archetype"] = f"The {summary['dominant_style']}"
    if summary.get("description"):
        profile["personality_summary"] = summary["description"]
    if (personality or {}).get("strengths"):
        profile["strengths"] = list(personality["strengths"])  # type: ignore[index]
    answers = {
        key: value.strip()
        for key, value in (area.get("answers") or {}).items()
        if isinstance(value, str) and value.strip()
    }
    recommendations = _recommendation_lines(
        area.get("ai_three_month_recommendations") or area.get("recommendations")
    )
    keys = "\n".join(
        f'  "{slot}" — the child at age {a}' for slot, a in zip(SLOTS, ages, strict=True)
    )
    first, last = SLOTS[0], SLOTS[-1]
    capital = subj[0].upper() + subj[1:]
    singular_they = (
        f'\n• "{subj}" here is singular but takes plural verb forms: "{subj} write", "{subj} keep", '
        f'"{subj} are" — never "{subj} writes" or "{subj} is". Where the subject is the child\'s '
        "name rather than the pronoun, keep the singular."
        if subj == "they"
        else ""
    )
    template = f"""You are writing one growth area's section of a long-term development pathway that a parent is reading about their own child. It projects what changes each year if the child is actively developed, versus what happens by default.

Child profile (refer to the child as {subj}/{poss}/{obj}):
$profile

Growth area:
$area

What the parent told us about the child in this area (question id → answer):
$answers

Recommendations already given to this parent for this area (stay consistent with these — the milestones should read like where those recommendations lead over ten years):
$recommendations

--- Task ---

Return one object under each of these {len(SLOTS)} keys. Every key is required — do not omit, rename, merge or add keys:
{keys}

All {len(SLOTS)} keys sit side by side at the top level of the JSON object. Do not nest one inside another — "{SLOTS[1]}" is a sibling of "{first}", not a field within it. Each key's value contains only the four fields below and no further keys.

Each of those objects has exactly these four fields:
• "title" — what the child achieves that year in this area. Under 9 words, present tense, starting with "{capital}" where it reads naturally (e.g. "{capital} finishes something for the first time"). It must be a concrete, observable change — not a feeling or a label.
• "guided" — 1–2 sentences describing what that year actually looks like on the supported path. Name a specific, real activity a {ages[0]}-to-{ages[-1]}-year-old could plausibly do. Max 32 words.
• "power" — one sentence on what the programme specifically does that year to make it happen (a weekly prompt, a tracked habit, a logged project, a profile insight). Concrete mechanism, not a promise. Max 24 words.
• "drift" — one or two short sentences on what happens instead if nothing changes: the ordinary, unremarkable default. Honest and specific, never cruel and never about the child being deficient. Max 22 words.

Rules:
• The {len(SLOTS)} milestones must escalate in key order. "{first}" (age {ages[0]}) is a first small win; "{last}" (age {ages[-1]}) is the child choosing {poss} own direction with evidence behind {obj}.
• Ground every milestone in the profile and parent answers above. Do not invent facts about the child — no named friends, schools, teachers, hobbies or events that were not given to you.
• Age-appropriate throughout: what fits at {ages[0]} must not be what fits at {ages[-1]}.
• Plain, warm, parent-facing language. No clinical or coaching jargon, no exclamation marks, no emoji, no markdown.
• Write the child's name (from the profile) and {subj}/{poss}/{obj} literally. Do not output template placeholders such as {{he}} or {{name}}.{singular_they}"""
    return render(
        template,
        profile=profile,
        area={"name": area["area_name"]},
        answers=answers or "(none given)",
        recommendations=recommendations or "(none yet)",
    )
