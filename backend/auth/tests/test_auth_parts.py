"""auth's building blocks: emails and peppers, tokens and passwords, the versioned authz
write (against the local Valkey), the login throttle's fallback, the runtime, the seed."""

import asyncio
import json
import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
import redis.asyncio as aioredis
from auth_testkit import (
    AUTH_PRIVATE,
    JWT_PRIVATE,
    JWT_PUBLIC,
    KID,
    OLD_PEPPER,
    OTHER_PUBLIC,
    PEPPER,
    authz_config,
    issuer,
    running,
)
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from pymongo import AsyncMongoClient
from redis.exceptions import ConnectionError as RedisConnectionError

from auth import seed
from auth.app import main
from auth.app.authz_cache import delete_entry, entry_from_account, entry_json, write_entry
from auth.app.runtime import Runtime
from auth.app.store import ALLOWED_EMAILS, AUTH, new_credentials
from auth.app.throttle import LoginThrottle
from auth.app.tokens import (
    InvalidToken,
    TokenIssuer,
    access_subject,
    check_password,
    decode_refresh,
    hash_password,
)
from auth.emails import Peppers, is_valid_address, log_key, mask, normalise
from common.authz import AuthzConfig, AuthzEntry

USER = str(uuid.uuid4())

# ── emails ─────────────────────────────────────────────────────────────────────


def test_normalise_trims_and_lower_cases_only():
    assert normalise("  Jane.Doe+Tag@Example.COM ") == "jane.doe+tag@example.com"
    assert normalise("j.a.n.e@gmail.com") == "j.a.n.e@gmail.com"  # no Gmail dot stripping


def test_addresses_hints_and_log_keys():
    assert is_valid_address("jane@example.com") and not is_valid_address("jane@")
    assert mask("Jane.Doe@Example.com") == "j***@example.com"
    assert log_key("ab" * 32) == "ab" * 8


def test_keys_are_hmacs_that_need_the_pepper():
    peppers = Peppers.parse(PEPPER)
    key = peppers.key(" JANE@example.com")
    assert len(key) == 64 and key == peppers.key("jane@example.com")
    assert key != Peppers.parse(OLD_PEPPER).key("jane@example.com")
    import hashlib

    assert key != hashlib.sha256(b"jane@example.com").hexdigest()


def test_during_a_rotation_the_highest_version_is_current_and_tried_first():
    peppers = Peppers.parse(json.dumps({"1": OLD_PEPPER, "2": PEPPER}))
    assert peppers.current == 2
    assert [v for v, _ in peppers.keys("a@b.c")] == [2, 1]
    assert peppers.key("a@b.c") == Peppers.parse(PEPPER).key("a@b.c")
    assert peppers.key("a@b.c", 1) == Peppers.parse(OLD_PEPPER).key("a@b.c")


@pytest.mark.parametrize(
    "raw,message",
    [
        ("", "shorter"),
        ("short", "shorter"),
        ("{not json", "valid JSON"),
        ('{"one": "x"}', "map versions"),
        ("[]", "shorter"),
        ("{}", "empty"),
        (json.dumps({"0": PEPPER}), "start at 1"),
    ],
)
def test_bad_peppers_are_refused(raw, message):
    with pytest.raises(ValueError, match=message):
        Peppers.parse(raw)


# ── passwords and tokens ───────────────────────────────────────────────────────


def test_passwords():
    hashed = hash_password("s3cure-pass")
    assert hashed.startswith("$2b$12$") and check_password("s3cure-pass", hashed)
    assert not check_password("wrong", hashed)
    assert not check_password("s3cure-pass", "not-a-bcrypt-hash")


