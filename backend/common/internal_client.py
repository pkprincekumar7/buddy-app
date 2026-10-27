"""Calls between services: service tokens and the Cloud Map DNS client (docs/auth-users-split.md, 13.2).

Internal endpoints live under `/internal/*` on port 8001, which the public ALB never routes.
Callers reach the callee's tasks directly through Cloud Map DNS
(`children.{app}-{env}.internal`); locally (INTERNAL_DNS_SUFFIX empty) the bare service name
resolves through Docker's DNS instead.

**Identity.** Every call carries a service token: a JWT signed with the caller's own Ed25519
key, `sub` = caller, `aud` = `<callee>-internal`, valid 60 s. The callee verifies it against
a public-key map keyed by `sub` (and by `kid` within it, so a rotation can hold two keys), so
a token signed by grow's key with `sub = "auth"` fails. Each internal route then lists the
callers it accepts with `allow_callers(...)`.

**The client** does what a load balancer would: a random IP from the DNS answer for each
call, a 2 s connect timeout, one retry against a different IP on a connection error (every
internal call is idempotent), and keep-alive connections that expire after 30 s so traffic
moves to new tasks after a deploy.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import random
import re
import socket
import time
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from typing import Annotated, Any

import httpx
import jwt
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import load_pem_private_key, load_pem_public_key
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt.exceptions import PyJWTError

from common.authz import AuthUnavailable, AuthzEntry, AuthzFill, mark_policy
from common.logging import request_id_var

INTERNAL_PORT = 8001
TOKEN_TTL_SECONDS = 60
TOKEN_LEEWAY_SECONDS = 5
CONNECT_TIMEOUT_SECONDS = 2.0
REQUEST_TIMEOUT_SECONDS = 5.0
KEEPALIVE_EXPIRY_SECONDS = 30.0
ALGORITHM = "EdDSA"

_SERVICE_RE = re.compile(r"[a-z][a-z0-9_-]{0,30}")
_KID_RE = re.compile(r"[A-Za-z0-9._-]{1,64}")

_logger = logging.getLogger(__name__)


def _check_service(name: str) -> str:
    if not isinstance(name, str) or not _SERVICE_RE.fullmatch(name):
        raise ValueError(f"invalid service name {name!r}")
    return name


def audience(service: str) -> str:
    return f"{_check_service(service)}-internal"


class InvalidServiceToken(Exception):
    """A service token that doesn't verify."""


# `/internal/<segment>/…` with at most one query string of plain `name=value` pairs.
_SAFE_PATH = re.compile(
    r"/internal(?:/[A-Za-z0-9._:-]+)+(?:\?[A-Za-z0-9_]+=[A-Za-z0-9._:-]*(?:&[A-Za-z0-9_]+=[A-Za-z0-9._:-]*)*)?"
)


# What each kind of owner answer must hold, for `checked_answer` (7.5).
CHILD_ANSWER: dict[str, type | tuple[type, ...]] = {
    "child_id": str, "location": str, "user_id": str, "is_deleted": bool, "version": int,
}  # fmt: skip
STATUS_ANSWER: dict[str, type | tuple[type, ...]] = {"completed": bool}
ANSWERS_ANSWER: dict[str, type | tuple[type, ...]] = {"user_id": str, "version": int}
SUMMARY_ANSWER: dict[str, type | tuple[type, ...]] = {
    "user_id": str, "traits": dict, "strengths": list, "version": int,
}  # fmt: skip
AREAS_ANSWER: dict[str, type | tuple[type, ...]] = {"areas": list}
AREA_ITEM: dict[str, type | tuple[type, ...]] = {"area_id": str, "user_id": str, "version": int}


def checked_answer(data: Any, shape: Mapping[str, type | tuple[type, ...]]) -> dict[str, Any]:
    """`data` if it's an object with `shape`'s fields and types; ValueError otherwise, which
    the caller turns into 503: a half-deployed owner's odd 200 is "unavailable", not a 500."""
    if not isinstance(data, dict):
        raise ValueError("the answer isn't an object")
    for name, kind in shape.items():
        value = data.get(name)
        # bool is an int: a version of True isn't a version.
        if not isinstance(value, kind) or (kind is int and isinstance(value, bool)):
            raise ValueError(f"the answer's {name} is missing or malformed")
    return data


