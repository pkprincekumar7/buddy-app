"""The personality: today's archetypes, the LLM's schema, the prompt and the view model (12.1, 8).

Ported from the web app, so the Discover pages render what they render today:
- `PERSONALITY_TYPES`: `personalityTypes` in `PersonalityAnalysis.tsx` (both apps hold the
  same table), the base each view model starts from;
- `LLM_SCHEMA`: `personalityLlmSchema()` (`lib/llmSchemas.ts`); the answer is checked
  against it before anything is stored;
- `build_prompt`: `buildPersonalityAnalysisPrompt` (`lib/prompts.ts`), except that the
  child's name, age, gender and answers go in as data blocks (common.generation.prompts),
  never spliced into the instructions;
- `view_model`: `adaptAiPersonalityToViewModel`, now on the server. The browser no longer
  adapts or saves it.

`school` isn't in the questionnaire block any more: it's on the child in children, and
discover's `child_access` copy doesn't hold it.
"""

from __future__ import annotations

import math
import re
from collections.abc import Mapping
from typing import Any

from jsonschema import Draft202012Validator

from common.generation.prompts import render

PERSONALITY_TYPES: dict[str, dict[str, Any]] = {
    "Ambitious": {
        "name": "Ambitious",
        "category": "motivators",
        "traits": ["Goal-oriented", "Driven", "Competitive", "Persistent", "Forward-thinking"],
        "description": "{childName} sets high standards, aims big, and is motivated by achieving success. They connect effort today with future goals and are energized by challenges.",
        "famous_people": [{"name": "Serena Williams"}, {"name": "Elon Musk"}],
        "color": "from-error-medium to-accent-pink",
        "strengths": ["Persistence", "High standards", "Focus on goals", "Motivation"],
        "growth_areas": ["Patience", "Managing stress", "Flexibility in approach"],
    },
    "Determined": {
        "name": "Determined",
        "category": "motivators",
        "traits": ["Focused", "Hardworking", "Resilient", "Patient", "Goal-oriented"],
        "description": "{childName} shows strong persistence, continues even in the face of difficulty, and is motivated to finish what they start.",
        "famous_people": [{"name": "Thomas Edison"}, {"name": "Malala Yousafzai"}],
        "color": "from-warning-orange-medium to-error-strong",
        "strengths": ["Persistence", "Goal completion", "Hard work", "Motivation under pressure"],
        "growth_areas": ["Flexibility", "Handling setbacks calmly", "Seeking help when needed"],
    },
    "Outgoing": {
        "name": "Outgoing",
        "category": "socializers",
        "traits": ["Friendly", "Sociable", "Confident", "Energetic", "Engaging"],
        "description": "{childName} thrives in social settings, enjoys meeting new people, and energizes others through their presence and enthusiasm.",
        "famous_people": [{"name": "Oprah Winfrey"}, {"name": "Will Smith"}],
        "color": "from-warning to-warning-orange",
        "strengths": ["Networking", "Communication", "Confidence", "Positive energy"],
        "growth_areas": ["Listening skills", "Sensitivity to introverts", "Managing overstimulation"],
    },
    "Creative": {
        "name": "Creative",
        "category": "creatives",
        "traits": ["Imaginative", "Inventive", "Curious", "Expressive", "Resourceful"],
        "description": "{childName} enjoys creating, imagining new possibilities, and finding unique solutions. They are inspired by self-expression and novel ideas.",
        "famous_people": [{"name": "Leonardo da Vinci"}, {"name": "Frida Kahlo"}],
        "color": "from-personality-light to-accent-pink",
        "strengths": ["Imagination", "Problem-solving", "Adaptability", "Artistic skills"],
        "growth_areas": ["Practical implementation", "Time management", "Accepting criticism"],
    },
    "Enthusiastic": {
        "name": "Enthusiastic",
        "category": "motivators",
        "traits": ["Excitable", "Optimistic", "Eager", "Passionate", "Energetic"],
        "description": "{childName} approaches new experiences with eagerness, expresses joy openly, and brings energy to their surroundings.",
        "famous_people": [{"name": "Robin Williams"}, {"name": "Ellen DeGeneres"}],
        "color": "from-success-bright to-warning-medium",
        "strengths": ["Positive energy", "Motivation", "Inspiration to others", "Optimism"],
        "growth_areas": ["Focusing energy", "Patience", "Managing disappointment"],
    },
    "Restless": {
        "name": "Restless",
        "category": "adventurers",
        "traits": ["Curious", "Impatient", "Varied interests", "Energetic", "Quick-moving"],
        "description": "{childName} prefers variety and fast-paced activities, seeks new experiences, and gets bored when things are slow or repetitive.",
        "famous_people": [{"name": "Richard Branson"}, {"name": "Bear Grylls"}],
        "color": "from-warning-orange to-error-medium",
        "strengths": ["Adaptability", "Energy", "Variety-seeking", "Quick learning"],
        "growth_areas": ["Patience", "Long-term focus", "Consistency"],
    },
    "Highly Energetic": {
        "name": "Highly Energetic",
        "category": "motivators",
        "traits": ["Active", "Vibrant", "Enthusiastic", "Persistent", "Alert"],
        "description": "{childName} has a high energy level, enjoys being active, and can engage in multiple activities with stamina and vitality.",
        "famous_people": [{"name": "Serena Williams"}, {"name": "Dwayne Johnson"}],
        "color": "from-error-medium to-warning-medium",
        "strengths": ["Stamina", "Multitasking", "Enthusiasm", "Persistence"],
        "growth_areas": ["Rest and recovery", "Focus", "Patience with slower activities"],
    },
    "Thinker": {
        "name": "Thinker",
        "category": "creatives",
        "traits": ["Curious", "Analytical", "Observant", "Thoughtful", "Problem-solver"],
        "description": "{childName} enjoys thinking deeply, solving problems, asking questions, and reflecting on experiences.",
        "famous_people": [{"name": "Albert Einstein"}, {"name": "Marie Curie"}],
        "color": "from-info to-personality-alt-strong",
        "strengths": ["Analytical thinking", "Problem-solving", "Curiosity", "Reflection"],
        "growth_areas": ["Action-taking", "Practical application", "Social interaction"],
    },
    "Playful": {
        "name": "Playful",
        "category": "socializers",
        "traits": ["Joyful", "Silly", "Energetic", "Curious", "Spontaneous"],
        "description": "{childName} brings fun and joy to situations, enjoys games and surprises, and approaches life with a light-hearted spirit.",
        "famous_people": [{"name": "Jim Carrey"}, {"name": "Robin Williams"}],
        "color": "from-accent-pink to-personality",
        "strengths": ["Humor", "Joy", "Creativity", "Social engagement"],
        "growth_areas": ["Focus", "Handling serious tasks", "Patience"],
    },
}  # fmt: skip
PERSONALITY_TYPE_KEYS: tuple[str, ...] = tuple(PERSONALITY_TYPES)
CATEGORY_KEYS: tuple[str, ...] = ("motivators", "socializers", "creatives", "adventurers")

