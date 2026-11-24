"""users' worker and runtime: account deletion on `user.deletion_requested` (10.3), the
event contract and replay tests (7.4, 7.8), the relay, and configuration from the
environment."""

import asyncio
import json
import uuid
from typing import Any

import pytest
from pymongo import AsyncMongoClient
from users_testkit import (
    AUTH_PUBLIC,
    JWT_PUBLIC,
    KID,
    LOCATION,
    OTHER,
    PARENT,
    REGION,
    USERS_PRIVATE,
    Running,
    auth_header,
    create_profile,
    running,
    settings,
)

from common.events import Event, Relay, SnsPublisher
from common.events.testing import (
    assert_consumer_contract,
    assert_replay_safe,
    seed_user_outbox,
    seeded_outbox_left,
    sns_envelope,
)
from users import worker
from users.app import main
from users.app.runtime import Runtime
from users.app.store import USERS


def deletion_requested(user_id: str = PARENT, version: int = 4) -> Event:
    """What auth publishes when an account is deleted (version = its authz_version)."""
    return Event.new(
        "user.deletion_requested",
        producer="auth",
        aggregate_id=user_id,
        location=LOCATION,
        version=version,
        region=REGION,
    )


async def snapshot(r: Running, user_id: str = PARENT) -> Any:
    profile = await r.runtime.db[USERS].find_one({"_id": user_id})
    tombstone = await r.runtime.db.tombstones.find_one(
        {"_id": f"user:{user_id}"}, {"deleted_at": 0}
    )
    return profile, tombstone


@pytest.mark.live_service
def test_a_deletion_removes_the_profile_and_confirms(mongo_uri):
    async def run() -> None:
        async with running(mongo_uri) as r:
            await create_profile(r)
            await create_profile(r, OTHER)
            await seed_user_outbox(r.runtime.db, user_id=PARENT, child_id=None, other_user_id=OTHER)
            consumer = worker.build_consumer(r.runtime)
            body = sns_envelope(deletion_requested(), r.layout["topics"]["auth"])
            assert (await consumer.handle_body(body)).value == "handled"

            assert await r.runtime.db[USERS].find_one({"_id": PARENT}) is None
            assert await r.runtime.db[USERS].find_one({"_id": OTHER}) is not None
            tombstone = await r.runtime.db.tombstones.find_one({"_id": f"user:{PARENT}"})
            assert tombstone is not None
            assert (tombstone["location"], tombstone["version"]) == (LOCATION, 4)
            assert await seeded_outbox_left(r.runtime.db) == {"other"}
            rows = await r.runtime.db.outbox.find(
                {"_id": {"$not": {"$regex": "^seeded-"}}}
            ).to_list(None)
            assert [(x["event_type"], x["aggregate_id"], x["version"]) for x in rows] == [
                ("user.data_deleted", PARENT, 4)
            ]
            assert rows[0]["region"] == REGION and rows[0]["published_at"] is None
            # The account can't be signed into any more, and the profile can't come back.
            assert (await create_profile(r)).status_code == 409
            assert (
                await r.http.get("/api/v1/users/me/profile", headers=auth_header())
            ).status_code == 404

    asyncio.run(run())


@pytest.mark.live_service
def test_a_deletion_with_no_profile_still_confirms(mongo_uri):
    # A registration that failed half-way: auth would otherwise wait for users forever.
    async def run() -> None:
        async with running(mongo_uri) as r:
            consumer = worker.build_consumer(r.runtime)
            body = sns_envelope(deletion_requested(), r.layout["topics"]["auth"])
            await consumer.handle_body(body)
            assert (
                await r.runtime.db.outbox.count_documents({"event_type": "user.data_deleted"}) == 1
            )

    asyncio.run(run())


@pytest.mark.live_service
def test_the_handler_is_safe_to_run_twice_and_the_contract_holds(mongo_uri):
    async def run() -> None:
        async with running(mongo_uri) as r:
            await create_profile(r)
            consumer = worker.build_consumer(r.runtime)
            # Every event users subscribes to has a handler (7.8).
            assert_consumer_contract(consumer)
            body = sns_envelope(deletion_requested(), r.layout["topics"]["auth"])

            async def handle() -> None:
                await consumer.handle_body(body)

            async def state() -> Any:
                return await snapshot(r)

            await assert_replay_safe(handle, state)

    asyncio.run(run())


@pytest.mark.live_service
def test_a_deletion_request_from_another_topic_is_rejected(mongo_uri):
    # Only auth produces user.deletion_requested: the same event on grow's topic is a
    # forgery, left for the DLQ (7.2).
    async def run() -> None:
        async with running(mongo_uri) as r:
            await create_profile(r)
            consumer = worker.build_consumer(r.runtime)
            forged = sns_envelope(deletion_requested(), r.layout["topics"]["grow"])
            assert (await consumer.handle_body(forged)).value == "rejected"
            assert await r.runtime.db[USERS].find_one({"_id": PARENT}) is not None

    asyncio.run(run())


