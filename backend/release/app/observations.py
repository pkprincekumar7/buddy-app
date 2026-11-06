"""The observation patterns (docs/auth-users-split.md, 8, 12.1).

Ported from the web app: `normalizeObservations`, `selectObservations` and
`observationsLlmSchema` (`lib/observationsData.ts`), and `buildObservationsPrompt`
(`lib/prompts.ts`), with the evidence blocks the Observations page built
(`buildGrowthAreaContext`, `buildChildActivityContext`). What today's page promoted after a
job is what the server stores now: the answer normalised (no note, no card; no source, no
card; icons from the registry; child-choice notes only if they match a line we gave), then
trimmed to the six cards the page shows, every offered evidence block getting a card first.

The evidence comes from release's own copies: `child_access` (name, age, gender),
`onboarding_inputs` (the questionnaire) and `growth_inputs` (each completed area's questions
with answers, and the child's picks as "Chose “X” over “Y”" lines). It goes in data blocks;
the instructions name the blocks by their source key only.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from itertools import islice
from typing import Any

from common.generation.prompts import render

ICON_KEYS: tuple[str, ...] = ("focus", "read", "sense", "motion", "words", "social", "note")
SELECTABLE_ICON_KEYS: tuple[str, ...] = tuple(k for k in ICON_KEYS if k != "note")
FALLBACK_ICON = "note"
SOURCES: tuple[str, ...] = ("onboarding", "grow", "child")

MAX_OBSERVATIONS = 6  # the cards the page shows
MAX_CANDIDATES = 8  # what the model may return: room for the per-source guarantee
MAX_NOTES = 3
TITLE_MAX_WORDS = 10
SUMMARY_MAX_WORDS = 28
NOTE_MAX_WORDS = 22

_WRAPPERS = (('"', '"'), ("“", "”"), ("'", "'"), ("‘", "’"))


def _string(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def cap_words(text: str, max_words: int) -> str:
    words = text.split()
    return text if len(words) <= max_words else " ".join(words[:max_words]) + "…"


def tidy_note(text: str) -> str:
    """Wrapping quotes off, inner straight quotes typographic, punctuation alone dropped."""
    out = text.strip()
    for opening, closing in _WRAPPERS:
        if (
            len(out) >= len(opening) + len(closing)
            and out.startswith(opening)
            and out.endswith(closing)
        ):
            out = out[len(opening) : -len(closing)].strip()
            break
    pieces = out.split('"')
    out = pieces[0] + "".join(
        ("“" if i % 2 else "”") + piece for i, piece in enumerate(pieces[1:], start=1)
    )
    return out if any(ch.isalnum() for ch in out) else ""


def choice_key(text: str) -> str:
    """Case, spacing, trailing periods and quote style away; the options themselves stay."""
    return re.sub(r"[\s.]+", " ", re.sub(r"[“”\"]", '"', text.lower())).strip()


def _allowed(note: str, allowed: set[str] | None) -> bool:
    """A "Chose … over …" note must be a line we gave: the one kind we can check exactly."""
    if allowed is None or not re.match(r"chose\s", note, flags=re.IGNORECASE):
        return True
    return choice_key(note) in allowed


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")[:48]


def _items(raw: Any) -> list[Any] | None:
    if isinstance(raw, list):
        return raw
    if not isinstance(raw, Mapping):
        return None
    nested = raw.get("observations")
    return nested if isinstance(nested, list) else None


def normalize(raw: Any, allowed_choices: Iterable[str] | None = None) -> list[dict[str, Any]]:
    """The valid observations, with ids; malformed ones dropped, at most 8 candidates."""
    allowed = (
        {choice_key(line) for line in allowed_choices} if allowed_choices is not None else None
    )
    items = _items(raw)
    if items is None:
        return []
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in items:
        if len(out) >= MAX_CANDIDATES:
            break
        if not isinstance(item, Mapping | list):
            continue
        entry: Mapping[str, Any] = item if isinstance(item, Mapping) else {}
        title, summary = _string(entry.get("title")), _string(entry.get("summary"))
        if not title or not summary:
            continue
        raw_notes = entry.get("notes")
        notes = [
            cap_words(note, NOTE_MAX_WORDS)
            for note in (
                tidied
                for tidied in (
                    tidy_note(_string(n))
                    for n in (raw_notes if isinstance(raw_notes, list) else [])
                )
                if tidied and _allowed(tidied, allowed)
            )
        ][:MAX_NOTES]
        if not notes:
            continue  # no evidence, no card
        raw_sources = entry.get("sources")
        sources = list(
            dict.fromkeys(
                s
                for s in (
                    _string(v) for v in (raw_sources if isinstance(raw_sources, list) else [])
                )
                if s in SOURCES
            )
        )
        if not sources:
            continue  # an observation we can't attribute is one we can't honestly show
        icon = _string(entry.get("icon"))
        item_id = _slug(title) or f"observation_{len(out) + 1}"
        if item_id in seen:
            item_id = f"{item_id}_{len(out) + 1}"
        seen.add(item_id)
        out.append(
            {
                "id": item_id,
                "title": cap_words(title, TITLE_MAX_WORDS),
                "summary": cap_words(summary, SUMMARY_MAX_WORDS),
                "notes": notes,
                "icon": icon if icon in ICON_KEYS else FALLBACK_ICON,
                "sources": sources,
            }
        )
    return out


@dataclass(frozen=True)
class Selection:
    items: list[dict[str, Any]]
    unrepresented: list[str] = field(default_factory=list)
    dropped: int = 0


def select(items: list[dict[str, Any]], available: Sequence[str]) -> Selection:
    """The six cards, every offered block getting one before any gets a second, in the
    model's own order (selectObservations)."""

    def unrepresented(kept: list[dict[str, Any]]) -> list[str]:
        return [s for s in available if not any(s in o["sources"] for o in kept)]

    if len(items) <= MAX_OBSERVATIONS:
        return Selection(items, unrepresented(items), 0)
    reserved: set[str] = set()
    for source in available:  # at most three: never past the six on their own
        first = next((o for o in items if o["id"] not in reserved and source in o["sources"]), None)
        if first is not None:
            reserved.add(first["id"])
    rest = (o["id"] for o in items if o["id"] not in reserved)
    reserved.update(islice(rest, MAX_OBSERVATIONS - len(reserved)))
    kept = [o for o in items if o["id"] in reserved]
    return Selection(kept, unrepresented(kept), len(items) - len(kept))


