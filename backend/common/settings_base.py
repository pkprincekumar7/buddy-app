"""Settings every service shares (docs/auth-users-split.md, sections 4, 9.3, 13.2, 15).

A service subclasses `ServiceSettings` and adds its own fields. Values come from the
environment (in AWS, the task definition and its secrets); a `.env` in the working
directory is read too, for local runs.

In stg and prod, settings that would quietly weaken the service stop it at startup instead
(production-readiness review, AUTH-07): `unsafe_settings` lists what every runtime needs,
and a service adds its own checks by extending it.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from pymongo import AsyncMongoClient

AppEnv = Literal["local", "dev", "sbx", "stg", "prod"]
# The environments real users reach, where unsafe settings refuse to start (AUTH-07).
STRICT_ENVS: frozenset[str] = frozenset({"stg", "prod"})


class UnsafeSettingsError(RuntimeError):
    """Settings that mustn't serve real users. Not a ValueError on purpose: pydantic wraps a
    ValueError in a ValidationError that prints part of the input, which holds the secrets;
    any other exception reaches the caller as it is, with only this message."""


# As the rate limits' client (common.limiter).
VALKEY_TIMEOUT_SECONDS = 2

# What a key of a service's secret holds until it's given a value: Terraform creates every key
# with it, and terraform-live-backend leaves an optional one without a value (an LLM
# provider's) at it, so it's filled once one is set (scripts/fill-service-secrets.sh).
UNFILLED_SECRET = "REPLACE_ME"


def filled(value: str | None) -> str:
    """`value`, or "" when it's unset or still UNFILLED_SECRET: a key nobody gave a value."""
    return "" if value is None or value.strip() == UNFILLED_SECRET else value


class ServiceSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    service_name: str = Field(pattern=r"^[a-z][a-z0-9_]{0,30}$", validation_alias="SERVICE_NAME")
    app_name: str = Field(
        default="superpower", pattern=r"^[a-z][a-z0-9-]{0,30}$", validation_alias="APP_NAME"
    )
    app_env: AppEnv = Field(default="local", validation_alias="APP_ENV")
    aws_region: str = Field(default="ap-south-1", validation_alias="AWS_REGION")
    # The image's commit (backend/Dockerfile sets GIT_SHA). Indexes are built once per
    # release with it (common.index_builds, DB-03), and at every start without one.
    release: str | None = Field(default=None, validation_alias="GIT_SHA")
    # The web app's origins, comma-separated ("https://superpower.example.com"). The public
    # app refuses cross-site writes carrying the session cookies from anywhere else
    # (common.origin, AUTH-05); unset, the check is off. common.serve reads the variable.
    public_origins: str = Field(default="", validation_alias="PUBLIC_ORIGINS")

    # ── MongoDB (section 4) ──
    mongodb_uri: str = Field(validation_alias="MONGODB_URI")
    mongodb_db_name: str = Field(validation_alias="MONGODB_DB_NAME")
    # Every task's pool counts toward the Atlas cluster's connection limit (M0 in dev and sbx:
    # 500; M10 in stg and prod: 1500), across every task of every service. Terraform's
    # mongodb_connection_budget checks the peak total (15.3, TF-03).
    mongodb_max_pool_size: int = Field(
        default=5, ge=1, le=100, validation_alias="MONGODB_MAX_POOL_SIZE"
    )

    # ── Valkey (9.3): unset means no cache, so the authz check and rate limits run per task ──
    redis_url: str | None = Field(default=None, validation_alias="REDIS_URL")
    # In AWS, the service's RBAC user and the replication group it signs its IAM token for
    # (common.valkey); unset locally, where the URL alone connects.
    redis_username: str | None = Field(default=None, validation_alias="REDIS_USERNAME")
    redis_replication_group_id: str | None = Field(
        default=None, validation_alias="REDIS_REPLICATION_GROUP_ID"
    )

    # ── internal calls (13.2) ──
    internal_dns_suffix: str = Field(default="", validation_alias="INTERNAL_DNS_SUFFIX")

    # ── telemetry (15.5): unset means traces stay in process (local runs) ──
    otel_exporter_otlp_endpoint: str | None = Field(
        default=None, validation_alias="OTEL_EXPORTER_OTLP_ENDPOINT"
    )
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = Field(
        default="INFO", validation_alias="LOG_LEVEL"
    )
    # S3 alone somewhere else than AWS_ENDPOINT_URL (common.uploads.s3_endpoint_url): set but
    # empty is AWS's own S3. Never set in AWS.
    aws_endpoint_url_s3: str | None = Field(default=None, validation_alias="AWS_ENDPOINT_URL_S3")

    # Behind CloudFront and the ALB the client's address comes from a header (15.1).
    behind_proxy: bool = Field(default=False, validation_alias="BEHIND_PROXY")

    @field_validator(
        "redis_url",
        "redis_username",
        "redis_replication_group_id",
        "otel_exporter_otlp_endpoint",
        mode="before",
    )
    @classmethod
    def _blank_is_unset(cls, value: Any) -> Any:
        return None if isinstance(value, str) and not value.strip() else value

    @property
    def events_prefix(self) -> str:
        """`{app}-{env}`: topics and queues are `{prefix}-{service}-events` (7.2)."""
        return f"{self.app_name}-{self.app_env}"

    @model_validator(mode="after")
    def _iam_valkey_needs_its_group(self) -> ServiceSettings:
        if self.redis_username and not self.redis_replication_group_id:
            raise ValueError("REDIS_USERNAME needs REDIS_REPLICATION_GROUP_ID (its IAM token)")
        return self

    def unsafe_settings(self) -> list[str]:
        """What's wrong for an environment real users reach; checked only in STRICT_ENVS."""
        problems = []
        if not self.redis_url:
            problems.append("REDIS_URL is unset: rate limits and the authz cache would be per task")
        elif not self.redis_url.startswith("rediss://"):
            problems.append("REDIS_URL must use TLS (rediss://)")
        if not self.redis_username:
            problems.append("REDIS_USERNAME is unset: Valkey's IAM sign-in needs it")
        # Every service has this field (Moto, locally); in AWS it must be the real endpoints.
        if getattr(self, "aws_endpoint_url", None):
            problems.append("AWS_ENDPOINT_URL is set: AWS calls would go to a local emulator")
        if self.aws_endpoint_url_s3:
            problems.append("AWS_ENDPOINT_URL_S3 is set: S3 calls would go to a local emulator")
        if not self.public_origins.strip():
            problems.append("PUBLIC_ORIGINS is unset: cross-site cookie writes wouldn't be refused")
        return problems

    @model_validator(mode="after")
    def _safe_for_real_users(self) -> ServiceSettings:
        if self.app_env in STRICT_ENVS and (problems := self.unsafe_settings()):
            raise UnsafeSettingsError(
                f"unsafe settings for APP_ENV={self.app_env}: " + "; ".join(problems)
            )
        return self

    def valkey_options(self) -> dict[str, Any]:
        """redis-py options for this service's Valkey: the IAM token provider in AWS."""
        from common.valkey import valkey_options

        return valkey_options(self)

    def valkey_client(self) -> Any:
        """The service's async Valkey client, or None without REDIS_URL.

        Short timeouts, so an unreachable Valkey fails at once and the authz check falls back
        to auth and its local cache (9.3) instead of hanging every request.
        """
        if not self.redis_url:
            return None
        import redis.asyncio as aioredis

        return aioredis.Redis.from_url(
            self.redis_url,
            socket_connect_timeout=VALKEY_TIMEOUT_SECONDS,
            socket_timeout=VALKEY_TIMEOUT_SECONDS,
            **self.valkey_options(),
        )

    def mongo_client(self, **kwargs: Any) -> AsyncMongoClient[dict[str, Any]]:
        """The service's MongoDB client, with the shared pool limit and UTC-aware dates."""
        options: dict[str, Any] = {
            "maxPoolSize": self.mongodb_max_pool_size,
            "tz_aware": True,
            "appname": self.service_name,
            "serverSelectionTimeoutMS": 5000,
            # A reply that never comes (a connection dropped without a reset) fails after
            # 30 s instead of holding the request or job forever (DB-02). Per socket read,
            # so a change stream's waits (about a second each) aren't cut short; the
            # client-wide timeoutMS would end the outbox relay's streams.
            "socketTimeoutMS": 30_000,
            **kwargs,
        }
        return AsyncMongoClient(self.mongodb_uri, **options)
