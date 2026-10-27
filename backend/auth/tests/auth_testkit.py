"""Shared pieces of auth's tests (conftest.py exposes the fixtures).

auth's tests run against MONGODB_TEST_URI (a throwaway replica set), never MONGODB_URI, and
the authz-cache tests against REDIS_URL (the local stand-in). Without them those tests
skip; with REQUIRE_LIVE_SERVICES=1 a skip is a failure, as in common/tests.

`running` wires auth to a throwaway database with a fake users service (an httpx mock
transport behind the real InternalClient), a fake Google verifier, and per-task limits.
Every key and pepper is generated per run.
"""

from __future__ import annotations

import contextlib
import json
import os
import secrets
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import boto3
import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ed25519, rsa
from moto import mock_aws
from pymongo import AsyncMongoClient

from auth.app import main
from auth.app.runtime import AuthSettings, Runtime
from auth.app.store import ALLOWED_EMAILS
from auth.app.throttle import LoginThrottle
from auth.app.tokens import TokenIssuer
from auth.emails import Peppers, mask, normalise
from common.authz import AuthzConfig
from common.events import topology
from common.internal_client import InternalClient, ServiceTokenSigner, ServiceTokenVerifier
from common.limiter import RateLimits

MONGO_URI = os.environ.get("MONGODB_TEST_URI")
REDIS_URL = os.environ.get("REDIS_URL")

KID = "k1"
ISSUER, AUDIENCE = "superpower-local", "superpower-api"
EMAIL = "Jane.Doe@Example.com"
PASSWORD = "s3cure-pass"
COUNTRY = "IN"
LOCATION = "in"


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
    monkeypatch.setenv("AWS_CONFIG_FILE", str(tmp_path / "aws-config"))
    monkeypatch.setenv("AWS_SHARED_CREDENTIALS_FILE", str(tmp_path / "aws-credentials"))
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "t")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "t")


@pytest.fixture
def redis_url() -> str:
    if not REDIS_URL:
        pytest.skip("REDIS_URL not set (the local Valkey stand-in, e.g. docker compose valkey)")
    return REDIS_URL


# ── keys (generated per run, never real) ───────────────────────────────────────


def _rsa() -> tuple[str, str]:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private = key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    ).decode()
    public = key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    return private, public.decode()


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
OTHER_PRIVATE, OTHER_PUBLIC = _rsa()
AUTH_PRIVATE, AUTH_PUBLIC = _ed()
USERS_PRIVATE, USERS_PUBLIC = _ed()
# Who may call auth's internal API in tests: users (allowed) and auth itself (refused).
SERVICE_KEYS = {"users": {"u1": USERS_PUBLIC}, "auth": {"a1": AUTH_PUBLIC}}
PEPPER = secrets.token_hex(32)
OLD_PEPPER = secrets.token_hex(32)


def authz_config() -> AuthzConfig:
    return AuthzConfig(public_keys={KID: JWT_PUBLIC}, issuer=ISSUER, audience=AUDIENCE)


def issuer() -> TokenIssuer:
    return TokenIssuer(JWT_PRIVATE, KID, issuer=ISSUER, audience=AUDIENCE)


def settings(db_name: str, mongo_uri: str, **extra: str) -> AuthSettings:
    return AuthSettings.model_validate(
        {
            "MONGODB_URI": mongo_uri,
            "MONGODB_DB_NAME": db_name,
            "JWT_PRIVATE_KEY": JWT_PRIVATE,
            "EMAIL_HMAC_PEPPER": PEPPER,
            "GOOGLE_CLIENT_ID": "test-client",
            "COOKIE_SECURE": "false",
            **extra,
        }
    )


# ── the fake users service ─────────────────────────────────────────────────────


@dataclass
class FakeUsers:
    """users' internal API as auth sees it. Set `put_status` / `delete_status` to an int
    to answer with it, or to "down" to refuse the connection."""

    put_status: int | str = 201
    delete_status: int | str = 204
    profiles: dict[str, dict[str, Any]] = field(default_factory=dict)
    calls: list[tuple[str, str, Any]] = field(default_factory=list)

    def handle(self, request: httpx.Request) -> httpx.Response:
        user_id = request.url.path.rsplit("/", 1)[-1]
        body = json.loads(request.content) if request.content else None
        self.calls.append((request.method, request.url.path, body))
        status = self.put_status if request.method == "PUT" else self.delete_status
        if status == "down":
            raise httpx.ConnectError("users is down", request=request)
        assert isinstance(status, int)
        if status < 300:
            if request.method == "PUT":
                self.profiles[user_id] = body or {}
            else:
                self.profiles.pop(user_id, None)
        return httpx.Response(status, json={} if status != 204 else None)

    def deleted(self) -> list[str]:
        return [path.rsplit("/", 1)[-1] for method, path, _ in self.calls if method == "DELETE"]


# ── a fake Google ──────────────────────────────────────────────────────────────

GOOGLE_TOKENS: dict[str, dict[str, Any]] = {}


async def fake_google(token: str, client_id: str) -> dict[str, Any]:
    assert client_id == "test-client"
    if token not in GOOGLE_TOKENS:
        raise ValueError("invalid token")
    return GOOGLE_TOKENS[token]


