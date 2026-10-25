"""What the auth service runs on: settings, MongoDB, keys, Valkey, the users client, Google.

Built once per process from the environment when MONGODB_URI is set (`Runtime.from_env`).
Without it the service serves `/health` only and every other route answers 503, so the
image still starts with no configuration.

auth is its own authz fill: on a cache miss it reads `auth.auth` directly (and refills the
cache) instead of calling itself (9.3).
"""

from __future__ import annotations

import asyncio
import os
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from typing import Any, Literal

import boto3
from pydantic import Field, field_validator
from pymongo import AsyncMongoClient

from auth.app.audit import AuditTrail, AuthAuthorizer
from auth.app.authz_cache import entry_from_account, write_entry
from auth.app.store import AUTH, ensure_collections
from auth.app.throttle import LoginThrottle
from auth.app.tokens import TokenIssuer
from auth.emails import Peppers
from common.audit import AuditLog
from common.authz import AuthzConfig, AuthzEntry
from common.deletion import PARTICIPANTS
from common.events.store import Db
from common.internal_client import InternalClient, ServiceTokenVerifier, public_keys_from_env
from common.limiter import RateLimits
from common.settings_base import ServiceSettings

SERVICE = "auth"

# Verifies a Google ID token for the client id; returns its claims or raises ValueError.
GoogleVerifier = Callable[[str, str], Awaitable[dict[str, Any]]]


class AuthSettings(ServiceSettings):
    service_name: str = Field(default=SERVICE, validation_alias="SERVICE_NAME")
    jwt_private_key: str = Field(validation_alias="JWT_PRIVATE_KEY")
    jwt_key_id: str = Field(default="key-v1", validation_alias="JWT_KEY_ID")
    jwt_access_expire_minutes: int = Field(
        default=30, ge=1, le=120, validation_alias="JWT_ACCESS_EXPIRE_MINUTES"
    )
    jwt_refresh_expire_hours: int = Field(
        default=24, ge=1, le=720, validation_alias="JWT_REFRESH_EXPIRE_HOURS"
    )
    email_hmac_pepper: str = Field(validation_alias="EMAIL_HMAC_PEPPER")
    # Empty: Google sign-in is off.
    google_client_id: str = Field(default="", validation_alias="GOOGLE_CLIENT_ID")
    cookie_secure: bool = Field(default=True, validation_alias="COOKIE_SECURE")
    cookie_samesite: Literal["lax", "strict", "none"] = Field(
        default="lax", validation_alias="COOKIE_SAMESITE"
    )
    cookie_domain: str | None = Field(default=None, validation_alias="COOKIE_DOMAIN")
    # The worker's own topic and queue (7.2), from Terraform.
    events_topic_arn: str | None = Field(default=None, validation_alias="EVENTS_TOPIC_ARN")
    events_queue_url: str | None = Field(default=None, validation_alias="EVENTS_QUEUE_URL")
    # Moto locally (0.3); unset in AWS.
    aws_endpoint_url: str | None = Field(default=None, validation_alias="AWS_ENDPOINT_URL")
    # Who must confirm an account deletion (10.3): common.deletion.PARTICIPANTS, or only
    # those deployed so far while services are still being built (comma-separated).
    deletion_participants: str = Field(
        default=",".join(PARTICIPANTS), validation_alias="DELETION_PARTICIPANTS"
    )

    @field_validator("deletion_participants")
    @classmethod
    def _known_participants(cls, value: str) -> str:
        names = [name.strip() for name in value.split(",") if name.strip()]
        unknown = set(names) - set(PARTICIPANTS)
        if not names or unknown:
            raise ValueError(
                f"DELETION_PARTICIPANTS must be some of {', '.join(PARTICIPANTS)}"
                + (f"; unknown: {', '.join(sorted(unknown))}" if unknown else "")
            )
        return ",".join(name for name in PARTICIPANTS if name in names)

    @property
    def participants(self) -> list[str]:
        return self.deletion_participants.split(",")

    @field_validator("cookie_domain", mode="before")
    @classmethod
    def _blank_domain(cls, value: Any) -> Any:
        return None if isinstance(value, str) and not value.strip() else value


