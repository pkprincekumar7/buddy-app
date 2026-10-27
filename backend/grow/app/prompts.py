"""The three growth-area prompts and their schemas (docs/auth-users-split.md, 8).

Ported from the web app (`lib/growthQuestionsPrompt.ts` and `buildGrowthAreaRecommendationsPrompt`
in `lib/prompts.ts`), built by the server from grow's own data and copies:
`child_access` (name, age, gender), `onboarding_inputs` (the questionnaire),
`personality_inputs` (archetype, summary, traits) and the area's document. Everything that
came from a parent (names, answers, reflections, the child's picks) goes in data blocks
(common.generation.prompts), never spliced into the instructions.

The schemas reach the model as a hint in the system message, as today; what's stored is
decided by the normalisers (grow.app.areas), which are the real guarantee.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from common.generation.prompts import render
from grow.app.areas import (
    ARCHETYPES,
    ICON_KEYS,
    QUESTIONS_PER_AREA,
    ROUNDS_PER_AREA,
    copy_tokens,
    tags_for_area,
)

_LABELS: dict[str, str] = {
    "strengths": "Top strengths",
    "hobbies": "Hobbies",
    "thinking_pattern": "Thinking pattern",
    "communication_style": "Communication style",
    "energy_level": "Energy level",
    "social_behaviour": "Social behaviour",
    "emotional_behaviour": "Emotional behaviour",
}


def _profile(child: Mapping[str, Any], personality: Mapping[str, Any] | None) -> dict[str, Any]:
    traits = (personality or {}).get("traits")
    summary = traits if isinstance(traits, Mapping) else {}
    profile: dict[str, Any] = {
        "name": (child.get("name") or "").strip() or "the child",
        "age": child.get("age") if child.get("age") is not None else "unknown",
    }
    if summary.get("dominant_style"):
        profile["personality_archetype"] = f"The {summary['dominant_style']}"
    if summary.get("description"):
        profile["personality_summary"] = summary["description"]
    if summary.get("traits"):
        profile["traits"] = list(summary["traits"])
    return profile


def _questionnaire(answers: Mapping[str, Any] | None) -> Any:
    given = {
        label: answers[field]
        for field, label in _LABELS.items()
        if answers and answers.get(field) not in (None, "", [])
    }
    return given or "(no questionnaire stored yet)"


def _pronouns(gender: str | None) -> str:
    t = copy_tokens(gender)
    return f"{t['he']}/{t['his']}/{t['him']}"


def _shared(
    child: Mapping[str, Any],
    answers: Mapping[str, Any] | None,
    personality: Mapping[str, Any] | None,
    area: Mapping[str, Any],
) -> dict[str, Any]:
    return {
        "profile": _profile(child, personality),
        "questionnaire": _questionnaire(answers),
        "area": {"name": area["name"], "description": area.get("description", "")},
    }


_SHARED_TEXT = """Child profile (refer to the child as PRONOUNS):
$profile

Questionnaire the parent completed at onboarding:
$questionnaire

Growth area:
$area"""


# ── stage 1: the parent's reflections ──────────────────────────────────────────

_PARENT_QUESTIONS = (
    """You are a child development specialist. Write the COUNT reflection questions a parent will answer about their own child for the growth area below. Their answers are the raw material for a personalised development plan, so each question has to pull out something a generic questionnaire would miss.

"""
    + _SHARED_TEXT
    + """

Each question has two fields, both strict word limits — go over and the response is rejected:
- "question": what you are asking the parent. Maximum 22 words. Address the parent directly about the child, by name, ending in a question mark.
- "hint": a short nudge under the question pointing at a concrete moment to recall. Maximum 14 words. Not a rephrasing of the question.

Instructions:
- Ask only about things the parent has actually witnessed the child do or say. A parent can describe a specific afternoon; they cannot reliably rate the child's "resilience". Never ask them to score, rank or diagnose.
- Ground every question in this specific child. Use the questionnaire and the archetype above so the questions could not have been written for a different child of the same age.
- Order them so they get progressively harder to answer: question 1 recalls something easy and concrete, question COUNT asks the parent to notice a pattern they may not have named before.
- Every question must be specific to the growth area above. Do not drift into the other growth areas.
- Ask about observed behaviour, not the parent's hopes. "What does he do when…" beats "How would you like him to…".
- One question per question. No compound questions joined by "and" that leave the parent answering only half.
- Write the child's name (from the profile) and pronouns literally. Do not output template placeholders like {name} or {he}.
- Warm, plain, parent-facing language. No clinical or developmental-psychology jargon.

