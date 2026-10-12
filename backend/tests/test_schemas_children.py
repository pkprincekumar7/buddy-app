"""app/schemas/children.py — the request/response models behind /children.

The rules ChildCreate and ChildPatch share are run against both, so the two
copies can't drift apart unnoticed.
"""

import re
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.schemas.children import (
    _PAYLOAD_MAX_BYTES,
    ChildCreate,
    ChildPatch,
    ChildResponse,
    _parse_age,
)

BOTH = pytest.mark.parametrize("model", [ChildCreate, ChildPatch], ids=["create", "patch"])

JOURNEY_FLAGS = (
    "onboarding_profile_completed",
    "conversational_onboarding_completed",
    "discover_completed",
    "grow_completed",
    "transform_visited",
    "release_visited",
    "connect_visited",
)


# ── age parsing ──────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("raw", "age"),
    [(None, None), (7, 7), ("12", 12), ("  12 years", 12), ("18 months", 18), ("007", 7)],
)
def test_parse_age_accepts_numbers_and_leading_numbers(raw, age):
    assert _parse_age(raw) == age


@pytest.mark.parametrize("raw", ["", "   ", "about seven", "seven 7", "-3", "years 12"])
def test_parse_age_rejects_text_without_a_leading_number(raw):
    with pytest.raises(ValueError, match="age must be a number"):
        _parse_age(raw)


@BOTH
def test_models_coerce_age_strings(model):
    assert model(age="9 years").age == 9
    with pytest.raises(ValidationError, match="age must be a number"):
        model(age="nine")


# ── avatar ───────────────────────────────────────────────────────────────────


@BOTH
@pytest.mark.parametrize(
    "url",
    ["http://cdn.example/a.png", "javascript:alert(1)", "//cdn.example/a.png", "HTTPS://x", ""],
)
def test_avatar_url_must_be_https(model, url):
    with pytest.raises(ValidationError, match="avatar_url must be an HTTPS URL"):
        model(avatar_url=url)


@BOTH
def test_avatar_url_https_is_accepted(model):
    assert model(avatar_url="https://cdn.example/a.png").avatar_url == "https://cdn.example/a.png"


@BOTH
def test_avatar_id_and_url_are_mutually_exclusive(model):
    with pytest.raises(ValidationError, match="either avatar_id or avatar_url, not both"):
        model(avatar_id="capper-boy", avatar_url="https://cdn.example/a.png")
    assert model(avatar_id="capper-boy").avatar_url is None


@BOTH
def test_avatar_url_length_is_bounded(model):
    with pytest.raises(ValidationError):
        model(avatar_url="https://x/" + "a" * 2048)


# ── extra (payload-blob) fields ──────────────────────────────────────────────


@BOTH
def test_unknown_fields_pass_through_as_extras(model):
    child = model(favourite_colour="teal", meta={"nested": [1, 2]})
    assert child.model_dump(exclude_unset=True) == {
        "favourite_colour": "teal",
        "meta": {"nested": [1, 2]},
    }


@BOTH
@pytest.mark.parametrize("key", ["$set", "$where", "a.b", "profile.name", "."])
def test_extra_keys_that_mongo_would_treat_as_operators_or_paths_are_rejected(model, key):
    with pytest.raises(ValidationError, match=re.escape(f"Field name {key!r} is not allowed")):
        model(**{key: 1})


@BOTH
def test_extra_payload_is_capped_at_64kb(model):
    model(blob="x" * (_PAYLOAD_MAX_BYTES - 20))  # just under, once JSON-quoted
    with pytest.raises(ValidationError, match="exceeds maximum allowed size"):
        model(blob="x" * _PAYLOAD_MAX_BYTES)


@BOTH
def test_declared_fields_do_not_count_towards_the_extra_cap(model):
    # The 64 KB budget is for the free-form extras; declared fields have their own limits.
    big_personality = {"text": "x" * (_PAYLOAD_MAX_BYTES + 1)}
    assert model(personality=big_personality).personality == big_personality


@BOTH
def test_non_serialisable_extras_are_rejected(model):
    # Can't come from JSON, but a Python caller could build one.
    with pytest.raises(ValidationError, match="invalid or non-serialisable data"):
        model(tags={"a", "b"})


# ── field limits ─────────────────────────────────────────────────────────────


@BOTH
@pytest.mark.parametrize(
    ("field", "limit"),
    [("name", 255), ("school", 300), ("avatar_id", 100), ("current_phase", 100)],
)
def test_string_lengths_are_bounded(model, field, limit):
    model(**{field: "x" * limit})
    with pytest.raises(ValidationError):
        model(**{field: "x" * (limit + 1)})


@BOTH
def test_visited_tabs_must_be_strings(model):
    with pytest.raises(ValidationError):
        model(visited_tabs=[{"tab": 1}])


# ── create vs patch differences ──────────────────────────────────────────────


def test_create_defaults_onboarding_phase_but_patch_leaves_it_unset():
    assert ChildCreate().onboarding_phase == 0
    assert "onboarding_phase" in ChildCreate().model_dump()
    assert ChildPatch().model_dump(exclude_unset=True) == {}  # an empty patch changes nothing


def test_patch_tracks_explicit_nulls_separately_from_omitted_fields():
    assert ChildPatch(school=None).model_dump(exclude_unset=True) == {"school": None}


@BOTH
def test_journey_flags_are_not_declared_fields(model):
    # They're writable only via POST /children/{id}/progress/{flag}; if a client
    # sends one it lands in the extras, which the router strips (_CHILD_SYSTEM_FIELDS).
    for flag in JOURNEY_FLAGS:
        assert flag not in model.model_fields
    assert model(discover_completed=True).__pydantic_extra__ == {"discover_completed": True}


# ── ChildResponse ────────────────────────────────────────────────────────────


def test_response_defaults_for_a_minimal_document():
    child = ChildResponse(id="c1", created_date="")
    assert child.name == "" and child.onboarding_phase == 0
    assert child.visited_tabs == [] and child.active_jobs == {}
    assert child.is_deleted is False and child.deleted_at is None
    for flag in JOURNEY_FLAGS:
        assert getattr(child, flag) is False


def test_response_drops_unknown_and_internal_fields():
    child = ChildResponse(id="c1", created_date="", user_id="p1", password="x", payload={"a": 1})
    dumped = child.model_dump()
    assert "user_id" not in dumped and "password" not in dumped and "payload" not in dumped


def test_response_mutable_defaults_are_not_shared():
    a, b = ChildResponse(id="a", created_date=""), ChildResponse(id="b", created_date="")
    a.visited_tabs.append("grow")
    a.active_jobs["x"] = "j"
    assert b.visited_tabs == [] and b.active_jobs == {}


def test_response_round_trips_a_full_document():
    deleted_at = datetime(2026, 1, 2, tzinfo=UTC)
    doc = {
        "id": "c1", "created_date": "2026-01-01T00:00:00+00:00", "name": "Mia", "age": 7,
        "visited_tabs": ["discover"], "active_jobs": {"generate_activity": "j1"},
        "pending_personality_vm": {"draft": 1}, "avatar_url": "https://cdn/x.png",
        "discover_completed": True, "is_deleted": True, "deleted_at": deleted_at,
    }  # fmt: skip
    dumped = ChildResponse(**doc).model_dump()
    for key, value in doc.items():
        assert dumped[key] == value
