"""common.internal_client: service tokens, the internal policy and the DNS client (design 13.2).

The build plan's 1.3 check: a token signed by service A with `sub = "B"` fails; key rotation
(two keys for one `sub`) works; a stopped IP is retried; the local mode reaches a service by
name (a real server on `localhost`, the way Docker's DNS answers a compose service's name).
"""

import asyncio
import json
import random
import socket
import threading
import time
from typing import Annotated, Any

import httpx
import jwt
import pytest
import uvicorn
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ed25519, rsa
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from common import internal_client as ic
from common.authz import POLICY_ATTR, AuthUnavailable, AuthzEntry
from common.internal_client import (
    CHILD_ANSWER,
    InternalClient,
    InternalUnavailable,
    InvalidServiceToken,
    ServiceTokenSigner,
    ServiceTokenVerifier,
    allow_callers,
    authz_fill,
    checked_answer,
)
from common.logging import request_id_var
from common.routers import PolicyRouter, route_policies


def _pair() -> tuple[str, str]:
    key = ed25519.Ed25519PrivateKey.generate()
    private = key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    ).decode()
    public = (
        key.public_key()
        .public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
        .decode()
    )
    return private, public


def _ed_key(pem: str) -> ed25519.Ed25519PrivateKey:
    key = serialization.load_pem_private_key(pem.encode(), password=None)
    assert isinstance(key, ed25519.Ed25519PrivateKey)
    return key


AUTH_PRIVATE, AUTH_PUBLIC = _pair()
AUTH_NEW_PRIVATE, AUTH_NEW_PUBLIC = _pair()
GROW_PRIVATE, GROW_PUBLIC = _pair()

KEYS = {"auth": {"a1": AUTH_PUBLIC, "a2": AUTH_NEW_PUBLIC}, "grow": {"g1": GROW_PUBLIC}}


def _verifier(service: str = "users") -> ServiceTokenVerifier:
    return ServiceTokenVerifier(service, KEYS)


# ── tokens ─────────────────────────────────────────────────────────────────────


def test_a_token_round_trips():
    token = ServiceTokenSigner("auth", "a1", AUTH_PRIVATE).token_for("users")
    assert _verifier().verify(token) == "auth"
    claims = jwt.decode(token, options={"verify_signature": False})
    assert claims["aud"] == "users-internal" and claims["exp"] - claims["iat"] == 60


def test_a_token_signed_by_one_service_claiming_to_be_another_fails():
    # grow signs with its own key but claims sub = "auth".
    forged = jwt.encode(
        {
            "sub": "auth",
            "aud": "users-internal",
            "iat": int(time.time()),
            "exp": int(time.time()) + 60,
        },
        _ed_key(GROW_PRIVATE),
        algorithm="EdDSA",
        headers={"kid": "a1"},
    )
    with pytest.raises(InvalidServiceToken, match="Signature"):
        _verifier().verify(forged)


def test_key_rotation_accepts_both_keys_for_one_service():
    old = ServiceTokenSigner("auth", "a1", AUTH_PRIVATE).token_for("users")
    new = ServiceTokenSigner("auth", "a2", AUTH_NEW_PRIVATE).token_for("users")
    assert _verifier().verify(old) == _verifier().verify(new) == "auth"
    after = ServiceTokenVerifier("users", {"auth": {"a2": AUTH_NEW_PUBLIC}})
    with pytest.raises(InvalidServiceToken, match="no key"):
        after.verify(old)  # the old key removed at the end of the rotation


def test_a_token_for_another_callee_fails():
    token = ServiceTokenSigner("auth", "a1", AUTH_PRIVATE).token_for("children")
    with pytest.raises(InvalidServiceToken, match="Audience"):
        _verifier("users").verify(token)


def test_an_expired_token_fails():
    signer = ServiceTokenSigner("auth", "a1", AUTH_PRIVATE, clock=lambda: time.time() - 120)
    with pytest.raises(InvalidServiceToken, match="expired"):
        _verifier().verify(signer.token_for("users"))


def _signed(claims: dict[str, Any], kid: str = "a1", key: str = AUTH_PRIVATE, **kw: Any) -> str:
    return jwt.encode(
        claims,
        _ed_key(key),
        algorithm="EdDSA",
        headers={"kid": kid},
        **kw,
    )