Return ONLY a JSON object with a "questions" array of exactly COUNT objects, each with "question" (≤22 words) and "hint" (≤14 words), in the order the parent will answer them."""
)


def parent_questions_prompt(
    child: Mapping[str, Any],
    answers: Mapping[str, Any] | None,
    personality: Mapping[str, Any] | None,
    area: Mapping[str, Any],
) -> str:
    template = _PARENT_QUESTIONS.replace("COUNT", str(QUESTIONS_PER_AREA)).replace(
        "PRONOUNS", _pronouns(child.get("gender"))
    )
    return render(template, **_shared(child, answers, personality, area))


def parent_questions_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "required": ["questions"],
        "additionalProperties": False,
        "properties": {
            "questions": {
                "type": "array",
                "minItems": QUESTIONS_PER_AREA,
                "maxItems": QUESTIONS_PER_AREA,
                "items": {
                    "type": "object",
                    "required": ["question", "hint"],
                    "additionalProperties": False,
                    "properties": {
                        "question": {"type": "string", "maxLength": 160, "description": "At most 22 words. Addressed to the parent, ending in a question mark."},
                        "hint": {"type": "string", "maxLength": 110, "description": "At most 14 words. A nudge towards a concrete moment, not a rephrasing."},
                    },
                },
            }
        },
    }  # fmt: skip


# ── stage 2: the child's either/or rounds ──────────────────────────────────────

_CHILD_ROUNDS = (
    """You are a child development specialist designing a short either/or game a child plays on a screen. COUNT rounds, two options per round, and the child taps the one they would rather have. Their pattern of choices reveals where they lean within the growth area below.

"""
    + _SHARED_TEXT
    + """

What the child's parent just told us about this area (question and answer pairs):
$reflections

Every option must carry one of these tags, and no others:
TAGS

Every option must carry one of these icon keys, and no others:
ICONS

Each option has four fields — the word limits are strict, go over and the response is rejected:
- "text": the choice as the child reads it. Maximum 12 words. Second person, starting with a verb.
- "star": a 1–2 word label for this choice on a constellation. Title case.
- "tag": exactly one tag from the list above.
- "icon": exactly one icon key from the list above, matching the option's content.

Instructions:
- Write to the child, not the parent. No name, no pronouns, no "your child" — the child is reading this directly. "Build a robot that does your chores", not "He builds a robot".
- Both options in a round must be genuinely exciting. If one is obviously the better answer the round measures nothing — the child must actually have to choose.
- The two options in a round MUST carry different tags. A round with the same tag on both sides cannot discriminate and is wasted.
- Spread the tags across the COUNT rounds so the winning tag is earned. Use at least four distinct tags overall, and do not let one tag appear in more than three rounds.
- Use the parent's answers to make the options concrete to the child's real world — their actual interests, activities and friendships — without ever quoting the parent back or revealing that a parent was asked.
- Age-appropriate throughout: these must be things a child of the profile's age would find genuinely thrilling.
- Every option must belong to the growth area above. Do not drift into the other growth areas.
- Concrete and vivid, never abstract. Name a thing that happens, not a quality.