# Brief descriptors so the LLM knows what each archetype key means (lib/prompts.ts).
ARCHETYPE_DESCRIPTORS: dict[str, str] = {
    "Ambitious": "goal-driven, competitive, motivated by achievement and future success",
    "Determined": "focused, hardworking, resilient, finishes what they start",
    "Outgoing": "friendly, sociable, confident, energised by people and social settings",
    "Creative": "imaginative, inventive, expressive, drawn to ideas and self-expression",
    "Enthusiastic": "excitable, optimistic, passionate, brings positive energy to everything",
    "Restless": "curious, variety-seeking, quick-moving, gets bored with repetition",
    "Highly Energetic": "active, vibrant, high-stamina, thrives in physical and multi-tasking contexts",
    "Thinker": "analytical, observant, deep-thinking, loves questions and problem-solving",
    "Playful": "joyful, spontaneous, light-hearted, approaches life with humour and fun",
}

# ── the LLM's answer ───────────────────────────────────────────────────────────

_STYLE = {"type": "string", "enum": list(PERSONALITY_TYPE_KEYS)}
LLM_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "dominant_style": _STYLE,
        "personality_category": {"type": "string", "enum": list(CATEGORY_KEYS)},
        "secondary_styles": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"personality_style": _STYLE, "prominence": {"type": "number"}},
            },
            "maxItems": 2,
        },
        "personalized_traits": {"type": "array", "items": {"type": "string"}, "minItems": 4, "maxItems": 6},
        "personalized_description": {"type": "string", "maxLength": 180},
        "personalized_growth_areas": {"type": "array", "items": {"type": "string"}, "minItems": 3, "maxItems": 10},
        "role_models": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"name": {"type": "string"}, "caption": {"type": "string", "maxLength": 48}},
                "required": ["name", "caption"],
            },
            "minItems": 2,
            "maxItems": 2,
        },
        "strength_summary_bullets": {"type": "array", "items": {"type": "string"}, "minItems": 6, "maxItems": 6},
        "trait_scores": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"label": {"type": "string"}, "score": {"type": "number", "minimum": 0, "maximum": 100}},
                "required": ["label", "score"],
            },
            "minItems": 4,
            "maxItems": 5,
        },
        "child_quote": {"type": "string", "maxLength": 120},
        "parent_note": {"type": "string", "maxLength": 220},
    },
    "required": [
        "dominant_style", "personality_category", "secondary_styles", "personalized_traits",
        "personalized_description", "personalized_growth_areas", "role_models",
        "strength_summary_bullets", "trait_scores", "child_quote", "parent_note",
    ],
}  # fmt: skip
_VALIDATOR = Draft202012Validator(LLM_SCHEMA)