def schema() -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "observations": {
                "type": "array",
                "minItems": MAX_OBSERVATIONS,
                "maxItems": MAX_CANDIDATES,
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string", "maxLength": 60, "description": "At most 8 words naming the pattern in the parent’s own vocabulary. Not a sentence, not a label."},
                        "summary": {"type": "string", "maxLength": 170, "description": "One sentence, at most 28 words, describing what the parent reported. No diagnosis, no frequency claim."},
                        "notes": {
                            "type": "array",
                            "minItems": 2,
                            "maxItems": MAX_NOTES,
                            "items": {"type": "string", "maxLength": 140, "description": "A distinct, specific observation derived from the evidence — never a sentence copied out of it, and never a repeat of the summary or another note."},
                        },
                        "icon": {"type": "string", "enum": list(SELECTABLE_ICON_KEYS), "description": "Closest matching icon key for this pattern."},
                        "sources": {
                            "type": "array",
                            "minItems": 1,
                            "maxItems": len(SOURCES),
                            "items": {"type": "string", "enum": list(SOURCES)},
                            "description": "Every evidence block this observation actually draws on.",
                        },
                    },
                    "required": ["title", "summary", "notes", "icon", "sources"],
                },
            }
        },
        "required": ["observations"],
    }  # fmt: skip


# ── the evidence and the prompt ────────────────────────────────────────────────

_LABELS: dict[str, str] = {
    "strengths": "Top strengths",
    "hobbies": "Hobbies",
    "thinking_pattern": "Thinking pattern",
    "communication_style": "Communication style",
    "energy_level": "Energy level",
    "social_behaviour": "Social behaviour",
    "emotional_behaviour": "Emotional behaviour",
}


