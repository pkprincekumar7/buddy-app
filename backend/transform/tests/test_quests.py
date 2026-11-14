"""The child's quests in child view (docs/child-view-build-plan.md, 3.1): the interest the plan
names, picking one, a log once a day up to the target, the lock and ownership. Removal with
the child and the account is in test_transform_worker.py."""

import asyncio
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any, get_args

import httpx
import pytest
from transform_testkit import LOCATION, OTHER, Running, auth_header, progress, running

from common.events import tombstone_key, write_tombstone
from transform.app import quests

TODAY = datetime.now(UTC).date().isoformat()
YESTERDAY = (datetime.now(UTC).date() - timedelta(days=1)).isoformat()
TOMORROW = (datetime.now(UTC).date() + timedelta(days=1)).isoformat()


def live(mongo_uri: str, test: Callable[[Running], Awaitable[None]]) -> None:
    async def go() -> None:
        async with running(mongo_uri) as r:
            await test(r)

    asyncio.run(go())


def _path(child_id: str, rest: str = "") -> str:
    return f"/api/v1/children/{child_id}/transform/quests{rest}"


def _code(response: httpx.Response) -> str:
    return response.json()["detail"]["code"]


async def _get(r: Running, child: str, user: str | None = None) -> httpx.Response:
    headers = auth_header(user) if user else auth_header()
    return await r.http.get(_path(child), params={"date": TODAY}, headers=headers)


async def _pick(r: Running, child: str, interest: str) -> httpx.Response:
    return await r.http.put(
        _path(child, "/current"),
        params={"date": TODAY},
        json={"interest": interest},
        headers=auth_header(),
    )


async def _log(
    r: Running, child: str, interest: str, quest: int, *, day: str = TODAY
) -> httpx.Response:
    return await r.http.post(
        _path(child, "/log"),
        params={"date": day},
        json={"interest": interest, "quest": quest},
        headers=auth_header(),
    )


async def _ask(r: Running, child: str, ask: str) -> None:
    patched = await r.save_plan(child, ask=ask)
    assert patched.status_code == 200


# ── the rules, without a database ──────────────────────────────────────────────


def test_the_quest_data_has_nine_interests_of_three_quests_each():
    assert list(get_args(quests.QuestInterest)) == list(quests.INTEREST_KEYS)
    assert len(quests.INTERESTS) == 9
    for interest in quests.INTERESTS:
        assert interest["label"] and interest["match"]
        assert len(interest["quests"]) == quests.QUESTS_PER_INTEREST
        for quest in interest["quests"]:
            assert quest["title"] and quest["how"] and 1 <= quest["target"] <= 5


@pytest.mark.parametrize(
    ("ask", "interest"),
    [
        ("He loves Lego and making things", "building"),
        ("Football, mostly", "football"),
        ("She reads every night", "reading"),
        ("Minecraft all day", "games"),
        ("looking at the stars", "space"),
        ("Being kind to others", None),
        ("", None),
        (None, None),
    ],
)
def test_the_plans_ask_names_the_default_interest(ask, interest):
    assert quests.default_interest(ask) == interest


def test_the_childs_day_may_be_a_day_either_side_of_the_servers():
    now = datetime(2026, 11, 11, 23, 0, tzinfo=UTC)
    assert quests.check_day("2026-11-12", now).isoformat() == "2026-11-12"
    for day in ("2026-11-09", "2026-11-13", "not-a-day"):
        with pytest.raises(ValueError):
            quests.check_day(day, now)


# ── the endpoints ──────────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_a_child_with_no_quests_reads_the_plans_interest_and_nothing_is_written(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        empty = (await _get(r, child)).json()
        assert empty["default_interest"] is None
        assert [empty[k] for k in ("interests", "current", "logs", "last_logged", "logged_today")] == [
            [], None, {}, {}, [],
        ]  # fmt: skip
        assert [i["key"] for i in empty["catalog"]] == list(quests.INTEREST_KEYS)
        await _ask(r, child, "she loves drawing comics")
        assert (await _get(r, child)).json()["default_interest"] == "drawing"
        assert await r.db[quests.KID_QUESTS].count_documents({}) == 0

    live(mongo_uri, test)