Return ONLY a JSON object with a "rounds" array of exactly COUNT objects, each with an "a" and a "b" option object holding "text", "star", "tag" and "icon"."""
)


def child_rounds_prompt(
    child: Mapping[str, Any],
    answers: Mapping[str, Any] | None,
    personality: Mapping[str, Any] | None,
    area: Mapping[str, Any],
    reflections: list[dict[str, str]],
) -> str:
    archetypes = ARCHETYPES.get(area["id"], {})
    tags = "\n".join(
        f'- "{tag}" — points towards {archetypes.get(tag, {}).get("title", tag)}'
        for tag in tags_for_area(area["id"])
    )
    template = (
        _CHILD_ROUNDS.replace("COUNT", str(ROUNDS_PER_AREA))
        .replace("PRONOUNS", _pronouns(child.get("gender")))
        .replace("TAGS", tags)
        .replace("ICONS", ", ".join(ICON_KEYS))
    )
    return render(
        template,
        **_shared(child, answers, personality, area),
        reflections=reflections or "(the parent left their reflections blank)",
    )


def child_rounds_schema(area_id: str) -> dict[str, Any]:
    option = {
        "type": "object",
        "required": ["text", "star", "tag", "icon"],
        "additionalProperties": False,
        "properties": {
            "text": {"type": "string", "maxLength": 90, "description": "At most 12 words. Addressed to the child in second person."},
            "star": {"type": "string", "maxLength": 14, "description": "A 1–2 word constellation label."},
            "tag": {"type": "string", "enum": tags_for_area(area_id)},
            "icon": {"type": "string", "enum": list(ICON_KEYS)},
        },
    }  # fmt: skip
    return {
        "type": "object",
        "required": ["rounds"],
        "additionalProperties": False,
        "properties": {
            "rounds": {
                "type": "array",
                "minItems": ROUNDS_PER_AREA,
                "maxItems": ROUNDS_PER_AREA,
                "items": {
                    "type": "object",
                    "required": ["a", "b"],
                    "additionalProperties": False,
                    "properties": {"a": option, "b": option},
                },
            }
        },
    }


# ── the 3-month recommendations ────────────────────────────────────────────────

_RECOMMENDATIONS = """You are a child development specialist. Based on the parent's responses and the child's own game activity responses, generate 5 personalised 3-month recommendations for the growth area below.

Child profile:
$profile

Growth area:
$area

Parent's responses (each question, its hint and the parent's answer):
$reflections

The child's own choices for this area (one per round), and the pattern they form:
$choices

Parent's feedback on suggested activities:
$feedback

Each recommendation has two fields, both strict word limits — go over and the response is rejected:
- "title": a short, concrete label for the action. Maximum 10 words. No trailing period. Must stand alone without the detail.
- "detail": one instruction covering what to do and how often. Maximum 25 words. Do not restate the title, and do not restate the age/gender/area — every word must be new information.

Instructions:
- Before generating recommendations, identify the single most significant gap or challenge the child has in this growth area based on the data above. Recommendation 1's title must name that gap directly — do not bury it in positive framing.
- Synthesise both the parent's perspective and the child's own responses; do not produce generic advice that could apply to any child.
- Order the 5 recommendations progressively: recommendation 1 addresses the core gap and is something the parent can start in week 1; recommendations 2–3 build on that foundation; recommendations 4–5 represent more advanced or consolidated practice by month 3.
- These 5 recommendations feed directly into a personalised 3-month goal plan, so the progression must be realistic and achievable.
- Given the word limits, each detail should carry exactly one instruction — the action and its frequency. Drop success criteria, caveats, and explanations; say the single most important thing and stop.
- Be honest: if the data shows the child genuinely struggles in this area, reflect that in the tone and urgency of early recommendations, within the same word limits.

Return ONLY a JSON object with a "recommendations" array of exactly 5 objects, each with "title" (≤10 words) and "detail" (≤25 words), specific to this growth area."""


def recommendations_prompt(
    child: Mapping[str, Any],
    area: Mapping[str, Any],
    reflections: list[dict[str, str]],
    choices: list[str],
    archetype: Mapping[str, str] | None,
    feedback: str | None,
) -> str:
    return render(
        _RECOMMENDATIONS,
        profile={
            "name": (child.get("name") or "").strip() or "the child",
            "age": child.get("age") if child.get("age") is not None else "unknown",
            "gender": child.get("gender") or "unknown",
        },
        area={"name": area["name"]},
        reflections=reflections or "(no answers given)",
        choices={"choices": choices, "pattern": dict(archetype) if archetype else None}
        if choices
        else "(the child's choices aren't recorded)",
        feedback=(feedback or "").strip() or "(none)",
    )


def recommendations_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "recommendations": {
                "type": "array",
                "minItems": 5,
                "maxItems": 5,
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string", "maxLength": 70, "description": "At most 10 words. A short label for the action, not a sentence."},
                        "detail": {"type": "string", "maxLength": 190, "description": "At most 25 words. One instruction: the action plus its frequency."},
                    },
                    "required": ["title", "detail"],
                },
            }
        },
    }  # fmt: skip