async def verify_google_token(token: str, client_id: str) -> dict[str, Any]:  # pragma: no cover
    """Google's own check: signature against Google's keys, audience, issuer and expiry.
    Calls Google, so tests pass their own verifier."""
    from google.auth.transport import requests as google_requests
    from google.oauth2 import id_token

    def verify() -> dict[str, Any]:
        claims: dict[str, Any] = id_token.verify_oauth2_token(
            token, google_requests.Request(), client_id, clock_skew_in_seconds=60
        )
        return claims

    return await asyncio.to_thread(verify)


@dataclass
class Runtime:
    settings: AuthSettings
    client: AsyncMongoClient[dict[str, Any]]
    authz_config: AuthzConfig
    issuer: TokenIssuer
    peppers: Peppers
    internal: InternalClient
    verifier: ServiceTokenVerifier
    limits: RateLimits
    throttle: LoginThrottle
    cache: Any = None
    google: GoogleVerifier = verify_google_token
    audit_log: AuditLog | None = None
    sns: Any = None
    sqs: Any = None
    # The relay's OldestUnpublishedOutboxAgeSeconds (15.5); None in tests.
    cloudwatch: Any = None
    authorizer: AuthAuthorizer = field(init=False)
    audit: AuditTrail = field(init=False)

    def __post_init__(self) -> None:
        self.issuer.check_published(self.authz_config)
        self.audit = AuditTrail(self.db, self.audit_log)
        self.authorizer = AuthAuthorizer(
            self.authz_config, cache=self.cache, fill=self.fill, trail=self.audit
        )

    @property
    def db(self) -> Db:
        return self.client[self.settings.mongodb_db_name]

    async def fill(self, user_id: str) -> AuthzEntry | None:
        """The authz entry from `auth.auth`, refilling the cache; None if no such account."""
        doc = await self.db[AUTH].find_one({"_id": user_id})
        if doc is None:
            return None
        entry = entry_from_account(doc)
        await write_entry(self.cache, user_id, entry)
        return entry

    @classmethod
    def from_env(cls, environ: Mapping[str, str] = os.environ) -> Runtime:
        # `environ` overrides the process environment, which settings also read.
        settings = AuthSettings.model_validate(dict(environ))
        # Its own RBAC user with an IAM token in AWS (common.valkey); the URL alone locally.
        cache = settings.valkey_client()
        valkey = settings.valkey_options()
        aws: dict[str, Any] = {"region_name": settings.aws_region}
        if settings.aws_endpoint_url:
            aws["endpoint_url"] = settings.aws_endpoint_url
        return cls(
            settings=settings,
            client=settings.mongo_client(),
            authz_config=AuthzConfig.from_env(environ),
            issuer=TokenIssuer(
                settings.jwt_private_key,
                settings.jwt_key_id,
                issuer=environ.get("JWT_ISSUER", "superpower-local"),
                audience=environ.get("JWT_AUDIENCE", "superpower-api"),
                access_minutes=settings.jwt_access_expire_minutes,
                refresh_hours=settings.jwt_refresh_expire_hours,
            ),
            peppers=Peppers.parse(settings.email_hmac_pepper),
            internal=InternalClient.from_env({"SERVICE_NAME": SERVICE, **environ}),
            verifier=ServiceTokenVerifier(
                SERVICE, public_keys_from_env(environ.get("INTERNAL_PUBLIC_KEYS", ""))
            ),
            # Keys under `auth`: its Valkey user may write LIMITS:LIMITER/auth/* (2.3).
            limits=RateLimits(
                settings.redis_url,
                prefix=SERVICE,
                behind_proxy=settings.behind_proxy,
                redis_options=valkey,
            ),
            throttle=LoginThrottle(settings.redis_url, prefix=SERVICE, redis_options=valkey),
            cache=cache,
            sns=boto3.client("sns", **aws),
            sqs=boto3.client("sqs", **aws),
            cloudwatch=boto3.client("cloudwatch", **aws),
        )

    async def prepare(self) -> None:
        """Create the collections before serving (none is created inside a transaction)."""
        await ensure_collections(self.db)

    async def aclose(self) -> None:
        await self.audit.flush()
        await self.internal.aclose()
        await self.client.close()
        if self.cache is not None:
            await self.cache.aclose()
