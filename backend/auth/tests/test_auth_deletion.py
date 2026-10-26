"""Account deletion, auth's part (10.3; build plan 3.5), the email lookup and the worker.

The plan's checks:
- the saga completes with users as the only participant so far;
- a confirmation carrying another service's name in its payload is ignored.
"""

import asyncio
import json
import time
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from auth_testkit import AUTH_PRIVATE, LOCATION, USERS_PRIVATE, Running, claims, running

from auth import worker
from auth.app import deletion, main
from auth.app.runtime import AuthSettings
from auth.app.store import ADMIN_COUNT, AUDIT, AUTH, DELETIONS, EMAIL_INDEX, SESSIONS
from common.events import Event
from common.events.testing import assert_consumer_contract, sns_envelope, topic_arn
from common.internal_client import ServiceTokenSigner

PATH = "/api/v1/auth/account"


def live(mongo_uri: str, test: Callable[[Running], Awaitable[None]], **options: Any) -> None:
    async def go() -> None:
        async with running(mongo_uri, **options) as r:
            await test(r)

    asyncio.run(go())


def _code(response: httpx.Response) -> str:
    return response.json()["detail"]["code"]


async def _signed_up(
    r: Running, email: str = "jane@example.com", role: str = "parent"
) -> dict[str, Any]:
    await r.allow(email)
    response = await r.register(email=email, ip=f"198.51.{uuid.uuid4().int % 250}.2")
    assert response.status_code == 201
    r.http.cookies.clear()
    user_id = claims(response.json()["access_token"])["sub"]
    if role == "admin":
        await r.db[AUTH].update_one({"_id": user_id}, {"$set": {"role": "admin"}})
        await r.db[ADMIN_COUNT].update_one({"_id": "admins"}, {"$inc": {"active": 1}}, upsert=True)
    return {
        "id": user_id,
        "headers": {"Authorization": f"Bearer {response.json()['access_token']}"},
    }


async def _delete(
    r: Running, who: dict[str, Any], email: str = "jane@example.com"
) -> httpx.Response:
    return await r.http.request(
        "DELETE", PATH, json={"confirm_email": email}, headers=who["headers"]
    )


def _confirmation(user_id: str, producer: str, version: int = 2, **payload: Any) -> Event:
    return Event.new(
        "user.data_deleted",
        producer=producer,
        aggregate_id=user_id,
        location=LOCATION,
        version=version,
        region="ap-south-1",
        payload=payload,
    )


# ── the start ──────────────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_deleting_an_account_starts_the_saga(mongo_uri):
    async def test(r: Running) -> None:
        jane = await _signed_up(r)
        await r.login(email="jane@example.com")
        r.http.cookies.clear()
        time.sleep(0.002)
        response = await r.http.request(
            "DELETE", PATH, json={"confirm_email": "  JANE@example.com "}, headers=jane["headers"]
        )
        assert (response.status_code, response.json()) == (202, {"status": "deleting"})
        assert any(
            "access_token=" in c and "Max-Age=0" in c
            for c in response.headers.get_list("set-cookie")
        )
        account = await r.db[AUTH].find_one({"_id": jane["id"]})
        assert account is not None and account["is_being_deleted"] is True
        assert account["tokens_revoked_at"] is not None and account["authz_version"] == 2
        assert await r.db[SESSIONS].count_documents({"user_id": jane["id"]}) == 0
        row = await r.db.outbox.find_one({"event_type": "user.deletion_requested"})
        assert row is not None and (row["aggregate_id"], row["version"], row["location"]) == (
            jane["id"], 2, LOCATION,
        )  # fmt: skip
        tracking = await r.db[DELETIONS].find_one({"_id": jane["id"]})
        assert tracking is not None
        assert (tracking["expected"], tracking["confirmed"]) == (["users"], [])
        # Nobody can sign in meanwhile, and the email isn't free yet.
        assert (await r.login(email="jane@example.com")).status_code == 401
        assert (await r.register(email="jane@example.com")).status_code == 409

    live(mongo_uri, test)


@pytest.mark.live_service
def test_the_email_must_match_and_the_last_admin_stays(mongo_uri):
    async def test(r: Running) -> None:
        jane = await _signed_up(r)
        wrong = await _delete(r, jane, email="other@example.com")
        assert (wrong.status_code, _code(wrong)) == (400, "confirmation_mismatch")
        boss = await _signed_up(r, "boss@example.com", role="admin")
        last = await _delete(r, boss, email="boss@example.com")
        assert (last.status_code, _code(last)) == (409, "last_admin")
        assert await r.db[DELETIONS].count_documents({}) == 0
        assert (
            await r.http.request("DELETE", PATH, json={"confirm_email": "x@y.z"})
        ).status_code == 401

    live(mongo_uri, test)


