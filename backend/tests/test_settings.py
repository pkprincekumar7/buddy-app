"""app/settings.py — configuration loading and validation.

Each test builds a Settings from an empty environment (every variable the class
reads is removed, and the real .env file is skipped), so nothing on the
developer's machine leaks in.
"""

import logging

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from pydantic import ValidationError

import app.settings as settings_module
from app.settings import Settings, get_settings


def _pem(password=None):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    encryption = (
        serialization.BestAvailableEncryption(password)
        if password
        else serialization.NoEncryption()
    )
    private = key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, encryption
    ).decode()
    public = (
        key.public_key()
        .public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
        .decode()
    )
    return private, public


PRIVATE, PUBLIC = _pem()


@pytest.fixture(autouse=True)
def empty_environment(monkeypatch):
    for field in Settings.model_fields.values():
        for alias in getattr(field.validation_alias, "choices", []):
            monkeypatch.delenv(alias, raising=False)
            monkeypatch.delenv(alias.upper(), raising=False)


def _settings(**values):
    return Settings(
        _env_file=None, jwt_private_key=values.pop("jwt_private_key", PRIVATE), **values
    )


# ── defaults ─────────────────────────────────────────────────────────────────


def test_safe_defaults():
    s = _settings()
    assert (s.mongodb_uri, s.mongodb_db_name) == ("mongodb://localhost:27017", "superpower_app")
    assert (s.jwt_algorithm, s.jwt_key_id) == ("RS256", "key-v1")
    assert (s.jwt_access_expire_minutes, s.jwt_refresh_expire_hours) == (30, 24)
    assert s.cookie_secure is True and s.cookie_samesite == "lax" and s.cookie_domain is None
    assert s.behind_proxy is False  # never trust X-Forwarded-For unless told to
    assert s.cors_origins == "http://localhost:5173,http://127.0.0.1:5173"
    assert (s.llm_timeout_seconds, s.llm_hourly_limit) == (60, 200)
    assert s.redis_url is None and s.redis_auth_token is None
    assert s.google_client_id == "" and s.app_env == "local"


def test_jwt_private_key_is_required():
    with pytest.raises(ValidationError, match="JWT_PRIVATE_KEY\n  Field required"):
        Settings(_env_file=None)


# ── loading from the environment ─────────────────────────────────────────────


def test_values_load_from_environment_variables(monkeypatch):
    monkeypatch.setenv("JWT_PRIVATE_KEY", PRIVATE)
    monkeypatch.setenv("MONGODB_URI", "mongodb+srv://u:p@cluster.mongodb.net/")
    monkeypatch.setenv("BEHIND_PROXY", "true")
    monkeypatch.setenv("COOKIE_SECURE", "false")
    monkeypatch.setenv("LLM_HOURLY_LIMIT", "5")
    s = Settings(_env_file=None)
    assert s.mongodb_uri == "mongodb+srv://u:p@cluster.mongodb.net/"
    assert s.behind_proxy is True and s.cookie_secure is False and s.llm_hourly_limit == 5


def test_values_load_from_an_env_file_and_unknown_keys_are_ignored(tmp_path):
    env = tmp_path / ".env"
    one_line_key = PRIVATE.replace("\n", "\\n")
    env.write_text(
        f'JWT_PRIVATE_KEY="{one_line_key}"\nAPP_ENV=stg\nSOMETHING_UNRELATED=1\n', encoding="utf-8"
    )
    s = Settings(_env_file=env)
    assert s.app_env == "stg" and s.jwt_public_key == PUBLIC


def test_environment_variables_override_the_env_file(tmp_path, monkeypatch):
    env = tmp_path / ".env"
    env.write_text("APP_ENV=from-file\n", encoding="utf-8")
    monkeypatch.setenv("APP_ENV", "from-env")
    assert Settings(_env_file=env, jwt_private_key=PRIVATE).app_env == "from-env"


# ── MongoDB ──────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("uri", ["mongodb://localhost:27017", "mongodb+srv://u:p@c.mongodb.net/"])
def test_mongodb_uri_accepts_both_schemes(uri):
    assert _settings(mongodb_uri=uri).mongodb_uri == uri


@pytest.mark.parametrize("uri", ["localhost:27017", "http://localhost:27017", "", "postgres://x"])
def test_mongodb_uri_rejects_other_schemes_with_examples(uri):
    with pytest.raises(ValidationError, match="must start with mongodb:// or mongodb\\+srv://"):
        _settings(mongodb_uri=uri)


# ── JWT key ──────────────────────────────────────────────────────────────────


def test_public_key_is_derived_from_the_private_key():
    s = _settings()
    assert s.jwt_private_key == PRIVATE and s.jwt_public_key == PUBLIC


def test_single_line_key_with_escaped_newlines_is_accepted():
    # Docker Compose .env files can't hold multi-line values.
    s = _settings(jwt_private_key=PRIVATE.replace("\n", "\\n"))
    assert s.jwt_private_key == PRIVATE and s.jwt_public_key == PUBLIC


