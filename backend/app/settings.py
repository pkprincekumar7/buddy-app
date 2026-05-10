import json
import logging
from urllib.parse import quote_plus

from pydantic import AliasChoices, Field, PrivateAttr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

log = logging.getLogger(__name__)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str | None = Field(
        default=None,
        validation_alias=AliasChoices("DATABASE_URL", "database_url"),
    )
    postgres_host: str | None = Field(default=None, validation_alias=AliasChoices("POSTGRES_HOST", "postgres_host"))
    postgres_port: str = Field(default="5432", validation_alias=AliasChoices("POSTGRES_PORT", "postgres_port"))
    postgres_user: str | None = Field(default=None, validation_alias=AliasChoices("POSTGRES_USER", "postgres_user"))
    postgres_password: str | None = Field(
        default=None, validation_alias=AliasChoices("POSTGRES_PASSWORD", "postgres_password")
    )
    postgres_db: str | None = Field(default=None, validation_alias=AliasChoices("POSTGRES_DB", "postgres_db"))
    openai_api_key: str = Field(
        default="",
        validation_alias=AliasChoices("OPENAI_API_KEY", "openai_api_key"),
    )
    openai_model: str = Field(
        default="gpt-4o-mini",
        validation_alias=AliasChoices("OPENAI_MODEL", "openai_model"),
    )
    anthropic_api_key: str = Field(
        default="",
        validation_alias=AliasChoices("ANTHROPIC_API_KEY", "anthropic_api_key"),
    )
    anthropic_model: str = Field(
        default="claude-sonnet-4-6",
        validation_alias=AliasChoices("ANTHROPIC_MODEL", "anthropic_model"),
    )
    gemini_api_key: str = Field(
        default="",
        validation_alias=AliasChoices("GEMINI_API_KEY", "gemini_api_key"),
    )
    gemini_model: str = Field(
        default="gemini-1.5-flash",
        validation_alias=AliasChoices("GEMINI_MODEL", "gemini_model"),
    )
    jwt_secret: str = Field(
        validation_alias=AliasChoices("JWT_SECRET", "jwt_secret"),
    )

    @field_validator("jwt_secret")
    @classmethod
    def validate_jwt_secret(cls, v: str) -> str:
        if len(v) < 32:
            raise ValueError(
                f"JWT_SECRET must be at least 32 characters long (got {len(v)}). "
                "Set the JWT_SECRET environment variable to a long random string."
            )
        return v

    jwt_access_expire_minutes: int = Field(
        default=30,
        validation_alias=AliasChoices("JWT_ACCESS_EXPIRE_MINUTES", "jwt_access_expire_minutes"),
    )
    jwt_refresh_expire_hours: int = Field(
        default=24,
        validation_alias=AliasChoices("JWT_REFRESH_EXPIRE_HOURS", "jwt_refresh_expire_hours"),
    )

    google_client_id: str = Field(
        default="",
        validation_alias=AliasChoices("GOOGLE_CLIENT_ID", "google_client_id"),
    )

    @field_validator("google_client_id", mode="before")
    @classmethod
    def normalize_google_client_id(cls, v: object) -> str:
        if v is None:
            return ""
        s = str(v).strip()
        if len(s) >= 2 and s[0] == s[-1] and s[0] in "\"'":
            s = s[1:-1].strip()
        return s

    cors_origins: str = Field(
        default="http://localhost:5173,http://127.0.0.1:5173",
        validation_alias=AliasChoices("CORS_ORIGINS", "cors_origins"),
    )

    @field_validator("cors_origins")
    @classmethod
    def validate_cors_origins(cls, v: str) -> str:
        for origin in (o.strip() for o in v.split(",") if o.strip()):
            if origin == "*":
                raise ValueError(
                    "CORS_ORIGINS must not be set to '*'. "
                    "Specify explicit origins (e.g. https://yourapp.com)."
                )
            if not (origin.startswith("http://") or origin.startswith("https://")):
                raise ValueError(
                    f"CORS origin must start with http:// or https://: {origin!r}"
                )
        return v

    jwt_algorithm: str = "HS256"

    app_env: str = Field(
        default="local",
        validation_alias=AliasChoices("APP_ENV", "app_env"),
    )

    behind_proxy: bool = Field(
        default=False,
        validation_alias=AliasChoices("BEHIND_PROXY", "behind_proxy"),
    )

    llm_timeout_seconds: int = Field(
        default=60,
        validation_alias=AliasChoices("LLM_TIMEOUT_SECONDS", "llm_timeout_seconds"),
    )

    postgres_pool_size: int = Field(
        default=5,
        validation_alias=AliasChoices("POSTGRES_POOL_SIZE", "postgres_pool_size"),
    )
    postgres_max_overflow: int = Field(
        default=10,
        validation_alias=AliasChoices("POSTGRES_MAX_OVERFLOW", "postgres_max_overflow"),
    )

    # ---------------------------------------------------------------------------
    # Multi-region routing (all optional — omit for single-instance mode)
    # ---------------------------------------------------------------------------

    # Dedicated PostgreSQL instance that stores only email_hash → region mappings.
    # Falls back to the main database_url when not set.
    router_db_url: str | None = Field(
        default=None,
        validation_alias=AliasChoices("ROUTER_DB_URL", "router_db_url"),
    )

    # Raw JSON string read from the REGIONAL_DB_URLS environment variable.
    # Intentionally excluded from model_dump() and repr — use the parsed
    # `regional_db_urls` property instead.
    # Example env value: '{"eu": "postgresql://...", "us": "postgresql://..."}'
    regional_db_urls_raw: str = Field(
        default="{}",
        exclude=True,
        repr=False,
        validation_alias=AliasChoices("REGIONAL_DB_URLS", "regional_db_urls_raw"),
    )

    # Redis URL for the per-user LLM rate limiter (sliding window, LLM_HOURLY_LIMIT req/hour).
    # When not set the rate limiter falls back to an in-process counter — correct
    # for single-instance local dev but breaks under multiple pods.
    redis_url: str | None = Field(
        default=None,
        validation_alias=AliasChoices("REDIS_URL", "redis_url"),
    )

    # Maximum LLM calls per user per hour. Set generously — the per-minute slowapi
    # limit handles burst abuse; this cap is purely for sustained cost exposure.
    llm_hourly_limit: int = Field(
        default=200,
        validation_alias=AliasChoices("LLM_HOURLY_LIMIT", "llm_hourly_limit"),
    )

    # The region assigned when no JWT is present (register/login flows in
    # single-instance mode, and as a safe fallback).
    default_region: str = Field(
        default="local",
        validation_alias=AliasChoices("DEFAULT_REGION", "default_region"),
    )

    # How often the background reconciler runs (minutes).
    # The reconciler repairs stale 'pending' UserRegionRecord rows left behind
    # by a failed Phase 2 or Phase 3 saga write.
    reconciler_interval_minutes: int = Field(
        default=5,
        validation_alias=AliasChoices("RECONCILER_INTERVAL_MINUTES", "reconciler_interval_minutes"),
    )

    # Parsed once at startup; never re-parsed on every request.
    _regional_db_urls_parsed: dict[str, str] = PrivateAttr(default_factory=dict)

    @model_validator(mode="after")
    def _parse_regional_db_urls(self) -> "Settings":
        """Parse and validate REGIONAL_DB_URLS once at startup.

        Logs a WARNING for any invalid entry so misconfigured multi-region
        deployments fail visibly rather than silently falling back to the
        main DB and writing data to the wrong region.
        """
        from sqlalchemy.engine import make_url as _make_url
        from sqlalchemy.exc import ArgumentError as _ArgError

        raw = self.regional_db_urls_raw.strip()
        if not raw:
            # Empty string means single-instance / single-region — not an error.
            result = {}
        else:
            try:
                result = json.loads(raw) or {}
            except json.JSONDecodeError as exc:
                log.error(
                    "REGIONAL_DB_URLS is not valid JSON — falling back to "
                    "single-instance mode.  error=%s",
                    exc,
                )
                result = {}

        for region_key, url in list(result.items()):
            try:
                _make_url(url)
            except (_ArgError, Exception) as exc:
                log.warning(
                    "REGIONAL_DB_URLS[%r] is not a valid DB URL — removing from "
                    "routing map, traffic will fall back to main engine.  error=%s",
                    region_key, exc,
                )
                del result[region_key]

        object.__setattr__(self, "_regional_db_urls_parsed", result)
        return self

    @property
    def regional_db_urls(self) -> dict[str, str]:
        """Parsed regional DB URL map. Returns empty dict in single-instance mode."""
        return self._regional_db_urls_parsed

    # Cookie settings for HttpOnly auth tokens.
    # Set COOKIE_SECURE=false only for local HTTP development; always True in production.
    cookie_secure: bool = Field(
        default=True,
        validation_alias=AliasChoices("COOKIE_SECURE", "cookie_secure"),
    )
    # "lax" allows navigation from external links while blocking cross-site state-changing requests.
    cookie_samesite: str = Field(
        default="lax",
        validation_alias=AliasChoices("COOKIE_SAMESITE", "cookie_samesite"),
    )
    # Only set if cookies must span subdomains (e.g. ".example.com"). Leave blank otherwise.
    cookie_domain: str | None = Field(
        default=None,
        validation_alias=AliasChoices("COOKIE_DOMAIN", "cookie_domain"),
    )

    @field_validator("cookie_samesite", mode="before")
    @classmethod
    def normalise_cookie_samesite(cls, v: object) -> object:
        return v.lower() if isinstance(v, str) else v

    @model_validator(mode="after")
    def validate_cookie_settings(self) -> "Settings":
        allowed = {"lax", "strict", "none"}
        if self.cookie_samesite.lower() not in allowed:
            raise ValueError(
                f"COOKIE_SAMESITE must be one of {allowed!r} (got {self.cookie_samesite!r})"
            )
        if self.cookie_samesite.lower() == "none" and not self.cookie_secure:
            raise ValueError(
                "COOKIE_SAMESITE=none requires COOKIE_SECURE=true. "
                "Browsers silently drop cookies with SameSite=None without the Secure flag."
            )
        return self

    @model_validator(mode="after")
    def warn_production_jwt_secret(self):
        if self.app_env.lower() == "prod" and len(self.jwt_secret) < 64:
            log.warning(
                "JWT_SECRET is only %d characters. In production, use a randomly "
                "generated secret of at least 64 characters "
                "(e.g. python -c \"import secrets; print(secrets.token_hex(32))\").",
                len(self.jwt_secret),
            )
        return self

    @model_validator(mode="after")
    def warn_production_cookie_security(self):
        if self.app_env.lower() == "prod" and not self.cookie_secure:
            log.warning(
                "COOKIE_SECURE=false in a production environment — auth cookies will "
                "not be restricted to HTTPS.  Set COOKIE_SECURE=true unless you are "
                "explicitly terminating TLS before this service."
            )
        return self

    @model_validator(mode="after")
    def warn_if_no_llm_key(self):
        if not any([self.openai_api_key, self.anthropic_api_key, self.gemini_api_key]):
            log.warning(
                "No LLM API key is set — LLM features will be disabled. "
                "Set at least one of OPENAI_API_KEY, ANTHROPIC_API_KEY, or GEMINI_API_KEY."
            )
        return self

    @model_validator(mode="after")
    def assemble_database_url(self):
        if self.database_url is not None:
            return self

        host = self.postgres_host
        user = self.postgres_user
        password = self.postgres_password
        dbname = self.postgres_db

        if host and user is not None and password is not None and dbname:
            url = (
                f"postgresql+psycopg://{quote_plus(user)}:{quote_plus(password)}"
                f"@{host}:{self.postgres_port}/{dbname}"
            )
            object.__setattr__(self, "database_url", url)
            return self

        if self.app_env.lower() == "prod":
            raise ValueError(
                "No database configuration found. "
                "Set DATABASE_URL or POSTGRES_* environment variables. "
                "SQLite is not permitted in production."
            )
        log.warning(
            "No database configuration found — falling back to SQLite (sqlite:///./buddy360.db). "
            "Set DATABASE_URL or POSTGRES_* environment variables for production use."
        )
        object.__setattr__(self, "database_url", "sqlite:///./buddy360.db")
        return self


settings = Settings()
