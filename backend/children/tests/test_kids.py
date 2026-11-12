"""The child's activity in child view (docs/child-view-build-plan.md, 2.1): stars given by the
server and each once, the circles' locks, ownership, and removal with the child."""

import asyncio
from collections.abc import Awaitable, Callable
from datetime import UTC, date, datetime, timedelta
from typing import Any

import httpx
import pytest
from children_testkit import ADMIN, OTHER, PARENT, Running, add_child, auth_header, running

from children.app import kids, lifecycle
from children.app.kids import KID_ACTIVITY
from children.app.store import CHILDREN

API = "/api/v1/children"
TODAY = datetime.now(UTC).date().isoformat()


def live(mongo_uri: str, test: Callable[[Running], Awaitable[None]]) -> None:
    async def go() -> None:
        async with running(mongo_uri) as r:
            await test(r)

    asyncio.run(go())


async def _open_flags(r: Running, child_id: str, *flags: str) -> None:
    await r.db[CHILDREN].update_one(
        {"_id": child_id}, {"$set": {f"progress.{f}": True for f in flags}}
    )


async def _open(r: Running, *flags: str) -> str:
    """A child whose circles up to `flags` are open."""
    child_id: str = (await add_child(r)).json()["id"]
    if flags:
        await r.db[CHILDREN].update_one(
            {"_id": child_id}, {"$set": {f"progress.{f}": True for f in flags}}
        )
    return child_id


async def _done(r: Running, child_id: str, *circles: str) -> None:
    """Mark circles done in child view straight in the database, giving no stars: Discover's
    badge, a Grow world, a Transform quest, a Release mood."""
    child = await r.db[CHILDREN].find_one({"_id": child_id})
    now = datetime.now(UTC)
    await kids.ensure_doc(r.db, child, now)
    marks: dict[str, Any] = {
        "discover": {"awards.badge:discover": now},
        "grow": {"worlds_done": [0]},
        "transform": {"awards.quest:space:0": now},
        "release": {"moods.2020-01-01": {"mood": "good", "note": None, "at": now}},
    }
    update: dict[str, Any] = {}
    for circle in circles:
        update.update(marks[circle])
    await r.db[KID_ACTIVITY].update_one({"_id": child_id}, {"$set": update})


async def _event(
    r: Running, child_id: str, body: dict[str, Any], *, day: str = TODAY, user: str = PARENT
) -> httpx.Response:
    return await r.http.post(
        f"{API}/{child_id}/kids/events", params={"date": day}, json=body, headers=auth_header(user)
    )


async def _get(r: Running, child_id: str, *, user: str = PARENT) -> httpx.Response:
    return await r.http.get(
        f"{API}/{child_id}/kids", params={"date": TODAY}, headers=auth_header(user)
    )


def _code(response: httpx.Response) -> str:
    return response.json()["detail"]["code"]


# ── the rules, without a database ──────────────────────────────────────────────


def test_the_childs_day_may_be_a_day_either_side_of_the_servers():
    now = datetime(2026, 11, 11, 23, 0, tzinfo=UTC)
    for day in ("2026-11-10", "2026-11-11", "2026-11-12"):
        assert kids.check_day(day, now).isoformat() == day
    for day in ("2026-11-09", "2026-11-13", "2026-13-01"):
        with pytest.raises(ValueError):
            kids.check_day(day, now)


def test_each_award_kind_has_its_stars_and_nothing_else_is_an_award():
    assert kids.award_stars("power:0") == 1
    assert kids.award_stars("try:6:2026-11-11") == 1
    assert kids.award_stars("badge:discover") == 3
    assert kids.award_stars("mood:2026-11-11") == 1
    assert kids.award_stars("quest:space:2") == 1
    for key in ("power:7", "try:1", "badge:other", "stars:100", "quest:chess:0", "quest:space:3"):
        with pytest.raises(ValueError):
            kids.award_stars(key)


def test_recent_moods_are_the_last_62_days_newest_first():
    today = date(2026, 11, 11)
    at = datetime(2026, 11, 11, tzinfo=UTC)
    moods = {
        (today - timedelta(days=n)).isoformat(): {"mood": "good", "note": None, "at": at}
        for n in (0, 1, 61, 62)
    }
    shown = kids.recent_moods(moods, today)
    assert list(shown) == ["2026-11-11", "2026-11-10", "2026-09-11"]


