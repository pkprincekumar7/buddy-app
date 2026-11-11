"""auth.app.google: Google's signing certs are cached, and Google gets 5 s (AUTH-01)."""

import asyncio
import threading
from typing import Any

import pytest

from auth.app import google

CERTS = "https://www.googleapis.com/oauth2/v1/certs"


class FakeSession:
    """A requests.Session stand-in: answers every request with the next response."""

    def __init__(self, *responses: tuple[int, dict[str, str]]) -> None:
        self.responses = list(responses)
        self.calls: list[dict[str, Any]] = []

    def request(self, method: str, url: str, **kwargs: Any) -> Any:
        self.calls.append({"method": method, "url": url, **kwargs})
        status, headers = self.responses.pop(0) if len(self.responses) > 1 else self.responses[0]

        class Raw:
            status_code = status
            content = b'{"kid": "cert"}'

        Raw.headers = headers  # type: ignore[attr-defined]
        return Raw()

    def close(self) -> None:  # google-auth's Request closes its session when collected
        pass


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def test_certs_are_fetched_once_per_max_age():
    session, clock = FakeSession((200, {"Cache-Control": "public, max-age=600"})), Clock()
    request = google.CachedCertsRequest(session, clock=clock)  # type: ignore[arg-type]
    first = request(CERTS)
    assert request(CERTS) is first and len(session.calls) == 1  # from the cache
    clock.now += 599
    request(CERTS)
    assert len(session.calls) == 1
    clock.now += 1
    request(CERTS)
    assert len(session.calls) == 2  # max-age is up: fetched again


def test_google_gets_5_seconds_not_120():
    session = FakeSession((200, {}))
    google.CachedCertsRequest(session)(CERTS)  # type: ignore[arg-type]
    assert session.calls[0]["timeout"] == google.TIMEOUT_SECONDS == 5


@pytest.mark.parametrize(
    "response",
    [
        (200, {}),  # no max-age
        (200, {"Cache-Control": "no-store, max-age=600"}),
        (200, {"cache-control": "no-cache"}),
        (500, {"Cache-Control": "max-age=600"}),  # an error is never kept
    ],
)
def test_only_cacheable_successes_are_kept(response):
    session = FakeSession(response)
    request = google.CachedCertsRequest(session)  # type: ignore[arg-type]
    request(CERTS)
    request(CERTS)
    assert len(session.calls) == 2


def test_other_requests_are_never_cached():
    session = FakeSession((200, {"Cache-Control": "max-age=600"}))
    request = google.CachedCertsRequest(session)  # type: ignore[arg-type]
    request(CERTS, method="POST", body=b"x")
    request(CERTS, method="POST", body=b"x")
    assert [c["method"] for c in session.calls] == ["POST", "POST"]


def test_max_age_is_read_and_capped_at_a_day():
    assert google.max_age({"Cache-Control": "public, max-age=25092, must-revalidate"}) == 25092
    assert google.max_age({"cache-control": "max-age=999999"}) == google.MAX_CACHE_SECONDS
    assert google.max_age({"Cache-Control": "s-maxage=60"}) == 0  # not max-age
    assert google.max_age({}) == 0


def test_the_check_uses_the_cached_request_on_its_own_pool(monkeypatch):
    seen: dict[str, Any] = {}

    def fake_verify(token: str, request: Any, audience: str, clock_skew_in_seconds: int) -> Any:
        seen.update(
            token=token,
            request=request,
            audience=audience,
            skew=clock_skew_in_seconds,
            thread=threading.current_thread().name,
        )
        return {"sub": "1", "email": "a@example.com"}

    monkeypatch.setattr(google.id_token, "verify_oauth2_token", fake_verify)
    claims = asyncio.run(google.verify_google_token("t0ken", "client-id"))
    assert claims == {"sub": "1", "email": "a@example.com"}
    assert seen["request"] is google._request and isinstance(
        seen["request"], google.CachedCertsRequest
    )
    assert (seen["token"], seen["audience"], seen["skew"]) == ("t0ken", "client-id", 60)
    assert seen["thread"].startswith("google-signin")  # not the default pool


def test_a_bad_token_still_raises(monkeypatch):
    def reject(*args: Any, **kwargs: Any) -> Any:
        raise ValueError("Token used too late")

    monkeypatch.setattr(google.id_token, "verify_oauth2_token", reject)
    with pytest.raises(ValueError, match="too late"):
        asyncio.run(google.verify_google_token("t", "c"))