def test_tokens_that_live_too_long_or_lack_claims_fail():
    now = int(time.time())
    with pytest.raises(InvalidServiceToken, match="longer than 60"):
        _verifier().verify(
            _signed({"sub": "auth", "aud": "users-internal", "iat": now, "exp": now + 3600})
        )
    with pytest.raises(InvalidServiceToken, match="iat"):
        _verifier().verify(_signed({"sub": "auth", "aud": "users-internal", "exp": now + 60}))


@pytest.mark.parametrize(
    "token",
    [
        pytest.param("not-a-jwt", id="garbage"),
        pytest.param(_signed({"sub": "auth"}, kid="zz"), id="unknown kid"),
        pytest.param(_signed({"sub": "nobody", "aud": "users-internal"}), id="unknown sub"),
        pytest.param(_signed({"sub": 7}), id="non-string sub"),
        pytest.param(
            jwt.encode(
                {"sub": "auth", "aud": "users-internal"},
                "a-shared-secret-long-enough-for-hs256",
                algorithm="HS256",
                headers={"kid": "a1"},
            ),
            id="HMAC",
        ),
        pytest.param(
            jwt.encode(
                {"sub": "auth", "aud": "users-internal"},
                "",
                algorithm="none",
                headers={"kid": "a1"},
            ),
            id="alg none",
        ),
    ],
)
def test_bad_tokens_fail(token):
    with pytest.raises(InvalidServiceToken):
        _verifier().verify(token)


def test_key_configuration_is_checked():
    rsa_private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    rsa_pem = rsa_private.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    ).decode()
    rsa_public = (
        rsa_private.public_key()
        .public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
        .decode()
    )
    with pytest.raises(ValueError, match="Ed25519"):
        ServiceTokenSigner("auth", "a1", rsa_pem)
    with pytest.raises(ValueError, match="valid PEM"):
        ServiceTokenSigner("auth", "a1", "nope")
    with pytest.raises(ValueError, match="key id"):
        ServiceTokenSigner("auth", "bad kid!", AUTH_PRIVATE)
    with pytest.raises(ValueError, match="invalid service"):
        ServiceTokenSigner("Auth", "a1", AUTH_PRIVATE)
    with pytest.raises(ValueError, match="Ed25519"):
        ServiceTokenVerifier("users", {"auth": {"a1": rsa_public}})
    with pytest.raises(ValueError, match="PEM public key"):
        ServiceTokenVerifier("users", {"auth": {"a1": "nope"}})
    escaped = ServiceTokenSigner("auth", "a1", AUTH_PRIVATE.replace("\n", "\\n"))
    ServiceTokenVerifier("users", {"auth": {"a1": AUTH_PUBLIC.replace("\n", "\\n")}}).verify(
        escaped.token_for("users")
    )


def test_public_keys_from_env():
    assert ic.public_keys_from_env(json.dumps(KEYS)) == KEYS
    for bad in ("", "[]", json.dumps({"auth": "pem"}), json.dumps({"auth": {"a1": 1}})):
        with pytest.raises(ValueError, match="JSON object"):
            ic.public_keys_from_env(bad)


# ── the internal policy ───────────────────────────────────────────────────────


@pytest.fixture
def internal_app() -> TestClient:
    app = FastAPI()
    app.state.service_tokens = _verifier()
    router = PolicyRouter()

    @router.put("/internal/users/{user_id}")
    async def put_user(
        user_id: str, caller: Annotated[str, Depends(allow_callers("auth"))]
    ) -> dict[str, str]:
        return {"caller": caller}

    app.include_router(router)
    return TestClient(app)


def _bearer(service: str, private: str, kid: str, callee: str = "users") -> dict[str, str]:
    return {
        "Authorization": f"Bearer {ServiceTokenSigner(service, kid, private).token_for(callee)}"
    }


def test_an_allowed_caller_passes(internal_app):
    response = internal_app.put("/internal/users/u1", headers=_bearer("auth", AUTH_PRIVATE, "a1"))
    assert response.json() == {"caller": "auth"}


def test_a_valid_caller_not_on_the_list_is_403(internal_app):
    response = internal_app.put("/internal/users/u1", headers=_bearer("grow", GROW_PRIVATE, "g1"))
    assert response.status_code == 403


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer junk"}])
def test_no_or_a_bad_token_is_401(internal_app, headers):
    assert internal_app.put("/internal/users/u1", headers=headers).status_code == 401


def test_the_internal_policy_is_a_policy():
    dependency = allow_callers("grow", "auth")
    assert getattr(dependency, POLICY_ATTR) == "internal:auth,grow"
    with pytest.raises(ValueError, match="at least one"):
        allow_callers()


