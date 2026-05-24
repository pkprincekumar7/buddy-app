import asyncio
import functools
import logging
import os
import random
import re
import uuid
from contextlib import asynccontextmanager
from datetime import UTC, datetime

from fastapi import FastAPI, HTTPException, Request
from fastapi.exception_handlers import http_exception_handler
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from motor.motor_asyncio import AsyncIOMotorClient
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.constants import API_V1_PREFIX
from app.database import init_indexes
from app.limiter import limiter, user_limiter
from app.llm_rate_limiter import get_redis_client
from app.routers.audio import router as audio_router
from app.routers.auth import router as auth_router
from app.routers.children import router as children_router
from app.routers.llm import router as llm_router
from app.routers.users import router as users_router
from app.settings import settings

log = logging.getLogger(__name__)

_REQUEST_ID_RE = re.compile(r"^[a-zA-Z0-9\-_]{1,64}$")


def _git_info() -> dict:
    # Values are baked into the image at build time via --build-arg / ENV.
    # CI (deploy-live-backend.yml) resolves real git metadata before docker build.
    # Local builds and scan builds default to "unknown" / empty string.
    tag = os.getenv("GIT_TAG") or None
    return {
        "commit": os.getenv("GIT_SHA", "unknown"),
        "branch": os.getenv("GIT_BRANCH", "unknown"),
        "committed_at": os.getenv("GIT_COMMITTED_AT", "unknown"),
        "tag": tag,
    }


_GIT_INFO = _git_info()

# ---------------------------------------------------------------------------
# Background task: expired-session cleanup
# ---------------------------------------------------------------------------
# MongoDB TTL indexes cannot be compound, so they cannot include the shard key
# (location) that is required on Atlas Global Clusters.  Instead, a background
# coroutine runs every hour and deletes any sessions whose expires_at has
# already passed.  On Atlas the fan-out across shards is acceptable for a
# once-hourly maintenance operation.
_SESSION_CLEANUP_INTERVAL_SECONDS = 3600  # 1 hour
_CLEANUP_LOCK_KEY = "session_cleanup:lock"
# TTL is slightly shorter than the interval so the lock never outlives a full cycle.
# It acts as a safety net only — the lock is explicitly released after cleanup.
_CLEANUP_LOCK_TTL = _SESSION_CLEANUP_INTERVAL_SECONDS - 10


async def _cleanup_expired_sessions(db) -> None:
    while True:
        await asyncio.sleep(_SESSION_CLEANUP_INTERVAL_SECONDS)

        r = get_redis_client()
        loop = asyncio.get_running_loop()
        lock_acquired = False

        if r is not None:
            # SET key 1 NX EX ttl — atomic acquire; returns True only if the key
            # did not exist, ensuring exactly one instance runs the cleanup.
            acquired = await loop.run_in_executor(
                None,
                functools.partial(r.set, _CLEANUP_LOCK_KEY, "1", nx=True, ex=_CLEANUP_LOCK_TTL),
            )
            if not acquired:
                log.debug("session_cleanup: lock held by another instance — skipping this cycle")
                continue
            lock_acquired = True
        else:
            # No Redis lock available — all instances will run cleanup.  Add per-cycle
            # jitter so pod restarts don't produce a synchronised wave of DB deletes.
            await asyncio.sleep(random.uniform(0, 300))  # nosec B311

        try:
            now = datetime.now(UTC)
            # NOTE: The `sessions` collection is sharded by `location`.  Querying
            # without the shard key triggers a scatter-gather fan-out across all
            # shards.  This is intentional and acceptable for a once-hourly
            # maintenance task.  If cleanup latency becomes a concern, replace this
            # with one delete_many per known location value (see routing.py for
            # the full set of valid location strings).
            result = await db["sessions"].delete_many({"expires_at": {"$lt": now}})
            if result.deleted_count:
                log.info("session_cleanup: removed %d expired sessions", result.deleted_count)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("session_cleanup: unexpected error — will retry next cycle")
        finally:
            if lock_acquired:
                try:
                    task = asyncio.current_task()
                    is_cancelling = (
                        task is not None and getattr(task, "cancelling", lambda: False)()
                    )
                    if not is_cancelling:
                        assert r is not None  # lock_acquired is only True when r was set
                        await loop.run_in_executor(None, r.delete, _CLEANUP_LOCK_KEY)
                except Exception:
                    log.warning(
                        "session_cleanup: failed to release Redis lock — "
                        "will expire naturally in %ds",
                        _CLEANUP_LOCK_TTL,
                    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    client: AsyncIOMotorClient = AsyncIOMotorClient(settings.mongodb_uri)
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


_OPENAPI_TAGS = [
    {"name": "auth", "description": "Authentication, session management, and account deletion."},
    {
        "name": "users",
        "description": "User preferences and child-scoped data (goals, growth areas).",
    },
    {"name": "children", "description": "Child profiles linked to a parent account."},
    {"name": "llm", "description": "Large-language-model invocation and provider availability."},
    {"name": "audio", "description": "Audio processing and speech-to-text transcription."},
    {"name": "system", "description": "Health checks and service build metadata."},
]

app = FastAPI(
    title="Buddy360 API",
    description=(
        "Backend API for the Buddy360 parenting-companion app. "
        "Provides authentication, child-profile management, LLM-powered guidance, "
        "and audio transcription."
    ),
    contact={"name": "Buddy360 Engineering", "email": "prince.kumar@pearson.com"},
    servers=[{"url": "/", "description": "Current environment"}],
    openapi_tags=_OPENAPI_TAGS,
    lifespan=lifespan,
)

app.state.limiter = limiter
app.state.user_limiter = user_limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]  # handler is correctly typed for RateLimitExceeded, a subclass of Exception
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


_HEALTH_PATHS = {"/health", "/api/health"}


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    client_id = request.headers.get("X-Request-Id", "")
    request_id = client_id if _REQUEST_ID_RE.match(client_id) else str(uuid.uuid4())
    response = await call_next(request)
    response.headers["X-Request-Id"] = request_id
    # Suppress caching for all API responses except the health check, which is
    # called frequently by load balancers and carries no sensitive data.
    if request.url.path not in _HEALTH_PATHS:
        response.headers["Cache-Control"] = "no-store"
    # X-Content-Type-Options and X-Frame-Options are intentionally NOT set here.
    # They are infrastructure-layer headers owned by the reverse proxy / CDN:
    #   - Docker Compose: nginx server-block add_header directives
    #   - AWS deployed:   CloudFront api_security response_headers_policy (override=true)
    # Setting them here as well would create duplicate header lines when running
    # behind nginx or CloudFront, requiring proxy_hide_header workarounds.
    # Cache-Control and X-Request-Id are application-layer concerns and stay here.
    return response


_allow_origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allow_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-Id"],
)

app.include_router(auth_router, prefix=API_V1_PREFIX)
app.include_router(users_router, prefix=API_V1_PREFIX)
app.include_router(children_router, prefix=API_V1_PREFIX)
app.include_router(llm_router, prefix=API_V1_PREFIX)
app.include_router(audio_router, prefix=API_V1_PREFIX)


@app.get(
    "/health",
    tags=["system"],
    description="Liveness probe — returns 200 OK when the process is running.",
)
def health_check():
    return {"status": "ok"}


@app.get(
    "/api/health",
    tags=["system"],
    description="Health check with build metadata (git SHA, branch, commit timestamp, tag).",
)
def api_health_check():
    return {"status": "ok", **_GIT_INFO}
