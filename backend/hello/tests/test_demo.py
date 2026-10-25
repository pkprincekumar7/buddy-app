"""Gate 1: hello, built only on `common`, publishes and consumes an event, makes a signed
internal call and passes the route-policy test (build plan, Phase 1).

Runs against a real MongoDB replica set and in-process Moto, with the same topology
scripts/local-aws-setup.py creates.
"""

import asyncio
import json
import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import boto3
import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ed25519, rsa
from moto import mock_aws
from pymongo import AsyncMongoClient

from common.authz import Authorizer, AuthzConfig, AuthzEntry
from common.events import Event, Relay, SnsPublisher, topology
from common.events.testing import assert_consumer_contract, assert_replay_safe, sns_envelope
from common.internal_client import InternalClient, ServiceTokenSigner, ServiceTokenVerifier
from common.routers import assert_every_route_has_a_policy
from hello import worker
from hello.app import main
from hello.app.demo import PING_COPIES, PINGS, Demo, HelloSettings

USER = str(uuid.uuid4())
OTHER = str(uuid.uuid4())
REGION = "ap-south-1"
KID = "k1"


def _rsa() -> tuple[Any, str]:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public = key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    return key, public.decode()


def _ed() -> tuple[str, str]:
    key = ed25519.Ed25519PrivateKey.generate()
    private = key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    ).decode()
    public = key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    return private, public.decode()


JWT_PRIVATE, JWT_PUBLIC = _rsa()
HELLO_PRIVATE, HELLO_PUBLIC = _ed()
GROW_PRIVATE, GROW_PUBLIC = _ed()
SERVICE_KEYS = {"hello": {"h1": HELLO_PUBLIC}, "grow": {"g1": GROW_PUBLIC}}


def token(sub: str = USER) -> str:
    now = int(time.time())
    claims = {
        "sub": sub,
        "iat": now,
        "iat_ms": now * 1000,
        "exp": now + 600,
        "type": "access",
        "location": "in",
        "iss": "superpower-local",
        "aud": "superpower-api",
    }
    return jwt.encode(claims, JWT_PRIVATE, algorithm="RS256", headers={"kid": KID})


async def _fill(user_id: str) -> AuthzEntry | None:
    return AuthzEntry(ver=1, role="parent", locked=False, deleting=False)


def _settings(db_name: str, mongo_uri: str, **extra: str) -> HelloSettings:
    return HelloSettings.model_validate(
        {"MONGODB_URI": mongo_uri, "MONGODB_DB_NAME": db_name, "AWS_REGION": REGION, **extra}
    )


@asynccontextmanager
async def demo_running(
    mongo_uri: str,
) -> AsyncIterator[tuple[Demo, httpx.AsyncClient, dict[str, Any]]]:
    """hello wired to a throwaway database and Moto, plus an HTTP client for its public app."""
    with mock_aws():
        aws = {"region_name": REGION, "aws_access_key_id": "t", "aws_secret_access_key": "t"}
        sns, sqs = boto3.client("sns", **aws), boto3.client("sqs", **aws)
        db_name = f"hello_test_{uuid.uuid4().hex[:10]}"
        settings = _settings(db_name, mongo_uri)
        layout = topology.apply_local(sns, sqs, settings.events_prefix)
        settings = _settings(
            db_name,
            mongo_uri,
            EVENTS_TOPIC_ARN=layout["topics"]["hello"],
            EVENTS_QUEUE_URL=layout["queues"]["hello"],
        )

        async def resolve(host: str, port: int) -> list[str]:
            return ["10.0.0.7"]

        internal = InternalClient(
            ServiceTokenSigner("hello", "h1", HELLO_PRIVATE),
            resolver=resolve,
            transport=httpx.ASGITransport(app=main.internal_app),
        )
        client: AsyncMongoClient[dict[str, Any]] = AsyncMongoClient(mongo_uri, tz_aware=True)
        demo = Demo(
            settings=settings,
            client=client,
            authorizer=Authorizer(
                AuthzConfig(
                    public_keys={KID: JWT_PUBLIC},
                    issuer="superpower-local",
                    audience="superpower-api",
                ),
                cache=None,
                fill=_fill,
            ),
            verifier=ServiceTokenVerifier("hello", SERVICE_KEYS),
            internal=internal,
            sns=sns,
            sqs=sqs,
        )
        await demo.prepare()  # as the lifespan does
        await demo.prepare()  # safe to repeat
        main.configure(demo)
        http = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app), base_url="http://hello"
        )
        try:
            yield demo, http, layout
        finally:
            await http.aclose()
            await client.drop_database(db_name)
            await demo.aclose()
            main.configure(None)


