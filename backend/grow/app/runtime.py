"""What the grow service runs on: settings, MongoDB, authorization, internal calls, AWS and
the shared hourly LLM limit.

Built once per process from the environment when MONGODB_URI is set (`Runtime.from_env`).
Without it the service serves `/health` only and every other route answers 503, so the
image still starts with no configuration. The LLM client isn't here: only the worker has
LLM keys (it builds one, `grow.worker`).
"""

from __future__ import annotations

import asyncio
import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

import boto3
from pydantic import Field
from pymongo import AsyncMongoClient

from common.authz import Authorizer, AuthzConfig
from common.events.store import Db, ensure_outbox, ensure_tombstones
from common.generation.llm_limit import DEFAULT_LIMIT, LlmHourlyLimit
from common.generation.switch import GenerationSwitch
from common.index_builds import Outcome, prepare_database, stop_index_build
from common.internal_client import (
    InternalClient,
    ServiceTokenVerifier,
    authz_fill,
    public_keys_from_env,
)
from common.limiter import RateLimits
from common.models import (
    ONBOARDING_INPUTS,
    PERSONALITY_INPUTS,
    ensure_child_access,
    ensure_inputs,
    ensure_jobs,
)
from common.regions import locations_for_region
from common.settings_base import ServiceSettings
from grow.app.store import ensure_growth_areas
from grow.app.worlds import ensure_world_runs

SERVICE = "grow"


class GrowSettings(ServiceSettings):
    service_name: str = Field(default=SERVICE, validation_alias="SERVICE_NAME")
    # The service's own topic and queue (7.2), from Terraform; the worker needs both.
    events_topic_arn: str | None = Field(default=None, validation_alias="EVENTS_TOPIC_ARN")
    events_queue_url: str | None = Field(default=None, validation_alias="EVENTS_QUEUE_URL")
    # Moto locally (0.3); unset in AWS.
    aws_endpoint_url: str | None = Field(default=None, validation_alias="AWS_ENDPOINT_URL")
    # The hourly LLM calls per user, shared by every circle (8).
    llm_hourly_limit: int = Field(default=DEFAULT_LIMIT, ge=1, validation_alias="LLM_HOURLY_LIMIT")
    # The generation kill switch's SSM parameter (common.generation.switch), from
    # Terraform; unset locally, where generation is always on.
    llm_switch_parameter: str | None = Field(default=None, validation_alias="LLM_SWITCH_PARAMETER")


@dataclass
class Runtime:
    settings: GrowSettings
    client: AsyncMongoClient[dict[str, Any]]
    authorizer: Authorizer
    verifier: ServiceTokenVerifier
    internal: InternalClient
    limits: RateLimits
    llm_limit: LlmHourlyLimit
    sns: Any = None
    sqs: Any = None
    # The relay's and the jobs' metrics (15.5); None in tests.
    cloudwatch: Any = None
    cache: Any = None
    switch: GenerationSwitch = field(default_factory=GenerationSwitch.always_on)

    # The background index build this task started, if any (prepare).
    index_build: asyncio.Task[Outcome] | None = None

    @property
    def db(self) -> Db:
        return self.client[self.settings.mongodb_db_name]

    def locations(self) -> list[str] | None:
        """This region's locations; every location locally (one task serves them all)."""
        if self.settings.app_env == "local":
            return None
        return locations_for_region(self.settings.aws_region, self.settings.app_env)

    @classmethod
    def from_env(cls, environ: Mapping[str, str] = os.environ) -> Runtime:
        # `environ` overrides the process environment, which settings also read.
        settings = GrowSettings.model_validate(dict(environ))
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
            # write only LIMITS:LIMITER/grow/* (build plan 2.3), and llm:hourly:*.
            limits=RateLimits(
                settings.redis_url,
                prefix=SERVICE,
                behind_proxy=settings.behind_proxy,
                redis_options=settings.valkey_options(),
            ),
            llm_limit=LlmHourlyLimit(cache, limit=settings.llm_hourly_limit),
            switch=GenerationSwitch(
                settings.llm_switch_parameter,
                boto3.client("ssm", **aws) if settings.llm_switch_parameter else None,
            ),
            sns=boto3.client("sns", **aws),
            sqs=boto3.client("sqs", **aws),
            cloudwatch=boto3.client("cloudwatch", **aws),
            cache=cache,
        )

    async def prepare(self) -> None:
        """Create the collections before serving, and their indexes in the background once
        per release (common.index_builds, DB-03). Creating a collection inside a transaction
        (an implicit create on first insert) conflicts with any concurrent create of it."""

        async def ensure(db: Db) -> None:
            await ensure_growth_areas(db)
            await ensure_world_runs(db)
            await ensure_jobs(db, SERVICE)
            await ensure_child_access(db)
            await ensure_inputs(db, [ONBOARDING_INPUTS, PERSONALITY_INPUTS])
            await ensure_outbox(db)
            await ensure_tombstones(db)

        self.index_build = await prepare_database(
            self.db, ensure, service=SERVICE, release=self.settings.release
        )

    async def aclose(self) -> None:
        stop_index_build(self.index_build)
        await self.internal.aclose()
        await self.client.close()
        if self.cache is not None:
            await self.cache.aclose()