def test_routes_see_the_policy(internal_app):
    route = next(
        r for r in internal_app.app.routes if getattr(r, "path", "") == "/internal/users/{user_id}"
    )
    assert route_policies(route) == ["internal:auth"]


def test_a_missing_verifier_is_a_server_error():
    app = FastAPI()

    @app.get("/internal/x")
    async def x(caller: Annotated[str, Depends(allow_callers("auth"))]) -> None:
        return None  # pragma: no cover - the dependency raises first

    with pytest.raises(RuntimeError, match="service_tokens"):
        TestClient(app).get("/internal/x", headers=_bearer("auth", AUTH_PRIVATE, "a1"))


# ── the DNS client ─────────────────────────────────────────────────────────────

SIGNER = ServiceTokenSigner("grow", "g1", GROW_PRIVATE)


def _client(handler, addresses=("10.0.0.1", "10.0.0.2"), **kwargs: Any) -> InternalClient:
    async def resolver(host: str, port: int) -> list[str]:
        return list(addresses)

    return InternalClient(
        SIGNER,
        dns_suffix="superpower-dev.internal",
        resolver=resolver,
        transport=httpx.MockTransport(handler),
        rng=random.Random(1),
        **kwargs,
    )


def test_a_call_carries_a_token_for_the_callee_and_the_trace_headers():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"ok": True})

    async def main() -> httpx.Response:
        client = _client(handler)
        try:
            return await client.get(
                "children", "/internal/children/c1", request_id="r-1", traceparent="00-x"
            )
        finally:
            await client.aclose()

    assert asyncio.run(main()).json() == {"ok": True}
    (request,) = seen
    assert request.url.port == 8001 and request.url.host in {"10.0.0.1", "10.0.0.2"}
    assert request.headers["host"] == "children.superpower-dev.internal"
    assert request.headers["x-request-id"] == "r-1" and request.headers["traceparent"] == "00-x"
    token = request.headers["authorization"].removeprefix("Bearer ")
    assert ServiceTokenVerifier("children", KEYS).verify(token) == "grow"


def test_a_call_carries_the_current_requests_id_by_default():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200)

    async def main() -> None:
        client = _client(handler)
        token = request_id_var.set("gw-7")
        try:
            await client.get("children", "/internal/children/c1")
        finally:
            request_id_var.reset(token)
            await client.aclose()

    asyncio.run(main())
    assert seen[0].headers["x-request-id"] == "gw-7"


def test_a_stopped_ip_is_retried_on_another():
    tried: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        tried.append(request.url.host)
        if len(tried) == 1:
            raise httpx.ConnectError("connection refused", request=request)
        return httpx.Response(200)

    async def main() -> int:
        client = _client(handler)
        response = await client.put("auth", "/internal/authz/u1", json={"a": 1})
        await client.aclose()
        return response.status_code

    assert asyncio.run(main()) == 200
    assert len(tried) == 2 and tried[0] != tried[1]


def test_two_failed_connections_are_unavailable():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("timed out", request=request)

    async def main() -> None:
        client = _client(handler, addresses=("10.0.0.9",))
        await client.post("auth", "/internal/x")

    with pytest.raises(InternalUnavailable, match="unreachable"):
        asyncio.run(main())


def test_no_address_is_unavailable():
    async def main(resolver) -> None:
        client = InternalClient(SIGNER, resolver=resolver)
        await client.delete("auth", "/internal/x")

    async def empty(host: str, port: int) -> list[str]:
        return []

    async def broken(host: str, port: int) -> list[str]:
        raise socket.gaierror("no such host")

    with pytest.raises(InternalUnavailable, match="no addresses"):
        asyncio.run(main(empty))
    with pytest.raises(InternalUnavailable, match="can't resolve"):
        asyncio.run(main(broken))


def test_only_internal_paths_and_valid_services():
    client = InternalClient(SIGNER)
    with pytest.raises(ValueError, match="/internal"):
        asyncio.run(client.get("auth", "/api/v1/auth/me"))
    with pytest.raises(ValueError, match="invalid service"):
        client.host("Auth")


@pytest.mark.parametrize(
    "path",
    [
        "/internal/children/abc?location=evil&x=?location=in",  # an id that adds a query
        "/internal/children/abc#?location=in",  # one that drops it
        "/internal/children/../users/u1",
        "/internal/children/a b?location=in",
        "/internal/",
    ],
)
def test_ids_in_the_path_cant_rewrite_the_call(path):
    # Found by the Phase 5-6 review: a client's `%3F` decodes into the path parameter.
    with pytest.raises(ValueError, match="plain segments"):
        asyncio.run(InternalClient(SIGNER).get("children", path))


