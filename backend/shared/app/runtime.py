"""What the shared service runs on: settings, authorization, rate limits, OpenAI's
transcription client and S3 for the APK link.

Shared has no database (docs/auth-users-split.md, 13.3), so MONGODB_URI isn't needed:
the runtime is built once per process when JWT_PUBLIC_KEYS is set (`Runtime.from_env`).
Without it every route but the health checks answers 503. Speech-to-text needs
OPENAI_API_KEY (`503 transcription_not_configured` otherwise), the APK link
ASSETS_BUCKET_NAME (`503 downloads_not_configured`).
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

import boto3
from botocore.config import Config
from pydantic import Field

from common.authz import Authorizer, AuthzConfig
from common.internal_client import InternalClient, authz_fill
from common.limiter import RateLimits
from common.settings_base import ServiceSettings

SERVICE = "shared"
# The APK bucket is one global bucket in us-east-1, whatever region serves the request.
ASSETS_REGION = "us-east-1"
# SigV4 on the regional endpoint: botocore's default presigns with SigV2 in us-east-1,
# which S3 refuses for buckets created after June 2020 (today's downloads router).
_S3_CONFIG = Config(signature_version="s3v4", s3={"addressing_style": "virtual"})
# A local endpoint (Moto) has no per-bucket hostnames: path style, as common.uploads does.
_LOCAL_S3_CONFIG = Config(signature_version="s3v4", s3={"addressing_style": "path"})


class SharedSettings(ServiceSettings):
    service_name: str = Field(default=SERVICE, validation_alias="SERVICE_NAME")
    # No database: the shared settings' MongoDB fields are left empty.
    mongodb_uri: str = Field(default="", validation_alias="MONGODB_URI")
    mongodb_db_name: str = Field(default="", validation_alias="MONGODB_DB_NAME")
    openai_api_key: str | None = Field(default=None, validation_alias="OPENAI_API_KEY")
    assets_bucket_name: str | None = Field(default=None, validation_alias="ASSETS_BUCKET_NAME")
    # Moto locally (0.3); unset in AWS.
    aws_endpoint_url: str | None = Field(default=None, validation_alias="AWS_ENDPOINT_URL")


@dataclass
class Runtime:
    settings: SharedSettings
    authorizer: Authorizer
    internal: InternalClient
    limits: RateLimits
    openai: Any = None  # AsyncOpenAI, or None without a key
    s3: Any = None  # the assets bucket's client, or None without a bucket
    cache: Any = None

    @classmethod
    def from_env(cls, environ: Mapping[str, str] = os.environ) -> Runtime:
        # `environ` overrides the process environment, which settings also read.
        settings = SharedSettings.model_validate(dict(environ))
        internal = InternalClient.from_env({"SERVICE_NAME": SERVICE, **environ})
        # Its own RBAC user with an IAM token in AWS (common.valkey); the URL alone locally.
        cache = settings.valkey_client()
        openai = None
        if settings.openai_api_key:
            from openai import AsyncOpenAI

            openai = AsyncOpenAI(api_key=settings.openai_api_key)
        s3 = None
        if settings.assets_bucket_name:
            s3 = boto3.client(
                "s3",
                region_name=ASSETS_REGION,
                endpoint_url=settings.aws_endpoint_url
                or f"https://s3.{ASSETS_REGION}.amazonaws.com",
                config=_LOCAL_S3_CONFIG if settings.aws_endpoint_url else _S3_CONFIG,
            )
        return cls(
            settings=settings,
            authorizer=Authorizer(
                AuthzConfig.from_env(environ), cache=cache, fill=authz_fill(internal)
            ),
            internal=internal,
            # The limiter's keys are prefixed with the service name: its Valkey user may
            # write only LIMITS:LIMITER/shared/* (build plan 2.3).
            limits=RateLimits(
                settings.redis_url,
                prefix=SERVICE,
                behind_proxy=settings.behind_proxy,
                redis_options=settings.valkey_options(),
            ),
            openai=openai,
            s3=s3,
            cache=cache,
        )

    async def aclose(self) -> None:
        await self.internal.aclose()
        if self.openai is not None:
            await self.openai.close()
        if self.cache is not None:
            await self.cache.aclose()
