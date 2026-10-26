"""Shared pieces of the shared service's tests (conftest.py exposes the fixtures).

The service has no database, so nothing here needs MONGODB_TEST_URI: `running` wires it to
an in-process Moto S3 (the assets bucket) and a fake OpenAI client, and signs tokens with
a key made per run.
"""

from __future__ import annotations

import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Any

import boto3
import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ed25519, rsa
from moto import mock_aws

from common.authz import Authorizer, AuthzConfig, AuthzEntry
from common.internal_client import InternalClient, ServiceTokenSigner
from common.limiter import RateLimits
from shared.app import main
from shared.app.runtime import _S3_CONFIG, ASSETS_REGION, Runtime, SharedSettings

KID = "k1"
PARENT = str(uuid.uuid4())
ADMIN = str(uuid.uuid4())
ROLES = {PARENT: "parent", ADMIN: "admin"}
BUCKET = "superpower-assets-test"


@pytest.fixture
def fake_aws_credentials(monkeypatch, tmp_path):
    """Never let a test pick up this machine's real AWS profile."""
    for name in ("AWS_PROFILE", "AWS_DEFAULT_PROFILE", "AWS_SESSION_TOKEN"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("AWS_CONFIG_FILE", str(tmp_path / "config"))
    monkeypatch.setenv("AWS_SHARED_CREDENTIALS_FILE", str(tmp_path / "credentials"))
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "t")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "t")


def _rsa() -> tuple[Any, str]:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public = key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    return key, public.decode()


JWT_PRIVATE, JWT_PUBLIC = _rsa()
SHARED_PRIVATE = (
    ed25519.Ed25519PrivateKey.generate()
    .private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    )
    .decode()
)


def auth_header(sub: str = PARENT) -> dict[str, str]:
    now = int(time.time())
    claims = {
        "sub": sub, "iat": now, "iat_ms": now * 1000, "exp": now + 600, "type": "access",
        "location": "in", "iss": "superpower-local", "aud": "superpower-api",
    }  # fmt: skip
    token = jwt.encode(claims, JWT_PRIVATE, algorithm="RS256", headers={"kid": KID})
    return {"Authorization": f"Bearer {token}"}


async def _fill(user_id: str) -> AuthzEntry | None:
    role = ROLES.get(user_id)
    return None if role is None else AuthzEntry(ver=1, role=role, locked=False, deleting=False)


@dataclass
class FakeOpenAI:
    """`audio.transcriptions.create`: records each call, answers `text` or raises `error`."""

    text: str = "He gets upset when his tower falls over"
    error: Exception | None = None
    calls: list[dict[str, Any]] = field(default_factory=list)
    closed: bool = False

    def __post_init__(self) -> None:
        self.audio = SimpleNamespace(transcriptions=SimpleNamespace(create=self._create))

    async def _create(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        if self.error is not None:
            raise self.error
        return SimpleNamespace(text=self.text)

    async def close(self) -> None:
        self.closed = True


@dataclass
class Running:
    runtime: Runtime
    http: httpx.AsyncClient
    internal: httpx.AsyncClient
    openai: FakeOpenAI
    s3: Any


@asynccontextmanager
async def running(*, openai: bool = True, assets: bool = True) -> AsyncIterator[Running]:
    with mock_aws():
        s3 = boto3.client(
            "s3",
            region_name=ASSETS_REGION,
            aws_access_key_id="t",
            aws_secret_access_key="t",
            config=_S3_CONFIG,
        )
        s3.create_bucket(Bucket=BUCKET)
        fake = FakeOpenAI()
        settings = SharedSettings.model_validate({"ASSETS_BUCKET_NAME": BUCKET} if assets else {})
        runtime = Runtime(
            settings=settings,
            authorizer=Authorizer(
                AuthzConfig(
                    public_keys={KID: JWT_PUBLIC},
                    issuer="superpower-local",
                    audience="superpower-api",
                ),
                cache=None,
                fill=_fill,
            ),
            internal=InternalClient(ServiceTokenSigner("shared", "s1", SHARED_PRIVATE)),
            limits=RateLimits(None, prefix="shared"),
            openai=fake if openai else None,
            s3=s3 if assets else None,
        )
        main.configure(runtime)
        http = httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://s")
        internal = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.internal_app), base_url="http://s"
        )
        try:
            yield Running(runtime, http, internal, fake, s3)
        finally:
            await http.aclose()
            await internal.aclose()
            await runtime.aclose()
            main.configure(None)
