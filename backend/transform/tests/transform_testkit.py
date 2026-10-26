"""Shared pieces of transform's tests (conftest.py exposes the fixtures).

transform's tests run against MONGODB_TEST_URI (a throwaway replica set), never MONGODB_URI.

    MONGODB_TEST_URI="mongodb://localhost:27017/?directConnection=true" pytest transform/tests

Without it the database tests skip; with REQUIRE_LIVE_SERVICES=1 a skip is a failure, as in
common/tests. `running` wires the service to a throwaway database, in-process Moto (with the
topology scripts/local-aws-setup.py creates), fakes of children's, discover's and grow's
internal APIs, an S3 bucket for photos, (read-through and confirm-before-deny) and a fake LLM provider behind the real
LlmClient, and records every audit event. No test calls a real LLM.
"""

from __future__ import annotations

import json
import os
import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
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
from common.generation.llm import LlmClient, LlmConfig
from common.generation.llm_limit import LlmHourlyLimit
from common.internal_client import InternalClient, ServiceTokenSigner, ServiceTokenVerifier
from common.limiter import RateLimits
from common.models import (
    CHILD_ACCESS,
    GROWTH_INPUTS,
    PERSONALITY_INPUTS,
    PROGRESS_FLAGS,
    growth_inputs_id,
)
from common.uploads import Uploads, UploadsConfig
from transform.app import main
from transform.app.runtime import Runtime, TransformSettings

MONGO_URI = os.environ.get("MONGODB_TEST_URI")

REGION = "ap-south-1"
LOCATION = "in"
KID = "k1"
PARENT = str(uuid.uuid4())
OTHER = str(uuid.uuid4())
ADMIN = str(uuid.uuid4())
ROLES = {PARENT: "parent", OTHER: "parent", ADMIN: "admin"}

FIXTURES = Path(__file__).parent / "fixtures"
ANSWERS: dict[str, Any] = {
    "strengths": ["curious", "kind"],
    "hobbies": ["drawing"],
    "thinking_pattern": "visual",
    "communication_style": "expressive",
    "energy_level": "high",
    "social_behaviour": "outgoing",
    "emotional_behaviour": "steady",
}
_CASES = json.loads((FIXTURES / "llm_answers.json").read_text())
# A valid Life Pathway answer: the first fixture.
PATHWAY_ANSWER: dict[str, Any] = _CASES[0]["answer"]
SUMMARY: dict[str, Any] = {
    "traits": {
        "dominant_style": "Thinker",
        "personality_category": "adventurers",
        "traits": ["Curious", "Observant"],
        "description": "Aarav notices the small things.",
    },
    "strengths": ["Asks thoughtful questions"],
}


def _do(k: str, kind: str = "text") -> dict[str, Any]:
    return {"k": k, "kind": kind, "label": f"Field {k}"}


PLAN_ANSWER: dict[str, Any] = {
    "metric": "Keepy-uppies in a row",
    "goals": ["Day 30: a habit.", "Day 60: shown to a coach.", "Day 90: a match."],
    "acts": [
        {
            "n": f"0{n}", "time": "15 min daily", "title": f"Activity {n}", "award": "Streak keeper",
            "objective": "Ten in a row.", "apply": "In the garden after school.",
            "do": [_do("note"), {**_do("count", "count"), "target": 10}],
        }
        for n in range(1, 10)
    ],
}  # fmt: skip
TRACKER_ANSWER: dict[str, Any] = {
    "steps": [
        {
            "title": f"Step {n}", "short": f"S{n}", "when": f"{10 - n} weeks out",
            "body": "Practise the routine.", "fields": [{"k": "note", "label": "Notes", "type": "note"}],
        }
        for n in range(1, 10)
    ]
}  # fmt: skip


