import asyncio
import logging
from dataclasses import dataclass

import boto3
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.deps import get_current_user
from app.limiter import user_limiter
from app.settings import settings

log = logging.getLogger(__name__)

router = APIRouter(prefix="/downloads", tags=["downloads"])

# Pre-signed URL validity in seconds. 5 minutes is the standard for single-use
# download links — long enough for slow connections to start the download, short
# enough to prevent the URL being shared or replayed.
_PRESIGN_EXPIRES_SECONDS = 300

# The APK bucket is always in us-east-1. A single global bucket is intentional:
# even as the backend is deployed to additional regions, the build artifacts
# live in one place to keep the CI/CD workflow simple.
_S3_BUCKET_REGION = "us-east-1"

# S3 key prefix where the GitHub Actions build-android-apk workflow stores APKs.
# Each build is stored as:  app-assets/applications/android/app-release-YYYY-MM-DD-HH-MM-SS.apk
# Lexicographic sort on the key suffix finds the most recent build automatically.
_ANDROID_APK_PREFIX = "app-assets/applications/android/"


class _ApkError(Exception):
    def __init__(self, detail: str, status: int) -> None:
        self.detail = detail
        self.status = status
        super().__init__(detail)


@dataclass
class ApkDownloadResult:
    url: str
    filename: str


class ApkDownloadResponse(BaseModel):
    url: str
    filename: str
    expires_in: int


def _resolve_apk_download(bucket: str) -> ApkDownloadResult:
    """List APK objects and generate a pre-signed URL in a single boto3 session.

    Raises _ApkError (with an HTTP status code) on failure so the caller never
    needs to inspect error strings to decide which status code to return.
    """
    s3 = boto3.client("s3", region_name=_S3_BUCKET_REGION)

    # Step 1 — find the latest APK key.
    try:
        paginator = s3.get_paginator("list_objects_v2")
        pages = paginator.paginate(Bucket=bucket, Prefix=_ANDROID_APK_PREFIX)
        keys = [
            obj["Key"]
            for page in pages
            for obj in page.get("Contents", [])
            if obj["Key"].endswith(".apk")
        ]
    except (BotoCoreError, ClientError) as exc:
        log.error("downloads: failed to list S3 objects: %s", exc)
        raise _ApkError("Could not reach file storage.", 503) from exc

    if not keys:
        raise _ApkError("No APK build is available yet.", 404)

    # Keys include a UTC timestamp suffix so lexicographic max == most recent build.
    key = max(keys)

    # Step 2 — generate pre-signed URL using the same client.
    # ResponseContentDisposition is embedded in the signed URL so the browser
    # receives a Content-Disposition: attachment header from S3 directly. This
    # is the only reliable way to control the saved filename for cross-origin
    # downloads — the HTML anchor `download` attribute is ignored for cross-origin
    # URLs by all major browsers.
    try:
        url = s3.generate_presigned_url(
            "get_object",
            Params={
                "Bucket": bucket,
                "Key": key,
                "ResponseContentDisposition": 'attachment; filename="buddy360-android.apk"',
            },
            ExpiresIn=_PRESIGN_EXPIRES_SECONDS,
        )
    except (BotoCoreError, ClientError) as exc:
        log.error("downloads: failed to generate pre-signed URL for key=%s: %s", key, exc)
        raise _ApkError("Could not generate download link.", 503) from exc

    return ApkDownloadResult(url=url, filename="buddy360-android.apk")


@router.get(
    "/apk",
    response_model=ApkDownloadResponse,
    summary="Get a pre-signed S3 URL to download the latest Android APK",
    description=(
        "Returns a time-limited pre-signed S3 URL for the most recent Android APK build. "
        "The URL is valid for 5 minutes. Requires an authenticated session."
    ),
)
@user_limiter.limit("10/minute")
async def get_apk_download_url(
    request: Request,
    user: dict = Depends(get_current_user),
) -> ApkDownloadResponse:
    if not settings.backend_bucket_name:
        raise HTTPException(status_code=503, detail="APK downloads are not configured.")

    # Run the blocking boto3 calls in a thread pool to keep the async event loop free.
    try:
        result = await asyncio.to_thread(_resolve_apk_download, settings.backend_bucket_name)
    except _ApkError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.detail) from exc

    raw_user_id = user.get("_id")
    safe_user_id = (
        str(raw_user_id).replace("\r", "").replace("\n", "")
        if raw_user_id is not None
        else "unknown"
    )

    log.info(
        "downloads: user=%s requested APK pre-signed URL filename=%s",
        safe_user_id,
        result.filename,
    )

    return ApkDownloadResponse(
        url=result.url,
        filename=result.filename,
        expires_in=_PRESIGN_EXPIRES_SECONDS,
    )