def test_tried_on_reads_only_that_days_tries():
    awards = {"try:2:2026-11-11": 0, "try:5:2026-11-11": 0, "try:2:2026-11-10": 0, "power:2": 0}
    assert kids.tried_on(awards, "2026-11-11") == [2, 5]


# ── the endpoints ──────────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_a_child_with_no_activity_reads_empty_and_nothing_is_written(mongo_uri):
    async def test(r: Running) -> None:
        child_id = await _open(r, "conversation")
        response = await _get(r, child_id)
        assert response.status_code == 200
        assert response.json() == {
            "stars": 0, "flipped_powers": [], "discover_badge": False, "tried_today": [],
            "best_times": {}, "moods": {}, "shown": {},
            "circles_done": {
                "discover": False, "grow": False, "transform": False, "release": False,
                "connect": False,
            },
        }  # fmt: skip
        assert await r.db[KID_ACTIVITY].count_documents({}) == 0

    live(mongo_uri, test)


@pytest.mark.live_service
def test_only_the_parent_reads_or_writes_and_only_their_live_child(mongo_uri):
    async def test(r: Running) -> None:
        child_id = await _open(r, "conversation")
        flip = {"type": "flip_power", "power": 0}
        assert (await _get(r, child_id, user=OTHER)).status_code == 404
        assert (await _event(r, child_id, flip, user=OTHER)).status_code == 404
        admin = await _event(r, child_id, flip, user=ADMIN)
        assert admin.status_code == 403 and _code(admin) == "parents_only"
        await r.http.delete(f"{API}/{child_id}", headers=auth_header())
        assert (await _event(r, child_id, flip)).status_code == 404
        assert (await _get(r, child_id)).status_code == 404

    live(mongo_uri, test)


def test_child_view_opens_each_circle_once_the_one_before_is_done():
    progress = {"conversation": True, "grow": True, "transform": True, "release": True}
    nothing = dict.fromkeys(kids.CIRCLES, False)
    # The parent's progress opens nothing past Discover in child view.
    assert [kids.circle_open(c, progress, nothing) for c in kids.CIRCLES] == [
        True, False, False, False, False,
    ]  # fmt: skip
    so_far = {**nothing, "discover": True, "grow": True}
    assert [kids.circle_open(c, progress, so_far) for c in kids.CIRCLES] == [
        True, True, True, False, False,
    ]  # fmt: skip
    # Without the chat, nothing opens, whatever was done.
    everything = dict.fromkeys(kids.CIRCLES, True)
    assert not any(kids.circle_open(c, {}, everything) for c in kids.CIRCLES)


@pytest.mark.live_service
def test_each_circle_opens_from_what_the_child_did_in_child_view(mongo_uri):
    async def test(r: Running) -> None:
        child_id = await _open(r)
        locked = await _event(r, child_id, {"type": "flip_power", "power": 0})
        assert locked.status_code == 403 and _code(locked) == "circle_locked"
        # The parent's flags open nothing past Discover in child view.
        await _open_flags(r, child_id, "conversation", "grow", "transform", "release")
        steps: list[tuple[str, dict[str, Any]]] = [
            ("grow", {"type": "world_done", "world": 2}),
            ("transform", {"type": "quest", "interest": "space", "quest": 0}),
            ("release", {"type": "mood", "mood": "good"}),
            ("connect", {"type": "show_win", "key": "badge:discover", "title": "Badge"}),
        ]
        for power in range(kids.POWER_COUNT):
            await _event(r, child_id, {"type": "flip_power", "power": power})
        for circle, body in steps:
            # Each opens only after the one before it: try the next one first.
            after = steps.index((circle, body)) + 1
            if after < len(steps):
                ahead = await _event(r, child_id, steps[after][1])
                assert ahead.status_code == 403 and _code(ahead) == "circle_locked"
            done = await _event(r, child_id, body)
            assert done.status_code == 200 and done.json()["circles_done"][circle] is True
        final = (await _get(r, child_id)).json()["circles_done"]
        assert final == dict.fromkeys(kids.CIRCLES, True)

    live(mongo_uri, test)


