"""app/schemas/growth_areas.py — the models behind /user/completed-growth-areas."""

import json

import pytest
from pydantic import ValidationError

from app.schemas.growth_areas import (
    _GROWTH_AREA_MAX_BYTES,
    AppendGrowthAreaRequest,
    ChildActivity,
    ChildActivityResults,
    CompletedGrowthArea,
    CompletedGrowthAreasResponse,
)


def _request(**fields):
    return AppendGrowthAreaRequest(area_id="focus", area_name="Focus", **fields)


# ── ChildActivity ────────────────────────────────────────────────────────────


def test_child_activity_defaults():
    assert ChildActivity().model_dump() == {"selections": [], "results": None}
    assert ChildActivityResults().model_dump() == {
        "summary": "",
        "strengths": [],
        "suggested_activities": [],
    }


@pytest.mark.parametrize(
    ("model", "field", "ok", "too_big"),
    [
        (ChildActivity, "selections", ["s"] * 50, ["s"] * 51),
        (ChildActivityResults, "strengths", ["s"] * 20, ["s"] * 21),
        (ChildActivityResults, "suggested_activities", ["s"] * 20, ["s"] * 21),
        (ChildActivityResults, "summary", "x" * 2000, "x" * 2001),
    ],
)
def test_child_activity_limits(model, field, ok, too_big):
    model(**{field: ok})
    with pytest.raises(ValidationError):
        model(**{field: too_big})


def test_child_activity_nested_results_are_validated():
    with pytest.raises(ValidationError):
        ChildActivity(results={"strengths": ["s"] * 21})
    assert ChildActivity(results={"summary": "ok"}).results.summary == "ok"


# ── CompletedGrowthArea (response) ───────────────────────────────────────────


def test_completed_area_needs_only_id_and_name():
    area = CompletedGrowthArea(area_id="focus", area_name="Focus")
    dumped = area.model_dump()
    assert dumped["answers"] == {}
    assert {k for k, v in dumped.items() if v is not None} == {"area_id", "area_name", "answers"}


def test_completed_area_declares_the_worker_written_fields():
    # _doc_to_growth_area builds this model field by field — a field missing here
    # is silently dropped from every response.
    for field in ("parent_questions", "child_rounds", "life_pathway_milestones",
                  "pending_recommendations", "pending_child_activity"):  # fmt: skip
        assert field in CompletedGrowthArea.model_fields


def test_completed_area_answers_must_be_strings():
    with pytest.raises(ValidationError):
        CompletedGrowthArea(area_id="a", area_name="A", answers={"q1": {"nested": 1}})


def test_response_wraps_a_list_of_areas():
    res = CompletedGrowthAreasResponse(areas=[{"area_id": "a", "area_name": "A"}])
    assert res.areas[0].area_id == "a"
    with pytest.raises(ValidationError):
        CompletedGrowthAreasResponse()


# ── AppendGrowthAreaRequest ──────────────────────────────────────────────────


def test_request_requires_id_and_name():
    with pytest.raises(ValidationError):
        AppendGrowthAreaRequest(area_id="focus")
    with pytest.raises(ValidationError):
        AppendGrowthAreaRequest(area_name="Focus")


def test_request_tracks_which_optional_fields_were_sent():
    # The route only writes optional fields that were explicitly set, so an
    # omitted field must be distinguishable from an explicit null.
    req = _request(feedback=None, show_game=True)
    assert req.model_fields_set == {"area_id", "area_name", "feedback", "show_game"}


@pytest.mark.parametrize(
    ("field", "ok", "too_big"),
    [
        ("area_id", "x" * 50, "x" * 51),
        ("area_name", "x" * 100, "x" * 101),
        ("status", "x" * 50, "x" * 51),
        ("step", "x" * 100, "x" * 101),
        ("feedback", "x" * 2000, "x" * 2001),
        ("recommendations", ["r"] * 50, ["r"] * 51),
        ("answers", {f"q{i}": "a" for i in range(100)}, {f"q{i}": "a" for i in range(101)}),
        ("answers", {"q": "x" * 1000}, {"q": "x" * 1001}),
    ],
)
def test_request_field_limits(field, ok, too_big):
    fields = {"area_id": "focus", "area_name": "Focus", field: ok}
    AppendGrowthAreaRequest(**fields)
    with pytest.raises(ValidationError):
        AppendGrowthAreaRequest(**{**fields, field: too_big})


def _blob_for(total_bytes):
    """generated_activity sized so the request's counted total is exactly total_bytes
    (answers always counts as '{}', 2 bytes)."""
    overhead = len(json.dumps({"b": ""})) + 2
    return {"b": "x" * (total_bytes - overhead)}


def test_payload_cap_is_exactly_64kb():
    blob = _blob_for(_GROWTH_AREA_MAX_BYTES)
    assert 2 + len(json.dumps(blob)) == _GROWTH_AREA_MAX_BYTES
    _request(generated_activity=blob)
    with pytest.raises(ValidationError, match="exceeds maximum allowed size \\(64 KB\\)"):
        _request(generated_activity=_blob_for(_GROWTH_AREA_MAX_BYTES + 1))


@pytest.mark.parametrize(
    "field",
    ["selected_activity", "interactive_answers", "interactive_draft", "generated_activity"],
)
def test_every_free_form_dict_counts_towards_the_cap(field):
    half = _blob_for(_GROWTH_AREA_MAX_BYTES // 2 + 10)  # each fine alone, too big together
    _request(**{field: half})
    other = "generated_activity" if field != "generated_activity" else "interactive_draft"
    with pytest.raises(ValidationError, match="exceeds maximum"):
        _request(**{field: half, other: half})  # the cap is on the total, not per field


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("ai_three_month_recommendations", ["x" * 40_000]),
        ("child_activity_selections", ["x" * 40_000]),
        ("recommendations", ["x" * 40_000]),
        ("child_activity", {"results": {"summary": "x" * 2000}, "selections": ["x" * 40_000]}),
    ],
)
def test_lists_and_child_activity_count_towards_the_cap(field, value):
    with pytest.raises(ValidationError, match="exceeds maximum"):
        _request(**{field: value}, generated_activity=_blob_for(30_000))


def test_answers_values_count_towards_the_cap():
    answers = {f"q{i}": "x" * 1000 for i in range(70)}  # each value valid, total > 64 KB
    with pytest.raises(ValidationError, match="exceeds maximum"):
        _request(answers=answers)


def test_short_string_fields_count_towards_the_cap():
    near_cap = _blob_for(_GROWTH_AREA_MAX_BYTES - 10)
    _request(generated_activity=near_cap, step="x" * 10)
    for field in ("feedback", "step", "status"):
        with pytest.raises(ValidationError, match="exceeds maximum"):
            _request(generated_activity=near_cap, **{field: "x" * 11})


def test_non_serialisable_payloads_are_rejected():
    # JSON input can't produce these, but a Python caller could.
    with pytest.raises(ValidationError, match="invalid or too-deeply nested"):
        _request(interactive_answers={"picked": {"a", "b"}})