class InternalUnavailable(Exception):
    """The callee couldn't be reached (no address, or every attempt failed to connect)."""


# ── tokens ─────────────────────────────────────────────────────────────────────


class ServiceTokenSigner:
    """Mints this service's tokens with its own Ed25519 key, which no other service holds."""

    def __init__(
        self, service: str, kid: str, private_pem: str, *, clock: Callable[[], float] = time.time
    ) -> None:
        self.service = _check_service(service)
        if not _KID_RE.fullmatch(kid):
            raise ValueError(f"invalid key id {kid!r}")
        self.kid = kid
        try:
            key = load_pem_private_key(private_pem.replace("\\n", "\n").encode(), password=None)
        except Exception as exc:
            raise ValueError("INTERNAL_SIGNING_KEY is not a valid PEM private key") from exc
        if not isinstance(key, Ed25519PrivateKey):
            raise ValueError("INTERNAL_SIGNING_KEY must be an Ed25519 key")
        self._key = key
        self.clock = clock

    def token_for(self, callee: str) -> str:
        now = int(self.clock())
        return jwt.encode(
            {
                "sub": self.service,
                "aud": audience(callee),
                "iat": now,
                "exp": now + TOKEN_TTL_SECONDS,
            },
            self._key,
            algorithm=ALGORITHM,
            headers={"kid": self.kid},
        )


@dataclass(frozen=True)
class ServiceTokenVerifier:
    """Verifies tokens addressed to `service`. `public_keys` is `{sub: {kid: PEM}}`."""

    service: str
    public_keys: Mapping[str, Mapping[str, str]]
    leeway_seconds: int = TOKEN_LEEWAY_SECONDS
    _keys: dict[tuple[str, str], Ed25519PublicKey] = field(init=False, repr=False, compare=False)

    def __post_init__(self) -> None:
        _check_service(self.service)
        keys: dict[tuple[str, str], Ed25519PublicKey] = {}
        for sub, by_kid in self.public_keys.items():
            _check_service(sub)
            for kid, pem in by_kid.items():
                try:
                    key = load_pem_public_key(pem.replace("\\n", "\n").encode())
                except Exception as exc:
                    raise ValueError(
                        f"INTERNAL_PUBLIC_KEYS[{sub!r}][{kid!r}] isn't a PEM public key"
                    ) from exc
                if not isinstance(key, Ed25519PublicKey):
                    raise ValueError(
                        f"INTERNAL_PUBLIC_KEYS[{sub!r}][{kid!r}] must be an Ed25519 key"
                    )
                keys[(sub, kid)] = key
        object.__setattr__(self, "_keys", keys)

    def verify(self, token: str) -> str:
        """The calling service, or InvalidServiceToken."""
        try:
            kid = jwt.get_unverified_header(token).get("kid")
            sub = jwt.decode(token, options={"verify_signature": False}).get("sub")
        except PyJWTError as exc:
            raise InvalidServiceToken("malformed token") from exc
        # The key is chosen by the claimed caller: a token signed by another service's key
        # fails the signature check below.
        key = self._keys.get((sub, kid)) if isinstance(sub, str) and isinstance(kid, str) else None
        if key is None:
            raise InvalidServiceToken("no key for this caller and kid")
        try:
            claims = jwt.decode(
                token,
                key,
                algorithms=[ALGORITHM],
                audience=audience(self.service),
                leeway=self.leeway_seconds,
                options={"require": ["sub", "aud", "iat", "exp"]},
            )
        except PyJWTError as exc:
            raise InvalidServiceToken(str(exc)) from exc
        if claims["exp"] - claims["iat"] > TOKEN_TTL_SECONDS:
            raise InvalidServiceToken("token lives longer than 60 s")
        return str(claims["sub"])


def public_keys_from_env(raw: str) -> dict[str, dict[str, str]]:
    """INTERNAL_PUBLIC_KEYS: a JSON object `{service: {kid: PEM}}` (a non-secret SSM parameter)."""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(
            "INTERNAL_PUBLIC_KEYS must be a JSON object of service → {kid → PEM}"
        ) from exc
    if not isinstance(data, dict) or not all(
        isinstance(sub, str)
        and isinstance(by_kid, dict)
        and all(isinstance(k, str) and isinstance(v, str) for k, v in by_kid.items())
        for sub, by_kid in data.items()
    ):
        raise ValueError("INTERNAL_PUBLIC_KEYS must be a JSON object of service → {kid → PEM}")
    return data


