"""Shared pieces of children's tests (conftest.py exposes the fixtures).

children's tests run against MONGODB_TEST_URI (a throwaway replica set), never MONGODB_URI.

    MONGODB_TEST_URI="mongodb://localhost:27017/?directConnection=true" pytest children/tests

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

from children.app import main
from children.app.runtime import ChildrenSettings, Runtime
from common.audit import AuditEvent, AuditLog
from common.authz import Authorizer, AuthzConfig, AuthzEntry
from common.events import topology
from common.internal_client import InternalClient, ServiceTokenSigner, ServiceTokenVerifier
from common.limiter import RateLimits
from common.uploads import Uploads, UploadsConfig

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
CHILDREN_PRIVATE, CHILDREN_PUBLIC = _ed()
ONBOARDING_PRIVATE, ONBOARDING_PUBLIC = _ed()
USERS_PRIVATE, USERS_PUBLIC = _ed()
SERVICE_KEYS = {
    "children": {"c1": CHILDREN_PUBLIC},
    "onboarding": {"o1": ONBOARDING_PUBLIC},
    "users": {"u1": USERS_PUBLIC},
}
BUCKET = "superpower-uploads-test"


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


def service_header(caller: str = "onboarding") -> dict[str, str]:
    keys = {"onboarding": ("o1", ONBOARDING_PRIVATE), "users": ("u1", USERS_PRIVATE)}
    kid, private = keys[caller]
    token = ServiceTokenSigner(caller, kid, private).token_for("children")
    return {"Authorization": f"Bearer {token}"}


async def _fill(user_id: str) -> AuthzEntry | None:
    role = ROLES.get(user_id)
    return None if role is None else AuthzEntry(ver=1, role=role, locked=False, deleting=False)


def authz_config() -> AuthzConfig:
    return AuthzConfig(
        public_keys={KID: JWT_PUBLIC}, issuer="superpower-local", audience="superpower-api"
    )


def settings(db_name: str, mongo_uri: str, **extra: str) -> ChildrenSettings:
    return ChildrenSettings.model_validate(
        {"MONGODB_URI": mongo_uri, "MONGODB_DB_NAME": db_name, "AWS_REGION": REGION, **extra}
    )


# ── release, faked (the Connect visit asks it) ─────────────────────────────────


@dataclass
class FakeRelease:
    """release's internal status: `completed` holds the children it says are done."""

    completed: set[str] = field(default_factory=set)
    down: bool = False
    status: int = 200
    calls: list[str] = field(default_factory=list)

    def handle(self, request: httpx.Request) -> httpx.Response:
        if self.down:
            raise httpx.ConnectError("connection refused", request=request)
        self.calls.append(f"{request.url.host} {request.url.path}?{request.url.query.decode()}")
        if self.status != 200:
            return httpx.Response(self.status)
        child_id = request.url.path.split("/")[-2]
        return httpx.Response(200, json={"completed": child_id in self.completed})


async def _resolve(host: str, port: int) -> list[str]:
    return [host]  # the fake answers by name


# ── the running service ────────────────────────────────────────────────────────


@dataclass
class Running:
    runtime: Runtime
    http: httpx.AsyncClient  # the public app
    internal: httpx.AsyncClient  # the internal app
    layout: dict[str, Any]
    audit: list[AuditEvent] = field(default_factory=list)
    release: FakeRelease = field(default_factory=FakeRelease)

    @property
    def db(self) -> Any:
        return self.runtime.db


@asynccontextmanager
async def running(mongo_uri: str, *, uploads: bool = True) -> AsyncIterator[Running]:
    with mock_aws():
        aws = {"region_name": REGION, "aws_access_key_id": "t", "aws_secret_access_key": "t"}
        sns, sqs = boto3.client("sns", **aws), boto3.client("sqs", **aws)
        s3 = boto3.client("s3", **aws)
        s3.create_bucket(Bucket=BUCKET, CreateBucketConfiguration={"LocationConstraint": REGION})
        db_name = f"children_test_{uuid.uuid4().hex[:10]}"
        layout = topology.apply_local(sns, sqs, settings(db_name, mongo_uri).events_prefix)
        configured = settings(
            db_name,
            mongo_uri,
            EVENTS_TOPIC_ARN=layout["topics"]["children"],
            EVENTS_QUEUE_URL=layout["queues"]["children"],
        )
        audit: list[AuditEvent] = []
        release = FakeRelease()
        client: AsyncMongoClient[dict[str, Any]] = AsyncMongoClient(mongo_uri, tz_aware=True)
        runtime = Runtime(
            settings=configured,
            client=client,
            authorizer=Authorizer(
                authz_config(), cache=None, fill=_fill, audit=AuditLog(sinks=[audit.append])
            ),
            verifier=ServiceTokenVerifier("children", SERVICE_KEYS),
            internal=InternalClient(
                ServiceTokenSigner("children", "c1", CHILDREN_PRIVATE),
                resolver=_resolve,
                transport=httpx.MockTransport(release.handle),
            ),
            limits=RateLimits(None, prefix="children"),
            sns=sns,
            sqs=sqs,
            uploads=Uploads(UploadsConfig(bucket=BUCKET, region=REGION), client=s3)
            if uploads
            else None,
        )
        await runtime.prepare()  # as the lifespan does
        await runtime.prepare()  # safe to repeat
        main.configure(runtime)
        http = httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://u")
        internal = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.internal_app), base_url="http://u"
        )
        try:
            yield Running(runtime, http, internal, layout, audit, release)
        finally:
            await http.aclose()
            await internal.aclose()
            await client.drop_database(db_name)
            await runtime.aclose()
            main.configure(None)


async def add_child(r: Running, user_id: str = PARENT, **fields: Any) -> httpx.Response:
    body = {"name": "Aarav", **fields}
    return await r.http.post("/api/v1/children", json=body, headers=auth_header(user_id))
