"""The child's world runs in child view (docs/child-view-build-plan.md, P.3, 3.4): the worlds'
data (its suggestions ground the recommendations' prompt, test_areas.py), a run's total,
keeping the last 10, the checks, the lock and ownership. Removal with the child and the
account is in test_grow_worker.py."""

import asyncio
import re
from collections.abc import Awaitable, Callable, Sequence

import httpx
import pytest
from grow_testkit import LOCATION, OTHER, Running, auth_header, progress, running

from common.events import tombstone_key, write_tombstone
from grow.app import worlds

TOKENS = {"name", "he", "He", "his", "His", "him", "Him", "is", "has", "does", "s", "es"}


def live(mongo_uri: str, test: Callable[[Running], Awaitable[None]]) -> None:
    async def go() -> None:
        async with running(mongo_uri) as r:
            await test(r)

    asyncio.run(go())


def _path(child_id: str, rest: str = "") -> str:
    return f"/api/v1/children/{child_id}/growth-areas/worlds{rest}"


async def _run(r: Running, child: str, world: int, scores: Sequence[float]) -> httpx.Response:
    return await r.http.post(
        _path(child, f"/{world}/runs"), json={"scores": list(scores)}, headers=auth_header()
    )


# ── the data, without a database ───────────────────────────────────────────────


def test_six_worlds_of_three_games_each_with_both_suggestions():
    assert len(worlds.WORLDS) == worlds.WORLD_COUNT == 6
    for world in worlds.WORLDS:
        assert world["name"] and world["icon"] and world["mission"] and world["hint"]
        assert len(world["games"]) == worlds.GAMES_PER_WORLD
        for game in world["games"]:
            assert game["type"] in worlds.GAME_TYPES
            assert game["title"] and game["skill"] and game["how"] and game["tip"]
            for tag in ("build_on", "support"):
                assert game[tag]["title"] and game[tag]["body"]


def test_the_parents_suggestions_name_no_one_and_use_only_known_tokens():
    for world in worlds.WORLDS:
        for game in world["games"]:
            for tag in ("build_on", "support"):
                text = game[tag]["title"] + " " + game[tag]["body"]
                bare = re.sub(r"\{\w+\}", "", text)
                assert not re.search(r"\b(he|his|him|she|her|Rahul)\b", bare, flags=re.I), text
                assert set(re.findall(r"\{(\w+)\}", text)) <= TOKENS, text


def test_each_game_type_has_its_settings():
    for world in worlds.WORLDS:
        for game in world["games"]:
            cfg = game["cfg"]
            if game["type"] == "sort":
                assert cfg["left"] and cfg["right"] and len(cfg["items"]) >= 6
            elif game["type"] == "dash":
                assert len({i["kind"] for i in cfg["items"]}) == 4
            elif game["type"] == "catch":
                assert (cfg.get("good") and cfg.get("bad")) or cfg.get("rule") == "even"
            elif game["type"] in ("timing", "react"):
                assert cfg["label"] and cfg["n"] > 0
            elif game["type"] == "memory":
                assert len(cfg["pads"]) == 4
            else:
                assert cfg["time"] > 0


def test_a_runs_total_and_band():
    assert worlds.total([80, 75, 72]) == 76
    assert worlds.total([1, 1, 2]) == 1
    assert worlds.total([1, 2, 2]) == 2
    assert [worlds.band(s)["label"] for s in (80, 79, 55, 54, 0)] == [
        "Super strong", "Growing well", "Growing well", "Keep practising", "Keep practising",
    ]  # fmt: skip


def test_a_runs_game_lines_for_releases_observations():
    run = {"scores": [80, 55, 54], "total": 63}
    assert worlds.game_lines("critical_thinking", run) == [
        "Played Planet Pattern (Memory): 80 of 100, Super strong",
        "Played Fact or Opinion (Clear thinking): 55 of 100, Growing well",
        "Played Even Catch (Following rules): 54 of 100, Keep practising",
    ]
    assert worlds.game_lines("not_an_area", run) == []


# ── the endpoints ──────────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_a_child_with_no_runs_reads_the_worlds_and_nothing_is_written(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        response = await r.http.get(_path(child), headers=auth_header())
        assert response.status_code == 200
        body = response.json()
        assert len(body["worlds"]) == 6 and body["runs"] == {}
        # The suggestions stay on the server: they ground the recommendations' prompt.
        game = body["worlds"][0]["games"][0]
        assert game["skill"] and "build_on" not in game and "support" not in game
        assert [b["label"] for b in body["bands"]] == [
            "Super strong", "Growing well", "Keep practising",
        ]  # fmt: skip
        assert await r.db[worlds.WORLD_RUNS].count_documents({}) == 0

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_run_is_kept_per_world_and_only_the_last_ten(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        first = (await _run(r, child, 2, [80, 75, 72])).json()
        assert [(x["total"], x["scores"]) for x in first["runs"]["2"]] == [(76, [80, 75, 72])]
        for n in range(11):
            await _run(r, child, 0, [n, n, n])
        runs = (await r.http.get(_path(child), headers=auth_header())).json()["runs"]
        assert [x["total"] for x in runs["0"]] == list(range(1, 11))  # oldest first
        assert len(runs["2"]) == 1

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_runs_scores_and_world_are_checked(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        for world, scores in (
            (0, [101, 50, 50]), (0, [-1, 50, 50]), (0, [50, 50]), (0, [50, 50, 50, 50]),
            (0, [50.5, 50, 50]), (6, [50, 50, 50]),
        ):  # fmt: skip
            assert (await _run(r, child, world, scores)).status_code == 422
        assert await r.db[worlds.WORLD_RUNS].count_documents({}) == 0

    live(mongo_uri, test)


@pytest.mark.live_service
def test_worlds_open_once_the_chat_is_done_and_only_for_the_parent(mongo_uri):
    async def test(r: Running) -> None:
        # Child view's own order: the reveal not passed yet, the worlds open after the chat.
        early = r.owners.add_child()
        await r.copy(early, progress=progress(profile=True, conversation=True))
        r.owners.personality(early, done=False)
        assert (await r.http.get(_path(early), headers=auth_header())).status_code == 200
        locked = r.owners.add_child()
        await r.copy(locked, progress=progress(profile=True))
        refused = await r.http.get(_path(locked), headers=auth_header())
        assert refused.status_code == 403
        assert refused.json()["detail"]["code"] == "circle_locked"
        theirs = r.owners.add_child(user_id=OTHER)
        await r.copy(theirs, user_id=OTHER)
        assert (await r.http.get(_path(theirs), headers=auth_header())).status_code == 404
        assert (await _run(r, theirs, 0, [1, 2, 3])).status_code == 404

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_deleted_child_gets_no_runs(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        await write_tombstone(r.db, tombstone_key("child", child), location=LOCATION, version=1)
        assert (await _run(r, child, 0, [1, 2, 3])).status_code == 404
        assert await r.db[worlds.WORLD_RUNS].count_documents({}) == 0

    live(mongo_uri, test)


@pytest.mark.live_service
def test_world_runs_are_limited_to_60_a_minute(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        statuses = [(await _run(r, child, 0, [50, 50, 50])).status_code for _ in range(61)]
        assert statuses[0] == 200 and statuses[-1] == 429 and statuses.count(429) == 1

    live(mongo_uri, test)
