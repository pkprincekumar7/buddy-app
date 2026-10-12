"""app/schemas/ninety_day_plan.py — the models behind /user/ninety-day-plan."""

import json

import pytest
from pydantic import ValidationError

from app.schemas.ninety_day_plan import (
    _MAX_BYTES,
    NinetyDayPlanPatch,
    NinetyDayPlanPhotoPresignRequest,
    NinetyDayPlanPhotoPresignResponse,
    NinetyDayPlanResponse,
)

# ── NinetyDayPlanResponse ────────────────────────────────────────────────────


def test_response_defaults_describe_an_unstarted_plan():
    assert NinetyDayPlanResponse().model_dump() == {
        "ask": None, "plan": None, "track_steps": None, "applied": {}, "act_inputs": {},
        "act_counts": {}, "feedback": {}, "event_name": None, "event_date": None,
        "event_set": False, "track_done": {}, "track_inputs": {}, "track_sittings": {},
        "photos": {},
    }  # fmt: skip


def test_response_ignores_storage_fields():
    plan = NinetyDayPlanResponse(_id="c1", user_id="p1", location="eu", ask="patience")
    assert plan.ask == "patience"
    assert not {"_id", "user_id", "location"} & set(plan.model_dump())


def test_response_mutable_defaults_are_not_shared():
    a, b = NinetyDayPlanResponse(), NinetyDayPlanResponse()
    a.applied["x"] = True
    a.photos["k"] = ["https://x"]
    assert b.applied == {} and b.photos == {}


def test_track_steps_holds_the_wrapper_object_not_a_bare_list():
    # The event-tracker job stores its whole {"steps": [...]} response verbatim.
    assert NinetyDayPlanResponse(track_steps={"steps": [1, 2]}).track_steps == {"steps": [1, 2]}
    with pytest.raises(ValidationError):
        NinetyDayPlanResponse(track_steps=[1, 2])


# ── NinetyDayPlanPatch ───────────────────────────────────────────────────────


def test_an_empty_patch_changes_nothing():
    patch = NinetyDayPlanPatch()
    assert patch.model_dump(exclude_unset=True) == {}
    assert patch.clear_track_steps is False


def test_patch_keeps_only_what_was_sent():
    patch = NinetyDayPlanPatch(applied={"a": True}, event_name=None)
    assert patch.model_dump(exclude_unset=True) == {"applied": {"a": True}, "event_name": None}


@pytest.mark.parametrize(
    ("field", "bad"),
    [
        ("applied", {"a": "maybe"}),
        ("act_inputs", {"a": 5}),
        ("act_counts", {"a": "many"}),
        ("act_counts", {"a": 1.5}),
        ("feedback", {"a": "not a dict"}),
        ("track_done", {"s": "done"}),
        ("track_inputs", {"s": ["x"]}),
        ("track_sittings", {"s": "x"}),
        ("photos", {"k": "https://single-url"}),
        ("photos", {"k": [1]}),
        ("event_set", "sometimes"),
    ],
)
def test_patch_value_types_are_enforced(field, bad):
    with pytest.raises(ValidationError):
        NinetyDayPlanPatch(**{field: bad})


def test_bool_maps_accept_pydantics_lax_spellings():
    # Pydantic's lax mode: "yes"/"no"/"1"/"0" coerce to bools — anything else is rejected.
    patch = NinetyDayPlanPatch(applied={"a": "yes", "b": "0"})
    assert patch.applied == {"a": True, "b": False}


@pytest.mark.parametrize(
    ("field", "limit"), [("ask", 2000), ("event_name", 200), ("event_date", 32)]
)
def test_patch_string_lengths_are_bounded(field, limit):
    NinetyDayPlanPatch(**{field: "x" * limit})
    with pytest.raises(ValidationError):
        NinetyDayPlanPatch(**{field: "x" * (limit + 1)})


def _feedback_of_size(total_bytes):
    """A feedback map whose patch serialises to exactly total_bytes."""
    overhead = len(json.dumps({"feedback": {"a": {"b": ""}}}))
    return {"a": {"b": "x" * (total_bytes - overhead)}}


def test_patch_payload_cap_is_exactly_64kb():
    at_cap = _feedback_of_size(_MAX_BYTES)
    assert len(json.dumps({"feedback": at_cap})) == _MAX_BYTES
    NinetyDayPlanPatch(feedback=at_cap)
    with pytest.raises(ValidationError, match="exceeds maximum allowed size \\(64 KB\\)"):
        NinetyDayPlanPatch(feedback=_feedback_of_size(_MAX_BYTES + 1))


def test_patch_cap_is_on_the_whole_body():
    half = {f"k{i}": "x" * 1000 for i in range(34)}  # ~34 KB each: fine alone
    NinetyDayPlanPatch(act_inputs=half)
    NinetyDayPlanPatch(track_inputs=half)
    with pytest.raises(ValidationError, match="exceeds maximum"):
        NinetyDayPlanPatch(act_inputs=half, track_inputs=half)


def test_patch_non_serialisable_payload_is_rejected():
    # JSON input can't produce a set, but a Python caller could.
    with pytest.raises(ValidationError, match="invalid or too-deeply nested"):
        NinetyDayPlanPatch(feedback={"a": {"tags": {"fun", "calm"}}})


# ── photo presign ────────────────────────────────────────────────────────────


@pytest.mark.parametrize("key", ["act:m101:sketch", "ideas", "a_b-c", "K" * 100, "0"])
def test_field_key_accepts_the_shapes_the_frontend_generates(key):
    assert (
        NinetyDayPlanPhotoPresignRequest(field_key=key, content_type="image/png").field_key == key
    )


@pytest.mark.parametrize(
    "key",
    ["../etc", "a/b", "a.b", "a b", "", "k" * 101, "ideas\n", "\nideas", "idéas", "a\\b", "%2e%2e"],
)
def test_field_key_cannot_carry_path_tricks_into_the_s3_key(key):
    with pytest.raises(ValidationError):
        NinetyDayPlanPhotoPresignRequest(field_key=key, content_type="image/png")


def test_presign_request_needs_both_fields_and_bounds_the_content_type():
    with pytest.raises(ValidationError):
        NinetyDayPlanPhotoPresignRequest(field_key="ideas")
    with pytest.raises(ValidationError):
        NinetyDayPlanPhotoPresignRequest(field_key="ideas", content_type="x" * 101)


def test_presign_response_shape():
    res = NinetyDayPlanPhotoPresignResponse(upload_url="https://u", photo_url="https://p")
    assert res.model_dump() == {"upload_url": "https://u", "photo_url": "https://p"}