@pytest.mark.live_service
def test_the_worker_consumes_from_sqs_and_relays_the_confirmation(mongo_uri):
    async def run() -> None:
        async with running(mongo_uri) as r:
            await create_profile(r)
            # auth's relay publishes the request; SNS delivers it to users' queue.
            await SnsPublisher(r.runtime.sns, r.layout["topics"]["auth"]).publish(
                deletion_requested()
            )
            stop = asyncio.Event()
            task = asyncio.create_task(worker.run(r.runtime, stop, wait_seconds=0))
            loop = asyncio.get_running_loop()
            deadline = loop.time() + 15
            while await r.runtime.db.outbox.find_one({"published_at": {"$ne": None}}) is None:
                assert loop.time() < deadline, "the worker didn't delete and confirm"
                await asyncio.sleep(0.1)
            stop.set()
            await asyncio.wait_for(task, 10)
            assert await r.runtime.db[USERS].find_one({"_id": PARENT}) is None
            # The confirmation reached auth's queue, from users' topic.
            messages = r.runtime.sqs.receive_message(
                QueueUrl=r.layout["queues"]["auth"], WaitTimeSeconds=0
            ).get("Messages", [])
            envelopes = [json.loads(m["Body"]) for m in messages]
            assert [(e["TopicArn"], json.loads(e["Message"])["event_type"]) for e in envelopes] == [
                (r.layout["topics"]["users"], "user.data_deleted")
            ]

    asyncio.run(run())


@pytest.mark.live_service
def test_the_relay_publishes_only_this_regions_rows(mongo_uri):
    async def run() -> None:
        async with running(mongo_uri) as r:
            consumer = worker.build_consumer(r.runtime)
            await consumer.handle_body(
                sns_envelope(deletion_requested(), r.layout["topics"]["auth"])
            )
            other = Relay(
                r.runtime.db,
                SnsPublisher(r.runtime.sns, r.layout["topics"]["users"]),
                region="eu-west-1",
            )
            assert await other.publish_pending() == 0
            mine = Relay(
                r.runtime.db,
                SnsPublisher(r.runtime.sns, r.layout["topics"]["users"]),
                region=REGION,
            )
            assert await mine.publish_pending() == 1

    asyncio.run(run())


def test_the_worker_needs_its_topic_and_queue():
    runtime = Runtime(
        settings=settings("x", "mongodb://x"),
        client=None,  # type: ignore[arg-type]
        authorizer=None,  # type: ignore[arg-type]
        verifier=None,  # type: ignore[arg-type]
        internal=None,  # type: ignore[arg-type]
        limits=None,  # type: ignore[arg-type]
    )
    with pytest.raises(RuntimeError, match="EVENTS_TOPIC_ARN"):
        asyncio.run(worker.run(runtime, asyncio.Event()))


# ── configuration from the environment ────────────────────────────────────────


def _env(mongo_uri: str) -> dict[str, str]:
    return {
        "MONGODB_URI": mongo_uri,
        "MONGODB_DB_NAME": f"users_env_{uuid.uuid4().hex[:8]}",
        "JWT_PUBLIC_KEYS": json.dumps({KID: JWT_PUBLIC}),
        "INTERNAL_SIGNING_KID": "u1",
        "INTERNAL_SIGNING_KEY": USERS_PRIVATE,
        "INTERNAL_PUBLIC_KEYS": json.dumps({"auth": {"a1": AUTH_PUBLIC}}),
        "REDIS_URL": "redis://localhost:6379",
        "AWS_ENDPOINT_URL": "http://localhost:5050",
        "AWS_ACCESS_KEY_ID": "t",
        "AWS_SECRET_ACCESS_KEY": "t",
    }


def test_from_env_builds_every_part(fake_aws_credentials, monkeypatch):
    # Settings also read the process environment (CI sets REDIS_URL): clear what's tested.
    for name in ("REDIS_URL", "AWS_ENDPOINT_URL"):
        monkeypatch.delenv(name, raising=False)
    runtime = Runtime.from_env(_env("mongodb://localhost:27017/?directConnection=true"))
    assert runtime.settings.service_name == "users" and runtime.cache is not None
    assert runtime.sns.meta.endpoint_url == "http://localhost:5050"
    assert runtime.limits.prefix == "users"
    asyncio.run(runtime.aclose())
    plain = Runtime.from_env(
        {k: v for k, v in _env("mongodb://x").items() if k not in ("REDIS_URL", "AWS_ENDPOINT_URL")}
    )
    assert plain.cache is None
    asyncio.run(plain.aclose())


@pytest.mark.live_service
def test_the_lifespan_shares_one_runtime_and_closes_it(
    monkeypatch, fake_aws_credentials, mongo_uri
):
    env = _env(mongo_uri)
    for key, value in env.items():
        monkeypatch.setenv(key, value)

    async def run() -> None:
        async with main.app.router.lifespan_context(main.app):
            async with main.internal_app.router.lifespan_context(main.internal_app):
                runtime = main.app.state.runtime
                assert runtime is not None and main.internal_app.state.runtime is runtime
            assert main.app.state.runtime is runtime  # still open for the public app
        assert main.app.state.runtime is None
        # The lifespan prepared the collections before serving; drop the test database.
        client: AsyncMongoClient[dict[str, Any]] = AsyncMongoClient(mongo_uri)
        assert {"outbox", "tombstones", USERS} <= set(
            await client[env["MONGODB_DB_NAME"]].list_collection_names()
        )
        await client.drop_database(env["MONGODB_DB_NAME"])
        await client.close()

    asyncio.run(run())
    monkeypatch.delenv("MONGODB_URI")

    async def unconfigured() -> None:
        async with main.app.router.lifespan_context(main.app):
            assert main.app.state.runtime is None

    asyncio.run(unconfigured())
