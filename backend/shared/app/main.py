"""The shared service's two apps, run by `python -m common.serve shared`.

Stateless and shared by every circle (docs/auth-users-split.md, 13.3). `app` is public
(port 8000, ALB rules 130 and 140); each endpoint is in docs/auth-users-split-api.md:

- `POST /api/v1/speech/transcriptions`: a voice recording to text (today's
  `/audio/transcribe`), parents only. Nothing is stored: the audio isn't kept or logged.
- `GET /api/v1/downloads/apk`: a 5-minute link to the newest Android APK, parents only.
- `GET /api/health`: the running build, for smoke tests and support.

`internal_app` (port 8001) answers `/internal/ping` only: no service calls shared, and
Cloud Map doesn't register it (services.tf).
"""

from __future__ import annotations

import asyncio
import io
import logging
import os
import re
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Annotated, Any

from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from limits import parse
from pydantic import BaseModel

from common.audit import route_template
from common.authz import Caller, current_caller, signed_in
from common.limiter import RateLimits
from common.routers import PolicyRouter, public
from shared.app.runtime import SERVICE, Runtime

MAX_AUDIO_BYTES = 10 * 1024 * 1024
# common.serve's cap on a request body: the recording plus the form's own parts.
MAX_BODY_BYTES = MAX_AUDIO_BYTES + 512 * 1024
# The allow-listed types and what OpenAI is told each is: never the client's Content-Type.
AUDIO_TYPES: dict[str, str] = {
    "webm": "audio/webm",
    "mp3": "audio/mpeg",
    "wav": "audio/wav",
    "m4a": "audio/mp4",
    "ogg": "audio/ogg",
    "mp4": "audio/mp4",
}
APK_PREFIX = "app-assets/applications/android/"
APK_FILENAME = "superpower-android.apk"
APK_URL_SECONDS = 300

_logger = logging.getLogger(__name__)
_runtime: Runtime | None = None
_users = 0
# /api/health is counted per task when the service runs unconfigured.
_fallback_limits = RateLimits(None, prefix=SERVICE)


def build_info(environ: Any = os.environ) -> dict[str, str | None]:
    """Baked into the image at build time (backend/Dockerfile's GIT_* args), as today."""
    return {
        "commit": environ.get("GIT_SHA", "unknown"),
        "branch": environ.get("GIT_BRANCH", "unknown"),
        "committed_at": environ.get("GIT_COMMITTED_AT", "unknown"),
        "tag": environ.get("GIT_TAG") or None,
    }


_BUILD = build_info()


def configure(runtime: Runtime | None) -> None:
    """Attach (or detach) the runtime's resources to both apps."""
    global _runtime
    _runtime = runtime
    app.state.runtime = runtime
    internal_app.state.runtime = runtime
    if runtime is not None:
        app.state.authorizer = runtime.authorizer


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Both apps share one Runtime per process; the last one to stop closes it."""
    global _users
    if _runtime is None and os.environ.get("JWT_PUBLIC_KEYS"):
        configure(Runtime.from_env())
    _users += 1
    try:
        yield
    finally:
        _users -= 1
        if _users == 0 and _runtime is not None:
            await _runtime.aclose()
            configure(None)


# The same contact and servers as today's app (app/main.py), for the published spec.
app = FastAPI(
    title=SERVICE,
    description="Shared: speech-to-text, the Android APK link and the build's health.",
    contact={"name": "Superpower Engineering", "email": "prince.kumar@pearson.com"},
    servers=[{"url": "/", "description": "Current environment"}],
    openapi_tags=[
        {"name": "health", "description": "Service health"},
        {"name": "speech", "description": "Speech-to-text"},
        {"name": "downloads", "description": "App downloads"},
    ],
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)
internal_app = FastAPI(
    title=f"{SERVICE} (internal)",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)
configure(None)


# ── shared dependencies ────────────────────────────────────────────────────────


def runtime_ready(request: Request) -> Runtime:
    """The runtime's resources, or 503 when the service runs without configuration."""
    runtime: Runtime | None = getattr(request.app.state, "runtime", None)
    if runtime is None:
        raise HTTPException(status_code=503, detail="shared isn't configured")
    return runtime


Ready = Annotated[Runtime, Depends(runtime_ready)]
SignedIn = Annotated[Caller, Depends(signed_in())]


def _too_many(seconds: int) -> HTTPException:
    return HTTPException(
        status_code=429, detail="Too many requests", headers={"Retry-After": str(seconds)}
    )


def per_user(limit: str) -> Callable[..., Awaitable[None]]:
    item = parse(limit)

    async def dependency(
        request: Request, runtime: Ready, caller: Annotated[Caller, Depends(current_caller)]
    ) -> None:
        if not runtime.limits.hit(
            item, route_template(request), request.method, f"user:{caller.user_id}"
        ):
            raise _too_many(item.get_expiry())

    return dependency


def per_ip(limit: str) -> Callable[..., Awaitable[None]]:
    item = parse(limit)

    async def dependency(request: Request) -> None:
        runtime: Runtime | None = getattr(request.app.state, "runtime", None)
        limits = runtime.limits if runtime is not None else _fallback_limits
        ip = limits.client_ip(request)
        if not limits.hit(item, route_template(request), request.method, f"ip:{ip}"):
            raise _too_many(item.get_expiry())

    return dependency


def _error(status: int, code: str, msg: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "msg": msg})


