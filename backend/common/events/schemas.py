"""Event payload schemas: schemas/<event>.vN.json, JSON Schema 2020-12 (docs/auth-users-split.md, 7.8).

Producers validate before writing the outbox row; consumers validate before handling.
"""

from __future__ import annotations

import json
from functools import cache
from importlib import resources
from typing import Any

from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError


class InvalidPayload(ValueError):
    """A payload that doesn't match its event's schema."""


@cache
def document(schema_id: str) -> dict[str, Any]:
    """The schema for `schema_id` (e.g. `child.changed.v1`). KeyError if there's none."""
    path = resources.files("common.events").joinpath("schemas", f"{schema_id}.json")
    if not path.is_file():
        raise KeyError(f"no schema {schema_id!r}")
    data: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    return data


@cache
def _validator(schema_id: str) -> Draft202012Validator:
    schema = document(schema_id)
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


def validate(schema_id: str, payload: object) -> None:
    """Raise InvalidPayload unless `payload` matches the schema."""
    try:
        _validator(schema_id).validate(payload)
    except ValidationError as exc:
        where = "/".join(str(p) for p in exc.absolute_path) or "payload"
        raise InvalidPayload(f"{schema_id}: {where}: {exc.message}") from exc


def example(schema_id: str) -> dict[str, Any]:
    """The schema's first example: a valid payload for tests and contract checks."""
    examples = document(schema_id).get("examples") or [{}]
    first: dict[str, Any] = json.loads(json.dumps(examples[0]))  # a copy callers may change
    return first
