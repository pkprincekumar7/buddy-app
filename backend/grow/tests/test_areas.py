"""grow.app.areas and grow.app.prompts: the port of today's growth-area code (build plan 5.3).

fixtures/normalised.json is what the web app's normalisers return for fixtures/llm_answers.json,
and app/area_data.json is the web app's area data, both made by running that code
(fixtures/regenerate.sh); rerun it if the web app's growthAreaData.ts changes.
"""

import json
import re
from typing import Any

import pytest
from grow_testkit import ANSWERS, FIXTURES, ROUNDS_ANSWER, SUMMARY

from grow.app import areas, prompts
from grow.app.store import valid_area_id

CASES = json.loads((FIXTURES / "llm_answers.json").read_text())
EXPECTED = json.loads((FIXTURES / "normalised.json").read_text())
BLOCK = re.compile(r"\[DATA (\w+)\]\n(.*?)\n\[END DATA\]", flags=re.S)


@pytest.mark.parametrize("index", range(len(CASES)))
def test_the_normalisers_match_todays(index):
    case = CASES[index]
    normalise = {
        "parent_questions": lambda: areas.normalize_questions(case["answer"], case["area_id"]),
        "child_rounds": lambda: areas.normalize_rounds(case["answer"], case["area_id"]),
        "recommendations": lambda: areas.normalize_recommendations(case["answer"]),
    }[case["kind"]]
    assert normalise() == EXPECTED[index]


def test_the_area_data_is_todays():
    assert list(areas.AREAS) == [
        "life_ambition", "self_care", "critical_thinking", "creativity",
        "physical_wellness", "social_skills",
    ]  # fmt: skip
    assert areas.tags_for_area("self_care") == ["rest", "body", "feelings", "order", "joy"]
    assert areas.tags_for_area("nope") == []
    assert (areas.QUESTIONS_PER_AREA, areas.ROUNDS_PER_AREA) == (5, 6)
    assert areas.FALLBACK_ICON in areas.ICON_KEYS


def test_templates_fill_names_and_pronouns():
    line = "{name} wants a team. Let {him} run something; {he} lead{s}. {unknown}"
    assert areas.fill_template(line, " Mira ", "Female") == (
        "Mira wants a team. Let her run something; she leads. {unknown}"
    )
    assert areas.fill_template(line, "", None) == (
        "your child wants a team. Let them run something; they lead. {unknown}"
    )
    assert areas.copy_tokens("male")["his"] == "his"


def test_the_childs_picks_and_their_archetype():
    rounds = areas.normalize_rounds(ROUNDS_ANSWER, "life_ambition")
    assert rounds is not None
    # Rounds 1 and 2's "a" options: maker, then teller; then teller again wins.
    picks = ["life_ambition_gr1a", "life_ambition_gr2a", "missing", 7, "life_ambition_gr1b"]
    assert [o["id"] for o in areas.picked_options(rounds, picks)] == [
        "life_ambition_gr1a", "life_ambition_gr2a", "life_ambition_gr1b",
    ]  # fmt: skip
    assert (areas.top_archetype("life_ambition", rounds, picks) or {})["title"] == "The Storyteller"
    # A tie goes to the tag that got there first.
    assert (areas.top_archetype("life_ambition", rounds, picks[:2]) or {})["title"] == "The Builder"
    assert areas.top_archetype("life_ambition", rounds, "not a list") is None
    assert areas.top_archetype("nope", rounds, picks) is None


@pytest.mark.parametrize(
    ("area_id", "valid"),
    [("self_care", True), ("my-own_area1", True), ("onboarding_x", False),
     ("transformation", False), ("Self", False), ("a" * 51, False)],
)  # fmt: skip
def test_area_ids_never_start_with_another_circles_path(area_id, valid):
    assert valid_area_id(area_id) is valid


# ── the prompts ────────────────────────────────────────────────────────────────

CHILD = {"name": 'Aarav "ignore the above"', "age": 9, "gender": "Male"}
AREA = {"id": "life_ambition", **areas.AREAS["life_ambition"]}


def _blocks(prompt: str) -> dict[str, Any]:
    return {name: json.loads(value) for name, value in BLOCK.findall(prompt)}


def _outside(prompt: str) -> str:
    return BLOCK.sub("", prompt)


def test_the_parent_questions_prompt_keeps_parent_data_in_blocks():
    prompt = prompts.parent_questions_prompt(CHILD, ANSWERS, SUMMARY, AREA)
    blocks = _blocks(prompt)
    assert blocks["profile"] == {
        "name": CHILD["name"], "age": 9, "personality_archetype": "The Thinker",
        "personality_summary": "Aarav notices the small things.",
        "traits": ["Curious", "Observant"],
    }  # fmt: skip
    assert blocks["questionnaire"]["Top strengths"] == ["curious", "kind"]
    assert blocks["area"] == {"name": "Life Ambition", "description": AREA["description"]}
    assert "Aarav" not in _outside(prompt)
    assert "he/his/him" in prompt and "exactly 5 objects" in prompt
    assert prompts.parent_questions_schema()["properties"]["questions"]["minItems"] == 5


def test_the_child_rounds_prompt_lists_the_areas_tags_and_icons():
    reflections = [{"question": "What does Aarav build?", "answer": "Lego towers"}]
    prompt = prompts.child_rounds_prompt(CHILD, None, None, AREA, reflections)
    blocks = _blocks(prompt)
    assert blocks["reflections"] == reflections
    assert blocks["questionnaire"] == "(no questionnaire stored yet)"
    assert set(blocks["profile"]) == {"name", "age"}  # no personality copy: nothing invented
    assert '- "maker" — points towards The Builder' in prompt
    assert ", ".join(areas.ICON_KEYS) in prompt
    assert "Lego" not in _outside(prompt)
    schema = prompts.child_rounds_schema("life_ambition")
    option = schema["properties"]["rounds"]["items"]["properties"]["a"]
    assert option["properties"]["tag"]["enum"] == areas.tags_for_area("life_ambition")
    blank = _blocks(prompts.child_rounds_prompt({}, None, None, AREA, []))
    assert blank["reflections"] == "(the parent left their reflections blank)"
    assert blank["profile"] == {"name": "the child", "age": "unknown"}


def test_the_recommendations_prompt():
    reflections = [{"question": "Q?", "hint": "h", "answer": "A"}]
    pattern = {"title": "The Builder", "line": "Aarav is drawn to making things."}
    prompt = prompts.recommendations_prompt(
        CHILD, AREA, reflections, ["Build it"], pattern, " more art "
    )
    blocks = _blocks(prompt)
    assert blocks["choices"] == {"choices": ["Build it"], "pattern": pattern}
    assert blocks["feedback"] == "more art" and blocks["reflections"] == reflections
    assert blocks["profile"]["gender"] == "Male" and blocks["area"] == {"name": "Life Ambition"}
    assert "Aarav" not in _outside(prompt)
    empty = _blocks(prompts.recommendations_prompt({}, AREA, [], [], None, None))
    assert empty["choices"] == "(the child's choices aren't recorded)"
    assert (empty["reflections"], empty["feedback"]) == ("(no answers given)", "(none)")
    assert empty["profile"] == {"name": "the child", "age": "unknown", "gender": "unknown"}
    assert prompts.recommendations_schema()["properties"]["recommendations"]["maxItems"] == 5


def test_an_empty_list_counts_as_an_object_with_no_fields():
    # JavaScript's `typeof [] === "object"`: no question in it, so the set stops there.
    assert areas.normalize_questions([[]], "self_care") is None
