"""app/services/google_auth.py, against real RS256 ID tokens.

Tokens are signed with a key generated here; the only thing patched is the
download of Google's public certs, which returns this key instead. Signature,
audience, issuer, expiry and clock-skew checks are all google-auth's own.
"""

import builtins
import importlib
import logging
import time

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from google.auth import crypt, jwt
from google.oauth2 import id_token as google_id_token

import app.services.google_auth as google_auth
from app.settings import settings

CLIENT_ID = "buddy-test.apps.googleusercontent.com"
KID = "test-key-1"


def _rsa_pem():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    public = key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    return private, public


GOOGLE_PRIVATE, GOOGLE_PUBLIC = _rsa_pem()
ATTACKER_PRIVATE, _ = _rsa_pem()


def _token(private=GOOGLE_PRIVATE, kid=KID, **claims):
    now = int(time.time())
    payload = {
        "iss": "https://accounts.google.com",
        "aud": CLIENT_ID,
        "sub": "1234567890",
        "email": "g@example.com",
        "email_verified": True,
        "iat": now,
        "exp": now + 3600,
        **claims,
    }
    signer = crypt.RSASigner.from_string(private, key_id=kid)
    return jwt.encode(signer, payload).decode()


@pytest.fixture
def certs(monkeypatch):
    """Serve our public key as Google's cert set; record each fetch."""
    fetches = []

    def fetch_certs(request, certs_url):
        fetches.append((request, certs_url))
        return {KID: GOOGLE_PUBLIC.decode()}

    monkeypatch.setattr(google_id_token, "_fetch_certs", fetch_certs)
    monkeypatch.setattr(settings, "google_client_id", CLIENT_ID)
    return fetches


def _rejected(token, caplog=None):
    with pytest.raises(HTTPException) as exc:
        google_auth.verify_google_token(token)
    assert (exc.value.status_code, exc.value.detail) == (401, "Invalid Google credential.")
    return exc.value


# ── valid tokens ─────────────────────────────────────────────────────────────


def test_a_valid_google_token_returns_its_claims(certs):
    claims = google_auth.verify_google_token(_token(name="Gita"))
    assert (claims["email"], claims["email_verified"], claims["name"]) == (
        "g@example.com",
        True,
        "Gita",
    )
    [(request, url)] = certs
    assert url == google_id_token._GOOGLE_OAUTH2_CERTS_URL  # Google's real cert endpoint
    assert isinstance(request, google_auth._google_requests.Request)


@pytest.mark.parametrize("iss", ["https://accounts.google.com", "accounts.google.com"])
def test_both_google_issuer_spellings_are_accepted(certs, iss):
    assert google_auth.verify_google_token(_token(iss=iss))["sub"] == "1234567890"


def test_tolerates_up_to_60_seconds_of_clock_skew(certs):
    now = int(time.time())
    google_auth.verify_google_token(_token(iat=now - 3600, exp=now - 50))  # just expired
    google_auth.verify_google_token(_token(iat=now + 50, exp=now + 3600))  # issued "in the future"


# ── rejected tokens ──────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "token",
    [
        pytest.param(lambda: _token(aud="someone-elses-app.apps.googleusercontent.com"), id="aud"),
        pytest.param(lambda: _token(iss="https://evil.example"), id="issuer"),
        pytest.param(
            lambda: _token(iat=int(time.time()) - 7200, exp=int(time.time()) - 120),
            id="expired-beyond-skew",
        ),  # fmt: skip
        pytest.param(lambda: _token(iat=int(time.time()) + 300), id="issued-too-far-ahead"),
        pytest.param(lambda: _token(private=ATTACKER_PRIVATE), id="forged-signature"),
        pytest.param(lambda: _token(kid="unknown-key"), id="unknown-kid"),
        pytest.param(lambda: "not.a.jwt", id="garbage"),
        pytest.param(lambda: "", id="empty"),
    ],
)
def test_invalid_tokens_are_a_generic_401(certs, token):
    _rejected(token())


def test_tampered_claims_break_the_signature(certs):
    header, payload, signature = _token().split(".")
    other_payload = _token(email="admin@example.com").split(".")[1]
    _rejected(f"{header}.{other_payload}.{signature}")
    assert payload != other_payload


def test_failure_is_logged_with_the_cause_but_not_returned(certs, caplog):
    with caplog.at_level(logging.WARNING, logger="app.services.google_auth"):
        exc = _rejected(_token(aud="someone-elses-app"))
    assert "Google ID token verification failed:" in caplog.text
    assert "wrong audience" in caplog.text
    assert "someone-elses-app" in caplog.text  # the reason is in the log...
    assert "someone-elses-app" not in exc.detail  # ...and not in the response


def test_cert_download_failure_is_401(certs, monkeypatch):
    def unreachable(request, certs_url):
        raise ConnectionError("googleapis.com unreachable")

    monkeypatch.setattr(google_id_token, "_fetch_certs", unreachable)
    _rejected(_token())


# ── not available ────────────────────────────────────────────────────────────


def test_not_configured_is_503_before_any_verification(certs, monkeypatch):
    monkeypatch.setattr(settings, "google_client_id", "")
    with pytest.raises(HTTPException) as exc:
        google_auth.verify_google_token(_token())
    assert (exc.value.status_code, exc.value.detail) == (503, "Google sign-in is not configured")
    assert certs == []


def test_missing_package_is_503(certs, monkeypatch):
    monkeypatch.setattr(google_auth, "_google_id_token", None)
    with pytest.raises(HTTPException) as exc:
        google_auth.verify_google_token(_token())
    assert exc.value.status_code == 503
    assert "google-auth[requests]" in exc.value.detail and "not installed" in exc.value.detail


def test_module_imports_without_google_auth_installed(monkeypatch, caplog):
    real_import = builtins.__import__

    def no_google(name, *args, **kwargs):
        if name.startswith("google.auth") or name.startswith("google.oauth2"):
            raise ImportError(f"No module named {name!r}")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", no_google)
    try:
        with caplog.at_level(logging.WARNING, logger="app.services.google_auth"):
            reloaded = importlib.reload(google_auth)
        assert reloaded._google_id_token is None and reloaded._google_requests is None
        assert "google-auth package is not installed" in caplog.text
    finally:
        monkeypatch.undo()
        importlib.reload(google_auth)
    assert google_auth._google_id_token is google_id_token
