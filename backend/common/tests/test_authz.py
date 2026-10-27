"""common.authz: token verification, the authz cache and the policies (design 9.2, 9.3, 11.2).

Covers every rejection the build plan's 1.1 check lists (deleting, locked, revoked_at_ms >=
iat_ms, a missing permission, 404 for non-owners) and the fail-closed 503 when neither the
cache nor auth can answer.
"""

import asyncio
import json
import time
import uuid
from typing import Annotated, Any

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from redis.exceptions import ConnectionError as RedisConnectionError

from common import authz
from common.audit import AuditEvent, AuditLog
from common.authz import (
    Access,
    Authorizer,
    AuthUnavailable,
    AuthzConfig,
    AuthzEntry,
    Caller,
    require,
    require_self_or,
    signed_in,
)
from common.routers import public

ISS, AUD, KID = "buddy-test", "buddy-api", "k1"
USER = str(uuid.uuid4())
OTHER = str(uuid.uuid4())
ADMIN = str(uuid.uuid4())


def _pem_pair() -> tuple[Any, str]:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_pem = (
        key.public_key()
        .public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
        .decode()
    )
    return key, public_pem


PRIVATE, PUBLIC = _pem_pair()
OTHER_PRIVATE, _ = _pem_pair()


def _config(**overrides: Any) -> AuthzConfig:
    return AuthzConfig(
        **{"public_keys": {KID: PUBLIC}, "issuer": ISS, "audience": AUD, **overrides}
    )


def token(
    sub: str = USER,
    *,
    key: Any = PRIVATE,
    kid: str | None = KID,
    drop: tuple[str, ...] = (),
    **claims: Any,
) -> str:
    now = int(time.time())
    payload: dict[str, Any] = {
        "sub": sub,
        "iat": now,
        "iat_ms": now * 1000 + 500,
        "exp": now + 600,
        "type": "access",
        "location": "in",
        "iss": ISS,
        "aud": AUD,
        **claims,
    }
    for name in drop:
        payload.pop(name)
    headers = {"kid": kid} if kid is not None else {}
    return jwt.encode(payload, key, algorithm="RS256", headers=headers)


def entry(role: str = "parent", **fields: Any) -> AuthzEntry:
    return AuthzEntry(
        **{
            "ver": 1,
            "role": role,
            "locked": False,
            "deleting": False,
            "revoked_at_ms": None,
            **fields,
        }
    )


class FakeCache:
    """Valkey's GET, with a switch to make it unreachable."""

    def __init__(self) -> None:
        self.data: dict[str, str] = {}
        self.down = False
        self.reads = 0

    async def get(self, name: str) -> str | None:
        self.reads += 1
        if self.down:
            raise RedisConnectionError("valkey down")
        return self.data.get(name)

    def put(self, user_id: str, value: AuthzEntry | str) -> None:
        self.data[f"authz:{user_id}"] = (
            value if isinstance(value, str) else json.dumps(value.__dict__)
        )


class FakeAuth:
    """auth's GET /internal/authz/{user_id}, with a switch to make it unreachable."""

    def __init__(self) -> None:
        self.entries: dict[str, AuthzEntry] = {}
        self.down = False
        self.calls: list[str] = []

    async def __call__(self, user_id: str) -> AuthzEntry | None:
        self.calls.append(user_id)
        if self.down:
            raise AuthUnavailable("auth down")
        return self.entries.get(user_id)


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def cache() -> FakeCache:
    return FakeCache()


@pytest.fixture
def auth() -> FakeAuth:
    fake = FakeAuth()
    fake.entries = {USER: entry(), OTHER: entry(), ADMIN: entry("admin")}
    return fake


@pytest.fixture
def events() -> list[AuditEvent]:
    return []


@pytest.fixture
def clock() -> Clock:
    return Clock()


@pytest.fixture
def authorizer(cache, auth, events, clock) -> Authorizer:
    return Authorizer(
        _config(), cache=cache, fill=auth, audit=AuditLog([events.append]), clock=clock
    )


@pytest.fixture
def client(authorizer) -> TestClient:
    app = FastAPI()
    app.state.authorizer = authorizer

    @app.get("/me")
    async def me(caller: Annotated[Caller, Depends(signed_in())]) -> dict[str, Any]:
        return {"user_id": caller.user_id, "role": caller.role, "location": caller.location}

    @app.post("/accounts/{account_id}/lock")
    async def lock(
        account_id: str, caller: Annotated[Caller, Depends(require("accounts:lock"))]
    ) -> dict[str, str]:
        return {"locked": account_id}

    @app.get("/users/{user_id}/profile")
    async def profile(
        user_id: str, access: Annotated[Access, Depends(require_self_or("profiles:read:any"))]
    ) -> dict[str, Any]:
        return {"subject": access.subject_id, "privileged": access.privileged}

    @app.get("/health", dependencies=[Depends(public())])
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return TestClient(app)


