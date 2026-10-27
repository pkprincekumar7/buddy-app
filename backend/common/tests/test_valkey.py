"""common.valkey: the IAM-token sign-in each service uses for its own Valkey user in AWS."""

import asyncio
import os
import uuid
from urllib.parse import parse_qs, urlsplit

import pytest
import redis.asyncio as aioredis
from botocore.credentials import Credentials
from limits.storage import RedisStorage

from common import valkey
from common.limiter import RateLimits
from common.settings_base import ServiceSettings
from common.valkey import ElastiCacheIAMProvider, valkey_options

FAKE = Credentials("AKIDEXAMPLE", "fake-secret-for-tests")  # not a real key


def _provider(clock: list[float] | None = None) -> ElastiCacheIAMProvider:
    now = clock or [0.0]
    return ElastiCacheIAMProvider(
        "superpower-dev-users", "Superpower-Redis-Dev", "ap-south-1",
        credentials=FAKE, clock=lambda: now[0],
    )  # fmt: skip


def test_the_token_is_a_presigned_connect_request_for_the_user():
    user, token = _provider().get_credentials()
    assert user == "superpower-dev-users"
    assert not token.startswith("http")
    url = urlsplit(f"https://{token}")
    assert url.netloc == "superpower-redis-dev"  # signed lower-case
    query = parse_qs(url.query)
    assert query["Action"] == ["connect"] and query["User"] == ["superpower-dev-users"]
    assert query["X-Amz-Algorithm"] == ["AWS4-HMAC-SHA256"]
    assert query["X-Amz-Expires"] == ["900"]
    assert query["X-Amz-Credential"][0].endswith("/ap-south-1/elasticache/aws4_request")
    assert query["X-Amz-Credential"][0].startswith("AKIDEXAMPLE/")
    assert "X-Amz-Signature" in query


def test_a_token_is_reused_for_10_minutes_then_remade(monkeypatch):
    clock = [0.0]
    provider = _provider(clock)
    made = []
    real = provider._signer

    def counting():
        made.append(clock[0])
        return real()

    monkeypatch.setattr(provider, "_signer", counting)
    first = provider.token()
    clock[0] = 599.0
    assert provider.token() == first and made == [0.0]
    clock[0] = 600.0
    provider.token()
    assert made == [0.0, 600.0]


def test_it_needs_credentials_and_its_names(monkeypatch):
    with pytest.raises(ValueError):
        ElastiCacheIAMProvider("", "group", "ap-south-1")
    import botocore.session

    monkeypatch.setattr(botocore.session.Session, "get_credentials", lambda self: None)
    provider = ElastiCacheIAMProvider("u", "g", "ap-south-1")
    with pytest.raises(RuntimeError, match="no AWS credentials"):
        provider.token()


def _settings(**env: str) -> ServiceSettings:
    return ServiceSettings.model_validate(
        {"SERVICE_NAME": "users", "MONGODB_URI": "mongodb://x", "MONGODB_DB_NAME": "x", **env}
    )


def test_settings_choose_iam_in_aws_and_the_url_alone_locally(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)  # no .env
    for name in ("REDIS_URL", "REDIS_USERNAME", "REDIS_REPLICATION_GROUP_ID"):
        monkeypatch.delenv(name, raising=False)
    local = _settings(REDIS_URL="redis://localhost:6379")
    assert local.valkey_options() == {} and valkey_options(object()) == {}
    assert _settings().valkey_client() is None
    deployed = _settings(
        REDIS_URL="rediss://cache.example:6379",
        REDIS_USERNAME="superpower-dev-users",
        REDIS_REPLICATION_GROUP_ID="superpower-redis-dev",
    )
    provider = deployed.valkey_options()["credential_provider"]
    assert isinstance(provider, ElastiCacheIAMProvider) and provider.user == "superpower-dev-users"
    client = deployed.valkey_client()
    kwargs = client.connection_pool.connection_kwargs
    assert isinstance(kwargs["credential_provider"], ElastiCacheIAMProvider)
    # An unreachable Valkey fails fast, so requests fall back to auth (9.3).
    assert kwargs["socket_connect_timeout"] == kwargs["socket_timeout"] == 2
    asyncio.run(client.aclose())
    # Blank values are unset, and a user needs the group its token is signed for.
    assert _settings(REDIS_USERNAME=" ").redis_username is None
    with pytest.raises(ValueError, match="REDIS_REPLICATION_GROUP_ID"):
        _settings(REDIS_USERNAME="superpower-dev-users")


def test_the_rate_limits_sign_in_the_same_way():
    provider = _provider()
    limits = RateLimits(
        "redis://localhost:6390", prefix="users", redis_options={"credential_provider": provider}
    )
    assert limits._primary is not None
    storage = limits._primary.storage
    assert isinstance(storage, RedisStorage)
    assert storage.storage.connection_pool.connection_kwargs["credential_provider"] is provider


@pytest.mark.live_service
def test_a_client_signs_in_with_the_token(monkeypatch):
    """Against the local Valkey stand-in: an ACL user whose password is the token, as
    ElastiCache checks it, is signed into by a client that has only the provider."""
    url = os.environ.get("REDIS_URL")
    if not url:
        pytest.skip("REDIS_URL not set (the local Valkey stand-in)")

    async def run() -> None:
        user = f"iam-test-{uuid.uuid4().hex[:8]}"
        provider = ElastiCacheIAMProvider(user, "local", "ap-south-1", credentials=FAKE)
        admin = aioredis.Redis.from_url(url)
        try:
            await admin.acl_setuser(
                user,
                enabled=True,
                passwords=[f"+{provider.token()}"],
                keys=["*"],
                commands=["+ping"],
            )
            client = aioredis.Redis.from_url(url, credential_provider=provider)
            assert await client.ping() is True
            await client.aclose()
        finally:
            await admin.acl_deluser(user)
            await admin.aclose()

    asyncio.run(run())


def test_the_module_says_what_it_is_for():
    assert valkey.TOKEN_SECONDS == 900 and valkey.REUSE_SECONDS < valkey.TOKEN_SECONDS


def test_the_signer_survives_a_garbage_collection():
    import gc

    provider = _provider()
    signer = provider._signer()
    gc.collect()  # the signer's event emitter is a weak reference to the provider's session
    assert signer.generate_presigned_url(
        {
            "method": "GET",
            "url": "https://g/?Action=connect",
            "body": {},
            "headers": {},
            "context": {},
        },
        operation_name="connect",
    )
