"""Shared S3 presigned-upload helpers.

Every upload flow in this app (child avatars, ninety-day-plan achievement
photos, ...) follows the same shape: validate a content type, mint a
presigned PUT URL under a per-child S3 prefix, and hand back the public URL
the client will PATCH into its own domain document once the upload succeeds.
Factored out here so that shape — and the cached boto3 client — has one home
instead of being copy-pasted per feature.
"""

from __future__ import annotations

import uuid
from typing import Any

import boto3

ALLOWED_IMAGE_CONTENT_TYPES: dict[str, str] = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
}

# Lazily initialised on first presign request (region not available at import time).
# Reused across requests to avoid creating a new connection pool per call.
_s3_client: Any | None = None


def get_s3_client(region: str) -> Any:
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client("s3", region_name=region)
    return _s3_client


def build_public_url(bucket: str, region: str, cdn_domain: str | None, key: str) -> str:
    """The URL a client stores and renders — a CloudFront domain when
    configured (OAC in front of a private bucket), else a direct S3 URL."""
    return (
        f"https://{cdn_domain}/{key}"
        if cdn_domain
        else f"https://{bucket}.s3.{region}.amazonaws.com/{key}"
    )


def build_upload_key(location: str, *parts: str, ext: str) -> str:
    """Every upload flow in this app should mint its key through here, so the
    shape stays consistent across features.

    `location` leads the path (uploads/{location}/...) even though this app
    is single-region today — the same field Mongo documents already carry
    for sharding. Once a second region goes live, the CloudFront edge layer
    needs this to route uploads/{location}/* to the correct region's bucket;
    a single distribution can't otherwise tell which of several regional
    buckets a given object lives in. Baking it in now avoids a painful key
    migration later, and costs nothing while there's only one region: the
    local-dev bucket's public-read policy is a wildcard on uploads/* and
    already covers whatever nested path this produces.
    """
    prefix = "/".join(["uploads", location, *parts])
    return f"{prefix}/{uuid.uuid4()}.{ext}"