def call(client: TestClient, path: str, sub: str = USER, method: str = "GET", **claims: Any):
    return client.request(method, path, headers={"Cookie": f"access_token={token(sub, **claims)}"})


# ── allowed ────────────────────────────────────────────────────────────────────


def test_a_cached_entry_is_used_without_asking_auth(client, cache, auth):
    cache.put(USER, entry())
    response = call(client, "/me")
    assert response.status_code == 200
    assert response.json() == {"user_id": USER, "role": "parent", "location": "in"}
    assert auth.calls == []


def test_a_miss_asks_auth(client, auth):
    assert call(client, "/me").status_code == 200
    assert auth.calls == [USER]


def test_the_cached_role_wins_over_the_token(client, cache):
    # The token says admin; the cache (authoritative) says parent.
    cache.put(USER, entry("parent"))
    assert call(client, "/accounts/x/lock", method="POST", role="admin").status_code == 403


def test_a_bearer_header_works_for_mobile(client):
    response = client.get("/me", headers={"Authorization": f"Bearer {token()}"})
    assert response.status_code == 200


def test_public_routes_need_no_token(client):
    assert client.get("/health").json() == {"status": "ok"}


# ── rejections from the account's state ───────────────────────────────────────


def test_deleting_is_401(client, cache, events):
    cache.put(USER, entry(deleting=True))
    assert call(client, "/me").status_code == 401
    assert [(e.permission, e.outcome, e.status) for e in events] == [("signed_in", "denied", 401)]


def test_locked_is_403(client, cache):
    cache.put(USER, entry(locked=True))
    response = call(client, "/me")
    assert response.status_code == 403
    assert "locked" in response.json()["detail"]


def test_a_token_issued_at_or_before_revocation_is_401(client, cache):
    iat_ms = 1_800_000_000_500
    cache.put(USER, entry(revoked_at_ms=iat_ms))
    assert call(client, "/me", iat_ms=iat_ms).status_code == 401
    assert call(client, "/me", iat_ms=iat_ms - 1).status_code == 401


def test_a_token_issued_after_revocation_in_the_same_second_is_allowed(client, cache):
    # Seconds would reject it; milliseconds don't (9.3).
    cache.put(USER, entry(revoked_at_ms=1_800_000_000_100))
    assert call(client, "/me", iat_ms=1_800_000_000_101).status_code == 200


def test_an_account_auth_doesnt_know_is_401(client, auth):
    del auth.entries[USER]
    assert call(client, "/me").status_code == 401


# ── permissions ────────────────────────────────────────────────────────────────


def test_a_missing_permission_is_403_and_audited(client, events):
    assert call(client, "/accounts/x/lock", method="POST").status_code == 403
    (event,) = events
    assert (event.permission, event.outcome, event.status, event.privileged) == (
        "accounts:lock",
        "denied",
        403,
        True,
    )
    assert event.route == "/accounts/{account_id}/lock"


def test_an_admin_only_permission_is_allowed_and_audited_as_privileged(client, events):
    assert call(client, "/accounts/x/lock", sub=ADMIN, method="POST").json() == {"locked": "x"}
    (event,) = events
    assert (event.actor_id, event.actor_role, event.outcome, event.privileged) == (
        ADMIN,
        "admin",
        "allowed",
        True,
    )


@pytest.mark.parametrize("path_user", ["me", USER])
def test_the_owner_reads_their_own_profile_unaudited(client, events, path_user):
    response = call(client, f"/users/{path_user}/profile")
    assert response.json() == {"subject": USER, "privileged": False}
    assert events == []


def test_someone_elses_profile_is_404_not_403(client, events):
    assert call(client, f"/users/{OTHER}/profile").status_code == 404
    (event,) = events
    assert (event.subject_id, event.outcome, event.status) == (OTHER, "denied", 404)


def test_an_admin_reads_any_profile_as_privileged(client, events):
    response = call(client, f"/users/{USER}/profile", sub=ADMIN)
    assert response.json() == {"subject": USER, "privileged": True}
    assert [(e.subject_id, e.outcome) for e in events] == [(USER, "allowed")]


