"""Browser requests: telling them apart, and refusing cross-site writes (review, AUTH-05).

The web app signs in with HttpOnly cookies, the mobile app with tokens in the body and an
`Authorization: Bearer` header. Browsers mark every request they send with headers a page's
script can't remove or forge: `Sec-Fetch-*` on all of them, and `Origin` on every POST,
PUT, PATCH and DELETE. React Native's networking sends neither.

- `is_browser_request`: auth leaves the tokens out of the body for a browser (the cookies
  carry them), so a script injected into a page can't read the refresh token.
- `OriginCheckMiddleware`: a state-changing request carrying a session cookie is refused
  when its `Origin` isn't one of PUBLIC_ORIGINS, or, without `Origin`, when `Sec-Fetch-Site`
  says another site sent it. `SameSite=lax` cookies still go with a POST from a sibling
  subdomain (same site), and a body-less POST such as `/auth/refresh` needs no CORS
  preflight, so this is what stops those. A request with neither header isn't from a
  browser page, so it can't be a cross-site forgery, and passes (the mobile app, which
  may hold the cookies too: React Native keeps a cookie jar).

Every service's public app gets the middleware (common.serve). Without PUBLIC_ORIGINS (local
runs, tests) it lets everything through; in stg and prod the settings require it.
"""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable, Iterable, Mapping, MutableMapping
from typing import Any
from urllib.parse import urlsplit

from starlette.requests import cookie_parser

from common.cookies import (
    DEPLOYED_ACCESS_COOKIE,
    DEPLOYED_REFRESH_COOKIE,
    LOCAL_ACCESS_COOKIE,
    LOCAL_REFRESH_COOKIE,
)

# Both sets of names (common.cookies): a check that misses one would let it through.
SESSION_COOKIES = (
    DEPLOYED_ACCESS_COOKIE,
    DEPLOYED_REFRESH_COOKIE,
    LOCAL_ACCESS_COOKIE,
    LOCAL_REFRESH_COOKIE,
)
UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
# Sec-Fetch-Site values a page on our own origin (or the user, typing the URL) produces.
OWN_SITE = frozenset({"same-origin", "none"})

Scope = MutableMapping[str, Any]
Message = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]
App = Callable[[Scope, Receive, Send], Awaitable[None]]


def parse_origins(value: str | None) -> frozenset[str] | None:
    """PUBLIC_ORIGINS ("https://a.example.com,https://b.example.com") as normalised origins,
    or None when unset (the check is off)."""
    origins = frozenset(
        o.strip().rstrip("/").lower() for o in (value or "").split(",") if o.strip()
    )
    return origins or None


def is_browser_request(headers: Mapping[str, str]) -> bool:
    """Sent by a browser: it has an `Origin` or any `Sec-Fetch-*` header."""
    return any(name == "origin" or name.startswith("sec-fetch-") for name in headers)


def _headers(scope: Scope) -> dict[str, str]:
    """The request's headers, names lower-cased; several Cookie headers joined into one."""
    headers: dict[str, str] = {}
    for raw_name, raw_value in scope.get("headers", []):
        name, value = raw_name.decode("latin-1").lower(), raw_value.decode("latin-1")
        headers[name] = (
            f"{headers[name]}; {value}" if name == "cookie" and name in headers else value
        )
    return headers


def _has_session_cookie(cookie_header: str) -> bool:
    """Parsed as the app parses it (Starlette's lenient parser): a stricter parser can stop at
    a malformed cookie a sibling subdomain planted first, and miss the session cookie the
    app would still read."""
    cookies = cookie_parser(cookie_header)
    return any(name in cookies for name in SESSION_COOKIES)


def _origin(value: str) -> str:
    parts = urlsplit(value.strip())
    return f"{parts.scheme}://{parts.netloc}".lower() if parts.scheme and parts.netloc else ""


def cross_site_reason(headers: Mapping[str, str], allowed: Iterable[str]) -> str | None:
    """Why this cookie-carrying write is refused, or None when it may go ahead."""
    if "origin" in headers:
        origin = _origin(headers["origin"])
        return None if origin in allowed else f"Origin {origin or 'null'} isn't allowed"
    site = headers.get("sec-fetch-site")
    if site is not None and site.lower() not in OWN_SITE:
        return f"a {site} request without an Origin"
    return None


class OriginCheckMiddleware:
    def __init__(self, app: App, allowed: frozenset[str] | None) -> None:
        self.app = app
        self.allowed = allowed

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            self.allowed is not None
            and scope.get("type") == "http"
            and scope.get("method") in UNSAFE_METHODS
        ):
            headers = _headers(scope)
            if _has_session_cookie(headers.get("cookie", "")) and (
                reason := cross_site_reason(headers, self.allowed)
            ):
                await _refuse(send, reason)
                return
        await self.app(scope, receive, send)


async def _refuse(send: Send, reason: str) -> None:
    body = json.dumps(
        {"detail": {"code": "cross_site_request", "msg": f"Refused: {reason}."}}
    ).encode()
    await send(
        {
            "type": "http.response.start",
            "status": 403,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})
