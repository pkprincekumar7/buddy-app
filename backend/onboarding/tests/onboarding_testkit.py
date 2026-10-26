"""Shared pieces of onboarding's tests (conftest.py exposes the fixtures).

onboarding's tests run against MONGODB_TEST_URI (a throwaway replica set), never MONGODB_URI.

    MONGODB_TEST_URI="mongodb://localhost:27017/?directConnection=true" pytest onboarding/tests

Without it the database tests skip; with REQUIRE_LIVE_SERVICES=1 a skip is a failure, as in
common/tests. `running` wires the service to a throwaway database, in-process Moto (with the
topology scripts/local-aws-setup.py creates) and a fake of children's internal API (the
read-through and confirm-before-deny calls), and records every audit event.
"""

from __future__ import annotations

import os
import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from urllib.parse import parse_qs

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
from common.models import CHILD_ACCESS, PROGRESS_FLAGS
from onboarding.app import main
from onboarding.app.runtime import OnboardingSettings, Runtime

MONGO_URI = os.environ.get("MONGODB_TEST_URI")

REGION = "ap-south-1"
LOCATION = "in"
KID = "k1"
PARENT = str(uuid.uuid4())
OTHER = str(uuid.uuid4())
ADMIN = str(uuid.uuid4())
ROLES = {PARENT: "parent", OTHER: "parent", ADMIN: "admin"}