def test_an_owner_without_the_self_permission_is_403(client, auth):
    auth.entries[USER] = entry("guest")  # an unknown role holds nothing
    assert call(client, "/me").status_code == 200  # still signed in
    assert call(client, "/users/me/profile").status_code == 403


def test_a_policy_on_a_route_without_its_path_parameter_is_a_server_error(authorizer):
    app = FastAPI()
    app.state.authorizer = authorizer

    @app.get("/broken/{other}")
    async def broken(
        other: str, access: Annotated[Access, Depends(require_self_or("profiles:read:any"))]
    ) -> None:
        return None  # pragma: no cover - the policy raises first

    with pytest.raises(RuntimeError, match="user_id"):
        TestClient(app).get("/broken/x", headers={"Cookie": f"access_token={token()}"})


def test_unknown_or_malformed_permissions_fail_at_definition():
    with pytest.raises(ValueError, match="unknown permission"):
        require("accounts:delete_everything")
    with pytest.raises(ValueError, match=":any"):
        require_self_or("accounts:lock")


def test_a_missing_authorizer_is_a_server_error():
    app = FastAPI()

    @app.get("/me")
    async def me(caller: Annotated[Caller, Depends(signed_in())]) -> None:
        return None  # pragma: no cover - the dependency raises first

    with pytest.raises(RuntimeError, match="app.state.authorizer"):
        TestClient(app).get("/me", headers={"Cookie": f"access_token={token()}"})


# ── fail closed, and the fallback while Valkey is down ───────────────────────


def test_a_miss_with_auth_down_is_503(client, auth):
    auth.down = True
    response = call(client, "/me")
    assert response.status_code == 503
    assert response.headers["retry-after"] == "5"


def test_valkey_down_asks_auth_and_keeps_the_answer_for_30_seconds(client, cache, auth, clock):
    cache.down = True
    assert call(client, "/me").status_code == 200
    assert call(client, "/me").status_code == 200
    assert auth.calls == [USER]  # one internal call for the burst

    clock.now += 29.9
    auth.entries[USER] = entry(locked=True)
    assert call(client, "/me").status_code == 200  # still the held answer

    clock.now += 0.2
    assert call(client, "/me").status_code == 403  # the lock lands within 30 s
    assert auth.calls == [USER, USER]


def test_valkey_and_auth_both_down_is_503(client, cache, auth):
    cache.down = True
    auth.down = True
    assert call(client, "/me").status_code == 503


def test_a_held_answer_still_serves_while_auth_is_down(client, cache, auth):
    cache.down = True
    assert call(client, "/me").status_code == 200
    auth.down = True
    assert call(client, "/me").status_code == 200


def test_a_malformed_cache_entry_is_refilled(client, cache, auth):
    cache.put(USER, "{not json")
    assert call(client, "/me").status_code == 200
    assert auth.calls == [USER]


def test_no_cache_configured_uses_the_local_hold(auth, clock):
    authorizer = Authorizer(_config(), cache=None, fill=auth, clock=clock)
    assert asyncio.run(authorizer.entry(USER)).role == "parent"
    assert asyncio.run(authorizer.entry(USER)).role == "parent"
    assert auth.calls == [USER]


def test_the_local_hold_is_bounded(auth, clock):
    authorizer = Authorizer(_config(), cache=None, fill=auth, local_max=2, clock=clock)
    for user in (USER, OTHER, ADMIN):
        asyncio.run(authorizer.entry(user))
    assert list(authorizer._local) == [OTHER, ADMIN]


# ── the token ──────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "make",
    [
        pytest.param(lambda: token(kid=None), id="no kid"),
        pytest.param(lambda: token(kid="k-unknown"), id="unknown kid"),
        pytest.param(lambda: token(key=OTHER_PRIVATE), id="wrong signature"),
        pytest.param(lambda: token(exp=int(time.time()) - 120), id="expired"),
        pytest.param(lambda: token(iss="other-env"), id="wrong issuer"),
        pytest.param(lambda: token(aud="other-api"), id="wrong audience"),
        pytest.param(lambda: token(type="refresh"), id="refresh token"),
        pytest.param(lambda: token(drop=("iat_ms",)), id="no iat_ms"),
        pytest.param(lambda: token(iat_ms=True), id="boolean iat_ms"),
        pytest.param(lambda: token(iat_ms="1"), id="string iat_ms"),
        pytest.param(lambda: token(iat_ms=0), id="zero iat_ms"),
        pytest.param(lambda: token("not-a-uuid"), id="bad sub"),
        pytest.param(lambda: token(str(uuid.uuid1())), id="uuid1 sub"),
        pytest.param(lambda: token(location="EU"), id="bad location"),
        pytest.param(lambda: token(drop=("location",)), id="no location"),
        pytest.param(lambda: "not.a.jwt", id="garbage"),
    ],
)
def test_bad_tokens_are_401(client, auth, make):
    response = client.get("/me", headers={"Cookie": f"access_token={make()}"})
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
    assert auth.calls == []  # rejected before any lookup


