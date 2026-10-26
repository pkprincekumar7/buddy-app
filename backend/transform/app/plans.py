"""The 90-day plan and its event tracker (docs/auth-users-split.md, 8, 12.1).

Ported from the web app's `lib/ninetyDayPlanPrompt.ts`: `ninetyDayPlanSchema` /
`buildNinetyDayPlanPrompt` and `ninetyDayTrackerSchema` / `buildNinetyDayTrackerPrompt`.
The answer is checked against its schema before it's stored, as the design asks; the apps
render `plan` and `track_steps` as they're stored (`mergeTrackSteps` adds the icons and
layout by step index).

**Decided here:** the tracker's "built around" line uses the parent's own `ask`. Today the
app derives a label from it by keyword (`readInterest` in `startJourneyPlans.ts`), "for
flavour only"; the words themselves say the same with nothing to keep in sync. The
parent's and child's data go in data blocks.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from jsonschema import Draft202012Validator

from common.generation.prompts import render


def _pronouns(gender: str | None) -> str:
    value = (gender or "").strip().lower()
    if value == "male":
        return "he/his/him"
    if value == "female":
        return "she/her/her"
    return "they/their/them"


def _age(child: Mapping[str, Any]) -> Any:
    age = child.get("age")
    return age if age is not None and age != "" else "unknown"


def errors(validator: Draft202012Validator, answer: Any) -> list[str]:
    """Where an answer breaks its schema (paths only, never the text); [] if it fits."""
    return sorted(
        {
            "/".join(str(p) for p in error.absolute_path) or "(root)"
            for error in validator.iter_errors(answer)
        }
    )


# ── the plan ───────────────────────────────────────────────────────────────────

_DO_FIELD = {
    "type": "object",
    "required": ["k", "kind", "label"],
    "additionalProperties": False,
    "properties": {
        "k": {"type": "string", "maxLength": 20},
        "kind": {"type": "string", "enum": ["text", "area", "date", "count", "num", "photo"]},
        "label": {"type": "string", "maxLength": 60},
        "ph": {"type": "string", "maxLength": 40},
        "target": {"type": "number"},
        "stepBy": {"type": "number"},
    },
}
_ACTIVITY = {
    "type": "object",
    "required": ["n", "time", "title", "award", "objective", "apply", "do"],
    "additionalProperties": False,
    "properties": {
        "n": {"type": "string", "enum": [f"0{n}" for n in range(1, 10)]},
        "time": {"type": "string", "maxLength": 30},
        "title": {"type": "string", "maxLength": 60},
        "award": {"type": "string", "maxLength": 30},
        "objective": {"type": "string", "maxLength": 160},
        "apply": {"type": "string", "maxLength": 160},
        "do": {"type": "array", "minItems": 1, "maxItems": 4, "items": _DO_FIELD},
    },
}
PLAN_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["metric", "goals", "acts"],
    "additionalProperties": False,
    "properties": {
        "metric": {"type": "string", "maxLength": 60},
        "goals": {
            "type": "array",
            "minItems": 3,
            "maxItems": 3,
            "items": {"type": "string", "maxLength": 220},
        },
        "acts": {"type": "array", "minItems": 9, "maxItems": 9, "items": _ACTIVITY},
    },
}
PLAN_VALIDATOR = Draft202012Validator(PLAN_SCHEMA)

_PLAN = """You are designing a 90-day self-directed development plan for the child in the profile below, grounded entirely in one thing the parent just told us, in their own words:
$ask

Child profile (refer to the child as PRONOUNS):
$profile

--- Task ---

Return a 3-month plan built around what the parent said above, not a generic curriculum. "metric" is the one number that tracks real progress in this specific pursuit (e.g. "Keepy-uppies in a row" for football, "Finished pieces" for a maker) — pick whatever actually measures growth in what the parent described.

"goals" is exactly 3 strings — one per month, each one sentence stating the concrete, observable bar cleared by day 30 / day 60 / day 90. Escalate: day 30 is a habit taking hold, day 60 is that habit tested in front of someone outside the house, day 90 is a finished, shown, undeniable result.