@pytest.mark.live_service
def test_admins_leave_the_counter_and_a_failed_start_puts_them_back(mongo_uri, monkeypatch):
    async def test(r: Running) -> None:
        a = await _signed_up(r, "a@example.com", role="admin")
        b = await _signed_up(r, "b@example.com", role="admin")
        real = deletion.add_to_outbox

        async def broken(*args: Any) -> Any:
            raise RuntimeError("primary stepped down")

        # Inside the transaction, so nothing committed: the admin is put back.
        monkeypatch.setattr(deletion, "add_to_outbox", broken)
        with pytest.raises(RuntimeError):
            await _delete(r, a, email="a@example.com")
        assert (await r.db[ADMIN_COUNT].find_one({}))["active"] == 2
        monkeypatch.setattr(deletion, "add_to_outbox", real)
        assert (await _delete(r, a, email="a@example.com")).status_code == 202
        assert (await r.db[ADMIN_COUNT].find_one({}))["active"] == 1
        # A locked admin was already taken off when locked: the counter stays.
        await r.db[AUTH].update_one({"_id": b["id"]}, {"$set": {"is_locked": True}})
        await r.db[ADMIN_COUNT].update_one({}, {"$set": {"active": 1}})
        # (b's token predates nothing; locked accounts are refused by the authz check)
        assert (await _delete(r, b, email="b@example.com")).status_code == 403

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_failure_after_the_commit_neither_fails_nor_puts_the_admin_back(mongo_uri, monkeypatch):
    async def test(r: Running) -> None:
        await _signed_up(r, "b@example.com", role="admin")
        a = await _signed_up(r, "a@example.com", role="admin")

        async def cache_down(*args: Any) -> None:
            raise ConnectionError("valkey down")

        monkeypatch.setattr(deletion, "write_entry", cache_down)
        # Started: the authz stream writes the entry instead.
        assert (await _delete(r, a, email="a@example.com")).status_code == 202
        assert (await r.db[ADMIN_COUNT].find_one({}))["active"] == 1
        assert (await r.db[AUTH].find_one({"_id": a["id"]}))["is_being_deleted"] is True
        assert await r.db[DELETIONS].count_documents({"_id": a["id"]}) == 1

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_role_changed_after_it_was_read_is_409_and_the_counter_put_back(mongo_uri, monkeypatch):
    async def test(r: Running) -> None:
        await _signed_up(r, "b@example.com", role="admin")
        a = await _signed_up(r, "a@example.com", role="admin")
        real = main.admin.take_admin_out

        async def demoted_meanwhile(runtime: Any) -> None:
            await real(runtime)
            # Another admin demoted (and so uncounted) them between the read and the start.
            await r.db[AUTH].update_one({"_id": a["id"]}, {"$set": {"role": "parent"}})

        monkeypatch.setattr(main.admin, "take_admin_out", demoted_meanwhile)
        response = await _delete(r, a, email="a@example.com")
        assert response.status_code == 409 and _code(response) == "account_changed"
        assert (await r.db[ADMIN_COUNT].find_one({}))["active"] == 2
        assert not (await r.db[AUTH].find_one({"_id": a["id"]})).get("is_being_deleted")

    live(mongo_uri, test)


def test_an_unknown_commit_result_undoes_nothing():
    from pymongo.errors import OperationFailure

    unknown = OperationFailure("commit timed out")
    unknown._add_error_label("UnknownTransactionCommitResult")
    assert deletion._not_committed(unknown) is False
    assert deletion._not_committed(OperationFailure("write conflict")) is True
    assert deletion._not_committed(RuntimeError("x")) is True


@pytest.mark.live_service
def test_a_second_request_let_through_by_a_cached_entry_is_401(mongo_uri):
    async def test(r: Running) -> None:
        jane = await _signed_up(r)
        # Fills this task's 30-second copy of Jane's entry (no Valkey here, 9.3).
        assert (await r.http.get("/api/v1/auth/me", headers=jane["headers"])).status_code == 200
        assert (await _delete(r, jane)).status_code == 202
        again = await _delete(r, jane)
        assert again.status_code == 401
        assert await r.db.outbox.count_documents({}) == 1
        # So is one for an account that's already gone.
        await r.db[AUTH].delete_many({})
        assert (await _delete(r, jane)).status_code == 401

    live(mongo_uri, test)


