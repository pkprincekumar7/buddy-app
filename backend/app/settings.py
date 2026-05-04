import logging
from urllib.parse import quote_plus

from pydantic import AliasChoices, Field, field_validator, model_validator
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
        for origin in (o.strip() for o in v.split(",")):
            if origin == "*":
                raise ValueError(
                    "CORS_ORIGINS must not be set to '*'. "
                    "Specify explicit origins (e.g. https://yourapp.com)."
                )
        return v

    jwt_algorithm: str = "HS256"

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

        log.warning(
            "No database configuration found — falling back to SQLite (sqlite:///./buddy360.db). "
            "Set DATABASE_URL or POSTGRES_* environment variables for production use."
        )
        object.__setattr__(self, "database_url", "sqlite:///./buddy360.db")
        return self


settings = Settings()
