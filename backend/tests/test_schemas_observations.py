"""app/schemas/observations.py — the models behind /user/observations."""

import json

import pytest
from pydantic import ValidationError

from app.schemas.observations import (
    _OBSERVATIONS_MAX_BYTES,
    _OBSERVATIONS_MAX_ITEMS,
    ObservationsPatch,
    ObservationsResponse,
)

CAP = _OBSERVATIONS_MAX_ITEMS

# ── ObservationsResponse ─────────────────────────────────────────────────────


def test_response_defaults_are_empty():
    assert ObservationsResponse().model_dump() == {
        "source": None,
        "items": [],
        "watching": [],
        "span": None,
        "started_at": None,
        "pending_observations": None,
    }


def test_cap_leaves_room_for_the_staged_candidates():
    # The client asks the provider for 8 candidates and shows 6.
    assert CAP == 8


@pytest.mark.parametrize("field", ["items", "watching"])
def test_over_long_stored_lists_are_truncated_not_rejected(field):
    # A plain max_length would turn one oversized stored document into a
    # permanent 500 on every read.
    stored = [f"o{i}" for i in range(CAP + 5)]
    res = ObservationsResponse(**{field: stored})
    assert getattr(res, field) == stored[:CAP]


@pytest.mark.parametrize("field", ["items", "watching"])
def test_lists_at_or_under_the_cap_are_kept_whole(field):
    stored = [f"o{i}" for i in range(CAP)]
    assert getattr(ObservationsResponse(**{field: stored}), field) == stored


def test_items_are_open_ended_provider_objects():
    items = [{"id": "o1", "icon": "spark", "anything": [1, {"x": 2}]}, "legacy-string"]
    assert ObservationsResponse(items=items).items == items


def test_watching_entries_must_be_strings():
    # Why the route filters non-strings out of a stored document before building this.
    with pytest.raises(ValidationError):
        ObservationsResponse(watching=["o1", 7])


def test_response_ignores_storage_fields():
    res = ObservationsResponse(_id="c1", user_id="p1", location="eu", source="onboarding")
    assert res.source == "onboarding" and "user_id" not in res.model_dump()


def test_mutable_defaults_are_not_shared():
    a, b = ObservationsResponse(), ObservationsResponse()
    a.items.append({"id": "x"})
    a.watching.append("x")
    assert b.items == [] and b.watching == []


# ── ObservationsPatch ────────────────────────────────────────────────────────


def test_an_empty_patch_changes_nothing():
    assert ObservationsPatch().model_dump(exclude_unset=True) == {}


def test_patch_with_only_watching_leaves_items_unset():
    assert ObservationsPatch(watching=["o1"]).model_dump(exclude_unset=True) == {"watching": ["o1"]}


@pytest.mark.parametrize("field", ["items", "watching"])
def test_patch_lists_are_capped_unlike_the_response(field):
    # Incoming data is rejected outright; only stored data is truncated.
    ObservationsPatch(**{field: [f"o{i}" for i in range(CAP)]})
    with pytest.raises(ValidationError):
        ObservationsPatch(**{field: [f"o{i}" for i in range(CAP + 1)]})


def test_watching_entries_are_bounded_strings():
    ObservationsPatch(watching=["x" * 100])
    with pytest.raises(ValidationError):
        ObservationsPatch(watching=["x" * 101])
    with pytest.raises(ValidationError):
        ObservationsPatch(watching=[{"id": "o1"}])


@pytest.mark.parametrize(("field", "limit"), [("source", 50), ("span", 50), ("started_at", 64)])
def test_string_lengths_are_bounded(field, limit):
    ObservationsPatch(**{field: "x" * limit})
    with pytest.raises(ValidationError):
        ObservationsPatch(**{field: "x" * (limit + 1)})


def _items_of_size(total_bytes):
    """A single-item list that serialises to exactly total_bytes."""
    overhead = len(json.dumps([{"t": ""}]))
    return [{"t": "x" * (total_bytes - overhead)}]


def test_items_payload_cap_is_exactly_64kb():
    at_cap = _items_of_size(_OBSERVATIONS_MAX_BYTES)
    assert len(json.dumps(at_cap)) == _OBSERVATIONS_MAX_BYTES
    ObservationsPatch(items=at_cap)
    with pytest.raises(ValidationError, match="exceeds maximum allowed size \\(64 KB\\)"):
        ObservationsPatch(items=_items_of_size(_OBSERVATIONS_MAX_BYTES + 1))


def test_cap_counts_only_items():
    # The other fields carry their own per-field limits.
    ObservationsPatch(items=_items_of_size(_OBSERVATIONS_MAX_BYTES), watching=["x" * 100] * CAP)


def test_explicit_null_items_skip_the_size_check():
    assert ObservationsPatch(items=None).items is None


def test_non_serialisable_items_are_rejected():
    # JSON input can't produce a set, but a Python caller could.
    with pytest.raises(ValidationError, match="invalid or too-deeply nested"):
        ObservationsPatch(items=[{"tags": {"a", "b"}}])
