"""Shared pieces of users' tests (conftest.py exposes the fixtures).

users' tests run against MONGODB_TEST_URI (a throwaway replica set), never MONGODB_URI.

    MONGODB_TEST_URI="mongodb://localhost:27017/?directConnection=true" pytest users/tests

Without it the database tests skip; with REQUIRE_LIVE_SERVICES=1 a skip is a failure, as in
common/tests. `running` wires the service to a throwaway database and in-process Moto (with
the topology scripts/local-aws-setup.py creates), and records every audit event.
"""

from __future__ import annotations

import os
import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any

import boto3
import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ed25519, rsa
from moto import mock_aws
from pymongo import AsyncMongoClient

from common.audit import AuditEvent, AuditLog
from common.authz import Authorizer, AuthzConfig, AuthzEntry
from common.events import topology
from common.internal_client import InternalClient, ServiceTokenSigner, ServiceTokenVerifier
from common.limiter import RateLimits
from users.app import main
from users.app.runtime import Runtime, UsersSettings

MONGO_URI = os.environ.get("MONGODB_TEST_URI")

REGION = "ap-south-1"
LOCATION = "in"
KID = "k1"
PARENT = str(uuid.uuid4())
OTHER = str(uuid.uuid4())
ADMIN = str(uuid.uuid4())
ROLES = {PARENT: "parent", OTHER: "parent", ADMIN: "admin"}


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    report = outcome.get_result()
    if (
        report.skipped
        and not hasattr(report, "wasxfail")
        and os.environ.get("REQUIRE_LIVE_SERVICES") == "1"
        and item.get_closest_marker("live_service")
    ):
        reason = report.longrepr[-1] if isinstance(report.longrepr, tuple) else report.longrepr
        report.outcome = "failed"
        report.longrepr = f"live service required (REQUIRE_LIVE_SERVICES=1) but skipped: {reason}"


@pytest.fixture
def mongo_uri() -> str:
    if not MONGO_URI:
        pytest.skip("MONGODB_TEST_URI not set (a throwaway replica set, e.g. docker compose mongo)")
    return MONGO_URI


@pytest.fixture
def fake_aws_credentials(monkeypatch, tmp_path):
    """Never let a test pick up this machine's real AWS profile."""
    for name in ("AWS_PROFILE", "AWS_DEFAULT_PROFILE", "AWS_SESSION_TOKEN"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("AWS_CONFIG_FILE", str(tmp_path / "config"))
    monkeypatch.setenv("AWS_SHARED_CREDENTIALS_FILE", str(tmp_path / "credentials"))
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "t")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "t")


# ── keys and tokens (generated per run, never real) ────────────────────────────


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
USERS_PRIVATE, USERS_PUBLIC = _ed()
AUTH_PRIVATE, AUTH_PUBLIC = _ed()
GROW_PRIVATE, GROW_PUBLIC = _ed()
SERVICE_KEYS = {
    "users": {"u1": USERS_PUBLIC},
    "auth": {"a1": AUTH_PUBLIC},
    "grow": {"g1": GROW_PUBLIC},
}


def token(sub: str = PARENT, location: str = LOCATION) -> str:
    now = int(time.time())
    claims = {
        "sub": sub,
        "iat": now,
        "iat_ms": now * 1000,
        "exp": now + 600,
        "type": "access",
        "location": location,
        "iss": "superpower-local",
        "aud": "superpower-api",
    }
    return jwt.encode(claims, JWT_PRIVATE, algorithm="RS256", headers={"kid": KID})


def auth_header(sub: str = PARENT, location: str = LOCATION) -> dict[str, str]:
    return {"Authorization": f"Bearer {token(sub, location)}"}


def service_header(caller: str = "auth") -> dict[str, str]:
    keys = {"auth": ("a1", AUTH_PRIVATE), "grow": ("g1", GROW_PRIVATE)}
    kid, private = keys[caller]
    return {
        "Authorization": f"Bearer {ServiceTokenSigner(caller, kid, private).token_for('users')}"
    }


async def _fill(user_id: str) -> AuthzEntry | None:
    role = ROLES.get(user_id)
    return None if role is None else AuthzEntry(ver=1, role=role, locked=False, deleting=False)


def authz_config() -> AuthzConfig:
    return AuthzConfig(
        public_keys={KID: JWT_PUBLIC}, issuer="superpower-local", audience="superpower-api"
    )


def settings(db_name: str, mongo_uri: str, **extra: str) -> UsersSettings:
    return UsersSettings.model_validate(
        {"MONGODB_URI": mongo_uri, "MONGODB_DB_NAME": db_name, "AWS_REGION": REGION, **extra}
    )


# ── the running service ────────────────────────────────────────────────────────


@dataclass
class Running:
    runtime: Runtime
    http: httpx.AsyncClient  # the public app
    internal: httpx.AsyncClient  # the internal app
    layout: dict[str, Any]
    audit: list[AuditEvent] = field(default_factory=list)


@asynccontextmanager
async def running(mongo_uri: str) -> AsyncIterator[Running]:
    with mock_aws():
        aws = {"region_name": REGION, "aws_access_key_id": "t", "aws_secret_access_key": "t"}
        sns, sqs = boto3.client("sns", **aws), boto3.client("sqs", **aws)
        db_name = f"users_test_{uuid.uuid4().hex[:10]}"
        layout = topology.apply_local(sns, sqs, settings(db_name, mongo_uri).events_prefix)
        configured = settings(
            db_name,
            mongo_uri,
            EVENTS_TOPIC_ARN=layout["topics"]["users"],
            EVENTS_QUEUE_URL=layout["queues"]["users"],
        )
        audit: list[AuditEvent] = []
        client: AsyncMongoClient[dict[str, Any]] = AsyncMongoClient(mongo_uri, tz_aware=True)
        runtime = Runtime(
            settings=configured,
            client=client,
            authorizer=Authorizer(
                authz_config(), cache=None, fill=_fill, audit=AuditLog(sinks=[audit.append])
            ),
            verifier=ServiceTokenVerifier("users", SERVICE_KEYS),
            internal=InternalClient(ServiceTokenSigner("users", "u1", USERS_PRIVATE)),
            limits=RateLimits(None, prefix="users"),
            sns=sns,
            sqs=sqs,
        )
        await runtime.prepare()  # as the lifespan does
        await runtime.prepare()  # safe to repeat
        main.configure(runtime)
        http = httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://u")
        internal = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.internal_app), base_url="http://u"
        )
        try:
            yield Running(runtime, http, internal, layout, audit)
        finally:
            await http.aclose()
            await internal.aclose()
            await client.drop_database(db_name)
            await runtime.aclose()
            main.configure(None)


async def create_profile(
    r: Running, user_id: str = PARENT, location: str = LOCATION, **fields: Any
) -> httpx.Response:
    """What auth does at registration: PUT /internal/users/{id}."""
    body = {"first_name": "Jane", "last_name": "Doe", "location": location, **fields}
    return await r.internal.put(f"/internal/users/{user_id}", json=body, headers=service_header())