def area_copy(area_id: str = "self_care", user_id: str = PARENT) -> dict[str, Any]:
    """A completed area, as grow's events and its internal read carry it."""
    return {
        "user_id": user_id,
        "area_id": area_id,
        "area_name": area_id.replace("_", " ").title(),
        "answers": {f"{area_id}_gq1": "Brushes her teeth alone"},
        "child_activity_results": None,
        "recommendations": None,
        "ai_three_month_recommendations": [{"title": "Start a routine", "detail": "Every night."}],
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
TRANSFORM_PRIVATE, TRANSFORM_PUBLIC = _ed()
RELEASE_PRIVATE, RELEASE_PUBLIC = _ed()
GROW_PRIVATE, GROW_PUBLIC = _ed()
SERVICE_KEYS = {
    "transform": {"t1": TRANSFORM_PUBLIC},
    "release": {"r1": RELEASE_PUBLIC},
    "grow": {"g1": GROW_PUBLIC},
}
_SIGNERS = {"release": ("r1", RELEASE_PRIVATE), "grow": ("g1", GROW_PRIVATE)}
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


def service_header(caller: str = "release") -> dict[str, str]:
    kid, private = _SIGNERS[caller]
    signed = ServiceTokenSigner(caller, kid, private).token_for("transform")
    return {"Authorization": f"Bearer {signed}"}


async def _fill(user_id: str) -> AuthzEntry | None:
    role = ROLES.get(user_id)
    return None if role is None else AuthzEntry(ver=1, role=role, locked=False, deleting=False)


def authz_config() -> AuthzConfig:
    return AuthzConfig(
        public_keys={KID: JWT_PUBLIC}, issuer="superpower-local", audience="superpower-api"
    )


def settings(db_name: str, mongo_uri: str, **extra: str) -> TransformSettings:
    return TransformSettings.model_validate(
        {"MONGODB_URI": mongo_uri, "MONGODB_DB_NAME": db_name, "AWS_REGION": REGION, **extra}
    )


def progress(**done: bool) -> dict[str, bool]:
    return {flag: bool(done.get(flag)) for flag in PROGRESS_FLAGS}


# ── the owners' internal APIs, faked ───────────────────────────────────────────


@dataclass
class FakeOwners:
    """children's `GET /internal/children/{id}`, discover's summary and grow's status and areas.

    `children`, `personalities` and `areas` hold what each owner knows; `down` names an
    owner that can't be reached, `broken` one that answers 500.
    """

    children: dict[str, dict[str, Any]] = field(default_factory=dict)
    personalities: dict[str, dict[str, Any]] = field(default_factory=dict)
    areas: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    calls: list[str] = field(default_factory=list)
    down: set[str] = field(default_factory=set)
    broken: set[str] = field(default_factory=set)

    def add_child(
        self, child_id: str | None = None, *, user_id: str = PARENT, version: int = 1, **fields: Any
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
            "progress": progress(profile=True, conversation=True, discover=True, grow=True),
            "version": version,
            **fields,
        }
        return child_id

    def complete_area(
        self, child_id: str, area_id: str = "self_care", *, user_id: str = PARENT, version: int = 2
    ) -> None:
        self.areas.setdefault(child_id, []).append(
            {
                "child_id": child_id,
                "location": LOCATION,
                **area_copy(area_id, user_id),
                "version": version,
            }
        )

    def personality(
        self, child_id: str, *, user_id: str = PARENT, done: bool = True, version: int = 2
    ) -> None:
        self.personalities[child_id] = {
            "child_id": child_id,
            "user_id": user_id,
            "location": LOCATION,
            **SUMMARY,
            "version": version,
            "done": done,
        }

    def handle(self, request: httpx.Request) -> httpx.Response:
        owner = request.url.host
        if owner in self.down:
            raise httpx.ConnectError("connection refused", request=request)
        if owner in self.broken:
            return httpx.Response(500)
        path = request.url.path
        self.calls.append(f"{owner} {path}")
        location = parse_qs(request.url.query.decode())["location"][0]
        if owner == "children":
            child = self.children.get(path.removeprefix("/internal/children/"))
            if child is None or child["location"] != location:
                return httpx.Response(404, json={"detail": "Not Found"})
            return httpx.Response(200, json=child)
        child_id = path.split("/")[4]
        if owner == "discover":
            personality = self.personalities.get(child_id)
            if personality is None:
                return httpx.Response(404, json={"detail": "Not Found"})
            return httpx.Response(200, json={k: v for k, v in personality.items() if k != "done"})
        areas = self.areas.get(child_id, [])
        if path.endswith("/status"):
            return httpx.Response(200, json={"completed": bool(areas)})
        return httpx.Response(200, json={"areas": areas})


async def _resolve(host: str, port: int) -> list[str]:
    return [host]  # the fake routes by name: children, discover or grow


# ── the LLM provider, faked ────────────────────────────────────────────────────


@dataclass
class FakeOpenAI:
    """`chat.completions.create`, answering `answers` in turn (a dict, a string or an error);
    the last one repeats."""

    answers: list[Any] = field(default_factory=lambda: [PATHWAY_ANSWER])
    prompts: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    async def _create(self, **kwargs: Any) -> Any:
        self.prompts.append(kwargs["messages"][1]["content"])
        answer = self.answers.pop(0) if len(self.answers) > 1 else self.answers[0]
        if isinstance(answer, Exception):
            raise answer
        content = answer if isinstance(answer, str) else json.dumps(answer)
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=content))],
            usage=SimpleNamespace(prompt_tokens=10, completion_tokens=20),
        )


async def claim(db: Any) -> dict[str, Any]:
    """The next due job, which the test expects to exist."""
    from common.generation import jobs

    job = await jobs.claim_next(db, locations=None)
    assert job is not None, "no job to claim"
    return job