def _auth(sub: str = USER) -> dict[str, str]:
    return {"Authorization": f"Bearer {token(sub)}"}


# ── the route-policy test ──────────────────────────────────────────────────────


def test_every_route_on_both_apps_declares_a_policy():
    assert_every_route_has_a_policy(main.app)
    assert_every_route_has_a_policy(main.internal_app)


def test_without_configuration_the_demo_answers_503():
    async def run() -> int:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app), base_url="http://h"
        ) as http:
            return (await http.post("/pings", json={"message": "hi"}, headers=_auth())).status_code

    assert asyncio.run(run()) == 503


# ── publish and consume an event ───────────────────────────────────────────────


@pytest.mark.live_service
def test_a_ping_is_published_and_consumed(mongo_uri):
    async def run() -> None:
        async with demo_running(mongo_uri) as (demo, http, layout):
            assert (await http.post("/pings", json={"message": "hi"})).status_code == 401
            response = await http.post("/pings", json={"message": "hello there"}, headers=_auth())
            assert response.status_code == 201
            ping_id = response.json()["id"]
            # The ping and its outbox row were written together.
            row = await demo.db.outbox.find_one({"aggregate_id": ping_id})
            assert (
                row is not None
                and row["event_type"] == "hello.pinged"
                and row["published_at"] is None
            )

            relay = Relay(demo.db, SnsPublisher(demo.sns, layout["topics"]["hello"]), region=REGION)
            assert await relay.publish_pending() == 1
            consumer = worker.build_consumer(demo)
            assert (
                await consumer.poll_once(demo.sqs, layout["queues"]["hello"], wait_seconds=0) == 1
            )
            copy = await demo.db[PING_COPIES].find_one({"_id": ping_id})
            assert copy is not None
            assert (copy["message"], copy["user_id"], copy["version"]) == ("hello there", USER, 1)

            # Every event hello subscribes to has a handler, and a redelivery changes nothing.
            assert_consumer_contract(consumer)
            event = Event.from_outbox(row)
            body = sns_envelope(event, layout["topics"]["hello"])

            async def handle() -> None:
                await consumer.handle_body(body)

            async def snapshot() -> Any:
                return await demo.db[PING_COPIES].find_one({"_id": ping_id}, {"updated_at": 0})

            await assert_replay_safe(handle, snapshot)

    asyncio.run(run())


@pytest.mark.live_service
def test_the_worker_relays_and_consumes_until_stopped(mongo_uri):
    async def run() -> None:
        async with demo_running(mongo_uri) as (demo, http, _):
            stop = asyncio.Event()
            task = asyncio.create_task(worker.run(demo, stop, wait_seconds=0))
            response = await http.post(
                "/pings", json={"message": "via the worker"}, headers=_auth()
            )
            ping_id = response.json()["id"]
            deadline = asyncio.get_running_loop().time() + 15
            while await demo.db[PING_COPIES].find_one({"_id": ping_id}) is None:
                assert asyncio.get_running_loop().time() < deadline, (
                    "the worker didn't consume the ping"
                )
                await asyncio.sleep(0.1)
            stop.set()
            await asyncio.wait_for(task, 10)

    asyncio.run(run())


def test_the_worker_needs_its_topic_and_queue():
    settings = HelloSettings.model_validate({"MONGODB_URI": "mongodb://x", "MONGODB_DB_NAME": "x"})
    demo = Demo(settings=settings, client=None, authorizer=None, verifier=None, internal=None)  # type: ignore[arg-type]
    with pytest.raises(RuntimeError, match="EVENTS_TOPIC_ARN"):
        asyncio.run(worker.run(demo, asyncio.Event()))


# ── a signed internal call ─────────────────────────────────────────────────────


@pytest.mark.live_service
def test_a_ping_is_read_back_through_a_signed_internal_call(mongo_uri):
    async def run() -> None:
        async with demo_running(mongo_uri) as (demo, http, _):
            created = (
                await http.post("/pings", json={"message": "round trip"}, headers=_auth())
            ).json()
            response = await http.get(f"/pings/{created['id']}/via-internal", headers=_auth())
            assert response.status_code == 200
            assert response.json()["message"] == "round trip"
            # Another user's ping is a 404, as is one that doesn't exist.
            assert (
                await http.get(f"/pings/{created['id']}/via-internal", headers=_auth(OTHER))
            ).status_code == 404
            assert (
                await http.get(f"/pings/{uuid.uuid4()}/via-internal", headers=_auth())
            ).status_code == 404

            internal = httpx.AsyncClient(
                transport=httpx.ASGITransport(app=main.internal_app), base_url="http://hello"
            )
            path = f"/internal/pings/{created['id']}"
            grow = ServiceTokenSigner("grow", "g1", GROW_PRIVATE).token_for("hello")
            assert (
                await internal.get(path, headers={"Authorization": f"Bearer {grow}"})
            ).status_code == 403
            assert (await internal.get(path)).status_code == 401
            assert (await internal.get("/internal/ping")).json()["status"] == "ok"
            await internal.aclose()

    asyncio.run(run())


