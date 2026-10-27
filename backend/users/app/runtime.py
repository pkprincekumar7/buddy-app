"""What the users service runs on: settings, MongoDB, authorization, internal calls, AWS.

Built once per process from the environment when MONGODB_URI is set (`Runtime.from_env`).
Without it the service serves `/health` only and every other route answers 503, so the
image still starts with no configuration.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

import boto3
from pydantic import Field
from pymongo import AsyncMongoClient

from common.authz import Authorizer, AuthzConfig
from common.events.store import Db, ensure_outbox, ensure_tombstones
from common.internal_client import (
    InternalClient,
    ServiceTokenVerifier,
    authz_fill,
    public_keys_from_env,
)
from common.limiter import RateLimits
from common.settings_base import ServiceSettings
from users.app.store import ensure_users

SERVICE = "users"


class UsersSettings(ServiceSettings):
    service_name: str = Field(default=SERVICE, validation_alias="SERVICE_NAME")
    # The service's own topic and queue (7.2), from Terraform; the worker needs both.
    events_topic_arn: str | None = Field(default=None, validation_alias="EVENTS_TOPIC_ARN")
    events_queue_url: str | None = Field(default=None, validation_alias="EVENTS_QUEUE_URL")
    # Moto locally (0.3); unset in AWS.
    aws_endpoint_url: str | None = Field(default=None, validation_alias="AWS_ENDPOINT_URL")


@dataclass
class Runtime:
    settings: UsersSettings
    client: AsyncMongoClient[dict[str, Any]]
    authorizer: Authorizer
    verifier: ServiceTokenVerifier
    internal: InternalClient
    limits: RateLimits
    sns: Any = None
    sqs: Any = None
    # The relay's OldestUnpublishedOutboxAgeSeconds (15.5); None in tests.
    cloudwatch: Any = None
    cache: Any = None

    @property
    def db(self) -> Db:
        return self.client[self.settings.mongodb_db_name]

    @classmethod
    def from_env(cls, environ: Mapping[str, str] = os.environ) -> Runtime:
        # `environ` overrides the process environment, which settings also read.
        settings = UsersSettings.model_validate(dict(environ))
        internal = InternalClient.from_env({"SERVICE_NAME": SERVICE, **environ})
        # Its own RBAC user with an IAM token in AWS (common.valkey); the URL alone locally.
        cache = settings.valkey_client()
        aws: dict[str, Any] = {"region_name": settings.aws_region}
        if settings.aws_endpoint_url:
            aws["endpoint_url"] = settings.aws_endpoint_url
        return cls(
            settings=settings,
            client=settings.mongo_client(),
            authorizer=Authorizer(
                AuthzConfig.from_env(environ), cache=cache, fill=authz_fill(internal)
            ),
            verifier=ServiceTokenVerifier(
                SERVICE, public_keys_from_env(environ.get("INTERNAL_PUBLIC_KEYS", ""))
            ),
            internal=internal,
            # The limiter's keys are prefixed with the service name: its Valkey user may
            # write only LIMITS:LIMITER/users/* (build plan 2.3).
            limits=RateLimits(
                settings.redis_url,
                prefix=SERVICE,
                behind_proxy=settings.behind_proxy,
                redis_options=settings.valkey_options(),
            ),
            sns=boto3.client("sns", **aws),
            sqs=boto3.client("sqs", **aws),
            cloudwatch=boto3.client("cloudwatch", **aws),
            cache=cache,
        )

    async def prepare(self) -> None:
        """Create the collections before serving. Creating one inside a transaction (an
        implicit create on first insert) conflicts with any concurrent create of it."""
        await ensure_users(self.db)
        await ensure_outbox(self.db)
        await ensure_tombstones(self.db)

    async def aclose(self) -> None:
        await self.internal.aclose()
        await self.client.close()
        if self.cache is not None:
            await self.cache.aclose()
