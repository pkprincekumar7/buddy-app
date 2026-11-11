"""common.generation.fit: over-long LLM text clipped to the schema, structure untouched."""

from typing import Any

from jsonschema import Draft202012Validator

from common.generation.fit import ELLIPSIS, clip, clip_to_schema

STEP = {
    "type": "object",
    "properties": {
        "title": {"type": "string", "maxLength": 20},
        "body": {"type": "string", "maxLength": 40},
        "tags": {"type": "array", "items": {"type": "string", "maxLength": 5}},
        "free": {"type": "string"},
    },
}
SCHEMA = {"type": "object", "properties": {"steps": {"type": "array", "items": STEP}}}


def test_a_long_text_is_cut_at_a_word_with_an_ellipsis():
    assert clip("short", 10) == "short"
    cut = clip("Practise buttoning the big coat every morning before school", 40)
    assert len(cut) <= 40 and cut.endswith(ELLIPSIS) and not cut[:-1].endswith(" ")
    assert cut == "Practise buttoning the big coat every…"
    # No usable space: cut mid-word rather than lose most of the text.
    assert clip("x" * 50, 10) == "x" * 9 + ELLIPSIS


def test_every_string_under_a_max_length_is_clipped_and_the_rest_kept():
    answer: dict[str, Any] = {
        "steps": [
            {
                "title": "A very long title for one step",
                "body": "Fine",
                "tags": ["ok", "far too long"],
                "free": "no limit " * 20,
                "extra": "not in the schema",
            },
            "not an object",  # left as it is: the validator reports it
        ],
        "other": {"x": 1},
    }
    clipped = clip_to_schema(answer, SCHEMA)
    step = clipped["steps"][0]
    assert len(step["title"]) <= 20 and step["body"] == "Fine"
    assert step["tags"] == ["ok", "far" + ELLIPSIS]
    assert step["free"] == answer["steps"][0]["free"] and step["extra"] == "not in the schema"
    assert clipped["steps"][1] == "not an object" and clipped["other"] == {"x": 1}
    assert answer["steps"][0]["title"] == "A very long title for one step"  # a copy
    errors = list(Draft202012Validator(SCHEMA).iter_errors(clipped))
    assert all("too long" not in e.message for e in errors)  # only the structural one
    assert clip_to_schema(["a"], {"type": "array"}) == ["a"]  # no item schema: untouched
    assert clip_to_schema(7, {"type": "integer"}) == 7