def test_checked_answer_turns_an_odd_200_into_an_error():
    good = {"child_id": "c", "location": "in", "user_id": "u", "is_deleted": False, "version": 2}
    assert checked_answer(good, CHILD_ANSWER) is good
    for odd in (
        "<html>",
        [good],
        {**good, "version": "2"},
        {**good, "version": True},
        {k: v for k, v in good.items() if k != "user_id"},
    ):
        with pytest.raises(ValueError):
            checked_answer(odd, CHILD_ANSWER)


def test_ipv6_addresses_are_bracketed():
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return httpx.Response(204)

    async def main() -> None:
        client = _client(handler, addresses=("fd00::1",))
        await client.get("auth", "/internal/x")

    asyncio.run(main())
    assert seen == ["http://[fd00::1]:8001/internal/x"]


def test_the_client_logs_one_structured_line(caplog):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(204)

    async def main() -> None:
        await _client(handler).get("auth", "/internal/x")

    with caplog.at_level("INFO", logger="common.internal_client"):
        asyncio.run(main())
    line = json.loads(
        next(r.getMessage() for r in caplog.records if "internal_call" in r.getMessage())
    )
    assert line["internal_call"]["callee"] == "auth" and line["internal_call"]["status"] == 204


def test_from_env_and_local_mode():
    env = {
        "SERVICE_NAME": "grow",
        "INTERNAL_SIGNING_KID": "g1",
        "INTERNAL_SIGNING_KEY": GROW_PRIVATE,
    }
    local = InternalClient.from_env(env)
    assert local.host("children") == "children"  # Docker's DNS answers the compose name
    aws = InternalClient.from_env({**env, "INTERNAL_DNS_SUFFIX": "superpower-dev.internal."})
    assert aws.host("children") == "children.superpower-dev.internal"


def test_resolve_returns_every_address():
    assert "127.0.0.1" in asyncio.run(ic.resolve("localhost", 8001))


# ── local mode against a real server ─────────────────────────────────────────


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def test_the_local_mode_reaches_a_service_by_name():
    # `localhost` stands in for a compose service name: both resolve through the system
    # resolver (Docker's DNS in a container), with no suffix.
    port = _free_port()
    app = FastAPI()
    app.state.service_tokens = ServiceTokenVerifier("localhost", KEYS)

    @app.get("/internal/ping")
    async def ping(caller: Annotated[str, Depends(allow_callers("grow"))]) -> dict[str, str]:
        return {"caller": caller}

    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    try:
        deadline = time.monotonic() + 10
        while not server.started:
            assert time.monotonic() < deadline, "server didn't start"
            time.sleep(0.02)

        async def main() -> httpx.Response:
            client = InternalClient(SIGNER, port=port)
            try:
                return await client.get("localhost", "/internal/ping")
            finally:
                await client.aclose()

        assert asyncio.run(main()).json() == {"caller": "grow"}
    finally:
        server.should_exit = True
        thread.join(5)


# ── the authz fill ─────────────────────────────────────────────────────────────


def _fill(handler):
    return authz_fill(_client(handler, addresses=("10.0.0.1",)))


def test_the_fill_returns_auths_entry():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/internal/authz/u1"
        assert request.headers["host"] == "auth.superpower-dev.internal"
        return httpx.Response(
            200, json={"ver": 3, "role": "parent", "locked": False, "deleting": False}
        )

    assert asyncio.run(_fill(handler)("u1")) == AuthzEntry(3, "parent", False, False, None)


def test_the_fill_says_none_for_an_unknown_account():
    assert asyncio.run(_fill(lambda r: httpx.Response(404))("u1")) is None


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(503),
        httpx.Response(200, json=[]),
        httpx.Response(200, json={"ver": "x"}),
        httpx.Response(200, content=b"not json"),
    ],
)
def test_the_fill_fails_closed(response):
    with pytest.raises(AuthUnavailable):
        asyncio.run(_fill(lambda r: response)("u1"))


def test_the_fill_fails_closed_when_auth_is_unreachable():
    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    def slow(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    with pytest.raises(AuthUnavailable, match="unreachable"):
        asyncio.run(_fill(down)("u1"))
    with pytest.raises(AuthUnavailable, match="slow"):
        asyncio.run(_fill(slow)("u1"))