def schema_errors(answer: Any) -> list[str]:
    """Where the LLM's answer breaks LLM_SCHEMA (paths only, never the text); [] if it fits."""
    return sorted(
        {
            "/".join(str(p) for p in error.absolute_path) or "(root)"
            for error in _VALIDATOR.iter_errors(answer)
        }
    )


# ── the prompt ─────────────────────────────────────────────────────────────────

_LABELS: dict[str, str] = {
    "strengths": "Top strengths",
    "hobbies": "Hobbies",
    "thinking_pattern": "Thinking pattern",
    "communication_style": "Communication style",
    "energy_level": "Energy level",
    "social_behaviour": "Social behaviour",
    "emotional_behaviour": "Emotional behaviour",
}

_TEMPLATE = """You are a child development specialist analysing a single child using a Superpower onboarding questionnaire completed by their parent/caregiver.

Return JSON ONLY that conforms to the response schema. Use warm, parent-friendly language throughout all human-facing fields.

Child profile (name, age, gender):
$profile

Collected questionnaire responses:
$questionnaire

Available personality archetypes (dominant_style must be EXACTLY one of these keys):
ARCHETYPES

Pronoun guidance: use PRONOUNS pronouns for the child in all human-facing text fields.

Requirements:
• dominant_style: Select the single archetype that best fits the child's questionnaire answers, taking their age and gender into account. A 10-year-old and a 15-year-old showing similar answers may map to different archetypes due to developmental stage differences.
• personality_category: must be one of: motivators, socializers, creatives, adventurers. Use this exact mapping — do not deviate:
  - Ambitious, Determined → motivators
  - Outgoing, Playful → socializers
  - Creative, Enthusiastic → creatives
  - Restless, Highly Energetic, Thinker → adventurers
• secondary_styles: up to TWO additional archetypes (different from dominant_style) that partially describe the child, each with a prominence score of 40–92. Base these strictly on questionnaire evidence.
• personalized_traits: 4–6 concise trait chips that are directly anchored in the parent's actual answers and the dominant archetype. Do not invent traits — only include what the questionnaire supports.
• personalized_description: EXACTLY ONE sentence (max 160 characters), written warmly for the parent/caregiver. Mention the child's name (from the profile) naturally once. Connect specific questionnaire cues to temperament. Use the correct pronoun. No invented facts, no second sentence, no bullets, no line breaks.
• personalized_growth_areas: 4–7 specific, actionable growth opportunities. Each bullet must: (a) name a concrete skill or behaviour gap visible in the questionnaire answers, (b) be appropriate for the child's age and gender (from the profile), and (c) be something a parent can meaningfully work on with the child. Write each bullet using the correct pronoun.
• role_models: EXACTLY two well-known, admirable public figures whose temperament and life story genuinely match the dominant archetype, and who are relatable and inspiring for a child of the profile's age and gender. For each provide: name (full name) and caption (a 4–6 word lowercase phrase describing what made them notable, e.g. "wondered about everything", "never stopped asking why").
• strength_summary_bullets: exactly 6 strength-focused bullets. Draw solely from what the parent's answers directly support — do not infer beyond the evidence. If extrapolating, frame it as a possibility, not a fact.
• trait_scores: 4–5 named mind-dimension scores (0–100 integers) that are directly grounded in the questionnaire evidence. Label each dimension concisely (e.g. "Curiosity", "Focus Power", "Creativity", "Social Energy"). Scores must reflect the actual questionnaire answers — do not invent.
• child_quote: A short, vivid first-person phrase (max 110 characters) that sounds like it could genuinely come from this child based on the questionnaire cues. Use the correct pronoun. No invented facts.
• parent_note: One or two warm, actionable sentences of parenting advice specific to this personality type and the questionnaire evidence. Address the parent directly ("Your child…"). Max 200 characters."""


