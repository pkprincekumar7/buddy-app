"""app/schemas/jobs.py — the request/response models behind /jobs."""

import json
from typing import get_args

import pytest
from pydantic import ValidationError

from app.schemas.jobs import (
    _ALLOWED_WRITE_BACK_COLLECTIONS,
    _ALLOWED_WRITE_BACK_FIELDS,
    _FILTER_MAX_DEPTH,
    _FILTER_MAX_KEYS,
    EnqueueJobPayload,
    EnqueueJobRequest,
    EnqueueJobResponse,
    JobStatusResponse,
    JobType,
    WriteBackConfig,
)


def _write_back(**overrides):
    return WriteBackConfig(**{"collection": "children", "filter": {}, "field": "plan", **overrides})


def _request(job_type="generate_ninety_day_plan", field="plan", **overrides):
    body = {"type": job_type, "child_id": "c1", "payload": {"prompt": "x"},
            "write_back": {"collection": "children", "filter": {}, "field": field}}  # fmt: skip
    return EnqueueJobRequest(**{**body, **overrides})


def _nested(depth):
    """A filter whose deepest value sits `depth` levels below the top."""
    value: object = 1
    for i in reversed(range(depth)):
        value = {f"k{i}": value}
    return value


# ── job types ────────────────────────────────────────────────────────────────


def test_every_job_type_has_a_write_back_allowlist():
    # A type missing from the allowlist could never be enqueued at all.
    assert set(get_args(JobType)) == set(_ALLOWED_WRITE_BACK_FIELDS)


def test_unknown_job_types_are_rejected():
    with pytest.raises(ValidationError):
        _request(job_type="generate_everything")


# ── WriteBackConfig ──────────────────────────────────────────────────────────


@pytest.mark.parametrize("collection", sorted(_ALLOWED_WRITE_BACK_COLLECTIONS))
def test_allowlisted_collections_are_accepted(collection):
    assert _write_back(collection=collection).collection == collection


@pytest.mark.parametrize("collection", ["users", "sessions", "email_index", "jobs", "Children", ""])
def test_other_collections_are_rejected(collection):
    with pytest.raises(ValidationError, match="write_back.collection must be one of"):
        _write_back(collection=collection)


@pytest.mark.parametrize(
    "flt",
    [
        {"$where": "1"},  # top level
        {"a": {"$ne": 1}},  # nested
        {"a": [{"$gt": 1}]},  # inside a list
        {"a": [[{"$or": []}]]},  # inside nested lists
    ],
)
def test_operator_keys_are_rejected_anywhere_in_the_filter(flt):
    with pytest.raises(ValidationError, match="must not start with"):
        _write_back(filter=flt)


def test_filter_depth_is_capped_inclusively():
    _write_back(filter=_nested(_FILTER_MAX_DEPTH))
    with pytest.raises(ValidationError, match="maximum nesting depth"):
        _write_back(filter=_nested(_FILTER_MAX_DEPTH + 1))


def test_lists_count_towards_the_depth():
    with pytest.raises(ValidationError, match="maximum nesting depth"):
        _write_back(filter={"a": [[[[1]]]]})


def test_filter_key_count_is_capped_inclusively_and_counts_nested_keys():
    _write_back(filter={f"k{i}": i for i in range(_FILTER_MAX_KEYS)})
    with pytest.raises(ValidationError, match="maximum key count"):
        _write_back(filter={f"k{i}": i for i in range(_FILTER_MAX_KEYS + 1)})
    nested = {"outer": {f"k{i}": i for i in range(_FILTER_MAX_KEYS)}}  # 21 keys in total
    with pytest.raises(ValidationError, match="maximum key count"):
        _write_back(filter=nested)


def test_plain_values_and_lists_are_fine():
    flt = {"area_id": "focus", "tags": ["a", "b"], "n": 3, "flag": None}
    assert _write_back(filter=flt).filter == flt


@pytest.mark.parametrize("field", ["plan", "_x", "plan.months", "a1_b2", "a" * 100])
def test_safe_field_names_are_accepted(field):
    assert _write_back(field=field).field == field


@pytest.mark.parametrize(
    "field", ["1plan", ".plan", "plan$", "plan months", "plan/x", "a" * 101, "plan\n", ""]
)
def test_unsafe_field_names_are_rejected(field):
    with pytest.raises(ValidationError):
        _write_back(field=field)


# ── EnqueueJobPayload ────────────────────────────────────────────────────────


def test_prompt_length_is_capped():
    EnqueueJobPayload(prompt="x" * 32000)
    with pytest.raises(ValidationError):
        EnqueueJobPayload(prompt="x" * 32001)


def test_schema_and_provider_are_optional():
    payload = EnqueueJobPayload(prompt="x", response_json_schema=None)
    assert (payload.response_json_schema, payload.provider) == (None, None)


def _schema_of_size(n):
    overhead = len(json.dumps({"d": ""}))
    return {"d": "x" * (n - overhead)}


def test_schema_size_is_capped_inclusively_at_4000_characters():
    assert len(json.dumps(_schema_of_size(4000))) == 4000
    EnqueueJobPayload(prompt="x", response_json_schema=_schema_of_size(4000))
    with pytest.raises(ValidationError, match="must not exceed 4000 characters"):
        EnqueueJobPayload(prompt="x", response_json_schema=_schema_of_size(4001))


@pytest.mark.parametrize(
    "ref", ["https://evil.example/s.json", "http://evil.example/s", "//evil.example/s"]
)
def test_external_refs_are_rejected_even_when_nested(ref):
    for schema in ({"$ref": ref}, {"properties": {"a": {"$ref": ref}}}):
        with pytest.raises(ValidationError, match="external \\$ref"):
            EnqueueJobPayload(prompt="x", response_json_schema=schema)


@pytest.mark.parametrize("ref", ["#/definitions/x", "#", "local.json"])
def test_internal_refs_are_allowed(ref):
    EnqueueJobPayload(prompt="x", response_json_schema={"$ref": ref, "definitions": {"x": {}}})


# ── EnqueueJobRequest ────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("job_type", "field"),
    sorted((t, f) for t, fields in _ALLOWED_WRITE_BACK_FIELDS.items() for f in fields),
)
def test_every_allowlisted_field_is_accepted_for_its_type(job_type, field):
    assert _request(job_type, field).write_back.field == field


def test_a_field_belonging_to_another_type_is_rejected_with_the_allowed_list():
    # e.g. a plan job can't write the event tracker's field.
    with pytest.raises(ValidationError) as exc:
        _request("generate_ninety_day_plan", "track_steps")
    message = str(exc.value)
    assert "'track_steps' is not allowed for job type 'generate_ninety_day_plan'" in message
    assert "Allowed fields: ['plan']" in message


def test_sensitive_fields_are_never_writable():
    for job_type in _ALLOWED_WRITE_BACK_FIELDS:
        for field in ("user_id", "location", "_id", "is_deleted", "discover_completed"):
            with pytest.raises(ValidationError, match="is not allowed for job type"):
                _request(job_type, field)


def test_child_id_length_is_capped():
    with pytest.raises(ValidationError):
        _request(child_id="c" * 101)


# ── responses ────────────────────────────────────────────────────────────────


def test_response_models():
    assert EnqueueJobResponse(job_id="j1").model_dump() == {"job_id": "j1"}
    status = JobStatusResponse(job_id="j1", status="pending", created_at="2026-01-01T00:00:00Z")
    assert status.error is None and status.created_at.year == 2026