"acts" is exactly 9 activities, 3 per month in month order (activities 1-3 = month 1, 4-6 = month 2, 7-9 = month 3). Each activity:
  • "n": "01" through "09" in order.
  • "time": the cadence, e.g. "15 min daily" or "Once a week".
  • "title": a short, concrete name for the activity. Max 8 words.
  • "award": a 1-3 word badge name for finishing it, e.g. "Streak keeper".
  • "objective": one sentence, the specific, checkable outcome that makes this activity done.
  • "apply": one sentence on how the child actually does this — the real-world action, not an abstraction.
  • "do": 1-4 fields the parent/child fill in as evidence, each with a "kind": "text" (one line), "area" (a few sentences), "date", "num" (a plain number), "count" (a running tally — set "target" to the number that finishes it, and "stepBy" if it should count up by more than 1 at a time), or "photo" (import a photo as proof). Pick whichever kinds genuinely fit what this activity produces — don't default to the same kind every time.

Rules:
  • Every activity must be something a child of the profile's age can actually do largely unsupervised — age-appropriate difficulty and independence throughout.
  • Ground everything in what the parent actually said. Do not invent facts about the child beyond the profile above.
  • Write the child's name (from the profile) and pronouns literally throughout. Do not output template placeholders such as {he} or {name}.
  • Months escalate in difficulty and independence — month 3's activities assume the habits from months 1-2 are already in place."""


def plan_prompt(child: Mapping[str, Any], personality: Mapping[str, Any] | None, ask: str) -> str:
    traits = (personality or {}).get("traits")
    summary = traits if isinstance(traits, Mapping) else {}
    profile: dict[str, Any] = {
        "name": (child.get("name") or "").strip() or "the child",
        "age": _age(child),
    }
    if summary.get("dominant_style"):
        profile["personality_archetype"] = f"The {summary['dominant_style']}"
    if summary.get("description"):
        profile["personality_summary"] = summary["description"]
    if (personality or {}).get("strengths"):
        profile["strengths"] = list(personality["strengths"])  # type: ignore[index]
    return render(
        _PLAN.replace("PRONOUNS", _pronouns(child.get("gender"))), ask=ask.strip(), profile=profile
    )


# ── the event tracker ──────────────────────────────────────────────────────────

_TRACK_FIELD = {
    "type": "object",
    "required": ["k", "label", "type"],
    "additionalProperties": False,
    "properties": {
        "k": {"type": "string", "maxLength": 20},
        "label": {"type": "string", "maxLength": 60},
        "ph": {"type": "string", "maxLength": 40},
        "type": {"type": "string", "enum": ["text", "date", "note"]},
    },
}
_STEP = {
    "type": "object",
    "required": ["title", "short", "when", "body", "fields"],
    "additionalProperties": False,
    "properties": {
        "title": {"type": "string", "maxLength": 40},
        "short": {"type": "string", "maxLength": 20},
        "when": {"type": "string", "maxLength": 40},
        "body": {"type": "string", "maxLength": 160},
        "fields": {"type": "array", "minItems": 1, "maxItems": 4, "items": _TRACK_FIELD},
    },
}
TRACKER_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["steps"],
    "additionalProperties": False,
    "properties": {"steps": {"type": "array", "minItems": 9, "maxItems": 9, "items": _STEP}},
}
TRACKER_VALIDATOR = Draft202012Validator(TRACKER_SCHEMA)

_TRACKER = """You are writing the 9 steps of a countdown tracker that walks the child in the profile below to a single named event — not a generic milestone list, a plan for THIS event:
$event

Built around what the parent said the child is into, in their own words:
$ask

Child (refer to the child as PRONOUNS):
$profile

--- Task ---

Return exactly 9 steps, in the order the child works through them counting down to the event above. Each step:
  • "title": short, concrete. Max 6 words.
  • "short": an even shorter label for a step-rail chip. Max 3 words.
  • "when": roughly when this step happens relative to the event, e.g. "6 weeks out".
  • "body": one or two sentences on what actually happens in this step.
  • "fields": 1-4 fields the child/the parent fill in as evidence, each "type": "text" (one line), "date", or "note" (a few sentences).

Rules:
  • Escalate toward the named event: early steps are preparation, the final 1-2 steps are the event itself and confirming it happened.
  • Age-appropriate for a child of the profile's age throughout.
  • Write the child's name (from the profile) and pronouns literally. Do not output template placeholders such as {he} or {name}.
  • Stay specific to the named event — do not drift into a generic checklist."""


def tracker_prompt(
    child: Mapping[str, Any], ask: str | None, event_name: str, event_date: str
) -> str:
    return render(
        _TRACKER.replace("PRONOUNS", _pronouns(child.get("gender"))),
        event={"name": event_name.strip(), "date": event_date},
        ask=(ask or "").strip() or "(not given)",
        profile={"name": (child.get("name") or "").strip() or "the child", "age": _age(child)},
    )
