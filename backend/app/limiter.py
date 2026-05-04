from fastapi import Request
from slowapi import Limiter

from app.settings import settings


def _get_client_ip(request: Request) -> str:
    if settings.behind_proxy:
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


limiter = Limiter(key_func=_get_client_ip)