def pronouns(gender: str | None) -> str:
    value = (gender or "").lower()
    return "she/her" if value == "female" else "he/his" if value == "male" else "they/their"


def build_prompt(child: Mapping[str, Any], answers: Mapping[str, Any]) -> str:
    """The personality prompt from discover's copies: `child_access` and `onboarding_inputs`."""
    archetypes = "\n".join(
        f"  • {key} — {ARCHETYPE_DESCRIPTORS.get(key, 'see context')}"
        for key in PERSONALITY_TYPE_KEYS
    )
    questionnaire = {
        label: answers[field]
        for field, label in _LABELS.items()
        if answers.get(field) not in (None, "", [])
    }
    # Only the server's own text replaces these; parent data goes in the data blocks.
    template = _TEMPLATE.replace("ARCHETYPES", archetypes).replace(
        "PRONOUNS", pronouns(child.get("gender"))
    )
    return render(
        template,
        profile={
            "name": child.get("name") or "",
            "age": child.get("age") if child.get("age") is not None else "unknown",
            "gender": child.get("gender") or "unknown",
        },
        questionnaire=questionnaire or "(no questionnaire stored yet)",
    )


# ── the view model (adaptAiPersonalityToViewModel) ─────────────────────────────


def _js_string(value: Any) -> str:
    """String(value) as JavaScript writes it, for the few non-string values the port sees."""
    if isinstance(value, str):
        return value
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _strings(raw: Any, fallback: list[str]) -> list[str]:
    if isinstance(raw, list) and raw:
        return [s for s in (_js_string(item) for item in raw) if s]
    return list(fallback)


def one_liner(raw: str, max_len: int = 180) -> str:
    """personalizedDescriptionOneLiner: the first sentence, cut at a word under `max_len`."""
    flat = re.sub(r"\s+", " ", raw).strip()
    if not flat:
        return ""
    match = re.match(r"^(.+?[.!?])(\s|$)", flat)
    sentence = match.group(1).strip() if match else flat
    if len(sentence) > max_len:
        sentence = sentence[:max_len].rstrip()
        last_space = sentence.rfind(" ")
        if last_space > max_len // 2:
            sentence = sentence[:last_space]
        sentence = f"{sentence}…"
    return sentence