@pytest.mark.parametrize(
    "headers",
    [{}, {"Authorization": "Basic abc"}, {"Authorization": "Bearer "}, {"Authorization": "Bearer"}],
)
def test_no_usable_token_is_401(client, headers):
    assert client.get("/me", headers=headers).status_code == 401


def test_the_cookie_wins_over_the_header(client):
    response = client.get(
        "/me",
        headers={"Cookie": f"access_token={token()}", "Authorization": "Bearer not-a-token"},
    )
    assert response.status_code == 200


def test_openapi_declares_how_to_authenticate(client):
    spec = client.get("/openapi.json").json()
    assert set(spec["components"]["securitySchemes"]) == {"APIKeyCookie", "HTTPBearer"}
    assert spec["paths"]["/me"]["get"]["security"]


# ── the entry and the config ──────────────────────────────────────────────────


def test_entry_round_trips():
    raw = json.dumps({"ver": 42, "role": "parent", "locked": False, "deleting": False})
    assert AuthzEntry.from_json(raw) == entry(ver=42)
    assert AuthzEntry.from_json(raw.encode()).ver == 42


@pytest.mark.parametrize(
    "raw",
    [
        "{",
        b"\xff",
        "[]",
        json.dumps({"ver": 0, "role": "parent", "locked": False, "deleting": False}),
        json.dumps({"ver": True, "role": "parent", "locked": False, "deleting": False}),
        json.dumps({"ver": 1, "role": "", "locked": False, "deleting": False}),
        json.dumps({"ver": 1, "role": "parent", "locked": 0, "deleting": False}),
        json.dumps({"ver": 1, "role": "parent", "locked": False, "deleting": None}),
        json.dumps(
            {"ver": 1, "role": "parent", "locked": False, "deleting": False, "revoked_at_ms": True}
        ),
        json.dumps(
            {"ver": 1, "role": "parent", "locked": False, "deleting": False, "revoked_at_ms": "1"}
        ),
    ],
)
def test_malformed_entries_are_rejected(raw):
    with pytest.raises(ValueError):
        AuthzEntry.from_json(raw)


def test_config_rejects_bad_setups():
    with pytest.raises(ValueError, match="empty"):
        _config(public_keys={})
    with pytest.raises(ValueError, match="not a valid PEM"):
        _config(public_keys={KID: "nope"})
    with pytest.raises(ValueError, match="issuer and audience"):
        _config(issuer="")


def test_config_from_env():
    escaped = PUBLIC.replace("\n", "\\n")  # how a .env line carries a PEM
    config = AuthzConfig.from_env(
        {"JWT_PUBLIC_KEYS": json.dumps({KID: escaped}), "JWT_ISSUER": ISS, "JWT_AUDIENCE": AUD}
    )
    assert config.key(KID) is not None
    assert config.key("other") is None
    assert config.key(None) is None
    assert config.leeway_seconds == 30
    defaults = AuthzConfig.from_env({"JWT_PUBLIC_KEYS": json.dumps({KID: PUBLIC})})
    assert (defaults.issuer, defaults.audience) == ("superpower-local", "superpower-api")


@pytest.mark.parametrize("value", ["", "not json", "[]", json.dumps({"k": 1})])
def test_config_from_env_rejects_bad_key_maps(value):
    with pytest.raises(ValueError, match="JSON object"):
        AuthzConfig.from_env({"JWT_PUBLIC_KEYS": value})


def test_caller_has():
    caller = Caller(USER, "parent", "in", 1, frozenset({"profiles:read:self"}))
    assert caller.has("profiles:read:self")
    assert not caller.has("accounts:lock")


def test_policies_are_marked():
    assert getattr(signed_in(), authz.POLICY_ATTR) == "signed_in"
    assert getattr(require("accounts:lock"), authz.POLICY_ATTR) == "require:accounts:lock"
    assert (
        getattr(require_self_or("profiles:read:any"), authz.POLICY_ATTR)
        == "require_self_or:profiles:read:any"
    )