def test_the_signing_key_must_be_an_rsa_key_published_under_its_kid():
    with pytest.raises(ValueError, match="valid PEM"):
        TokenIssuer("not a key", KID, issuer="i", audience="a")
    ec_key = (
        ec.generate_private_key(ec.SECP256R1())
        .private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
        .decode()
    )
    with pytest.raises(ValueError, match="RSA"):
        TokenIssuer(ec_key, KID, issuer="i", audience="a")
    wrong = AuthzConfig(public_keys={KID: OTHER_PUBLIC}, issuer="i", audience="a")
    with pytest.raises(ValueError, match="isn't JWT_PRIVATE_KEY's public key"):
        issuer().check_published(wrong)
    absent = AuthzConfig(public_keys={"other": JWT_PUBLIC}, issuer="i", audience="a")
    with pytest.raises(ValueError):
        issuer().check_published(absent)
    issuer().check_published(authz_config())
    assert issuer().public_pem() == JWT_PUBLIC
    # A key with escaped newlines (single-line secrets) works too.
    TokenIssuer(JWT_PRIVATE.replace("\n", "\\n"), KID, issuer="i", audience="a")


def test_refresh_tokens_are_checked_for_their_shape():
    config = authz_config()
    good = issuer().issue(USER, "in", "parent").refresh_token
    assert decode_refresh(good, config)["sub"] == USER
    for token in (
        issuer().issue(USER, "in", "parent").access_token,  # no jti / family_id
        issuer().issue("not-a-uuid", "in", "parent").refresh_token,
        issuer().issue(USER, "Bad Zone", "parent").refresh_token,
    ):
        with pytest.raises(InvalidToken):
            decode_refresh(token, config)


def test_access_subject_reads_only_validly_signed_access_tokens():
    config = authz_config()
    tokens = issuer().issue(USER, "in", "parent")
    assert access_subject(tokens.access_token, config) == USER
    assert access_subject(tokens.refresh_token, config) is None
    assert access_subject("junk", config) is None


# ── the authz cache ────────────────────────────────────────────────────────────


def _account(**fields: Any) -> dict[str, Any]:
    return {"_id": USER, "authz_version": 3, "role": "parent", **fields}


def test_an_account_becomes_its_cache_entry():
    revoked = datetime(2026, 10, 24, 9, 30, 0, 123000, tzinfo=UTC)
    entry = entry_from_account(_account(is_locked=True, tokens_revoked_at=revoked))
    assert entry == AuthzEntry(
        ver=3, role="parent", locked=True, deleting=False, revoked_at_ms=1792834200123
    )
    assert entry_from_account(_account()).revoked_at_ms is None
    assert json.loads(entry_json(entry)) == {
        "ver": 3,
        "role": "parent",
        "locked": True,
        "deleting": False,
        "revoked_at_ms": 1792834200123,
    }


def test_no_cache_or_an_unreachable_one_is_never_an_error():
    class Down:
        async def eval(self, *args: Any) -> Any:
            raise RedisConnectionError("down")

        async def delete(self, *args: Any) -> Any:
            raise RedisConnectionError("down")

    entry = entry_from_account(_account())
    assert asyncio.run(write_entry(None, USER, entry)) is False
    assert asyncio.run(write_entry(Down(), USER, entry)) is False
    asyncio.run(delete_entry(None, USER))  # nothing to do, no error
    asyncio.run(delete_entry(Down(), USER))  # the entry expires on its own


@pytest.mark.live_service
def test_the_versioned_write_never_goes_backwards(redis_url):
    async def run() -> None:
        cache = aioredis.Redis.from_url(redis_url)
        user = str(uuid.uuid4())
        key = f"authz:{user}"
        try:
            v2 = AuthzEntry(ver=2, role="parent", locked=False, deleting=False)
            locked = AuthzEntry(ver=3, role="parent", locked=True, deleting=False)
            assert await write_entry(cache, user, v2)
            assert await write_entry(cache, user, locked)
            # A slow write that read the account before the lock can't undo it.
            assert not await write_entry(cache, user, v2)
            # The same version must carry the same content.
            assert not await write_entry(
                cache, user, AuthzEntry(ver=3, role="admin", locked=True, deleting=False)
            )
            assert await write_entry(cache, user, locked)  # identical: accepted (TTL refresh)
            assert json.loads(await cache.get(key))["locked"] is True
            assert 3500 < await cache.ttl(key) <= 3600
            # Something unreadable in the key is replaced.
            await cache.set(key, "garbage")
            assert await write_entry(cache, user, v2)
        finally:
            await cache.delete(key)
            await cache.aclose()

    asyncio.run(run())


