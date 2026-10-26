"""The circle rules for onboarding's routes (docs/auth-users-split.md, 7.5, 12.3, 12.4).

Every request reads the child's `child_access` copy, kept from children's `child.changed`:
- **Missing copy** (the page opened before the first event arrived): read through,
  `GET /internal/children/{id}` once, store what it returns and continue.
- **Ownership:** someone else's child, a deleted one, or none at all is `404
  child_not_found`.
- **Unlock:** onboarding opens once the profile step is done (`progress.profile`). If the
  copy says it isn't, children is asked before refusing (confirm before deny). This is
  the exception to "don't overwrite": children owns `child_access`, so its answer is
  stored as a version-checked upsert rather than as a `confirmed` flag (12.4).

Children unreachable (or answering anything but 200 / 404) is `503` with `Retry-After`,
never a wrong "locked" or "not found".
"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from common.events import is_tombstoned, tombstone_key, versioned_upsert
from common.internal_client import InternalUnavailable
from common.models import CHILD_ACCESS, PROGRESS_FLAGS, SCHEMA_VERSION, stage_done
from onboarding.app.runtime import Runtime

OWNER = "children"
UNLOCKED_BY = "profile"
RETRY_AFTER_SECONDS = 2


def error(status: int, code: str, msg: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "msg": msg})


def not_found() -> HTTPException:
    return error(404, "child_not_found", "No such child.")


def _unavailable() -> HTTPException:
    return HTTPException(
        status_code=503,
        detail={"code": "children_unavailable", "msg": "Try again in a moment."},
        headers={"Retry-After": str(RETRY_AFTER_SECONDS)},
    )


async def ask_children(runtime: Runtime, child_id: str, location: str) -> dict[str, Any] | None:
    """Children's `child_access` fields for the child, deleted or not; None if it has none."""
    try:
        response = await runtime.internal.get(
            OWNER, f"/internal/children/{child_id}?location={location}"
        )
    except InternalUnavailable as exc:
        raise _unavailable() from exc
    if response.status_code == 404:
        return None
    if response.status_code != 200:
        raise _unavailable()
    data: dict[str, Any] = response.json()
    return data


def _copy(data: dict[str, Any]) -> dict[str, Any]:
    """Children's answer in `child_access`'s shape."""
    progress = data.get("progress") or {}
    return {
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


async def store(runtime: Runtime, copy: dict[str, Any]) -> None:
    """Keep children's answer: applied only if newer, and never over a tombstone."""
    fields = {
        key: value for key, value in copy.items() if key not in ("_id", "location", "version")
    }
    await versioned_upsert(
        runtime.db,
        CHILD_ACCESS,
        doc_id=copy["_id"],
        location=copy["location"],
        version=copy["version"],
        fields={**fields, "schema_version": SCHEMA_VERSION},
        tombstones=[tombstone_key("child", copy["_id"]), tombstone_key("user", copy["user_id"])],
    )


async def child_for(
    runtime: Runtime, child_id: str, *, location: str, owner: str | None
) -> dict[str, Any]:
    """The child's copy if it exists, isn't deleted and (with `owner`) is theirs; else 404."""
    copy = await runtime.db[CHILD_ACCESS].find_one({"_id": child_id, "location": location})
    if copy is None:
        if await is_tombstoned(runtime.db, [tombstone_key("child", child_id)]):
            raise not_found()  # purged: no need to ask
        data = await ask_children(runtime, child_id, location)
        if data is None:
            raise not_found()
        copy = _copy(data)
        await store(runtime, copy)
    if copy["is_deleted"] or (owner is not None and copy["user_id"] != owner):
        raise not_found()
    return copy


async def require_unlocked(runtime: Runtime, copy: dict[str, Any]) -> None:
    """403 circle_locked unless the profile step is done, confirmed with children first."""
    if stage_done(copy, UNLOCKED_BY):
        return
    data = await ask_children(runtime, copy["_id"], copy["location"])
    if data is None:
        raise not_found()
    fresh = _copy(data)
    await store(runtime, fresh)
    if fresh["is_deleted"] or fresh["user_id"] != copy["user_id"]:
        raise not_found()
    if not fresh["progress"][UNLOCKED_BY]:
        raise error(403, "circle_locked", "Finish the child's profile first.")
