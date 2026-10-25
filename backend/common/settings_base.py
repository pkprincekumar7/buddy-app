"""Settings every service shares (docs/auth-users-split.md, sections 4, 9.3, 13.2, 15).

A service subclasses `ServiceSettings` and adds its own fields. Values come from the
environment (in AWS, the task definition and its secrets); a `.env` in the working
directory is read too, for local runs.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from pymongo import AsyncMongoClient

AppEnv = Literal["local", "dev", "sbx", "stg", "prod"]


class ServiceSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    service_name: str = Field(pattern=r"^[a-z][a-z0-9_]{0,30}$", validation_alias="SERVICE_NAME")
    app_name: str = Field(
        default="superpower", pattern=r"^[a-z][a-z0-9-]{0,30}$", validation_alias="APP_NAME"
    )
    app_env: AppEnv = Field(default="local", validation_alias="APP_ENV")
    aws_region: str = Field(default="ap-south-1", validation_alias="AWS_REGION")

    # ── MongoDB (section 4) ──
    mongodb_uri: str = Field(validation_alias="MONGODB_URI")
    mongodb_db_name: str = Field(validation_alias="MONGODB_DB_NAME")
    # Atlas M0 (dev, sbx, stg) allows 500 connections per cluster across every task of every
    # service: 5 per task keeps a busy environment well inside that (15.3).
    mongodb_max_pool_size: int = Field(
        default=5, ge=1, le=100, validation_alias="MONGODB_MAX_POOL_SIZE"
    )

    # ── Valkey (9.3): unset means no cache, so the authz check and rate limits run per task ──
    redis_url: str | None = Field(default=None, validation_alias="REDIS_URL")

    # ── internal calls (13.2) ──
    internal_dns_suffix: str = Field(default="", validation_alias="INTERNAL_DNS_SUFFIX")

    # ── telemetry (15.5): unset means traces stay in process (local runs) ──
    otel_exporter_otlp_endpoint: str | None = Field(
        default=None, validation_alias="OTEL_EXPORTER_OTLP_ENDPOINT"
    )
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = Field(
        default="INFO", validation_alias="LOG_LEVEL"
    )
    # Behind CloudFront and the ALB the client's address comes from a header (15.1).
    behind_proxy: bool = Field(default=False, validation_alias="BEHIND_PROXY")

    @field_validator("redis_url", "otel_exporter_otlp_endpoint", mode="before")
    @classmethod
    def _blank_is_unset(cls, value: Any) -> Any:
        return None if isinstance(value, str) and not value.strip() else value

    @property
    def events_prefix(self) -> str:
        """`{app}-{env}`: topics and queues are `{prefix}-{service}-events` (7.2)."""
        return f"{self.app_name}-{self.app_env}"

    def mongo_client(self, **kwargs: Any) -> AsyncMongoClient[dict[str, Any]]:
        """The service's MongoDB client, with the shared pool limit and UTC-aware dates."""
        options: dict[str, Any] = {
            "maxPoolSize": self.mongodb_max_pool_size,
            "tz_aware": True,
            "appname": self.service_name,
            "serverSelectionTimeoutMS": 5000,
            **kwargs,
        }
        return AsyncMongoClient(self.mongodb_uri, **options)
