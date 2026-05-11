import asyncio
import logging
import re
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Request
from fastapi.exception_handlers import http_exception_handler
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from motor.motor_asyncio import AsyncIOMotorClient
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.database import init_indexes
from app.limiter import limiter, user_limiter
from app.routers.auth import router as auth_router
from app.routers.users import router as users_router
from app.routers.children import router as children_router
from app.routers.audio import router as audio_router
from app.routers.llm import router as llm_router
from app.settings import settings

log = logging.getLogger(__name__)

_REQUEST_ID_RE = re.compile(r'^[a-zA-Z0-9\-_]{1,64}$')

# ---------------------------------------------------------------------------
# Background task: expired-session cleanup
# ---------------------------------------------------------------------------
# MongoDB TTL indexes cannot be compound, so they cannot include the shard key
# (location) that is required on Atlas Global Clusters.  Instead, a background
# coroutine runs every hour and deletes any sessions whose expires_at has
# already passed.  On Atlas the fan-out across shards is acceptable for a
# once-hourly maintenance operation.
_SESSION_CLEANUP_INTERVAL_SECONDS = 3600  # 1 hour


async def _cleanup_expired_sessions(db) -> None:
    while True:
        await asyncio.sleep(_SESSION_CLEANUP_INTERVAL_SECONDS)
        try:
            now = datetime.now(timezone.utc)
            result = await db["sessions"].delete_many({"expires_at": {"$lt": now}})
            if result.deleted_count:
                log.info("session_cleanup: removed %d expired sessions", result.deleted_count)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("session_cleanup: unexpected error — will retry next cycle")


@asynccontextmanager
async def lifespan(app: FastAPI):
    client = AsyncIOMotorClient(settings.mongodb_uri)
    db = client[settings.mongodb_db_name]
    await init_indexes(db)
    app.state.db = db
    log.info("mongodb: connected db=%s", settings.mongodb_db_name)
    cleanup_task = asyncio.create_task(_cleanup_expired_sessions(db))
    try:
        yield
    finally:
        cleanup_task.cancel()
        await asyncio.gather(cleanup_task, return_exceptions=True)
        client.close()
        log.info("mongodb: connection closed")


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