# ── the callee's side: who may call this route ────────────────────────────────

_service_bearer = HTTPBearer(auto_error=False, scheme_name="ServiceToken")


def get_verifier(request: Request) -> ServiceTokenVerifier:
    verifier = getattr(request.app.state, "service_tokens", None)
    if not isinstance(verifier, ServiceTokenVerifier):
        raise RuntimeError(
            "app.state.service_tokens isn't set: create a ServiceTokenVerifier at startup"
        )
    return verifier


def allow_callers(*callers: str) -> Callable[..., Awaitable[str]]:
    """The policy for an internal route: a valid service token from one of `callers`.

    401 without a valid token; 403 for a valid one from a service not on the list.
    Returns the calling service.
    """
    if not callers:
        raise ValueError("allow_callers needs at least one service")
    allowed = frozenset(_check_service(c) for c in callers)

    async def dependency(
        request: Request,
        credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_service_bearer)],
    ) -> str:
        verifier = get_verifier(request)
        if credentials is None:
            raise HTTPException(status_code=401, detail="Service token required")
        try:
            caller = verifier.verify(credentials.credentials)
        except InvalidServiceToken as exc:
            _logger.warning("rejected service token on %s: %s", request.url.path, exc)
            raise HTTPException(status_code=401, detail="Invalid service token") from exc
        if caller not in allowed:
            _logger.warning(
                "service %s may not call %s %s", caller, request.method, request.url.path
            )
            raise HTTPException(status_code=403, detail="Forbidden")
        return caller

    return mark_policy(f"internal:{','.join(sorted(allowed))}", dependency)


# ── the caller's side: the DNS client ─────────────────────────────────────────

Resolver = Callable[[str, int], Awaitable[list[str]]]


async def resolve(host: str, port: int) -> list[str]:
    """Every address in the DNS answer (Cloud Map answers multivalue, up to 8 task IPs)."""
    loop = asyncio.get_running_loop()
    infos = await loop.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    return sorted({str(info[4][0]) for info in infos})


