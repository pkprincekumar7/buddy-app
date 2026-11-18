"""The two growth-area prompts and their schemas (docs/auth-users-split.md, 8).

Ported from the web app (`lib/growthQuestionsPrompt.ts` and `buildGrowthAreaRecommendationsPrompt`
in `lib/prompts.ts`), built by the server from grow's own data and copies:
`child_access` (name, age, gender), `onboarding_inputs` (the questionnaire),
`personality_inputs` (archetype, summary, traits), the area's document and the child's
latest run of the area's world (grow.app.worlds). Everything that came from a parent or
the child (names, answers, reflections, game scores) goes in data blocks
(common.generation.prompts), never spliced into the instructions.

The schemas reach the model as a hint in the system message, as today; what's stored is
decided by the normalisers (grow.app.areas), which are the real guarantee.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from common.generation.prompts import render
from grow.app.areas import QUESTIONS_PER_AREA, RECOMMENDATION_SOURCES, copy_tokens

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


# ── the 3-month recommendations ────────────────────────────────────────────────

RECOMMENDATIONS_COUNT = 5

_RECOMMENDATIONS = """You are a child development specialist. Based on the parent's reflections and the child's own games for this area, generate COUNT personalised 3-month recommendations for the growth area below.

Child profile:
$profile

Growth area:
$area

Parent's reflections (each question, its hint and the parent's answer):
$reflections

The child's latest run of this area's games in child view. For each of the 3 games: the skill it practises, its title, the score (0 to 100) and its band; then the run's total, how many tries are kept, the change in total since the previous run (null on a first try) and the days since it was played. "build_on" is a suggestion for building on the best game's skill and "support" one for supporting the weakest game's skill; use them as grounding, in your own words:
$games

Parent's feedback on suggested activities:
$feedback

Each recommendation has three fields; the word limits are strict, go over and the response is rejected:
- "title": a short, concrete label for the action. Maximum 10 words. No trailing period. Must stand alone without the detail.
- "detail": one instruction covering what to do and how often. Maximum 25 words. Do not restate the title, and do not restate the age/gender/area — every word must be new information.
- "source": what the recommendation is grounded in, exactly one of:
  - "both": the parent's reflections AND the child's game scores together;
  - "kid": the child's game scores only;
  - "you": the parent's reflections only;
  - "step": the next step (the fifth recommendation only).

Source rules:
- If the child hasn't played this area's games yet, never use "kid" or "both".
- If the parent gave no answers, never use "you" or "both".
- When a recommendation is backed by both the reflections and the games, use "both".

Instructions:
- Before generating recommendations, identify the single most significant gap or challenge the child has in this growth area based on the data above (a low-scoring game skill counts). Recommendation 1's title must name that gap directly — do not bury it in positive framing.
- Synthesise everything given above; do not produce generic advice that could apply to any child. Refer to a game by its skill, not its score.
- Order recommendations 1 to 4 progressively: recommendation 1 addresses the core gap and is something the parent can start in week 1; recommendations 2–3 build on that foundation; recommendation 4 represents more advanced or consolidated practice by month 3.
- Recommendation 5 is always the next step, with "source": "step":
  - if the child hasn't played this area's games yet, ask the parent to have the child play this area's games in child view;
  - if this is the child's first try, say to check back in a week so progress can be seen;
  - otherwise react to the change since the previous run: celebrate the effort if the total went up, keep it light and encouraging if it stayed flat or went down.
- These recommendations feed directly into a personalised 3-month goal plan, so the progression must be realistic and achievable.
- Given the word limits, each detail should carry exactly one instruction — the action and its frequency. Drop success criteria, caveats, and explanations; say the single most important thing and stop.
- Be honest: if the data shows the child genuinely struggles in this area, reflect that in the tone and urgency of early recommendations, within the same word limits.

Return ONLY a JSON object with a "recommendations" array of exactly COUNT objects, each with "title" (≤10 words), "detail" (≤25 words) and "source", specific to this growth area."""


def recommendations_prompt(
    child: Mapping[str, Any],
    area: Mapping[str, Any],
    reflections: list[dict[str, str]],
    run: Mapping[str, Any] | None,
    feedback: str | None,
) -> str:
    """`run` is grow.app.worlds.latest_run's summary, or None before the first run."""
    return render(
        _RECOMMENDATIONS.replace("COUNT", str(RECOMMENDATIONS_COUNT)),
        profile={
            "name": (child.get("name") or "").strip() or "the child",
            "age": child.get("age") if child.get("age") is not None else "unknown",
            "gender": child.get("gender") or "unknown",
        },
        area={"name": area["name"]},
        reflections=reflections or "(no answers given)",
        games=dict(run) if run else "(the child hasn't played this area's games yet)",
        feedback=(feedback or "").strip() or "(none)",
    )


def recommendations_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "recommendations": {
                "type": "array",
                "minItems": RECOMMENDATIONS_COUNT,
                "maxItems": RECOMMENDATIONS_COUNT,
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string", "maxLength": 70, "description": "At most 10 words. A short label for the action, not a sentence."},
                        "detail": {"type": "string", "maxLength": 190, "description": "At most 25 words. One instruction: the action plus its frequency."},
                        "source": {"type": "string", "enum": list(RECOMMENDATION_SOURCES), "description": "both, kid (the games), you (the answers) or step (the fifth, the next step)."},
                    },
                    "required": ["title", "detail", "source"],
                },
            }
        },
    }  # fmt: skip
