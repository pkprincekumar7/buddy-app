"""The hello service's two apps, run by `python -m common.serve hello`.

`app` is public (port 8000, behind the ALB); `internal_app` is internal (port 8001, through
Cloud Map only). Real services follow the same shape.
"""

from fastapi import FastAPI

SERVICE = "hello"

# The same contact and servers as today's app (app/main.py), for the published spec.
app = FastAPI(
    title=SERVICE,
    description="Placeholder service that proves the per-service build and deploy.",
    contact={"name": "Superpower Engineering", "email": "prince.kumar@pearson.com"},
    servers=[{"url": "/", "description": "Current environment"}],
    openapi_tags=[{"name": "health", "description": "Service health"}],
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)
internal_app = FastAPI(
    title=f"{SERVICE} (internal)", docs_url=None, redoc_url=None, openapi_url=None
)


@app.get("/health", tags=["health"], description="Liveness check for the load balancer.")
def health() -> dict[str, str]:
    return {"status": "ok", "service": SERVICE}


@internal_app.get(
    "/internal/ping", tags=["internal"], description="Reachability check for internal callers."
)
def ping() -> dict[str, str]:
    return {"status": "ok", "service": SERVICE}