# ── the login throttle ─────────────────────────────────────────────────────────


def test_the_throttle_counts_failures_and_clears_on_success():
    throttle = LoginThrottle(None)
    for _ in range(5):
        assert not throttle.blocked("k" * 64, "1.1.1.1")
        throttle.failed("k" * 64, "1.1.1.1")
    assert throttle.blocked("k" * 64, "1.1.1.1")
    assert not throttle.blocked("k" * 64, "2.2.2.2")
    throttle.succeeded("k" * 64, "1.1.1.1")
    assert not throttle.blocked("k" * 64, "1.1.1.1")


def test_the_throttle_falls_back_per_task_and_retries_valkey():
    class Broken:
        calls = 0

        def __getattr__(self, name: str) -> Any:
            def fail(*args: Any, **kwargs: Any) -> Any:
                Broken.calls += 1
                raise ConnectionError("valkey down")

            return fail

    now = [0.0]
    throttle = LoginThrottle(None, clock=lambda: now[0])
    throttle._primary = Broken()  # type: ignore[assignment]
    throttle.failed("k" * 64, "ip")
    assert Broken.calls == 1 and not throttle.blocked("k" * 64, "ip")
    assert Broken.calls == 1  # not retried within 30 s
    now[0] = 31.0
    throttle.failed("k" * 64, "ip")
    assert Broken.calls == 2
    assert LoginThrottle("redis://localhost:6390")._primary is not None


# ── the runtime ────────────────────────────────────────────────────────────────


def _env(mongo_uri: str) -> dict[str, str]:
    return {
        "MONGODB_URI": mongo_uri,
        "MONGODB_DB_NAME": f"auth_env_{uuid.uuid4().hex[:8]}",
        "JWT_PRIVATE_KEY": JWT_PRIVATE,
        "JWT_KEY_ID": KID,
        "JWT_PUBLIC_KEYS": json.dumps({KID: JWT_PUBLIC}),
        "EMAIL_HMAC_PEPPER": PEPPER,
        "INTERNAL_SIGNING_KID": "a1",
        "INTERNAL_SIGNING_KEY": AUTH_PRIVATE,
        "INTERNAL_PUBLIC_KEYS": "{}",
        "COOKIE_DOMAIN": " ",
        "REDIS_URL": "redis://localhost:6379",
        "AWS_ENDPOINT_URL": "http://localhost:5050",
    }


def test_from_env_builds_every_part(monkeypatch, tmp_path, fake_aws_credentials):
    # Settings read the process environment and a .env in the working directory too.
    monkeypatch.chdir(tmp_path)
    for name in ("REDIS_URL", "COOKIE_SECURE", "COOKIE_DOMAIN", "AWS_ENDPOINT_URL"):
        monkeypatch.delenv(name, raising=False)
    runtime = Runtime.from_env(_env("mongodb://localhost:27017/?directConnection=true"))
    assert runtime.settings.service_name == "auth" and runtime.cache is not None
    assert runtime.settings.cookie_domain is None and runtime.settings.cookie_secure is True
    assert runtime.limits.prefix == "auth" and runtime.peppers.current == 1
    assert runtime.sns.meta.endpoint_url == "http://localhost:5050"
    asyncio.run(runtime.aclose())
    plain = Runtime.from_env(
        {k: v for k, v in _env("mongodb://x").items() if k not in ("REDIS_URL", "AWS_ENDPOINT_URL")}
    )
    assert plain.cache is None
    asyncio.run(plain.aclose())
    # A private key JWT_PUBLIC_KEYS doesn't hold under its kid stops the start.
    with pytest.raises(ValueError, match="public key"):
        Runtime.from_env({**_env("mongodb://x"), "JWT_KEY_ID": "unpublished"})


