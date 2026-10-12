"""app/services/journey_progress.py — grow_completed, derived from growth_areas."""

import asyncio

import pytest

from app import models
from app.services.journey_progress import has_completed_growth_area


class _GrowthAreas:
    def __init__(self, docs):
        self.docs, self.calls = docs, []

    async def find_one(self, query, projection):
        self.calls.append((query, projection))
        return next((d for d in self.docs if all(d.get(k) == v for k, v in query.items())), None)


def _area(**overrides):
    return {"_id": "ga1", "user_id": "p1", "child_id": "c1", "location": "eu",
            "status": "completed", **overrides}  # fmt: skip


def _check(docs, user_id="p1", child_id="c1", location="eu"):
    areas = _GrowthAreas(docs)
    result = asyncio.run(
        has_completed_growth_area({models.GROWTH_AREAS: areas}, user_id, child_id, location)
    )
    return result, areas.calls


def test_true_once_one_of_the_childs_areas_is_completed():
    result, [(query, projection)] = _check([_area(status="in_progress", _id="ga0"), _area()])
    assert result is True
    assert query == {"user_id": "p1", "child_id": "c1", "location": "eu", "status": "completed"}
    assert projection == {"_id": 1}  # existence check only — no document payload


@pytest.mark.parametrize(
    "docs",
    [
        [],
        [_area(status="in_progress")],
        [_area(status=None)],
        [_area(child_id="c2")],  # a sibling's area
        [_area(user_id="p2")],  # another parent's area
        [_area(location="us")],  # same ids on another shard
    ],
    ids=["none", "in-progress", "no-status", "sibling", "other-parent", "other-location"],
)
def test_false_unless_this_childs_own_area_is_completed(docs):
    assert _check(docs)[0] is False


def test_never_reads_the_child_document():
    # The point of deriving it: a grow_completed flag on the child is ignored.
    result, calls = _check([])
    assert result is False and len(calls) == 1