@pytest.mark.live_service
def test_picking_the_plans_interest_keeps_it_out_of_the_childs_own(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        await _ask(r, child, "football")
        own = (await _pick(r, child, "football")).json()
        assert own["current"] == "football" and own["interests"] == []
        added = (await _pick(r, child, "space")).json()
        assert added["current"] == "space" and added["interests"] == ["space"]
        again = (await _pick(r, child, "space")).json()
        assert again["interests"] == ["space"]
        assert (await _pick(r, child, "chess")).status_code == 422

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_quest_is_logged_once_a_day_up_to_its_target(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        await _pick(r, child, "music")
        first = (await _log(r, child, "music", 2)).json()  # "Play for someone": target 1
        assert first["logs"] == {"music:2": 1} and first["logged_today"] == ["music:2"]
        assert first["last_logged"] == {"music:2": TODAY}
        assert (await _log(r, child, "music", 2, day=YESTERDAY)).json()["logs"] == {"music:2": 1}
        practice = (await _log(r, child, "music", 0)).json()  # target 5
        assert practice["logs"]["music:0"] == 1
        assert (await _log(r, child, "music", 0)).json()["logs"]["music:0"] == 1  # same day
        # A day before the last one logged doesn't count (and shows as done for that day):
        # alternating two dates the server accepts can't log one real day twice.
        back = (await _log(r, child, "music", 0, day=YESTERDAY)).json()
        assert back["logs"]["music:0"] == 1 and "music:0" in back["logged_today"]
        assert (await _log(r, child, "music", 0, day=TOMORROW)).json()["logs"]["music:0"] == 2
        assert (await _log(r, child, "music", 0)).json()["logs"]["music:0"] == 2
        far = await _log(r, child, "music", 0, day="2020-01-01")
        assert far.status_code == 422 and _code(far) == "bad_date"
        assert (await _log(r, child, "music", 3)).status_code == 422

    live(mongo_uri, test)


@pytest.mark.live_service
def test_two_logs_at_once_count_once(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        await _pick(r, child, "space")
        both = await asyncio.gather(_log(r, child, "space", 0), _log(r, child, "space", 0))
        assert [b.status_code for b in both] == [200, 200]
        assert (await _get(r, child)).json()["logs"] == {"space:0": 1}

    live(mongo_uri, test)


@pytest.mark.live_service
def test_only_a_picked_interest_is_logged(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        refused = await _log(r, child, "cooking", 0)
        assert refused.status_code == 409 and _code(refused) == "interest_not_picked"
        await _ask(r, child, "baking")
        assert (await _log(r, child, "cooking", 0)).status_code == 200

    live(mongo_uri, test)


@pytest.mark.live_service
def test_quests_open_once_the_chat_is_done_and_only_for_the_parent(mongo_uri):
    async def test(r: Running) -> None:
        # Child view's own order: no growth area needed, only the chat (children decides the rest).
        early = r.owners.add_child()
        await r.copy(early, progress=progress(profile=True, conversation=True))
        assert (await _get(r, early)).status_code == 200
        locked = r.owners.add_child()
        await r.copy(locked, progress=progress(profile=True))
        refused = await _get(r, locked)
        assert refused.status_code == 403 and _code(refused) == "circle_locked"
        theirs = r.owners.add_child(user_id=OTHER)
        await r.copy(theirs, user_id=OTHER)
        for response in (await _get(r, theirs), await _pick(r, theirs, "space")):
            assert response.status_code == 404
        child = await r.ready_child()
        assert (await _get(r, child, user=OTHER)).status_code == 404

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_deleted_child_gets_no_quests(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        await write_tombstone(r.db, tombstone_key("child", child), location=LOCATION, version=1)
        response: Any = await _pick(r, child, "space")
        assert response.status_code == 404
        assert await r.db[quests.KID_QUESTS].count_documents({}) == 0

    live(mongo_uri, test)


@pytest.mark.live_service
def test_quest_writes_are_rate_limited(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        picks = [(await _pick(r, child, "space")).status_code for _ in range(61)]
        assert picks[0] == 200 and picks[-1] == 429 and picks.count(429) == 1
        logs = [(await _log(r, child, "space", 0)).status_code for _ in range(121)]
        assert logs[0] == 200 and logs[-1] == 429 and logs.count(429) == 1

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_counted_log_publishes_transform_quest_logged_with_it(mongo_uri):
    async def test(r: Running) -> None:
        child = await r.ready_child()
        await _pick(r, child, "space")
        await _log(r, child, "space", 0)
        await _log(r, child, "space", 0)  # the same day: not counted, nothing published
        await _log(r, child, "space", 0, day=TOMORROW)
        rows = await r.db.outbox.find({"event_type": "transform.quest_logged"}).to_list(None)
        # Each counted log, in the log's transaction, for children's child-view progress.
        assert [(row["aggregate_id"], row["payload"]) for row in rows] == [
            (child, {"interest": "space", "quest": 0}),
            (child, {"interest": "space", "quest": 0}),
        ]
        assert sorted(row["version"] for row in rows) == sorted({row["version"] for row in rows})

    live(mongo_uri, test)
