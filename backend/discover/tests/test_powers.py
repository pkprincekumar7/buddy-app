"""Child view's powers (docs/child-view-build-plan.md, P.4 and 2.5): the fixed mapping from the
stored personality, and `GET …/personality/powers`."""

import asyncio
from collections.abc import Awaitable, Callable

import pytest
from discover_testkit import (
    OTHER,
    Running,
    auth_header,
    claim,
    llm_client,
    progress,
    running,
)

from discover.app import generation, powers
from discover.app.personality import PERSONALITY_TYPES, view_model

# The kids page's order, and children's `kids.GAMES` (the games' best times and the flips).
GAMES = ["focus", "curious", "order", "draw", "climb", "voice", "energy"]


def _path(child_id: str) -> str:
    return f"/api/v1/children/{child_id}/personality/powers"


def _levels(model: dict) -> list[int]:
    return [p["level"] for p in powers.powers(model)]


# ── the mapping ────────────────────────────────────────────────────────────────


def test_the_table_has_the_seven_games_in_order_and_uses_every_archetype():
    powers.check_table()
    assert [p["game"] for p in powers.POWERS] == GAMES
    for power in powers.POWERS:
        assert power["name"] and power["line"] and power["try_this"]


def test_a_power_takes_its_strongest_archetypes_level():
    # The fixture's answer: Thinker dominant, Creative 78 and Playful 55 secondary.
    model = view_model({"dominant_style": "Thinker", "secondary_styles": [
        {"personality_style": "Creative", "prominence": 78},
        {"personality_style": "Playful", "prominence": 55},
    ]}, "Aarav")  # fmt: skip
    assert _levels(model) == [5, 5, 3, 4, 3, 3, 3]


@pytest.mark.parametrize("style", list(PERSONALITY_TYPES))
def test_every_archetype_gives_at_least_one_top_power(style):
    levels = _levels(view_model({"dominant_style": style}, "Aarav"))
    assert 5 in levels and set(levels) <= {3, 4, 5}


def test_missing_or_odd_scores_fall_back_to_the_lowest_level():
    assert _levels({}) == [3] * 7
    assert _levels({"scores": "nope"}) == [3] * 7
    odd = {"Thinker": None, "Creative": True, "Playful": float("nan"), "Outgoing": "90"}
    assert _levels({"scores": odd}) == [3] * 7
    assert powers.level({"Restless": 60}, ["Restless"]) == 4
    assert powers.level({"Restless": 59.9}, ["Restless"]) == 3


# ── the endpoint ───────────────────────────────────────────────────────────────


def live(mongo_uri: str, test: Callable[[Running], Awaitable[None]]) -> None:
    async def go() -> None:
        async with running(mongo_uri) as r:
            await test(r)

    asyncio.run(go())


@pytest.mark.live_service
def test_powers_wait_for_the_personality_then_follow_it(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        early = await r.http.get(_path(child), headers=auth_header())
        assert early.status_code == 404
        assert early.json()["detail"]["code"] == "personality_not_ready"
        await r.http.post(f"/api/v1/children/{child}/personality/generation", headers=auth_header())
        generating = await r.http.get(_path(child), headers=auth_header())
        assert generating.status_code == 404
        await generation.process(r.runtime, llm_client(), await claim(r.db))
        ready = await r.http.get(_path(child), headers=auth_header())
        assert ready.status_code == 200
        assert ready.json()["style"] == "Thinker"
        assert ready.json()["style_line"].startswith("You can think about one hard thing")
        shown = ready.json()["powers"]
        assert [p["game"] for p in shown] == GAMES
        assert [p["level"] for p in shown] == [5, 5, 3, 4, 3, 3, 3]
        assert shown[0] == {
            "name": "Focus", "game": "focus", "level": 5,
            "line": "You can stick with one hard thing for a long time.",
            "try_this": "Pick one puzzle and finish it. No switching.",
        }  # fmt: skip

    live(mongo_uri, test)


@pytest.mark.live_service
def test_powers_follow_the_circle_rules(mongo_uri):
    async def test(r: Running) -> None:
        locked = r.owners.add_child()
        await r.copy(locked, progress=progress(profile=True))
        refused = await r.http.get(_path(locked), headers=auth_header())
        assert refused.status_code == 403
        theirs = r.owners.add_child(user_id=OTHER)
        await r.copy(theirs, user_id=OTHER)
        assert (await r.http.get(_path(theirs), headers=auth_header())).status_code == 404

    live(mongo_uri, test)


@pytest.mark.live_service
def test_powers_are_limited_to_60_a_minute(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        statuses = [
            (await r.http.get(_path(child), headers=auth_header())).status_code for _ in range(61)
        ]
        assert statuses[-1] == 429 and statuses.count(429) == 1

    live(mongo_uri, test)
