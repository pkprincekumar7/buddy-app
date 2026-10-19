import logging
from functools import lru_cache

from cryptography.hazmat.primitives.serialization import (
    Encoding,
    PublicFormat,
    load_pem_private_key,
    load_pem_public_key,
)
from pydantic import AliasChoices, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

log = logging.getLogger(__name__)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    mongodb_uri: str = Field(
        default="mongodb://localhost:27017",
        validation_alias=AliasChoices("MONGODB_URI", "mongodb_uri"),
    )
    mongodb_db_name: str = Field(
        default="superpower_app",
        validation_alias=AliasChoices("MONGODB_DB_NAME", "mongodb_db_name"),
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

    jwt_private_key: str = Field(
        validation_alias=AliasChoices("JWT_PRIVATE_KEY", "jwt_private_key"),
    )

    @field_validator("jwt_private_key")
    @classmethod
    def validate_jwt_private_key(cls, v: str) -> str:
        # Docker Compose .env files don't support multiline values.
        # The key may be stored as a single line with literal \n escape sequences.
        v = v.replace("\\n", "\n")
        try:
            load_pem_private_key(v.encode(), password=None)
        except Exception as exc:
            raise ValueError(
                "JWT_PRIVATE_KEY must be a valid RSA private key in PEM format. "
                "Generate one with: openssl genrsa -out jwt_private.pem 2048"
            ) from exc
        return v

    jwt_key_id: str = Field(
        default="key-v1",
        validation_alias=AliasChoices("JWT_KEY_ID", "jwt_key_id"),
    )

    jwt_access_expire_minutes: int = Field(
        default=30,
        validation_alias=AliasChoices("JWT_ACCESS_EXPIRE_MINUTES", "jwt_access_expire_minutes"),
    )
    jwt_refresh_expire_hours: int = Field(
        default=24,
        validation_alias=AliasChoices("JWT_REFRESH_EXPIRE_HOURS", "jwt_refresh_expire_hours"),
    )
    jwt_algorithm: str = "RS256"
    jwt_public_key: str = ""

    # kid → RSA public key PEM, as JSON — the same JWT_PUBLIC_KEYS GitHub
    # secret the Lambda@Edge validator uses (APP-02). Lets tokens signed with
    # an outgoing key keep validating during a rotation instead of logging
    # everyone out. Optional: the current key (jwt_key_id → the public half of
    # jwt_private_key) is always accepted, so a deployment without it behaves
    # exactly as before. See docs/jwt-keys.md.
    jwt_public_keys: dict[str, str] = Field(
        default_factory=dict,
        validation_alias=AliasChoices("JWT_PUBLIC_KEYS", "jwt_public_keys"),
    )
    # The key map tokens are actually verified against: jwt_public_keys plus
    # the current signing key. Derived below; not settable.
    jwt_verification_keys: dict[str, str] = Field(default_factory=dict)

    # Tolerated clock skew (seconds) for exp/nbf/iat — tokens are minted in the
    # bootstrap region and verified in the home region. Same value as the
    # edge's CLOCK_SKEW_LEEWAY_SECONDS.
    jwt_leeway_seconds: int = Field(
        default=30,
        validation_alias=AliasChoices("JWT_LEEWAY_SECONDS", "jwt_leeway_seconds"),
    )

    # `iss` / `aud` claims (EDGE-04). Every token is stamped with both and every
    # decode requires both, so a token minted by another environment fails
    # even if it was (wrongly) signed with the same key. Deployed values come
    # from Terraform — "<app_name>-<environment>" and "<app_name>-api", the
    # same expressions the Lambda@Edge validator is built with
    # (infra-live-backend ecs.tf, infra-live-edge lambda_edge.tf).
    jwt_issuer: str = Field(
        default="superpower-local",
        min_length=1,
        validation_alias=AliasChoices("JWT_ISSUER", "jwt_issuer"),
    )
    jwt_audience: str = Field(
        default="superpower-api",
        min_length=1,
        validation_alias=AliasChoices("JWT_AUDIENCE", "jwt_audience"),
    )

    @model_validator(mode="after")
    def derive_jwt_public_key(self) -> "Settings":
        private_key = load_pem_private_key(self.jwt_private_key.encode(), password=None)
        public_pem = (
            private_key.public_key()
            .public_bytes(Encoding.PEM, PublicFormat.SubjectPublicKeyInfo)
            .decode()
        )
        object.__setattr__(self, "jwt_public_key", public_pem)

        keys: dict[str, str] = {}
        for kid, pem in self.jwt_public_keys.items():
            pem = pem.replace("\\n", "\n")
            try:
                public_key = load_pem_public_key(pem.encode())
            except Exception as exc:
                raise ValueError(f"JWT_PUBLIC_KEYS[{kid!r}] is not a valid PEM public key") from exc
            keys[kid] = public_key.public_bytes(
                Encoding.PEM, PublicFormat.SubjectPublicKeyInfo
            ).decode()
        listed = keys.get(self.jwt_key_id)
        if listed is not None and listed != public_pem:
            raise ValueError(
                f"JWT_PUBLIC_KEYS[{self.jwt_key_id!r}] doesn't match JWT_PRIVATE_KEY — the "
                "signing key's kid must map to its own public key (check JWT_KEY_ID)"
            )
        keys[self.jwt_key_id] = public_pem
        object.__setattr__(self, "jwt_verification_keys", keys)
        return self

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

    redis_auth_token: str | None = Field(
        default=None,
        validation_alias=AliasChoices("REDIS_AUTH_TOKEN", "redis_auth_token"),
    )

    # S3 bucket that holds static assets and mobile app builds.
    # The GitHub Actions build-android-apk workflow writes APKs to:
    #   s3://{assets_bucket_name}/app-assets/applications/android/app-release-{timestamp}.apk
    # The /downloads/apk endpoint reads this bucket to generate pre-signed URLs.
    # The bucket always lives in us-east-1, regardless of which region the backend
    # is deployed to — a single global bucket is intentional to avoid multi-region
    # S3 complexity while the app scales to new regions.
    assets_bucket_name: str = Field(
        default="",
        validation_alias=AliasChoices("ASSETS_BUCKET_NAME", "assets_bucket_name"),
    )

    # S3 bucket for user-generated uploads (child profile photos, etc.).
    # In local dev, set to the manually-created local uploads bucket.
    # In deployed environments, populated via ECS task environment / GitHub secret.
    uploads_bucket_name: str = Field(
        default="",
        validation_alias=AliasChoices("UPLOADS_BUCKET_NAME", "uploads_bucket_name"),
    )
    # AWS region the backend is deployed to — set by GitHub Actions / Terraform.
    # Used for S3 clients that must target the deployment region (e.g. uploads bucket).
    aws_region: str = Field(
        default="",
        validation_alias=AliasChoices("AWS_REGION", "aws_region"),
    )
    # Lifetime (seconds) of the S3 presigned GET URLs the API returns for
    # photos (EDGE-05; app/services/s3_uploads.py). Photos are private: Mongo
    # stores only S3 keys and every read presigns them. A URL can end sooner
    # if the signing credentials (the ECS task role's) expire first.
    uploads_url_ttl_seconds: int = Field(
        default=3600,
        ge=300,
        le=86400,
        validation_alias=AliasChoices("UPLOADS_URL_TTL_SECONDS", "uploads_url_ttl_seconds"),
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


@lru_cache
def get_settings() -> Settings:
    """FastAPI dependency wrapper around the module-level `settings` singleton.

    Returns the same instance on every call (cached) so it's cheap to inject via
    Depends(get_settings) in request handlers. Tests can override it per-case with
    app.dependency_overrides[get_settings] without touching the module singleton
    that non-request code (validators, auth_utils, worker.py) imports directly.
    """
    return settings