# ── the confirmations ──────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_the_saga_completes_with_users_as_the_only_participant(mongo_uri):
    async def test(r: Running) -> None:
        jane = await _signed_up(r)
        assert (await _delete(r, jane)).status_code == 202
        consumer = worker.build_consumer(r.runtime)
        body = sns_envelope(_confirmation(jane["id"], "users"), r.layout["topics"]["users"])
        assert (await consumer.handle_body(body)).value == "handled"
        # Credentials last: the email index, the account and the tracking row are gone.
        assert await r.db[EMAIL_INDEX].count_documents({"user_id": jane["id"]}) == 0
        assert await r.db[AUTH].find_one({"_id": jane["id"]}) is None
        assert await r.db[DELETIONS].find_one({"_id": jane["id"]}) is None
        # The email can be registered again.
        assert (await r.register(email="jane@example.com")).status_code == 201
        # A late duplicate changes nothing harmful (recorded again, finished again).
        assert (await consumer.handle_body(body)).value == "handled"

    live(mongo_uri, test, aws=True)


@pytest.mark.live_service
def test_who_confirmed_comes_from_the_topic_never_the_payload(mongo_uri):
    async def test(r: Running) -> None:
        jane = await _signed_up(r)
        await _delete(r, jane)
        consumer = worker.build_consumer(r.runtime)
        # users' confirmation says it's children's: it counts as users' only.
        forged = _confirmation(jane["id"], "users", service="children", source="children")
        await consumer.handle_body(sns_envelope(forged, r.layout["topics"]["users"]))
        tracking = await r.db[DELETIONS].find_one({"_id": jane["id"]})
        assert tracking is not None and tracking["confirmed"] == ["users"]
        assert await r.db[AUTH].find_one({"_id": jane["id"]}) is not None  # children hasn't
        # children's own confirmation, from its own topic, finishes it.
        await consumer.handle_body(
            sns_envelope(_confirmation(jane["id"], "children"), r.layout["topics"]["children"])
        )
        assert await r.db[AUTH].find_one({"_id": jane["id"]}) is None
        # A topic that isn't a data service's is rejected outright (the consumer's check).
        other = await consumer.handle_body(
            sns_envelope(
                _confirmation(jane["id"], "users"), topic_arn("superpower-local", "shared")
            )
        )
        assert other.value == "rejected"

    live(mongo_uri, test, aws=True, participants="users,children")


@pytest.mark.live_service
def test_a_confirmation_before_the_tracking_row_creates_it(mongo_uri):
    # The start crashed between its transaction and the deletions upsert.
    async def test(r: Running) -> None:
        jane = await _signed_up(r)
        received = worker.build_consumer(r.runtime).check(
            sns_envelope(_confirmation(jane["id"], "users"), r.layout["topics"]["users"])
        )
        r.runtime.settings.deletion_participants = "users,children"
        assert await deletion.confirm(r.runtime, received) is False
        tracking = await r.db[DELETIONS].find_one({"_id": jane["id"]})
        assert tracking is not None
        assert (tracking["expected"], tracking["confirmed"]) == (["users", "children"], ["users"])

    live(mongo_uri, test, aws=True)


@pytest.mark.live_service
def test_a_deletion_older_than_24_hours_is_reported(mongo_uri, caplog):
    async def test(r: Running) -> None:
        old = datetime.now(UTC) - timedelta(hours=25)
        await r.db[DELETIONS].insert_many(
            [
                {"_id": "u-in", "location": "in", "requested_at": old, "expected": ["users", "grow"], "confirmed": ["users"]},
                {"_id": "u-us", "location": "us", "requested_at": old, "expected": ["users"], "confirmed": []},
                {"_id": "u-new", "location": "in", "requested_at": datetime.now(UTC), "expected": ["users"], "confirmed": []},
            ]
        )  # fmt: skip
        with caplog.at_level("ERROR"):
            assert await deletion.report_stuck(r.runtime, ["in"]) == 1
            assert await deletion.report_stuck(r.runtime, None) == 2
        assert "auth.deletion.stuck id=u-in" in caplog.text and "waiting_for=grow" in caplog.text

    live(mongo_uri, test)