def llm_client(fake: FakeOpenAI | None = None) -> LlmClient:
    return LlmClient(
        LlmConfig(openai_api_key="test-key-not-real"),
        circle="transform",
        openai_client=fake or FakeOpenAI(),
    )


# ── the running service ────────────────────────────────────────────────────────


@dataclass
class Running:
    runtime: Runtime
    http: httpx.AsyncClient  # the public app
    internal: httpx.AsyncClient  # the internal app
    layout: dict[str, Any]
    owners: FakeOwners
    audit: list[AuditEvent] = field(default_factory=list)

    @property
    def db(self) -> Any:
        return self.runtime.db

    async def copy(self, child_id: str, **fields: Any) -> None:
        """A `child_access` row, as `child.changed` leaves it (Grow done)."""
        doc = {
            "_id": child_id,
            "location": LOCATION,
            "user_id": PARENT,
            "name": "Aarav",
            "age": 9,
            "gender": "boy",
            "is_deleted": False,
            "progress": progress(profile=True, conversation=True, discover=True, grow=True),
            "version": 1,
            "updated_at": datetime.now(UTC),
            "schema_version": 1,
            **fields,
        }
        await self.db[CHILD_ACCESS].insert_one(doc)

    async def area(
        self, child_id: str, area_id: str = "self_care", *, user_id: str = PARENT, version: int = 2
    ) -> None:
        """A `growth_inputs` row, as `grow.area_completed` leaves it."""
        await self.db[GROWTH_INPUTS].insert_one(
            {
                "_id": growth_inputs_id(child_id, area_id),
                "location": LOCATION,
                "child_id": child_id,
                **area_copy(area_id, user_id),
                "version": version,
                "updated_at": datetime.now(UTC),
                "schema_version": 1,
            }
        )

    async def summary(self, child_id: str, *, user_id: str = PARENT, version: int = 2) -> None:
        """A `personality_inputs` row, as `discover.personality_finalised` leaves it."""
        await self.db[PERSONALITY_INPUTS].insert_one(
            {
                "_id": child_id,
                "location": LOCATION,
                "user_id": user_id,
                **SUMMARY,
                "version": version,
                "updated_at": datetime.now(UTC),
                "schema_version": 1,
            }
        )

    async def ready_child(self, **fields: Any) -> str:
        """A child with its copies (one completed area), ready to generate."""
        child_id = self.owners.add_child()
        self.owners.personality(child_id)
        self.owners.complete_area(child_id)
        await self.copy(child_id, **fields)
        await self.summary(child_id)
        await self.area(child_id)
        return child_id


@asynccontextmanager
async def running(
    mongo_uri: str, *, llm_hourly_limit: int = 200, uploads: bool = True
) -> AsyncIterator[Running]:
    with mock_aws():
        aws = {"region_name": REGION, "aws_access_key_id": "t", "aws_secret_access_key": "t"}
        sns, sqs = boto3.client("sns", **aws), boto3.client("sqs", **aws)
        s3 = boto3.client("s3", **aws)
        s3.create_bucket(Bucket=BUCKET, CreateBucketConfiguration={"LocationConstraint": REGION})
        db_name = f"transform_test_{uuid.uuid4().hex[:10]}"
        layout = topology.apply_local(sns, sqs, settings(db_name, mongo_uri).events_prefix)
        configured = settings(
            db_name,
            mongo_uri,
            EVENTS_TOPIC_ARN=layout["topics"]["transform"],
            EVENTS_QUEUE_URL=layout["queues"]["transform"],
        )
        audit: list[AuditEvent] = []
        owners = FakeOwners()
        client: AsyncMongoClient[dict[str, Any]] = AsyncMongoClient(mongo_uri, tz_aware=True)
        runtime = Runtime(
            settings=configured,
            client=client,
            authorizer=Authorizer(
                authz_config(), cache=None, fill=_fill, audit=AuditLog(sinks=[audit.append])
            ),
            verifier=ServiceTokenVerifier("transform", SERVICE_KEYS),
            internal=InternalClient(
                ServiceTokenSigner("transform", "t1", TRANSFORM_PRIVATE),
                resolver=_resolve,
                transport=httpx.MockTransport(owners.handle),
            ),
            limits=RateLimits(None, prefix="transform"),
            llm_limit=LlmHourlyLimit(None, limit=llm_hourly_limit),
            sns=sns,
            sqs=sqs,
            uploads=Uploads(UploadsConfig(bucket=BUCKET, region=REGION), client=s3)
            if uploads
            else None,
        )
        await runtime.prepare()  # as the lifespan does
        await runtime.prepare()  # safe to repeat
        main.configure(runtime)
        http = httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://t")
        internal = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.internal_app), base_url="http://t"
        )
        try:
            yield Running(runtime, http, internal, layout, owners, audit)
        finally:
            await http.aclose()
            await internal.aclose()
            await client.drop_database(db_name)
            await runtime.aclose()
            main.configure(None)
