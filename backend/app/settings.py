import logging
import re

from pydantic import AliasChoices, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_LOCATION_RE = re.compile(r"^[a-z0-9_-]{1,16}$")

log = logging.getLogger(__name__)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    mongodb_uri: str = Field(
        default="mongodb://localhost:27017",
        validation_alias=AliasChoices("MONGODB_URI", "mongodb_uri"),
    )
    mongodb_db_name: str = Field(
        default="buddy_app",
        validation_alias=AliasChoices("MONGODB_DB_NAME", "mongodb_db_name"),
    )
    default_location: str = Field(
        default="us",
        validation_alias=AliasChoices("DEFAULT_LOCATION", "default_location"),
    )

    @field_validator("mongodb_uri")
    @classmethod
    def validate_mongodb_uri(cls, v: str) -> str:
        if not (v.startswith("mongodb://") or v.startswith("mongodb+srv://")):
            raise ValueError(
                f"MONGODB_URI must start with mongodb:// or mongodb+srv://, got {v!r}. "
                "Local example: mongodb://localhost:27017  "
                "Atlas example: mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/"
            )
        return v

    @field_validator("default_location")
    @classmethod
    def validate_default_location(cls, v: str) -> str:
        if not _LOCATION_RE.match(v):
            raise ValueError(
                f"DEFAULT_LOCATION must match [a-z0-9_-]{{1,16}} (got {v!r}). "
                "Valid examples: us, eu, apac, in, br, me, cn, ru."
            )
        return v

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
    jwt_algorithm: str = "HS256"

    openai_api_key: str = Field(
        default="",
        validation_alias=AliasChoices("OPENAI_API_KEY", "openai_api_key"),
    )
    openai_model: str = Field(
        default="gpt-5.4-mini",
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
        default="gemini-3-flash",
        validation_alias=AliasChoices("GEMINI_MODEL", "gemini_model"),
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
                raise ValueError(f"CORS origin must start with http:// or https://: {origin!r}")
        return v

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
        gt=0,
        validation_alias=AliasChoices("LLM_TIMEOUT_SECONDS", "llm_timeout_seconds"),
    )
    llm_hourly_limit: int = Field(
        default=200,
        gt=0,
        validation_alias=AliasChoices("LLM_HOURLY_LIMIT", "llm_hourly_limit"),
    )

    redis_url: str | None = Field(
        default=None,
        validation_alias=AliasChoices("REDIS_URL", "redis_url"),
    )

    # S3 bucket that holds static assets and mobile app builds.
    # The GitHub Actions build-android-apk workflow writes APKs to:
    #   s3://{backend_bucket_name}/app-assets/applications/android/app-release-{timestamp}.apk
    # The /downloads/apk endpoint reads this bucket to generate pre-signed URLs.
    # The bucket always lives in us-east-1, regardless of which region the backend
    # is deployed to — a single global bucket is intentional to avoid multi-region
    # S3 complexity while the app scales to new regions.
    backend_bucket_name: str = Field(
        default="",
        validation_alias=AliasChoices("BACKEND_BUCKET_NAME", "backend_bucket_name"),
    )

    cookie_secure: bool = Field(
        default=True,
        validation_alias=AliasChoices("COOKIE_SECURE", "cookie_secure"),
    )
    cookie_samesite: str = Field(
        default="lax",
        validation_alias=AliasChoices("COOKIE_SAMESITE", "cookie_samesite"),
    )
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
                '(e.g. python -c "import secrets; print(secrets.token_hex(32))").',
                len(self.jwt_secret),
            )
        return self

    @model_validator(mode="after")
    def warn_production_cookie_security(self):
        if self.app_env.lower() == "prod" and not self.cookie_secure:
            log.warning(
                "COOKIE_SECURE=false in a production environment — auth cookies will "
                "not be restricted to HTTPS. Set COOKIE_SECURE=true unless you are "
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


settings = Settings()  # type: ignore[call-arg]  # pydantic-settings loads required fields from env