ANSWERS: dict[str, Any] = {
    "strengths": ["curious", "kind"],
    "hobbies": ["drawing"],
    "thinking_pattern": "visual",
    "communication_style": "expressive",
    "energy_level": "high",
    "social_behaviour": "outgoing",
    "emotional_behaviour": "steady",
}


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
ONBOARDING_PRIVATE, ONBOARDING_PUBLIC = _ed()
DISCOVER_PRIVATE, DISCOVER_PUBLIC = _ed()
GROW_PRIVATE, GROW_PUBLIC = _ed()
CHILDREN_PRIVATE, CHILDREN_PUBLIC = _ed()
SERVICE_KEYS = {
    "onboarding": {"o1": ONBOARDING_PUBLIC},
    "discover": {"d1": DISCOVER_PUBLIC},
    "grow": {"g1": GROW_PUBLIC},
    "children": {"c1": CHILDREN_PUBLIC},
}
_SIGNERS = {
    "discover": ("d1", DISCOVER_PRIVATE),
    "grow": ("g1", GROW_PRIVATE),
    "children": ("c1", CHILDREN_PRIVATE),
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


def service_header(caller: str = "discover") -> dict[str, str]:
    kid, private = _SIGNERS[caller]
    signed = ServiceTokenSigner(caller, kid, private).token_for("onboarding")
    return {"Authorization": f"Bearer {signed}"}


async def _fill(user_id: str) -> AuthzEntry | None:
    role = ROLES.get(user_id)
    return None if role is None else AuthzEntry(ver=1, role=role, locked=False, deleting=False)


def authz_config() -> AuthzConfig:
    return AuthzConfig(
        public_keys={KID: JWT_PUBLIC}, issuer="superpower-local", audience="superpower-api"
    )


def settings(db_name: str, mongo_uri: str, **extra: str) -> OnboardingSettings:
    return OnboardingSettings.model_validate(
        {"MONGODB_URI": mongo_uri, "MONGODB_DB_NAME": db_name, "AWS_REGION": REGION, **extra}
    )


# ── children's internal API, faked ─────────────────────────────────────────────


def progress(**done: bool) -> dict[str, bool]:
    return {flag: bool(done.get(flag)) for flag in PROGRESS_FLAGS}


@dataclass
class FakeChildren:
    """`GET /internal/children/{id}` as children answers it; `mode` breaks it on purpose."""

    children: dict[str, dict[str, Any]] = field(default_factory=dict)
    calls: list[str] = field(default_factory=list)
    mode: str = "ok"  # "down" (can't connect) or "error" (a 500)

    def add(
        self,
        child_id: str | None = None,
        *,
        user_id: str = PARENT,
        profile: bool = True,
        version: int = 1,
        **fields: Any,
    ) -> str:
        child_id = child_id or str(uuid.uuid4())
        self.children[child_id] = {
            "child_id": child_id,
            "user_id": user_id,
            "location": LOCATION,
            "name": "Aarav",
            "age": 9,
            "gender": "boy",
            "is_deleted": False,
            "progress": progress(profile=profile),
            "version": version,
            **fields,
        }
        return child_id

    def handle(self, request: httpx.Request) -> httpx.Response:
        if self.mode == "down":
            raise httpx.ConnectError("connection refused", request=request)
        if self.mode == "error":
            return httpx.Response(500)
        child_id = request.url.path.removeprefix("/internal/children/")
        self.calls.append(child_id)
        location = parse_qs(request.url.query.decode())["location"][0]
        child = self.children.get(child_id)
        if child is None or child["location"] != location:
            return httpx.Response(404, json={"detail": "Not Found"})
        return httpx.Response(200, json=child)


async def _resolve(host: str, port: int) -> list[str]:
    return ["10.0.0.1"]


# ── the running service ────────────────────────────────────────────────────────


@dataclass
class Running:
    runtime: Runtime
    http: httpx.AsyncClient  # the public app
    internal: httpx.AsyncClient  # the internal app
    layout: dict[str, Any]
    children: FakeChildren
    audit: list[AuditEvent] = field(default_factory=list)

    @property
    def db(self) -> Any:
        return self.runtime.db

    async def copy(self, child_id: str, **fields: Any) -> None:
        """A `child_access` row, as `child.changed` leaves it."""
        doc = {
            "_id": child_id,
            "location": LOCATION,
            "user_id": PARENT,
            "name": "Aarav",
            "age": 9,
            "gender": "boy",
            "is_deleted": False,
            "progress": progress(profile=True),
            "version": 1,
            "updated_at": datetime.now(UTC),
            "schema_version": 1,
            **fields,
        }
        await self.db[CHILD_ACCESS].insert_one(doc)


@asynccontextmanager
async def running(mongo_uri: str) -> AsyncIterator[Running]:
    with mock_aws():
        aws = {"region_name": REGION, "aws_access_key_id": "t", "aws_secret_access_key": "t"}
        sns, sqs = boto3.client("sns", **aws), boto3.client("sqs", **aws)
        db_name = f"onboarding_test_{uuid.uuid4().hex[:10]}"
        layout = topology.apply_local(sns, sqs, settings(db_name, mongo_uri).events_prefix)
        configured = settings(
            db_name,
            mongo_uri,
            EVENTS_TOPIC_ARN=layout["topics"]["onboarding"],
            EVENTS_QUEUE_URL=layout["queues"]["onboarding"],
        )
        audit: list[AuditEvent] = []
        children = FakeChildren()
        client: AsyncMongoClient[dict[str, Any]] = AsyncMongoClient(mongo_uri, tz_aware=True)
        runtime = Runtime(
            settings=configured,
            client=client,
            authorizer=Authorizer(
                authz_config(), cache=None, fill=_fill, audit=AuditLog(sinks=[audit.append])
            ),
            verifier=ServiceTokenVerifier("onboarding", SERVICE_KEYS),
            internal=InternalClient(
                ServiceTokenSigner("onboarding", "o1", ONBOARDING_PRIVATE),
                resolver=_resolve,
                transport=httpx.MockTransport(children.handle),
            ),
            limits=RateLimits(None, prefix="onboarding"),
            sns=sns,
            sqs=sqs,
        )
        await runtime.prepare()  # as the lifespan does
        await runtime.prepare()  # safe to repeat
        main.configure(runtime)
        http = httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://o")
        internal = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.internal_app), base_url="http://o"
        )
        try:
            yield Running(runtime, http, internal, layout, children, audit)
        finally:
            await http.aclose()
            await internal.aclose()
            await client.drop_database(db_name)
            await runtime.aclose()
            main.configure(None)