@pytest.mark.live_service
def test_an_internal_server_error_is_raised(mongo_uri, monkeypatch):
    async def run() -> None:
        async with demo_running(mongo_uri) as (demo, http, _):
            created = (await http.post("/pings", json={"message": "x"}, headers=_auth())).json()

            async def broken(*args: Any, **kwargs: Any) -> httpx.Response:
                return httpx.Response(
                    500, request=httpx.Request("GET", "http://hello/internal/pings/x")
                )

            monkeypatch.setattr(demo.internal, "get", broken)
            with pytest.raises(httpx.HTTPStatusError):
                await http.get(f"/pings/{created['id']}/via-internal", headers=_auth())

    asyncio.run(run())


# ── configuration from the environment ────────────────────────────────────────


def _env(mongo_uri: str) -> dict[str, str]:
    return {
        "MONGODB_URI": mongo_uri,
        "MONGODB_DB_NAME": f"hello_env_{uuid.uuid4().hex[:8]}",
        "JWT_PUBLIC_KEYS": json.dumps({KID: JWT_PUBLIC}),
        "INTERNAL_SIGNING_KID": "h1",
        "INTERNAL_SIGNING_KEY": HELLO_PRIVATE,
        "INTERNAL_PUBLIC_KEYS": json.dumps(SERVICE_KEYS),
        "REDIS_URL": "redis://localhost:6379",
        "AWS_ENDPOINT_URL": "http://localhost:5050",
        "AWS_ACCESS_KEY_ID": "t",
        "AWS_SECRET_ACCESS_KEY": "t",
    }


@pytest.fixture
def fake_aws_credentials(monkeypatch, tmp_path):
    """Never let a test pick up this machine's real AWS profile."""
    for name in ("AWS_PROFILE", "AWS_DEFAULT_PROFILE", "AWS_SESSION_TOKEN"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("AWS_CONFIG_FILE", str(tmp_path / "config"))
    monkeypatch.setenv("AWS_SHARED_CREDENTIALS_FILE", str(tmp_path / "credentials"))
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "t")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "t")


def test_from_env_builds_every_part(fake_aws_credentials, monkeypatch):
    # Settings also read the process environment (CI sets REDIS_URL): clear what's tested.
    for name in ("REDIS_URL", "AWS_ENDPOINT_URL"):
        monkeypatch.delenv(name, raising=False)
    demo = Demo.from_env(_env("mongodb://localhost:27017/?directConnection=true"))
    assert demo.settings.service_name == "hello" and demo.cache is not None
    assert demo.sns.meta.endpoint_url == "http://localhost:5050"
    asyncio.run(demo.aclose())
    plain = Demo.from_env(
        {k: v for k, v in _env("mongodb://x").items() if k not in ("REDIS_URL", "AWS_ENDPOINT_URL")}
    )
    assert plain.cache is None
    asyncio.run(plain.aclose())


@pytest.mark.live_service
def test_the_lifespan_shares_one_demo_and_closes_it(monkeypatch, fake_aws_credentials, mongo_uri):
    env = _env(mongo_uri)
    for key, value in env.items():
        monkeypatch.setenv(key, value)

    async def run() -> None:
        async with main.app.router.lifespan_context(main.app):
            async with main.internal_app.router.lifespan_context(main.internal_app):
                demo = main.app.state.demo
                assert demo is not None and main.internal_app.state.demo is demo
            assert main.app.state.demo is demo  # still open for the public app
        assert main.app.state.demo is None
        # The lifespan prepared the collections before serving; drop the test database.
        client: AsyncMongoClient[dict[str, Any]] = AsyncMongoClient(mongo_uri)
        assert {"outbox", PINGS, PING_COPIES} <= set(
            await client[env["MONGODB_DB_NAME"]].list_collection_names()
        )
        await client.drop_database(env["MONGODB_DB_NAME"])
        await client.close()

    asyncio.run(run())
    monkeypatch.delenv("MONGODB_URI")

    async def unconfigured() -> None:
        async with main.app.router.lifespan_context(main.app):
            assert main.app.state.demo is None

    asyncio.run(unconfigured())
