from urllib.parse import quote_plus

from pydantic import AliasChoices, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


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
    jwt_secret: str = Field(
        default="change-me-in-production-use-long-random-string",
        validation_alias=AliasChoices("JWT_SECRET", "jwt_secret"),
    )
    jwt_expire_minutes: int = Field(
        default=60 * 24 * 30,
        validation_alias=AliasChoices(
            "JWT_EXPIRE_MINUTES",
            "JWT_ACCESS_EXPIRE_MINUTES",
            "jwt_expire_minutes",
        ),
    )

    cors_origins: str = Field(
        default="http://localhost:5173,http://127.0.0.1:5173",
        validation_alias=AliasChoices("CORS_ORIGINS", "cors_origins"),
    )

    jwt_algorithm: str = "HS256"
    demo_parent_pin: str = "1234"

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

        object.__setattr__(self, "database_url", "sqlite:///./buddy360.db")
        return self


settings = Settings()