# ── the worker ─────────────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_the_worker_publishes_the_request_and_finishes_on_confirmation(mongo_uri):
    async def test(r: Running) -> None:
        jane = await _signed_up(r)
        await _delete(r, jane)
        assert_consumer_contract(worker.build_consumer(r.runtime))
        stop = asyncio.Event()
        task = asyncio.create_task(worker.run(r.runtime, stop, wait_seconds=0, stuck_interval=0.05))
        loop = asyncio.get_running_loop()
        deadline = loop.time() + 15
        # The relay publishes user.deletion_requested; SNS delivers it to users' queue.
        while True:
            messages = r.runtime.sqs.receive_message(
                QueueUrl=r.layout["queues"]["users"], WaitTimeSeconds=0
            ).get("Messages", [])
            if messages:
                break
            assert loop.time() < deadline, "the relay didn't publish the request"
            await asyncio.sleep(0.1)
        envelope = json.loads(messages[0]["Body"])
        assert envelope["TopicArn"] == r.layout["topics"]["auth"]
        assert json.loads(envelope["Message"])["event_type"] == "user.deletion_requested"
        # users confirms on its topic; SNS delivers it to auth's queue; the worker finishes.
        r.runtime.sns.publish(
            TopicArn=r.layout["topics"]["users"],
            Message=_confirmation(jane["id"], "users").to_message(),
            MessageAttributes=_confirmation(jane["id"], "users").message_attributes(),
        )
        while await r.db[AUTH].find_one({"_id": jane["id"]}) is not None:
            assert loop.time() < deadline, "the worker didn't finish the deletion"
            await asyncio.sleep(0.1)
        stop.set()
        await asyncio.wait_for(task, 15)
        assert worker.region_locations(r.runtime) is None  # APP_ENV=local: every location
        r.runtime.settings.app_env = "dev"
        assert "in" in (worker.region_locations(r.runtime) or [])

    live(mongo_uri, test, aws=True)


@pytest.mark.live_service
def test_the_worker_needs_its_topic_and_queue_and_survives_a_failed_check(mongo_uri, monkeypatch):
    async def test(r: Running) -> None:
        with pytest.raises(RuntimeError, match="EVENTS_TOPIC_ARN"):
            await worker.run(r.runtime, asyncio.Event())
        stop = asyncio.Event()
        calls = [0]

        async def flaky(*args: Any) -> int:
            calls[0] += 1
            if calls[0] == 1:
                raise RuntimeError("network")
            stop.set()
            return 0

        monkeypatch.setattr(deletion, "report_stuck", flaky)
        await asyncio.wait_for(worker.report_stuck(r.runtime, stop, interval=0.01), 5)
        assert calls[0] == 2

    live(mongo_uri, test)


# ── the email lookup ───────────────────────────────────────────────────────────


def _service(caller: str) -> dict[str, str]:
    keys = {"users": ("u1", USERS_PRIVATE), "auth": ("a1", AUTH_PRIVATE)}
    kid, private = keys[caller]
    return {"Authorization": f"Bearer {ServiceTokenSigner(caller, kid, private).token_for('auth')}"}


@pytest.mark.live_service
def test_no_service_may_read_emails_yet(mongo_uri, monkeypatch):
    async def test(r: Running) -> None:
        jane = await _signed_up(r)
        path = f"/internal/auth/users/{jane['id']}/email?location={LOCATION}"
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.internal_app), base_url="http://a"
        ) as internal:
            assert (await internal.get(path, headers=_service("users"))).status_code == 403
            assert (await internal.get(path)).status_code == 401
            assert (
                await internal.get(path, headers={"Authorization": "Bearer junk"})
            ).status_code == 401
            # Once a service is on the list, it gets the email, and the read is audited.
            monkeypatch.setattr(main, "EMAIL_CALLERS", frozenset({"users"}))
            response = await internal.get(path, headers=_service("users"))
            assert response.json() == {"email": "jane@example.com"}
            await r.runtime.audit.flush()
            row = await r.db[AUDIT].find_one({"permission": "emails:read"})
            assert row is not None and (row["actor_id"], row["subject_id"]) == ("users", jane["id"])
            missing = f"/internal/auth/users/{uuid.uuid4()}/email?location={LOCATION}"
            assert (await internal.get(missing, headers=_service("users"))).status_code == 404
            no_location = f"/internal/auth/users/{jane['id']}/email"
            assert (await internal.get(no_location, headers=_service("users"))).status_code == 422

    live(mongo_uri, test)


# ── the participants setting ───────────────────────────────────────────────────


def test_deletion_participants_must_be_known_services():
    base = {
        "MONGODB_URI": "mongodb://x", "MONGODB_DB_NAME": "x", "JWT_PRIVATE_KEY": "x",
        "EMAIL_HMAC_PEPPER": "x" * 32,
    }  # fmt: skip
    every = AuthSettings.model_validate(base)
    assert every.participants == [
        "users", "children", "onboarding", "discover", "grow", "transform", "release",
    ]  # fmt: skip
    some = AuthSettings.model_validate({**base, "DELETION_PARTICIPANTS": " grow, users "})
    assert some.participants == ["users", "grow"]  # catalogue order, trimmed
    for bad in ("", "users,billing", " , "):
        with pytest.raises(ValueError):
            AuthSettings.model_validate({**base, "DELETION_PARTICIPANTS": bad})
