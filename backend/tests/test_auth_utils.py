import asyncio
import base64
import hashlib
import hmac
import json
import threading
from datetime import UTC, datetime, timedelta
from http.cookies import Morsel, SimpleCookie

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import Request, Response

from app import auth_utils
from app.auth_utils import (
    REFRESH_COOKIE_PATH,
    TokenPair,
    _encode,
    async_hash_password,
    async_verify_password,
    clear_auth_cookies,
    cookie_kwargs,
    create_access_token,
    create_refresh_token,
    decode_access_token_ignore_exp,
    decode_token,
    decode_token_of_type,
    extract_token,
    hash_password,
    set_auth_cookies,
    verify_password,
)
from app.settings import settings


def _request(*, cookies: dict[str, str] | None = None, authorization: str | None = None):
    headers = []
    if cookies:
        cookie = "; ".join(f"{k}={v}" for k, v in cookies.items())
        headers.append((b"cookie", cookie.encode()))
    if authorization is not None:
        headers.append((b"authorization", authorization.encode()))
    return Request({"type": "http", "headers": headers})


def _claims(token: str) -> dict:
    return jwt.decode(token, settings.jwt_public_key, algorithms=[settings.jwt_algorithm])


def _expired(token_type: str) -> str:
    past = datetime.now(UTC) - timedelta(hours=2)
    return _encode(
        {
            "sub": "u1",
            "iat": past,
            "exp": past + timedelta(minutes=1),
            "type": token_type,
            "location": "eu",
        }
    )


def _set_cookies(response: Response) -> dict[str, Morsel]:
    """Cookie name → its parsed Set-Cookie attributes."""
    parsed = {}
    for name, value in response.raw_headers:
        if name == b"set-cookie":
            cookie = SimpleCookie()
            cookie.load(value.decode())
            parsed.update(cookie)
    return parsed


# -- extract_token --------------------------------------------------------------


def test_extract_token_prefers_the_cookie():
    req = _request(cookies={"access_token": "from-cookie"}, authorization="Bearer from-header")
    assert extract_token(req, "access_token") == "from-cookie"


def test_extract_token_falls_back_to_bearer_header():
    assert extract_token(_request(authorization="Bearer tok"), "access_token") == "tok"


@pytest.mark.parametrize("authorization", [None, "Basic dXNlcjpwYXNz", "bearer tok", ""])
def test_extract_token_returns_none_without_cookie_or_bearer(authorization):
    assert extract_token(_request(authorization=authorization), "access_token") is None


# -- passwords ------------------------------------------------------------------


def test_hash_and_verify_password_roundtrip():
    hashed = hash_password("s3cret-pass")
    assert hashed != "s3cret-pass"
    assert verify_password("s3cret-pass", hashed) is True
    assert verify_password("wrong-pass", hashed) is False


def test_verify_password_returns_false_for_a_malformed_hash():
    assert verify_password("anything", "not-a-bcrypt-hash") is False


def test_passwords_are_hashed_with_bcrypt_cost_12():
    # Pins the work factor: a lowered cost (e.g. gensalt(4)) would pass every
    # other test while making stolen hashes ~256x cheaper to crack.
    assert hash_password("s3cret-pass").startswith("$2b$12$")


def test_async_password_helpers_run_bcrypt_off_the_event_loop_thread(monkeypatch):
    # bcrypt at cost 12 takes ~250 ms; run inline it would stall every request.
    threads: list[tuple[str, int]] = []
    real_hash, real_verify = auth_utils.hash_password, auth_utils.verify_password

    def spy_hash(password):
        threads.append(("hash", threading.get_ident()))
        return real_hash(password)

    def spy_verify(plain, hashed):
        threads.append(("verify", threading.get_ident()))
        return real_verify(plain, hashed)

    monkeypatch.setattr(auth_utils, "hash_password", spy_hash)
    monkeypatch.setattr(auth_utils, "verify_password", spy_verify)

    async def scenario():
        loop_thread = threading.get_ident()
        hashed = await async_hash_password("s3cret-pass")
        assert await async_verify_password("s3cret-pass", hashed) is True
        return loop_thread

    loop_thread = asyncio.run(scenario())
    assert [name for name, _ in threads] == ["hash", "verify"]
    assert all(ident != loop_thread for _, ident in threads)


def test_async_password_helpers():
    hashed = asyncio.run(async_hash_password("s3cret-pass"))
    assert asyncio.run(async_verify_password("s3cret-pass", hashed)) is True
    assert asyncio.run(async_verify_password("nope", hashed)) is False


# -- token creation ---------------------------------------------------------------