def google_token(email: str = EMAIL, **claims: Any) -> str:
    token = f"google-{uuid.uuid4()}"
    GOOGLE_TOKENS[token] = {"email": email, "email_verified": True, **claims}
    return token


# ── the running service ────────────────────────────────────────────────────────


@dataclass
class Running:
    runtime: Runtime
    http: httpx.AsyncClient
    users: FakeUsers
    layout: dict[str, Any] = field(default_factory=dict)

    @property
    def db(self) -> Any:
        return self.runtime.db

    async def allow(self, email: str = EMAIL, version: int | None = None) -> None:
        """Put `email` on the allow-list, as an admin would (5.2)."""
        await self.db[ALLOWED_EMAILS].insert_one(
            {
                "_id": self.runtime.peppers.key(email, version),
                "key_version": version or self.runtime.peppers.current,
                "email_hint": mask(email),
                "added_by": str(uuid.uuid4()),
                "created_at": datetime.now(UTC),
            }
        )

    async def register(
        self, email: str = EMAIL, ip: str = "203.0.113.1", **fields: Any
    ) -> httpx.Response:
        body = {
            "email": email,
            "password": PASSWORD,
            "first_name": "Jane",
            "last_name": "Doe",
            "country_code": COUNTRY,
            **fields,
        }
        return await self.http.post("/api/v1/auth/register", json=body, headers=viewer(ip))

    async def login(
        self, email: str = EMAIL, password: str = PASSWORD, ip: str = "203.0.113.1"
    ) -> httpx.Response:
        return await self.http.post(
            "/api/v1/auth/login", json={"email": email, "password": password}, headers=viewer(ip)
        )


def viewer(ip: str) -> dict[str, str]:
    """The client address CloudFront reports (the runtime's limits are behind_proxy)."""
    return {"CloudFront-Viewer-Address": f"{ip}:443"}


def claims(token: str) -> dict[str, Any]:
    return jwt.decode(token, JWT_PUBLIC, algorithms=["RS256"], audience=AUDIENCE, issuer=ISSUER)


@asynccontextmanager
async def running(
    mongo_uri: str,
    *,
    peppers: str = PEPPER,
    cache: Any = None,
    users: FakeUsers | None = None,
    aws: bool = False,
    participants: str = "users",
) -> AsyncIterator[Running]:
    """`aws`: in-process Moto with the local topology (r.layout), and the worker's topic
    and queue set. `participants`: who must confirm a deletion (DELETION_PARTICIPANTS)."""
    with contextlib.ExitStack() as stack:
        layout: dict[str, Any] = {}
        sns = sqs = None
        extra = {"DELETION_PARTICIPANTS": participants}
        if aws:
            stack.enter_context(mock_aws())
            credentials = {
                "region_name": "ap-south-1",
                "aws_access_key_id": "t",
                "aws_secret_access_key": "t",
            }
            sns, sqs = boto3.client("sns", **credentials), boto3.client("sqs", **credentials)
            layout = topology.apply_local(sns, sqs, "superpower-local")
            extra |= {
                "EVENTS_TOPIC_ARN": layout["topics"]["auth"],
                "EVENTS_QUEUE_URL": layout["queues"]["auth"],
            }
        async with _running(mongo_uri, peppers, cache, users, sns, sqs, layout, extra) as r:
            yield r


@asynccontextmanager
async def _running(
    mongo_uri: str,
    peppers: str,
    cache: Any,
    users: FakeUsers | None,
    sns: Any,
    sqs: Any,
    layout: dict[str, Any],
    extra: dict[str, str],
) -> AsyncIterator[Running]:
    db_name = f"auth_test_{uuid.uuid4().hex[:10]}"
    users = users or FakeUsers()

    async def resolve(host: str, port: int) -> list[str]:
        return ["10.0.0.7"]

    client: AsyncMongoClient[dict[str, Any]] = AsyncMongoClient(mongo_uri, tz_aware=True)
    runtime = Runtime(
        settings=settings(db_name, mongo_uri, EMAIL_HMAC_PEPPER=peppers, **extra),
        client=client,
        authz_config=authz_config(),
        issuer=issuer(),
        peppers=Peppers.parse(peppers),
        internal=InternalClient(
            ServiceTokenSigner("auth", "a1", AUTH_PRIVATE),
            resolver=resolve,
            transport=httpx.MockTransport(users.handle),
        ),
        verifier=ServiceTokenVerifier("auth", SERVICE_KEYS),
        limits=RateLimits(None, prefix="auth", behind_proxy=True),
        throttle=LoginThrottle(None),
        cache=cache,
        google=fake_google,
        sns=sns,
        sqs=sqs,
    )
    await runtime.prepare()
    await runtime.prepare()  # safe to repeat
    main.configure(runtime)
    http = httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://a")
    try:
        yield Running(runtime, http, users, layout)
    finally:
        await http.aclose()
        await runtime.audit.flush()  # rows still being written, before the database goes
        await client.drop_database(db_name)
        await runtime.aclose()
        main.configure(None)


def key(email: str = EMAIL, version: int | None = None) -> str:
    return Peppers.parse(PEPPER).key(normalise(email), version)