@dataclass(frozen=True)
class Evidence:
    """The blocks a prompt offers, in the order it offers them, and the choice lines."""

    blocks: dict[str, Any]
    choice_lines: list[str]

    @property
    def sources(self) -> list[str]:
        return list(self.blocks)


def evidence(answers: Mapping[str, Any] | None, areas: Sequence[Mapping[str, Any]]) -> Evidence:
    """From the copies: the questionnaire, the areas' reflections, the child's picks."""
    blocks: dict[str, Any] = {}
    questionnaire = {
        label: answers[name]
        for name, label in _LABELS.items()
        if answers and answers.get(name) not in (None, "", [])
    }
    if questionnaire:
        blocks["onboarding"] = questionnaire
    reflections = {
        area["area_name"]: [pair for pair in area["reflections"] if pair.get("answer")]
        for area in areas
        if any(pair.get("answer") for pair in area.get("reflections") or [])
    }
    if reflections:
        blocks["grow"] = reflections
    choices = {
        area["area_name"]: list(area["child_choices"])
        for area in areas
        if area.get("child_choices")
    }
    if choices:
        blocks["child"] = choices
    return Evidence(blocks, [line for lines in choices.values() for line in lines])


_INTRO = {
    "onboarding": "[SOURCE: onboarding] Onboarding questionnaire, answered by the parent:",
    "grow": "[SOURCE: grow] Growth-area reflections, answered by the parent (per area, each question with the parent's answer):",
    "child": "[SOURCE: child] The child's own picks in the Grow rounds (per area). Each line is a forced choice between two options WE offered — the child tapped one, so these are choices, not quotations:",
}