def test_create_access_token_claims_and_kid_header():
    token = create_access_token("u1", "eu")
    claims = _claims(token)
    assert claims["sub"] == "u1"
    assert claims["type"] == "access"
    assert claims["location"] == "eu"
    assert claims["exp"] - claims["iat"] == settings.jwt_access_expire_minutes * 60
    assert jwt.get_unverified_header(token)["kid"] == settings.jwt_key_id


def test_create_access_token_merges_extra_claims():
    assert _claims(create_access_token("u1", "eu", extra={"role": "admin"}))["role"] == "admin"


def test_create_access_token_ignores_empty_extra():
    assert "role" not in _claims(create_access_token("u1", "eu", extra={}))


@pytest.mark.parametrize("reserved", ["sub", "iat", "exp", "type", "location"])
def test_create_access_token_rejects_overriding_reserved_claims(reserved):
    with pytest.raises(ValueError, match="reserved JWT claims"):
        create_access_token("u1", "eu", extra={reserved: "x"})


def test_create_refresh_token_claims_and_jti():
    token, jti = create_refresh_token("u1", "in")
    assert jwt.get_unverified_header(token)["kid"] == settings.jwt_key_id
    claims = _claims(token)
    assert claims["sub"] == "u1"
    assert claims["type"] == "refresh"
    assert claims["jti"] == jti
    assert claims["location"] == "in"
    assert claims["exp"] - claims["iat"] == settings.jwt_refresh_expire_hours * 3600


def test_refresh_tokens_get_unique_jtis():
    assert create_refresh_token("u1", "in")[1] != create_refresh_token("u1", "in")[1]


# -- decoding ---------------------------------------------------------------------


def test_decode_token_valid():
    assert decode_token(create_access_token("u1", "eu"))["sub"] == "u1"


def test_decode_token_rejects_garbage_expired_and_foreign_signatures():
    other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    other_pem = other_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    forged = jwt.encode({"sub": "u1", "type": "access"}, other_pem, algorithm="RS256")
    for token in ("not-a-jwt", _expired("access"), forged):
        assert decode_token(token) is None


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unsigned_or_hmac_token(alg: str, key: bytes = b"", now: int | None = None) -> str:
    if now is None:
        now = int(datetime.now(UTC).timestamp())
    header = {"alg": alg, "typ": "JWT", "kid": settings.jwt_key_id}
    payload = {"sub": "u1", "type": "access", "location": "eu", "iat": now, "exp": now + 600}
    signing_input = (
        f"{_b64url(json.dumps(header).encode())}.{_b64url(json.dumps(payload).encode())}"
    )
    if alg == "none":
        return f"{signing_input}."
    signature = hmac.new(key, signing_input.encode(), hashlib.sha256).digest()
    return f"{signing_input}.{_b64url(signature)}"


@pytest.mark.parametrize("decode", [decode_token, decode_access_token_ignore_exp])
def test_unsigned_alg_none_tokens_are_rejected(decode):
    assert decode(_unsigned_or_hmac_token("none")) is None


@pytest.mark.parametrize("decode", [decode_token, decode_access_token_ignore_exp])
def test_hs256_signed_with_the_public_key_is_rejected(decode):
    # Algorithm confusion: the public key is public, so if HS256 were accepted
    # anyone could mint a valid token by using it as the HMAC secret.
    token = _unsigned_or_hmac_token("HS256", key=settings.jwt_public_key.encode())
    assert decode(token) is None


def test_the_forged_token_helper_is_well_formed():
    # Guards the two tests above: the same construction, signed RS256 for real,
    # must be accepted — so a rejection there is about the algorithm, not the shape.
    now = int(datetime.now(UTC).timestamp())
    payload = {"sub": "u1", "type": "access", "location": "eu", "iat": now, "exp": now + 600}
    assert decode_token(_encode(payload))["sub"] == "u1"
    # Same `now` as `payload`: two clock reads can straddle a second boundary.
    header, body, _ = _unsigned_or_hmac_token("HS256", key=b"k", now=now).split(".")
    assert json.loads(base64.urlsafe_b64decode(body + "==")) == payload
    assert json.loads(base64.urlsafe_b64decode(header + "=="))["alg"] == "HS256"


def test_decode_token_of_type_matches_expected_type():
    access = create_access_token("u1", "eu")
    refresh, _ = create_refresh_token("u1", "eu")
    assert decode_token_of_type(access, "access")["type"] == "access"
    assert decode_token_of_type(refresh, "refresh")["type"] == "refresh"


