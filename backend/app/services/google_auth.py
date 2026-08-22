import logging

from fastapi import HTTPException

from app.settings import settings

try:
    from google.auth.transport import requests as _google_requests
    from google.oauth2 import id_token as _google_id_token
except ImportError:
    _google_id_token = None  # type: ignore[assignment]
    _google_requests = None  # type: ignore[assignment]
    logging.getLogger(__name__).warning(
        "google-auth package is not installed — Google sign-in endpoints will "
        "return 503.  Install with: pip install 'google-auth[requests]'"
    )

log = logging.getLogger(__name__)


def verify_google_token(id_token_str: str) -> dict:
    if not settings.google_client_id:
        raise HTTPException(status_code=503, detail="Google sign-in is not configured")
    if _google_id_token is None:
        raise HTTPException(
            status_code=503,
            detail=(
                "Server cannot verify Google tokens: the `google-auth[requests]` package "
                "is not installed.  Contact the server administrator."
            ),
        )
    try:
        return _google_id_token.verify_oauth2_token(
            id_token_str,
            _google_requests.Request(),
            settings.google_client_id,
            clock_skew_in_seconds=60,
        )
    except Exception as exc:
        log.warning(
            "Google ID token verification failed: %s: %s",
            type(exc).__name__,
            exc,
            exc_info=True,
        )
        raise HTTPException(status_code=401, detail="Invalid Google credential.") from exc
