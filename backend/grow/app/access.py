"""The circle rules for grow's routes (docs/auth-users-split.md, 7.5, 12.3, 12.4).

The same shape as discover's (`discover/app/access.py`), with discover as the owner of the
unlock:
- **Missing `child_access` copy:** read through from children (`GET /internal/children/{id}`)
  and store it as a version-checked upsert.
- **Ownership:** someone else's, a deleted or an unknown child is `404 child_not_found`.
- **Unlock:** grow opens once Discover is done (`progress.discover`: the personality ready
  and the reveal passed). If the copy says it isn't, discover is asked
  (`GET /internal/discover/children/{id}/status`) before refusing; a yes is stored as
  `child_access.confirmed.discover`, never over `progress` or `version` (7.5).
- **Missing copies a generation needs:** `onboarding_inputs` read through from onboarding
  (`…/answers`), `personality_inputs` from discover (`…/summary`).

An owner that can't be reached (or answers anything unexpected) is `503` with
`Retry-After`, never a wrong "locked" or "not found".
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from fastapi import HTTPException

from common.events import is_tombstoned, tombstone_key, versioned_upsert
from common.internal_client import (
    ANSWERS_ANSWER,
    CHILD_ANSWER,
    STATUS_ANSWER,
    SUMMARY_ANSWER,
    InternalUnavailable,
    checked_answer,
)
from common.models import (
    ANSWER_FIELDS,
    CHILD_ACCESS,
    ONBOARDING_INPUTS,
    PERSONALITY_INPUTS,
    PROGRESS_FLAGS,
    SCHEMA_VERSION,
    stage_done,
)
from grow.app.runtime import Runtime

UNLOCKED_BY = "discover"
RETRY_AFTER_SECONDS = 2


def error(status: int, code: str, msg: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "msg": msg})


def not_found() -> HTTPException:
    return error(404, "child_not_found", "No such child.")


def _unavailable(owner: str) -> HTTPException:
    return HTTPException(
        status_code=503,
        detail={"code": f"{owner}_unavailable", "msg": "Try again in a moment."},
        headers={"Retry-After": str(RETRY_AFTER_SECONDS)},
    )


async def _ask(
    runtime: Runtime, owner: str, path: str, shape: Mapping[str, type | tuple[type, ...]]
) -> dict[str, Any] | None:
    """The owner's answer; None for a 404; 503 if it can't be reached or answers oddly."""
    try:
        response = await runtime.internal.get(owner, path)
    except InternalUnavailable as exc:
        raise _unavailable(owner) from exc
    if response.status_code == 404:
        return None
    if response.status_code != 200:
        raise _unavailable(owner)
    try:
        return checked_answer(response.json(), shape)
    except ValueError as exc:
        raise _unavailable(owner) from exc


def _tombstones(child_id: str, user_id: str) -> list[str]:
    return [tombstone_key("child", child_id), tombstone_key("user", user_id)]


# ── child_access ───────────────────────────────────────────────────────────────


async def child_for(
    runtime: Runtime, child_id: str, *, location: str, owner: str | None
) -> dict[str, Any]:
    """The child's copy if it exists, isn't deleted and (with `owner`) is theirs; else 404."""
    copy = await runtime.db[CHILD_ACCESS].find_one({"_id": child_id, "location": location})
    if copy is None:
        if await is_tombstoned(runtime.db, [tombstone_key("child", child_id)]):
            raise not_found()  # purged: no need to ask
        data = await _ask(
            runtime, "children", f"/internal/children/{child_id}?location={location}", CHILD_ANSWER
        )
        if data is None:
            raise not_found()
        progress = data.get("progress") or {}
        copy = {
            "_id": data["child_id"],
            "location": data["location"],
            "user_id": data["user_id"],
            "name": data.get("name"),
            "age": data.get("age"),
            "gender": data.get("gender"),
            "is_deleted": bool(data["is_deleted"]),
            "progress": {flag: bool(progress.get(flag)) for flag in PROGRESS_FLAGS},
            "version": data["version"],
        }
        fields = {k: v for k, v in copy.items() if k not in ("_id", "location", "version")}
        await versioned_upsert(
            runtime.db,
            CHILD_ACCESS,
            doc_id=copy["_id"],
            location=copy["location"],
            version=copy["version"],
            fields={**fields, "schema_version": SCHEMA_VERSION},
            tombstones=_tombstones(copy["_id"], copy["user_id"]),
        )
    if copy["is_deleted"] or (owner is not None and copy["user_id"] != owner):
        raise not_found()
    return copy


async def require_unlocked(runtime: Runtime, copy: dict[str, Any]) -> None:
    """403 circle_locked unless Discover is done, confirmed with discover first."""
    if stage_done(copy, UNLOCKED_BY):
        return
    status = await _ask(
        runtime,
        "discover",
        f"/internal/discover/children/{copy['_id']}/status?location={copy['location']}",
        STATUS_ANSWER,
    )
    if not (status or {}).get("completed"):
        raise error(403, "circle_locked", "Finish Discover first.")
    # Recorded as confirmed: the copy's progress and version stay children's (7.5).
    await runtime.db[CHILD_ACCESS].update_one(
        {"_id": copy["_id"], "location": copy["location"]},
        {"$set": {f"confirmed.{UNLOCKED_BY}": True}},
    )


# ── onboarding_inputs ──────────────────────────────────────────────────────────


async def answers_for(runtime: Runtime, copy: dict[str, Any]) -> dict[str, Any]:
    """The child's onboarding answers, read through from onboarding if not copied yet."""
    child_id, location = copy["_id"], copy["location"]
    answers = await runtime.db[ONBOARDING_INPUTS].find_one({"_id": child_id, "location": location})
    if answers is not None:
        return answers
    data = await _ask(
        runtime,
        "onboarding",
        f"/internal/onboarding/children/{child_id}/answers?location={location}",
        ANSWERS_ANSWER,
    )
    if data is None or data.get("user_id") != copy["user_id"]:
        # Unlocked but no answers: onboarding is behind its own status. Ask again soon.
        raise _unavailable("onboarding")
    fields = {
        "user_id": data["user_id"],
        **{name: data.get(name) for name in ANSWER_FIELDS},
        "schema_version": SCHEMA_VERSION,
    }
    await versioned_upsert(
        runtime.db,
        ONBOARDING_INPUTS,
        doc_id=child_id,
        location=location,
        version=data["version"],
        fields=fields,
        tombstones=_tombstones(child_id, copy["user_id"]),
    )
    return {"_id": child_id, "location": location, **fields, "version": data["version"]}


# ── personality_inputs ─────────────────────────────────────────────────────────


async def personality_for(runtime: Runtime, copy: dict[str, Any]) -> dict[str, Any]:
    """The child's personality summary, read through from discover if not copied yet."""
    child_id, location = copy["_id"], copy["location"]
    summary = await runtime.db[PERSONALITY_INPUTS].find_one({"_id": child_id, "location": location})
    if summary is not None:
        return summary
    data = await _ask(
        runtime,
        "discover",
        f"/internal/discover/children/{child_id}/summary?location={location}",
        SUMMARY_ANSWER,
    )
    if data is None or data.get("user_id") != copy["user_id"]:
        # Unlocked but no personality: discover is behind its own status. Ask again soon.
        raise _unavailable("discover")
    fields = {
        "user_id": data["user_id"],
        "traits": data["traits"],
        "strengths": data["strengths"],
        "schema_version": SCHEMA_VERSION,
    }
    await versioned_upsert(
        runtime.db,
        PERSONALITY_INPUTS,
        doc_id=child_id,
        location=location,
        version=data["version"],
        fields=fields,
        tombstones=_tombstones(child_id, copy["user_id"]),
    )
    return {"_id": child_id, "location": location, **fields, "version": data["version"]}
