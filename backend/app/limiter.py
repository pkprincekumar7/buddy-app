import logging

import jwt
from fastapi import Request
from slowapi import Limiter

from app.settings import settings

log = logging.getLogger(__name__)


def _get_client_ip(request: Request) -> str:
    if settings.behind_proxy:
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            # Use the leftmost entry — the client IP as seen by the proxy.
            # Standard proxies (AWS ALB, Nginx, GCP LB) prepend the client IP
            # so position [0] is the real client address.  Only use [-1] if your
            # specific proxy is configured to append rather than prepend (rare).
            return forwarded.split(",")[0].strip()
    if request.client is None:
        log.warning("rate_limit: request.client is None; using fallback bucket")
        return "__no_peer_address__"
    return request.client.host


def _get_user_id(request: Request) -> str:
    """
    Rate-limit key for authenticated endpoints: the user ID from the access
    token.  Falls back to IP so unauthenticated requests still get a bucket.

    Using the user ID prevents a single authenticated user from bypassing
    per-endpoint limits by rotating IPs (VPN, proxies, etc.).
    """
    token = request.cookies.get("access_token")
    if token:
        try:
            payload = jwt.decode(
                token,
                settings.jwt_public_key,
                algorithms=[settings.jwt_algorithm],
                options={"verify_exp": False},
            )
            sub = payload.get("sub")
            if sub and payload.get("type") == "access":
                return f"user:{sub}"
        except jwt.PyJWTError as exc:
            log.debug(
                "rate_limit: JWT decode failed (%s), falling back to IP bucket", type(exc).__name__
            )
    return f"ip:{_get_client_ip(request)}"


limiter = Limiter(key_func=_get_client_ip)
user_limiter = Limiter(key_func=_get_user_id)
