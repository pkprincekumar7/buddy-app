import logging
import re
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exception_handlers import http_exception_handler
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from sqlalchemy.exc import SQLAlchemyError

from app.limiter import limiter, user_limiter
from app.routers.auth import router as auth_router
from app.routers.users import router as users_router
from app.routers.children import router as children_router
from app.routers.audio import router as audio_router
from app.routers.llm import router as llm_router
from app.settings import settings

log = logging.getLogger(__name__)

# Only allow safe printable ASCII characters (no newlines, control chars, or
# non-ASCII) to prevent log-injection via a crafted X-Request-Id header.
_REQUEST_ID_RE = re.compile(r'^[a-zA-Z0-9\-_]{1,64}$')


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Schema is managed by Alembic migrations (run via `alembic upgrade head` before startup).
    from apscheduler.schedulers.background import BackgroundScheduler
    from app.reconciler import cleanup_expired_tokens, reconcile_pending_routes

    scheduler = BackgroundScheduler()
    scheduler.add_job(
        reconcile_pending_routes,
        trigger="interval",
        minutes=settings.reconciler_interval_minutes,
        id="reconciler",
        max_instances=1,
        coalesce=True,
    )
    scheduler.add_job(
        cleanup_expired_tokens,
        trigger="interval",
        hours=6,
        id="token_cleanup",
        max_instances=1,
        coalesce=True,
    )
    scheduler.start()
    log.info("reconciler: scheduler started (interval=%d min)", settings.reconciler_interval_minutes)
    try:
        yield
    finally:
        scheduler.shutdown(wait=False)
        log.info("reconciler: scheduler stopped")


app = FastAPI(title="Buddy360 API", lifespan=lifespan)

app.state.limiter = limiter
app.state.user_limiter = user_limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
# SlowAPIMiddleware is registered first so that CORSMiddleware (registered below)
# becomes the outermost layer.  Starlette executes middleware in reverse
# registration order (last-added = first-executed), so CORS runs before the
# rate limiter and OPTIONS preflight requests are handled by CORS without
# consuming any rate-limit quota.
app.add_middleware(SlowAPIMiddleware)


@app.exception_handler(HTTPException)
async def custom_http_exception_handler(request: Request, exc: HTTPException):
    return await http_exception_handler(request, exc)


@app.exception_handler(SQLAlchemyError)
async def sqlalchemy_exception_handler(request: Request, exc: SQLAlchemyError):
    log.exception("Database error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    log.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    client_id = request.headers.get("X-Request-Id", "")
    request_id = client_id if _REQUEST_ID_RE.match(client_id) else str(uuid.uuid4())
    response = await call_next(request)
    response.headers["X-Request-Id"] = request_id
    response.headers["Cache-Control"] = "no-store"
    return response


_allow_origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allow_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-Id"],
)

app.include_router(auth_router, prefix="/api/v1")
app.include_router(users_router, prefix="/api/v1")
app.include_router(children_router, prefix="/api/v1")
app.include_router(llm_router, prefix="/api/v1")
app.include_router(audio_router, prefix="/api/v1")


@app.get("/health")
@app.get("/api/health")
def health_check():
    return {"status": "ok"}