def test_public_key_cannot_be_supplied_separately():
    _, other_public = _pem()
    assert _settings(jwt_public_key=other_public).jwt_public_key == PUBLIC


@pytest.mark.parametrize(
    "key",
    ["", "not a key", PUBLIC, _pem(password=b"secret")[0]],
    ids=["empty", "garbage", "public-key", "encrypted"],
)
def test_invalid_jwt_keys_are_rejected_with_how_to_fix(key):
    with pytest.raises(ValidationError, match="openssl genrsa -out jwt_private.pem 2048"):
        _settings(jwt_private_key=key)


def test_signed_tokens_verify_with_the_derived_key():
    import jwt

    s = _settings()
    token = jwt.encode({"sub": "u1"}, s.jwt_private_key, algorithm=s.jwt_algorithm)
    assert jwt.decode(token, s.jwt_public_key, algorithms=[s.jwt_algorithm]) == {"sub": "u1"}


# ── Google client id ─────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("raw", "client_id"),
    [
        (None, ""),
        ("", ""),
        ("  abc.apps.googleusercontent.com \n", "abc.apps.googleusercontent.com"),
        ('"abc.apps.googleusercontent.com"', "abc.apps.googleusercontent.com"),
        ("' abc '", "abc"),
        ("\"abc'", "\"abc'"),  # mismatched quotes are not stripped
        ('"', '"'),  # a lone quote isn't a quoted value
        ('""', ""),
    ],
)
def test_google_client_id_is_trimmed_and_unquoted(raw, client_id):
    assert _settings(google_client_id=raw).google_client_id == client_id


# ── CORS ─────────────────────────────────────────────────────────────────────


def test_cors_accepts_explicit_origins_and_ignores_blank_entries():
    value = "https://app.example.com, http://localhost:5173,,"
    assert _settings(cors_origins=value).cors_origins == value


@pytest.mark.parametrize("origins", ["*", "https://app.example.com,*", " * "])
def test_cors_wildcard_is_rejected(origins):
    with pytest.raises(ValidationError, match="must not be set to '\\*'"):
        _settings(cors_origins=origins)


@pytest.mark.parametrize("origin", ["app.example.com", "ftp://x", "//app.example.com"])
def test_cors_origins_need_a_scheme(origin):
    with pytest.raises(ValidationError, match="must start with http:// or https://"):
        _settings(cors_origins=f"https://ok.example.com,{origin}")


# ── LLM ──────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("field", ["llm_timeout_seconds", "llm_hourly_limit"])
@pytest.mark.parametrize("value", [0, -1])
def test_llm_limits_must_be_positive(field, value):
    with pytest.raises(ValidationError):
        _settings(**{field: value})


def test_warns_when_no_llm_key_is_set(caplog):
    with caplog.at_level(logging.WARNING, logger="app.settings"):
        _settings()
    assert "No LLM API key is set" in caplog.text


@pytest.mark.parametrize("key", ["openai_api_key", "anthropic_api_key", "gemini_api_key"])
def test_any_one_llm_key_silences_the_warning(caplog, key):
    with caplog.at_level(logging.WARNING, logger="app.settings"):
        _settings(**{key: "k"})
    assert "No LLM API key" not in caplog.text


# ── cookies ──────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(("raw", "value"), [("Strict", "strict"), ("LAX", "lax"), ("None", "none")])
def test_samesite_is_case_insensitive(raw, value):
    assert _settings(cookie_samesite=raw).cookie_samesite == value


def test_samesite_rejects_unknown_values():
    with pytest.raises(ValidationError, match="COOKIE_SAMESITE must be one of"):
        _settings(cookie_samesite="sometimes")


def test_samesite_none_requires_secure_cookies():
    # Browsers silently drop SameSite=None cookies without Secure.
    with pytest.raises(ValidationError, match="COOKIE_SAMESITE=none requires COOKIE_SECURE=true"):
        _settings(cookie_samesite="none", cookie_secure=False)
    assert _settings(cookie_samesite="none", cookie_secure=True).cookie_samesite == "none"


@pytest.mark.parametrize(("env", "secure", "warned"), [
    ("prod", False, True), ("PROD", False, True), ("prod", True, False), ("stg", False, False),
])  # fmt: skip
def test_insecure_cookies_in_prod_are_warned_about(caplog, env, secure, warned):
    with caplog.at_level(logging.WARNING, logger="app.settings"):
        _settings(app_env=env, cookie_secure=secure)
    assert ("COOKIE_SECURE=false in a production environment" in caplog.text) is warned


# ── the singleton ────────────────────────────────────────────────────────────


def test_get_settings_returns_the_module_singleton():
    assert get_settings() is settings_module.settings
    assert get_settings() is get_settings()
