"""The session cookies' names (production-readiness review, AUTH-05).

Deployed (every APP_ENV but local, all served over HTTPS behind CloudFront) the names carry
the prefixes browsers enforce:

- `__Host-access_token`: only accepted with `Secure`, `Path=/` and no `Domain`, so no other
  subdomain of the site can set or overwrite it.
- `__Secure-refresh_token`: only accepted with `Secure`. Its `Path=/api/v1/auth/` rules out
  `__Host-`; it's host-only all the same (auth sets no `Domain`).

Locally the app runs over plain HTTP, where browsers drop prefixed cookies, so the names
are the bare ones. auth sets them; every service reads the access cookie (common.authz);
infra-live-edge's JWT validator reads the deployed names.
"""

from __future__ import annotations

import os

DEPLOYED_ACCESS_COOKIE = "__Host-access_token"
DEPLOYED_REFRESH_COOKIE = "__Secure-refresh_token"
LOCAL_ACCESS_COOKIE = "access_token"
LOCAL_REFRESH_COOKIE = "refresh_token"


def session_cookie_names(app_env: str) -> tuple[str, str]:
    """(access cookie, refresh cookie) for `app_env`."""
    if app_env == "local":
        return LOCAL_ACCESS_COOKIE, LOCAL_REFRESH_COOKIE
    return DEPLOYED_ACCESS_COOKIE, DEPLOYED_REFRESH_COOKIE


# Read once: APP_ENV is fixed for a task's life (the task definition sets it).
ACCESS_COOKIE, REFRESH_COOKIE = session_cookie_names(os.environ.get("APP_ENV", "local"))