@pytest.mark.live_service
def test_auth_fills_the_authz_entry_from_its_own_database(mongo_uri):
    async def run() -> None:
        async with running(mongo_uri) as r:
            assert await r.runtime.fill(USER) is None
            await r.db[AUTH].insert_one(
                new_credentials(
                    user_id=USER,
                    email="jane@example.com",
                    password_hash="x",
                    country_code="IN",
                    location="in",
                    auth_provider="password",
                    now=datetime.now(UTC),
                )
            )
            entry = await r.runtime.fill(USER)
            assert entry is not None and (entry.ver, entry.role, entry.locked) == (
                1,
                "parent",
                False,
            )

    asyncio.run(run())


@pytest.mark.live_service
def test_the_lifespan_shares_one_runtime_and_closes_it(
    monkeypatch, mongo_uri, fake_aws_credentials
):
    env = _env(mongo_uri)
    for key, value in env.items():
        monkeypatch.setenv(key, value)

    async def run() -> None:
        async with main.app.router.lifespan_context(main.app):
            async with main.internal_app.router.lifespan_context(main.internal_app):
                runtime = main.app.state.runtime
                assert runtime is not None and main.internal_app.state.runtime is runtime
            assert main.app.state.runtime is runtime
        assert main.app.state.runtime is None
        client: AsyncMongoClient[dict[str, Any]] = AsyncMongoClient(mongo_uri)
        names = set(await client[env["MONGODB_DB_NAME"]].list_collection_names())
        assert {
            "auth", "sessions", "email_index", "allowed_emails", "deletions",
            "audit", "admin_count", "outbox", "tombstones",
        } <= names  # fmt: skip
        await client.drop_database(env["MONGODB_DB_NAME"])
        await client.close()

    asyncio.run(run())
    monkeypatch.delenv("MONGODB_URI")

    async def unconfigured() -> None:
        async with main.app.router.lifespan_context(main.app):
            assert main.app.state.runtime is None

    asyncio.run(unconfigured())


# ── the local allow-list seed ──────────────────────────────────────────────────


def _seed_env(mongo_uri: str, db_name: str, **extra: str) -> dict[str, str]:
    return {
        "APP_ENV": "local",
        "LOCAL_ALLOWED_EMAIL": "Tester@Example.com",
        "MONGODB_URI": mongo_uri,
        "MONGODB_DB_NAME": db_name,
        "EMAIL_HMAC_PEPPER": PEPPER,
        **extra,
    }


@pytest.mark.parametrize(
    "change,message",
    [
        ({"LOCAL_ALLOWED_EMAIL": ""}, "set LOCAL_ALLOWED_EMAIL"),
        ({"APP_ENV": "dev"}, "only for APP_ENV=local"),
        ({"LOCAL_ALLOWED_EMAIL": "nope"}, "valid address"),
    ],
)
def test_the_seed_refuses_anything_but_a_complete_local_setup(
    change, message, tmp_path, monkeypatch
):
    monkeypatch.chdir(tmp_path)  # no .env here
    with pytest.raises(SystemExit, match=message):
        seed.settings_from(_seed_env("mongodb://x", "x", **change))


@pytest.mark.live_service
def test_the_seed_allow_lists_the_email_once(mongo_uri, tmp_path, monkeypatch, capsys):
    db_name = f"auth_seed_{uuid.uuid4().hex[:8]}"
    monkeypatch.chdir(tmp_path)
    # Values from .env are read too; the environment wins.
    (tmp_path / ".env").write_text("LOCAL_ALLOWED_EMAIL=from-dotenv@example.com\n")
    env = _seed_env(mongo_uri, db_name)
    del env["LOCAL_ALLOWED_EMAIL"]
    assert seed.main(env) == 0 and seed.main(env) == 0
    out = capsys.readouterr().out
    expected = Peppers.parse(PEPPER).key("from-dotenv@example.com")
    assert f"email_key={expected[:16]}" in out and "dotenv@" not in out

    async def check() -> None:
        client: AsyncMongoClient[dict[str, Any]] = AsyncMongoClient(mongo_uri)
        rows = await client[db_name][ALLOWED_EMAILS].find({}).to_list(None)
        assert [(row["_id"], row["email_hint"]) for row in rows] == [(expected, "f***@example.com")]
        await client.drop_database(db_name)
        await client.close()

    asyncio.run(check())