_TEMPLATE = """You are helping a parent see the patterns in what THEY have already told us about their child. You are a careful listener writing back what you heard. You are not an assessor.

Child (use PRONOUNS pronouns):
$profile

Every evidence block below is tagged with the source key you must cite for anything you draw from it.

BLOCKS

Return JSON ONLY conforming to the response schema.

HOW TO BUILD THE SET
1. Return EXACTLY six observations. Not five, not seven.
2. Read across EVERY block before deciding what the six are. You are describing six different facets of one child — how attention works, how the child communicates, what settles the child, what the child chooses, what the child avoids, what the child is drawn to. Two observations a parent would read as the same point waste a slot.
3. Prefer merging two halves of one answer into a single richer observation. If merging everything mergeable leaves you short of six, do NOT split a pattern back apart to pad the count — return to the blocks and find a facet you have not used.
4. Every observation must rest on something in the blocks above. If you cannot trace it, drop it and find another.
RULE5
6. A pattern that shows up in MORE THAN ONE block is the strongest thing this page can offer, because it has turned up more than once. Group it into ONE observation citing every block it appears in, and put those observations FIRST in your list. Something the parent described that the child's own choices also point to is worth more than either on its own — do not split it into two cards and lose that.

FIELD RULES
• title — at most 8 words, and it must READ AS A PATTERN, containing a verb. Not a noun fragment lifted out of the answer.
  Good: "Attention runs long on chosen projects" · "Settles better outdoors than indoors" · "Reading aloud runs slower than talking"
  Bad, because it is a category: "Sensory sensitivity" · "Executive function"
  Bad, because it is a fragment that tells the parent nothing: "Three things to do" · "Sit with a Lego build" · "Lego and focus"
• summary — ONE sentence, max 28 words, addressed to the parent, using PRONOUNS. It states the pattern the notes are facets of. It must NOT restate any single note, and must not simply string the notes together: if the parent could delete this sentence and lose nothing, rewrite it.
• notes — EXACTLY 2 or 3 points. These carry the value of the card. They are NOT a transcript, and a parent who has just written those answers gains nothing from being read them back.
  – From the onboarding or grow blocks: NEVER copy a sentence out of the block. Turn what it tells you into a specific observation. "I have to call him twice for dinner" is input; "Needs a second call before dinner lands once absorbed" is a note.
  – Each note must add something the summary does NOT say, and something no other note on this card says. If two notes could merge without losing information, you have written one note twice — replace it.
  – Reword and sharpen only. Do NOT add a fact, cause, motive or consequence the evidence does not contain. Every note must stay traceable to the block it came from.
  – From the child block, the ONE exception to rewording: copy the line EXACTLY as written, whole, in its Chose “X” over “Y” form. Do not reword it, summarise it, or re-pair halves of two different lines. This is not stylistic — the two options in a round are the one thing you cannot paraphrase without risking claiming the child chose something the child actually rejected, and the rejected side is half the meaning. Reproduce a line verbatim or leave it out.
  – The child tapped one of two options WE wrote and said nothing, so never present a choice as the child's words or as speech.
  Do NOT wrap a note in quotation marks — the page frames them itself. Quote marks belong only inside a child-block line, around each of the two options.
• sources — every source key whose block you actually drew on for this pattern. Cite honestly; do not add a key for a block you did not use.
• icon — closest match from: ICONS.

WHAT THE BAN BELOW IS AND IS NOT
Describing a behaviour the parent described, in the parent's own words, is always allowed — including behaviour around reading, attention, noise or social situations. That is the whole product. What is banned is NAMING it as a category, or implying it should be looked into. "Reading aloud runs slower than talking" is required of you if the parent said it. "Possible reading difficulty" is forbidden. Do not resolve this tension by dropping the observation: silently omitting what the parent raised is the worst available outcome, worse than either extreme.

FORBIDDEN — these break the product's core promise to the parent
• No diagnostic or screening vocabulary, in any field, including as a hedge. Never use: disorder, syndrome, condition, deficit, ADHD, ADD, autism, autistic, ASD, spectrum, neurodivergent, dyslexia, dyslexic, dyspraxia, sensory processing disorder, SPD, ODD, anxiety, depression, impairment, disability, delay, symptom, trait marker, clinical, diagnosis, assessment, screening.
• Do not suggest the child be assessed, screened, evaluated, or seen by a professional. That is not this page's job. Note the parent may themselves be wondering whether to raise something with a teacher — reflect that they said it, but do not answer the question for them.
• No frequency or repetition claims. You have single-sitting answers, not a log, so you cannot know how often anything happens. Never write "often", "always", "usually", "frequently", "repeatedly", "tends to", "every time", or any count. Write what was reported, not how often it occurs.
• No comparison to other children or to developmental norms. Never "for children of that age", "behind", "ahead", "below average", "typical", "advanced", "struggles with".
• No cause-and-effect explanation of why the child is like this. Report the pattern; do not theorise the mechanism.
• Do not rank the patterns by concern, and do not flag any of them as the important one."""


def _pronouns(gender: str | None) -> str:
    value = (gender or "").lower()
    return "she/her" if value == "female" else "he/his" if value == "male" else "they/their"


def prompt(child: Mapping[str, Any], found: Evidence) -> str:
    keys = found.sources
    if len(keys) == 1:
        rule5 = f"5. There is one source block above ({keys[0]}). Everything you return must be grounded in it."
    else:
        rule5 = (
            f"5. There are {len(keys)} source blocks above ({', '.join(keys)}), so AT LEAST "
            f"{len(keys)} of your observations must each cite a different one. Count them before "
            "you answer. A longer block is not a more important one: one block may hold a "
            "handful of fields while another holds thirty answers, and both still get represented."
        )
    blocks = "\n\n".join(f"{_INTRO[key]}\n${key}" for key in keys)
    template = (
        _TEMPLATE.replace("BLOCKS", blocks)
        .replace("RULE5", rule5)
        .replace("PRONOUNS", _pronouns(child.get("gender")))
        .replace("ICONS", ", ".join(SELECTABLE_ICON_KEYS))
    )
    return render(
        template,
        profile={
            "name": (child.get("name") or "").strip() or "the child",
            "age": child.get("age") if child.get("age") is not None else "unknown",
            "gender": child.get("gender") or "unknown",
        },
        **found.blocks,
    )
