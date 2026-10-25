"""What hello's Gate 1 demo runs on: settings, MongoDB, authorization, internal calls, AWS.

Built once per process from the environment when MONGODB_URI is set (`Demo.from_env`);
without it hello serves `/health` only and the demo routes answer 503, so the plain image
still starts with no configuration (build plan 0.4).
"""

from __future__ import annotations

import contextlib
import os
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

import boto3
from pydantic import Field
from pymongo import AsyncMongoClient
from pymongo.errors import CollectionInvalid

from common.authz import Authorizer, AuthzConfig
from common.events.store import Db, ensure_outbox
from common.internal_client import (
    InternalClient,
    ServiceTokenVerifier,
    authz_fill,
    public_keys_from_env,
)
from common.settings_base import ServiceSettings

SERVICE = "hello"
PINGS = "pings"
PING_COPIES = "ping_copies"


class HelloSettings(ServiceSettings):
    service_name: str = Field(default=SERVICE, validation_alias="SERVICE_NAME")
    # The service's own topic and queue (7.2), from Terraform; the worker needs both.
    events_topic_arn: str | None = Field(default=None, validation_alias="EVENTS_TOPIC_ARN")
    events_queue_url: str | None = Field(default=None, validation_alias="EVENTS_QUEUE_URL")
    # Moto locally (0.3); unset in AWS.
    aws_endpoint_url: str | None = Field(default=None, validation_alias="AWS_ENDPOINT_URL")


@dataclass
class Demo:
    settings: HelloSettings
    client: AsyncMongoClient[dict[str, Any]]
    authorizer: Authorizer
    verifier: ServiceTokenVerifier
    internal: InternalClient
    sns: Any = None
    sqs: Any = None
    cache: Any = None

    @property
    def db(self) -> Db:
        return self.client[self.settings.mongodb_db_name]

    @classmethod
    def from_env(cls, environ: Mapping[str, str] = os.environ) -> Demo:
        # `environ` overrides the process environment, which settings also read.
        settings = HelloSettings.model_validate(dict(environ))
        internal = InternalClient.from_env({"SERVICE_NAME": SERVICE, **environ})
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
            sns=boto3.client("sns", **aws),
            sqs=boto3.client("sqs", **aws),
            cache=cache,
        )

    async def prepare(self) -> None:
        """Create the collections before serving. Creating one inside a transaction (an
        implicit create on first insert) conflicts with any concurrent create of it."""
        await ensure_outbox(self.db)
        existing = set(await self.db.list_collection_names())
        for name in (PINGS, PING_COPIES):
            if name not in existing:
                with contextlib.suppress(CollectionInvalid):  # another task created it first
                    await self.db.create_collection(name)

    async def aclose(self) -> None:
        await self.internal.aclose()
        await self.client.close()
        if self.cache is not None:
            await self.cache.aclose()
