"""common.origin: browser requests, and cross-site cookie writes refused (AUTH-05)."""

import asyncio

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from common.origin import (
    OriginCheckMiddleware,
    cross_site_reason,
    is_browser_request,
    parse_origins,
)

APP_ORIGIN = "https://superpower.example.com"


def _client(allowed: str | None = APP_ORIGIN) -> TestClient:
    app = FastAPI()

    @app.post("/api/v1/auth/refresh")
    @app.get("/api/v1/auth/refresh")
    @app.delete("/api/v1/auth/refresh")
    async def refresh() -> dict[str, str]:
        return {"status": "ok"}

    return TestClient(OriginCheckMiddleware(app, parse_origins(allowed)))


def test_origins_are_parsed_and_normalised():
    assert parse_origins(None) is None and parse_origins(" , ") is None
    assert parse_origins("https://A.example.com/, https://b.example.com") == frozenset(
        {"https://a.example.com", "https://b.example.com"}
    )


def test_a_browser_is_told_apart_by_headers_scripts_cannot_drop():
    assert is_browser_request({"origin": APP_ORIGIN})
    assert is_browser_request({"sec-fetch-mode": "cors"})
    # React Native's networking (the mobile app) sends neither.
    assert not is_browser_request({"authorization": "Bearer x", "user-agent": "okhttp/4"})


@pytest.mark.parametrize(
    ("headers", "allowed"),
    [
        ({"origin": APP_ORIGIN}, True),
        ({"origin": APP_ORIGIN.upper()}, True),
        ({"origin": "https://evil.example.com"}, False),  # a sibling subdomain: same site
        ({"origin": "null"}, False),  # a sandboxed frame or a data: URL
        ({"sec-fetch-site": "same-site"}, False),  # a browser, no Origin, another subdomain
        ({"sec-fetch-site": "cross-site"}, False),
        ({"sec-fetch-site": "same-origin"}, True),
        ({"sec-fetch-site": "none"}, True),  # typed into the address bar
        ({}, True),  # not a browser: the mobile app, curl
    ],
)
def test_which_cookie_writes_are_refused(headers, allowed):
    reason = cross_site_reason(headers, frozenset({APP_ORIGIN}))
    assert (reason is None) is allowed


def test_a_cross_site_post_with_the_refresh_cookie_is_refused():
    client = _client()
    client.cookies.set("refresh_token", "r")
    refused = client.post("/api/v1/auth/refresh", headers={"Origin": "https://evil.example.com"})
    assert refused.status_code == 403
    assert refused.json()["detail"]["code"] == "cross_site_request"
    assert (
        refused.json()["detail"]["msg"] == "Refused: Origin https://evil.example.com isn't allowed."
    )
    assert (
        client.delete("/api/v1/auth/refresh", headers={"Sec-Fetch-Site": "same-site"}).status_code
        == 403
    )
    # Our own origin, and a client that isn't a browser, go ahead.
    assert client.post("/api/v1/auth/refresh", headers={"Origin": APP_ORIGIN}).status_code == 200
    assert client.post("/api/v1/auth/refresh").status_code == 200


def test_only_cookie_carrying_writes_are_checked():
    client = _client()
    evil = {"Origin": "https://evil.example.com"}
    # No session cookie: nothing a forged request could use (a Bearer token isn't sent by
    # the browser on its own).
    assert client.post("/api/v1/auth/refresh", headers=evil).status_code == 200
    client.cookies.set("other", "x")
    assert client.post("/api/v1/auth/refresh", headers=evil).status_code == 200
    # Reads aren't checked: they change nothing.
    client.cookies.set("access_token", "a")
    assert client.get("/api/v1/auth/refresh", headers=evil).status_code == 200


def test_a_malformed_cookie_planted_first_does_not_hide_the_session_cookie():
    # A sibling subdomain can set a cookie for the whole site, and the browser may send it
    # first. A strict parser stops there; the app's (Starlette's) still reads the session.
    client = _client()
    evil = {"Origin": "https://evil.example.com"}
    for header in ('bad"=x; access_token=a', "a b=c; refresh_token=r", 'access_token=a; bad"=x'):
        assert (
            client.post("/api/v1/auth/refresh", headers={**evil, "Cookie": header}).status_code
            == 403
        )
    assert (
        client.post(
            "/api/v1/auth/refresh", headers={**evil, "Cookie": 'bad"=x; theme=dark'}
        ).status_code
        == 200
    )


def test_several_cookie_headers_are_read_together():
    async def main():
        seen = []

        async def app(scope, receive, send):
            seen.append(scope["path"])

        sent = []

        async def receive():
            return {"type": "http.request", "body": b""}

        async def send(message):
            sent.append(message)

        middleware = OriginCheckMiddleware(app, parse_origins(APP_ORIGIN))
        scope = {
            "type": "http",
            "method": "POST",
            "path": "/x",
            "headers": [
                (b"origin", b"https://evil.example.com"),
                (b"cookie", b"theme=dark"),
                (b"cookie", b"access_token=a"),  # HTTP/2 can send each cookie on its own
            ],
        }
        await middleware(scope, receive, send)
        return seen, sent[0]["status"]

    assert asyncio.run(main()) == ([], 403)


def test_without_public_origins_the_check_is_off():
    client = _client(allowed=None)
    client.cookies.set("refresh_token", "r")
    evil = {"Origin": "https://evil.example.com"}
    assert client.post("/api/v1/auth/refresh", headers=evil).status_code == 200