def _parents_only(caller: Caller) -> None:
    if caller.role != "parent":
        raise _error(403, "parents_only", "Only parents can use this.")


# ── models ─────────────────────────────────────────────────────────────────────


class Transcript(BaseModel):
    transcript: str


class ApkLink(BaseModel):
    url: str
    filename: str
    expires_in: int


class Build(BaseModel):
    status: str
    commit: str | None
    branch: str | None
    committed_at: str | None
    tag: str | None


# ── routes ─────────────────────────────────────────────────────────────────────

health_router = PolicyRouter()
router = PolicyRouter(prefix="/api/v1")


@health_router.get(
    "/health",
    tags=["health"],
    dependencies=[Depends(public())],
    description="Liveness check for the load balancer.",
)
def health() -> dict[str, str]:
    return {"status": "ok", "service": SERVICE}


@health_router.get(
    "/api/health",
    tags=["health"],
    dependencies=[Depends(public()), Depends(per_ip("30/minute"))],
    description="The running build (git SHA, branch, commit time, tag), for smoke tests and "
    "support; `unknown` without build metadata. This service's build only.",
)
def api_health() -> Build:
    return Build(status="ok", **_BUILD)


def _audio_type(filename: str | None) -> str:
    """The file's last extension, after stripping control characters; webm without one."""
    name = re.sub(r"[\x00-\x1f\x7f]", "", filename or "") or "recording.webm"
    extension = name.rsplit(".", 1)[-1].lower() if "." in name else "webm"
    if extension not in AUDIO_TYPES:
        allowed = ", ".join(sorted(AUDIO_TYPES))
        raise _error(415, "unsupported_audio_type", f"Allowed: {allowed}.")
    return extension


@router.post(
    "/speech/transcriptions",
    tags=["speech"],
    dependencies=[Depends(per_user("10/minute"))],
    description="A voice recording (`audio`: webm, mp3, wav, m4a, ogg or mp4, ≤ 10 MB) to "
    "text, parents only. Nothing is stored, and the audio isn't kept or logged.",
)
async def transcribe(
    runtime: Ready, caller: SignedIn, audio: Annotated[UploadFile, File()]
) -> Transcript:
    _parents_only(caller)
    if runtime.openai is None:
        raise _error(503, "transcription_not_configured", "Speech-to-text isn't configured.")
    # The body cap (MAX_BODY_BYTES, common.body_limit) already refused anything much larger
    # before the form was parsed; this is the recording's own limit.
    content = await audio.read(MAX_AUDIO_BYTES + 1)
    if len(content) > MAX_AUDIO_BYTES:
        raise _error(413, "audio_too_large", "The recording is over 10 MB.")
    extension = _audio_type(audio.filename)
    try:
        # A fixed name: the parent's filename is never sent anywhere.
        result = await runtime.openai.audio.transcriptions.create(
            model="whisper-1",
            file=(f"recording.{extension}", io.BytesIO(content), AUDIO_TYPES[extension]),
            language="en",
        )
    except Exception as exc:
        _logger.warning("shared.transcription.failed error=%s", type(exc).__name__)
        raise _error(
            502, "transcription_unavailable", "Speech-to-text is unavailable; try again."
        ) from exc
    return Transcript(transcript=result.text)


def _newest_apk_link(s3: Any, bucket: str) -> str | None:
    """A presigned GET for the newest APK (keys carry a UTC timestamp), or None."""
    pages = s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=APK_PREFIX)
    keys = [
        o["Key"] for page in pages for o in page.get("Contents", []) if o["Key"].endswith(".apk")
    ]
    if not keys:
        return None
    url: str = s3.generate_presigned_url(
        "get_object",
        Params={
            "Bucket": bucket,
            "Key": max(keys),
            "ResponseContentDisposition": f'attachment; filename="{APK_FILENAME}"',
        },
        ExpiresIn=APK_URL_SECONDS,
    )
    return url


@router.get(
    "/downloads/apk",
    tags=["downloads"],
    dependencies=[Depends(per_user("10/minute"))],
    description="A 5-minute link to the newest Android APK, parents only.",
)
async def apk_link(runtime: Ready, caller: SignedIn) -> ApkLink:
    _parents_only(caller)
    bucket = runtime.settings.assets_bucket_name
    if runtime.s3 is None or not bucket:
        raise _error(503, "downloads_not_configured", "APK downloads aren't configured.")
    try:
        url = await asyncio.to_thread(_newest_apk_link, runtime.s3, bucket)
    except Exception as exc:
        _logger.warning("shared.apk.failed error=%s", type(exc).__name__)
        raise _error(503, "downloads_unavailable", "Couldn't reach file storage.") from exc
    if url is None:
        raise _error(404, "apk_not_available", "No Android build is available yet.")
    _logger.info("shared.apk.link user=%s", caller.user_id)
    return ApkLink(url=url, filename=APK_FILENAME, expires_in=APK_URL_SECONDS)


app.include_router(health_router)
app.include_router(router)


# ── internal routes (port 8001) ────────────────────────────────────────────────

internal_router = PolicyRouter(prefix="/internal")


@internal_router.get(
    "/ping",
    tags=["internal"],
    dependencies=[Depends(public())],
    description="Reachability check (port 8001). No service calls shared internally.",
)
def ping() -> dict[str, str]:
    return {"status": "ok", "service": SERVICE}


internal_app.include_router(internal_router)
