from fastapi import Request
from slowapi import Limiter


def _get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host


limiter = Limiter(key_func=_get_client_ip)