@pytest.mark.live_service
def test_flipping_gives_a_star_once_per_power_and_the_badge_once(mongo_uri):
    async def test(r: Running) -> None:
        child_id = await _open(r, "conversation")
        first = (await _event(r, child_id, {"type": "flip_power", "power": 3})).json()
        assert first["stars"] == 1 and first["flipped_powers"] == [3]
        again = (await _event(r, child_id, {"type": "flip_power", "power": 3})).json()
        assert again["stars"] == 1
        for power in range(kids.POWER_COUNT):
            last = (await _event(r, child_id, {"type": "flip_power", "power": power})).json()
        assert last["flipped_powers"] == list(range(kids.POWER_COUNT))
        assert last["discover_badge"] is True
        assert last["stars"] == kids.POWER_COUNT + 3
        # Flipping again after the badge gives nothing more.
        assert (await _event(r, child_id, {"type": "flip_power", "power": 0})).json()[
            "stars"
        ] == kids.POWER_COUNT + 3

    live(mongo_uri, test)


@pytest.mark.live_service
def test_two_flips_at_once_give_one_star(mongo_uri):
    async def test(r: Running) -> None:
        child_id = await _open(r, "conversation")
        flip = {"type": "flip_power", "power": 1}
        both = await asyncio.gather(_event(r, child_id, flip), _event(r, child_id, flip))
        assert [b.status_code for b in both] == [200, 200]
        assert (await _get(r, child_id)).json()["stars"] == 1

    live(mongo_uri, test)


@pytest.mark.live_service
def test_try_this_today_gives_a_star_once_a_day_per_power(mongo_uri):
    async def test(r: Running) -> None:
        child_id = await _open(r, "conversation")
        yesterday = (datetime.now(UTC).date() - timedelta(days=1)).isoformat()
        try_two = {"type": "try_power", "power": 2}
        assert (await _event(r, child_id, try_two)).json()["tried_today"] == [2]
        assert (await _event(r, child_id, try_two)).json()["stars"] == 1
        assert (await _event(r, child_id, try_two, day=yesterday)).json()["stars"] == 2
        assert (await _event(r, child_id, {"type": "try_power", "power": 4})).json()[
            "tried_today"
        ] == [2, 4]
        far = await _event(r, child_id, try_two, day="2020-01-01")
        assert far.status_code == 422 and _code(far) == "bad_date"

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_games_best_time_is_kept_and_gives_no_stars(mongo_uri):
    async def test(r: Running) -> None:
        child_id = await _open(r, "conversation")

        async def best(seconds: float) -> dict[str, Any]:
            body = {"type": "game_best", "game": "focus", "seconds": seconds}
            response = await _event(r, child_id, body)
            assert response.status_code == 200
            return response.json()

        assert (await best(4.2))["best_times"] == {"focus": 4.2}
        assert (await best(6.0))["best_times"] == {"focus": 4.2}
        last = await best(3.1)
        assert last["best_times"] == {"focus": 3.1} and last["stars"] == 0
        for body in (
            {"type": "game_best", "game": "focus", "seconds": 0.1},
            {"type": "game_best", "game": "chess", "seconds": 3},
            {"type": "flip_power", "power": 7},
            {"type": "stars", "stars": 100},
        ):
            assert (await _event(r, child_id, body)).status_code == 422

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_mood_is_kept_per_day_and_the_note_is_capped(mongo_uri):
    async def test(r: Running) -> None:
        child_id = await _open(r, "conversation")
        await _done(r, child_id, "discover", "grow", "transform")
        first = await _event(r, child_id, {"type": "mood", "mood": "low", "note": "Rainy."})
        assert first.json()["moods"] == {TODAY: {"mood": "low", "note": "Rainy."}}
        second = await _event(r, child_id, {"type": "mood", "mood": "great"})
        assert second.json()["moods"] == {TODAY: {"mood": "great", "note": None}}
        assert second.json()["stars"] == 1  # once a day, however often it's changed
        long = await _event(r, child_id, {"type": "mood", "mood": "okay", "note": "x" * 501})
        assert long.status_code == 422
        assert (await _event(r, child_id, {"type": "mood", "mood": "angry"})).status_code == 422

    live(mongo_uri, test)