class InternalClient:
    def __init__(
        self,
        signer: ServiceTokenSigner,
        *,
        dns_suffix: str = "",
        port: int = INTERNAL_PORT,
        resolver: Resolver = resolve,
        transport: httpx.AsyncBaseTransport | None = None,
        rng: random.Random | None = None,
    ) -> None:
        self.signer = signer
        self.dns_suffix = dns_suffix.strip(".")
        self.port = port
        self.resolver = resolver
        self.rng = rng or random.SystemRandom()
        self._http = httpx.AsyncClient(
            transport=transport,
            timeout=httpx.Timeout(REQUEST_TIMEOUT_SECONDS, connect=CONNECT_TIMEOUT_SECONDS),
            limits=httpx.Limits(keepalive_expiry=KEEPALIVE_EXPIRY_SECONDS),
            follow_redirects=False,
        )

    @classmethod
    def from_env(cls, environ: Mapping[str, str] = os.environ, **kwargs: Any) -> InternalClient:
        """SERVICE_NAME, INTERNAL_SIGNING_KID, INTERNAL_SIGNING_KEY, INTERNAL_DNS_SUFFIX."""
        signer = ServiceTokenSigner(
            environ["SERVICE_NAME"],
            environ["INTERNAL_SIGNING_KID"],
            environ["INTERNAL_SIGNING_KEY"],
        )
        return cls(signer, dns_suffix=environ.get("INTERNAL_DNS_SUFFIX", ""), **kwargs)

    def host(self, service: str) -> str:
        """`children.{app}-{env}.internal` in AWS; plain `children` locally (Docker's DNS)."""
        _check_service(service)
        return f"{service}.{self.dns_suffix}" if self.dns_suffix else service

    async def aclose(self) -> None:
        await self._http.aclose()

    async def request(
        self,
        method: str,
        service: str,
        path: str,
        *,
        json: Any = None,
        request_id: str | None = None,
        traceparent: str | None = None,
    ) -> httpx.Response:
        """Call `service`'s internal `path`. InternalUnavailable if it can't be reached."""
        segments = path.split("?", 1)[0].split("/")
        if not _SAFE_PATH.fullmatch(path) or {".", ".."} & set(segments):
            # Ids pasted into the path must not add a query, a fragment or a segment: a
            # `?` or `#` in a client's id would rewrite what the owner is asked (review).
            raise ValueError("internal calls go to /internal/* with plain segments only")
        host = self.host(service)
        try:
            addresses = await self.resolver(host, self.port)
        except OSError as exc:
            raise InternalUnavailable(f"can't resolve {host}") from exc
        if not addresses:
            raise InternalUnavailable(f"{host} has no addresses")
        headers = {"Authorization": f"Bearer {self.signer.token_for(service)}", "Host": host}
        # The current request's id by default, so one id follows a request across services.
        request_id = request_id or request_id_var.get()
        if request_id:
            headers["X-Request-Id"] = request_id
        if traceparent:
            headers["traceparent"] = traceparent

        first = self.rng.choice(addresses)
        others = [a for a in addresses if a != first]
        attempts = [first, self.rng.choice(others) if others else first]
        started = time.monotonic()
        for attempt, address in enumerate(attempts):
            url = f"http://{_url_host(address)}:{self.port}{path}"
            try:
                response = await self._http.request(method, url, json=json, headers=headers)
            except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
                # A task that just stopped can stay in a cached answer for the 10 s TTL.
                _logger.info("internal call to %s at %s failed to connect (%s)", host, address, exc)
                if attempt == len(attempts) - 1:
                    self._log(service, method, path, None, started, retried=True)
                    raise InternalUnavailable(f"{host} unreachable") from exc
                continue
            self._log(service, method, path, response.status_code, started, retried=attempt > 0)
            return response
        raise AssertionError("unreachable")  # pragma: no cover - the loop always returns or raises

    def _log(
        self,
        service: str,
        method: str,
        path: str,
        status: int | None,
        started: float,
        *,
        retried: bool,
    ) -> None:
        # The structured line Logs Insights reads for internal-call rate, errors and latency (13.2).
        _logger.info(
            json.dumps(
                {
                    "internal_call": {
                        "caller": self.signer.service,
                        "callee": service,
                        "method": method,
                        "path": path,
                        "status": status,
                        "ms": round((time.monotonic() - started) * 1000, 1),
                        "retried": retried,
                    }
                },
                sort_keys=True,
            )
        )

    async def get(self, service: str, path: str, **kwargs: Any) -> httpx.Response:
        return await self.request("GET", service, path, **kwargs)

    async def put(self, service: str, path: str, **kwargs: Any) -> httpx.Response:
        return await self.request("PUT", service, path, **kwargs)

    async def post(self, service: str, path: str, **kwargs: Any) -> httpx.Response:
        return await self.request("POST", service, path, **kwargs)

    async def delete(self, service: str, path: str, **kwargs: Any) -> httpx.Response:
        return await self.request("DELETE", service, path, **kwargs)


def _url_host(address: str) -> str:
    return f"[{address}]" if ":" in address else address


# ── the authz fill (9.3) ───────────────────────────────────────────────────────


def authz_fill(client: InternalClient) -> AuthzFill:
    """The Authorizer's fill: auth's `GET /internal/authz/{user_id}`, which also refills Valkey.

    404 means the account doesn't exist (None); anything else that isn't a valid 200 means
    auth can't answer, and the request fails closed.
    """

    async def fill(user_id: str) -> AuthzEntry | None:
        try:
            response = await client.get("auth", f"/internal/authz/{user_id}")
        except (InternalUnavailable, httpx.HTTPError) as exc:
            raise AuthUnavailable(str(exc)) from exc
        if response.status_code == 404:
            return None
        if response.status_code != 200:
            raise AuthUnavailable(f"auth answered {response.status_code}")
        try:
            return AuthzEntry.from_dict(response.json())
        except (ValueError, TypeError, AttributeError) as exc:
            raise AuthUnavailable("auth's answer isn't an authz entry") from exc

    return fill