def test_decode_token_of_type_rejects_wrong_type_and_invalid_tokens():
    refresh, _ = create_refresh_token("u1", "eu")
    assert decode_token_of_type(refresh, "access") is None
    assert decode_token_of_type("not-a-jwt", "access") is None


def test_decode_access_token_ignore_exp_accepts_an_expired_access_token():
    assert decode_access_token_ignore_exp(_expired("access"))["sub"] == "u1"


def test_decode_access_token_ignore_exp_rejects_other_types_and_garbage():
    assert decode_access_token_ignore_exp(_expired("refresh")) is None
    assert decode_access_token_ignore_exp("not-a-jwt") is None


# -- cookies ----------------------------------------------------------------------


@pytest.mark.parametrize(
    ("domain", "expected"), [("", None), ("buddy.example.com", "buddy.example.com")]
)
def test_cookie_kwargs(monkeypatch, domain, expected):
    monkeypatch.setattr(auth_utils.settings, "cookie_domain", domain)
    kw = cookie_kwargs()
    assert kw["httponly"] is True
    assert kw["secure"] == settings.cookie_secure
    assert kw["samesite"] == settings.cookie_samesite
    assert kw["domain"] == expected


class _Sessions:
    def __init__(self):
        self.inserted: list[dict] = []

    async def insert_one(self, doc):
        self.inserted.append(doc)


@pytest.fixture
def prod_cookies(monkeypatch):
    monkeypatch.setattr(auth_utils.settings, "cookie_secure", True)
    monkeypatch.setattr(auth_utils.settings, "cookie_samesite", "strict")
    monkeypatch.setattr(auth_utils.settings, "cookie_domain", "buddy.example.com")


def _assert_secure(morsel):
    assert morsel["httponly"] is True
    assert morsel["secure"] is True
    assert morsel["samesite"].lower() == "strict"
    assert morsel["domain"] == "buddy.example.com"


@pytest.mark.usefixtures("prod_cookies")
def test_both_auth_cookies_carry_every_security_attribute():
    response = Response()
    asyncio.run(set_auth_cookies(response, "u1", "eu", {"sessions": _Sessions()}))
    cookies = _set_cookies(response)
    for name in ("access_token", "refresh_token"):
        _assert_secure(cookies[name])


@pytest.mark.usefixtures("prod_cookies")
def test_cleared_cookies_match_the_set_ones_so_browsers_delete_them():
    # A browser only deletes a cookie whose domain/path match the one it holds.
    response = Response()
    clear_auth_cookies(response)
    cookies = _set_cookies(response)
    for name in ("access_token", "refresh_token"):
        _assert_secure(cookies[name])
        assert cookies[name]["max-age"] == "0"


def test_set_auth_cookies_sets_both_cookies_stores_the_session_and_returns_tokens():
    sessions = _Sessions()
    db = {"sessions": sessions}
    response = Response()

    before = datetime.now(UTC)
    tokens = asyncio.run(set_auth_cookies(response, "u1", "eu", db))
    after = datetime.now(UTC)

    assert isinstance(tokens, TokenPair)
    access, refresh = _claims(tokens.access_token), _claims(tokens.refresh_token)
    assert (access["type"], access["location"]) == ("access", "eu")
    assert (refresh["type"], refresh["location"]) == ("refresh", "eu")

    cookies = _set_cookies(response)
    access_cookie, refresh_cookie = cookies["access_token"], cookies["refresh_token"]
    assert access_cookie.value == tokens.access_token
    assert access_cookie["path"] == "/"
    assert access_cookie["max-age"] == str(settings.jwt_access_expire_minutes * 60)
    assert access_cookie["httponly"] is True
    assert refresh_cookie.value == tokens.refresh_token
    assert refresh_cookie["path"] == REFRESH_COOKIE_PATH
    assert refresh_cookie["max-age"] == str(settings.jwt_refresh_expire_hours * 3600)

    [session] = sessions.inserted
    assert session["_id"] == refresh["jti"]
    assert (session["user_id"], session["location"]) == ("u1", "eu")
    window = timedelta(hours=settings.jwt_refresh_expire_hours)
    assert before + window <= session["expires_at"] <= after + window


def test_clear_auth_cookies_expires_both_cookies_on_their_paths():
    response = Response()
    clear_auth_cookies(response)
    cookies = _set_cookies(response)
    assert cookies["access_token"]["path"] == "/"
    assert cookies["refresh_token"]["path"] == REFRESH_COOKIE_PATH
    for name in ("access_token", "refresh_token"):
        assert cookies[name].value == ""
        assert cookies[name]["max-age"] == "0"
