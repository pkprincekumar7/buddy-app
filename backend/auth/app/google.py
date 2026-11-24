"""Google ID tokens: Google's own check, with its signing certs cached (production-readiness
review, AUTH-01).

`google.oauth2.id_token.verify_oauth2_token` downloads Google's certs through the `request`
it's given, and google-auth's own `Request` does so on every call, with a 120 s timeout.
`CachedCertsRequest` keeps a successful GET for as long as Google's `Cache-Control: max-age`
allows (about 7 hours) and waits at most 5 s for Google. So a sign-in normally makes no
call to Google at all, and a slow Google holds up only Google sign-ins.

The check runs on its own small thread pool: the google-auth call is synchronous, and on
the default pool a slow Google could take the threads bcrypt needs for password logins.
"""

from __future__ import annotations

import asyncio
import re
import threading
import time
from collections.abc import Callable, Mapping
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import requests
from google.auth import transport
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token

TIMEOUT_SECONDS = 5
# Google sends about 7 hours; a day at most, whatever a response says.
MAX_CACHE_SECONDS = 24 * 3600
CLOCK_SKEW_SECONDS = 60

_MAX_AGE = re.compile(r"(?:^|[,\s])max-age=(\d+)", re.IGNORECASE)


def max_age(headers: Mapping[str, str]) -> int:
    """The seconds a response may be reused: its `max-age`, 0 without one or with no-store."""
    control = headers.get("Cache-Control") or headers.get("cache-control") or ""
    if "no-store" in control.lower() or "no-cache" in control.lower():
        return 0
    match = _MAX_AGE.search(control)
    return min(int(match.group(1)), MAX_CACHE_SECONDS) if match else 0


class CachedCertsRequest(google_requests.Request):
    """google-auth's requests transport with a short timeout and a cache for plain GETs."""

    def __init__(
        self,
        session: requests.Session | None = None,
        *,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        super().__init__(session if session is not None else requests.Session())
        self.clock = clock
        self._cache: dict[str, tuple[float, transport.Response]] = {}
        self._lock = threading.Lock()

    def __call__(
        self,
        url: str,
        method: str = "GET",
        body: Any = None,
        headers: Mapping[str, str] | None = None,
        timeout: float | None = TIMEOUT_SECONDS,
        **kwargs: Any,
    ) -> transport.Response:
        if method != "GET" or body is not None:
            return super().__call__(url, method, body, headers, timeout=timeout, **kwargs)
        with self._lock:
            cached = self._cache.get(url)
            if cached is not None and cached[0] > self.clock():
                return cached[1]
        response = super().__call__(url, method, body, headers, timeout=timeout, **kwargs)
        if response.status == 200 and (seconds := max_age(response.headers)) > 0:
            with self._lock:
                self._cache[url] = (self.clock() + seconds, response)
        return response


_request = CachedCertsRequest()
_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="google-signin")


async def verify_google_token(token: str, client_id: str) -> dict[str, Any]:
    """Google's own check: signature against Google's keys, audience, issuer and expiry."""

    def verify() -> dict[str, Any]:
        claims: dict[str, Any] = id_token.verify_oauth2_token(
            token, _request, client_id, clock_skew_in_seconds=CLOCK_SKEW_SECONDS
        )
        return claims

    return await asyncio.get_running_loop().run_in_executor(_pool, verify)