# ── removal with the child ─────────────────────────────────────────────────────


@pytest.mark.live_service
def test_the_activity_goes_with_the_purged_child(mongo_uri):
    async def test(r: Running) -> None:
        child_id = await _open(r, "conversation")
        kept = await _open(r, "conversation")
        for c in (child_id, kept):
            await _event(r, c, {"type": "flip_power", "power": 0})
        await r.http.delete(f"{API}/{child_id}", headers=auth_header())
        doc = await r.db[CHILDREN].find_one({"_id": child_id})
        assert await lifecycle.purge_one(r.runtime, doc)
        assert await r.db[KID_ACTIVITY].find_one({"_id": child_id}) is None
        assert await r.db[KID_ACTIVITY].find_one({"_id": kept}) is not None

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_quest_gives_a_star_once_and_waits_for_a_world(mongo_uri):
    async def test(r: Running) -> None:
        child_id = await _open(r, "conversation")
        await _done(r, child_id, "discover")
        quest = {"type": "quest", "interest": "space", "quest": 1}
        locked = await _event(r, child_id, quest)
        assert locked.status_code == 403 and _code(locked) == "circle_locked"
        await _done(r, child_id, "discover", "grow")
        assert (await _event(r, child_id, quest)).json()["stars"] == 1
        assert (await _event(r, child_id, quest)).json()["stars"] == 1
        other = {"type": "quest", "interest": "space", "quest": 2}
        assert (await _event(r, child_id, other)).json()["stars"] == 2
        for bad in ({**quest, "interest": "chess"}, {**quest, "quest": 3}):
            assert (await _event(r, child_id, bad)).status_code == 422

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_shown_win_is_kept_for_the_parent_without_stars(mongo_uri):
    async def test(r: Running) -> None:
        child_id = await _open(r, "conversation")
        await _done(r, child_id, "discover", "grow", "transform")
        show = {"type": "show_win", "key": "quest:space:2", "title": "Quest done: Draw the sky"}
        locked = await _event(r, child_id, show)
        assert locked.status_code == 403 and _code(locked) == "circle_locked"
        await _done(r, child_id, "discover", "grow", "transform", "release")
        shown = (await _event(r, child_id, show)).json()
        assert shown["stars"] == 0
        assert shown["shown"]["quest:space:2"]["title"] == "Quest done: Draw the sky"
        again = (await _event(r, child_id, {**show, "title": "  Draw the sky  "})).json()
        assert list(again["shown"]) == ["quest:space:2"]
        assert again["shown"]["quest:space:2"]["title"] == "Draw the sky"
        assert (await _get(r, child_id)).json()["shown"] == again["shown"]
        for bad in (
            {**show, "key": "Quest.space"}, {**show, "key": "a:b:c:d:e"}, {**show, "title": ""},
            {**show, "title": "x" * 81},
        ):  # fmt: skip
            assert (await _event(r, child_id, bad)).status_code == 422

    live(mongo_uri, test)


@pytest.mark.live_service
def test_only_so_many_wins_are_kept(mongo_uri):
    async def test(r: Running) -> None:
        child_id = await _open(r, "conversation")
        await _done(r, child_id, "discover", "grow", "transform", "release")
        for n in range(kids.SHOWN_MAX):
            body = {"type": "show_win", "key": f"world:{n}", "title": f"World {n}"}
            assert (await _event(r, child_id, body)).status_code == 200
        full = await _event(r, child_id, {"type": "show_win", "key": "streak", "title": "Streak"})
        assert full.status_code == 409 and _code(full) == "shown_full"
        same = {"type": "show_win", "key": "world:0", "title": "World zero"}
        assert (await _event(r, child_id, same)).status_code == 200  # replacing one is fine

    live(mongo_uri, test)


@pytest.mark.live_service
def test_kids_events_are_limited_to_120_a_minute(mongo_uri):
    async def test(r: Running) -> None:
        child_id = await _open(r, "conversation")
        flip = {"type": "flip_power", "power": 0}
        statuses = [(await _event(r, child_id, flip)).status_code for _ in range(121)]
        assert statuses[0] == 200 and statuses[-1] == 429 and statuses.count(429) == 1

    live(mongo_uri, test)
