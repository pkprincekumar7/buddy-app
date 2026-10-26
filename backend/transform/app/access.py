"""The circle rules for transform's routes (docs/auth-users-split.md, 7.5, 12.3, 12.4).

The same shape as grow's (`grow/app/access.py`), with grow as the owner of the unlock:
- **Missing `child_access` copy:** read through from children (`GET /internal/children/{id}`)
  and store it as a version-checked upsert.
- **Ownership:** someone else's, a deleted or an unknown child is `404 child_not_found`.
- **Unlock:** transform opens once Grow is done (`progress.grow`: a growth area completed).
  If the copy says it isn't, grow is asked (`GET /internal/grow/children/{id}/status`)
  before refusing; a yes is stored as `child_access.confirmed.grow`, never over `progress`
  or `version` (7.5).
- **Missing copies a generation needs:** `personality_inputs` read through from discover
  (`…/summary`), `growth_inputs` from grow (`…/areas`).

An owner that can't be reached (or answers anything unexpected) is `503` with
`Retry-After`, never a wrong "locked" or "not found".
"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from common.events import is_tombstoned, tombstone_key, versioned_upsert
from common.internal_client import InternalUnavailable
from common.models import (
    CHILD_ACCESS,
    GROWTH_FIELDS,
    GROWTH_INPUTS,
    PERSONALITY_INPUTS,
    PROGRESS_FLAGS,
    SCHEMA_VERSION,
    growth_inputs_id,
    stage_done,
)
from transform.app.runtime import Runtime

UNLOCKED_BY = "grow"
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


async def _ask(runtime: Runtime, owner: str, path: str) -> dict[str, Any] | None:
    """The owner's answer; None for a 404; 503 if it can't be reached or answers oddly."""
    try:
        response = await runtime.internal.get(owner, path)
    except InternalUnavailable as exc:
        raise _unavailable(owner) from exc
    if response.status_code == 404:
        return None
    if response.status_code != 200:
        raise _unavailable(owner)
    data: dict[str, Any] = response.json()
    return data


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
        data = await _ask(runtime, "children", f"/internal/children/{child_id}?location={location}")
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
    """403 circle_locked unless Grow is done, confirmed with grow first."""
    if stage_done(copy, UNLOCKED_BY):
        return
    status = await _ask(
        runtime,
        "grow",
        f"/internal/grow/children/{copy['_id']}/status?location={copy['location']}",
    )
    if not (status or {}).get("completed"):
        raise error(403, "circle_locked", "Complete a growth area first.")
    # Recorded as confirmed: the copy's progress and version stay children's (7.5).
    await runtime.db[CHILD_ACCESS].update_one(
        {"_id": copy["_id"], "location": copy["location"]},
        {"$set": {f"confirmed.{UNLOCKED_BY}": True}},
    )


# ── personality_inputs ─────────────────────────────────────────────────────────


async def personality_for(runtime: Runtime, copy: dict[str, Any]) -> dict[str, Any]:
    """The child's personality summary, read through from discover if not copied yet."""
    child_id, location = copy["_id"], copy["location"]
    summary = await runtime.db[PERSONALITY_INPUTS].find_one({"_id": child_id, "location": location})
    if summary is not None:
        return summary
    data = await _ask(
        runtime, "discover", f"/internal/discover/children/{child_id}/summary?location={location}"
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


# ── growth_inputs ──────────────────────────────────────────────────────────────


async def areas_for(runtime: Runtime, copy: dict[str, Any]) -> list[dict[str, Any]]:
    """The child's completed growth areas, read through from grow (and kept) on a miss."""
    child_id, location = copy["_id"], copy["location"]
    data = await _ask(
        runtime, "grow", f"/internal/grow/children/{child_id}/areas?location={location}"
    )
    for area in (data or {}).get("areas", []):
        if area.get("user_id") != copy["user_id"]:
            continue  # someone else's: never copied
        await versioned_upsert(
            runtime.db,
            GROWTH_INPUTS,
            doc_id=growth_inputs_id(child_id, area["area_id"]),
            location=location,
            version=area["version"],
            fields={
                "user_id": area["user_id"],
                "child_id": child_id,
                **{name: area.get(name) for name in ("area_id", *GROWTH_FIELDS)},
                "schema_version": SCHEMA_VERSION,
            },
            tombstones=_tombstones(child_id, copy["user_id"]),
        )
    return (
        await runtime.db[GROWTH_INPUTS]
        .find({"location": location, "child_id": child_id, "user_id": copy["user_id"]})
        .to_list(None)
    )
