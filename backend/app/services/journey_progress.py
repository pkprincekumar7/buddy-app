"""Personality Journey dimension-circle progress, derived from real data rather
than a client-reported flag — a boolean field on the Child document can be set
directly by any authenticated client via PATCH /children/{id}, so anything that
gates access on it must compute the truth from tamper-proof state instead of
trusting the stored value.
"""

from __future__ import annotations

from motor.motor_asyncio import AsyncIOMotorDatabase

from app import models


async def has_completed_growth_area(
    db: AsyncIOMotorDatabase, user_id: str, child_id: str, location: str
) -> bool:
    """True once at least one of the child's growth areas has status 'completed'.

    This is the real, tamper-proof signal behind `grow_completed` — a
    growth_areas document reaching status 'completed' only happens through the
    Growth Areas flow itself (backend/app/routers/users.py's
    append_completed_growth_area), so it can't be forged the way a plain
    boolean field on the Child document can.
    """
    doc = await db[models.GROWTH_AREAS].find_one(
        {"user_id": user_id, "child_id": child_id, "location": location, "status": "completed"},
        {"_id": 1},
    )
    return doc is not None