def _number(value: Any) -> float | int | None:
    """Number(value ?? 0): None where JavaScript gets NaN (which JSON writes as null)."""
    if value is None:
        return 0
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int | float):
        return value if math.isfinite(value) else None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def view_model(ai: Mapping[str, Any], child_name: str | None) -> dict[str, Any]:
    """The `{type, scores, profile}` the Discover pages render, from the LLM's answer."""
    safe_name = child_name.strip() if child_name and child_name.strip() else "your child"
    style = ai.get("dominant_style")
    dominant = style if isinstance(style, str) and style in PERSONALITY_TYPES else "Creative"
    category = ai.get("personality_category")
    base = PERSONALITY_TYPES[dominant]
    category_key = (
        category if isinstance(category, str) and category in CATEGORY_KEYS else base["category"]
    )

    raw_description = ai.get("personalized_description")
    raw_description = raw_description.strip() if isinstance(raw_description, str) else ""
    if raw_description:
        named = re.sub(r"\{childName\}", lambda _: safe_name, raw_description, flags=re.IGNORECASE)
        named = re.sub(r"\btheir\b", lambda _: f"{safe_name}'s", named, flags=re.IGNORECASE)
        description = one_liner(named)
    else:
        description = base["description"].replace("{childName}", safe_name, 1)

    scores: dict[str, float | int] = dict.fromkeys(PERSONALITY_TYPE_KEYS, 14)
    scores[dominant] = 100
    secondaries = ai.get("secondary_styles")
    for secondary in (secondaries if isinstance(secondaries, list) else [])[:2]:
        if not isinstance(secondary, Mapping):
            continue
        sec_style = secondary.get("personality_style")
        if (
            not isinstance(sec_style, str)
            or sec_style not in PERSONALITY_TYPES
            or sec_style == dominant
        ):
            continue
        prominence = secondary.get("prominence")
        value = (
            prominence
            if isinstance(prominence, int | float) and not isinstance(prominence, bool)
            else 72
        )
        clamped = max(42, min(96, value if math.isfinite(value) else 72))
        if not scores[sec_style] or scores[sec_style] < clamped:
            scores[sec_style] = clamped

    raw_scores = ai.get("trait_scores")
    trait_scores: list[dict[str, Any]] = []
    if isinstance(raw_scores, list):
        for item in raw_scores:
            entry = item if isinstance(item, Mapping) else {}
            label = entry.get("label")
            label = _js_string("" if label is None else label)
            if label:
                trait_scores.append({"label": label, "score": _number(entry.get("score"))})

    def text(name: str) -> str:
        value = ai.get(name)
        return value.strip() if isinstance(value, str) else ""

    profile = {
        **base,
        "category": category_key,
        "name": base["name"],
        "traits": _strings(ai.get("personalized_traits"), base["traits"]),
        "description": description,
        "famous_people": [dict(person) for person in base["famous_people"]],
        "strengths": _strings(ai.get("strength_summary_bullets"), base["strengths"]),
        "growth_areas": _strings(ai.get("personalized_growth_areas"), base["growth_areas"]),
        "trait_scores": trait_scores,
        "child_quote": text("child_quote"),
        "parent_note": text("parent_note"),
    }
    return {"type": dominant, "scores": scores, "profile": profile}


def summary(model: Mapping[str, Any]) -> dict[str, Any]:
    """`discover.personality_finalised`'s payload: the trait summary and strengths (7.6)."""
    profile = model["profile"]
    return {
        "traits": {
            "dominant_style": model["type"],
            "personality_category": profile["category"],
            "traits": profile["traits"],
            "description": profile["description"],
        },
        "strengths": profile["strengths"],
    }
