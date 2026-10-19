"""Shared S3 upload helpers: presigned PUTs and presigned GETs (EDGE-05).

Every upload flow in this app (child avatars, ninety-day-plan achievement
photos, ...) follows the same shape: validate a content type, mint a
presigned PUT URL under a per-child S3 prefix, and hand back a URL the client
will PATCH into its own domain document once the upload succeeds.

Photos are private: the uploads bucket has no public or CloudFront access.
Mongo stores only the S3 **key** (uploads/...), and every read turns it into a
short-lived S3 presigned GET URL (upload_url_for). The API keeps its
URL-shaped fields for compatibility with released mobile builds: on write,
upload_key_from_ref accepts either a key or one of our own bucket URLs (as
the client got it, query string and all) and reduces it to the key.
Factored out here so that shape — and the cached boto3 client — has one home
instead of being copy-pasted per feature.
"""

from __future__ import annotations

import re
import uuid
from typing import TYPE_CHECKING, Any
from urllib.parse import unquote, urlsplit

import boto3
from botocore.config import Config

if TYPE_CHECKING:
    from app.settings import Settings

ALLOWED_IMAGE_CONTENT_TYPES: dict[str, str] = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
}

# Lazily initialised on first presign request (region not available at import time).
# Reused across requests to avoid creating a new connection pool per call.
_s3_client: Any | None = None


# SigV4 + virtual-hosted + the regional endpoint, so every presigned URL is
# https://{bucket}.s3.{region}.amazonaws.com/... signed with SigV4. Without
# this, botocore presigns with legacy SigV2 in some regions (eu-west-1,
# us-east-1), which S3 rejects for buckets created after June 2020, and uses
# the global s3.amazonaws.com host.
S3_SIGV4_CONFIG = Config(signature_version="s3v4", s3={"addressing_style": "virtual"})


def regional_s3_endpoint(region: str) -> str:
    """The regional S3 endpoint to pair with S3_SIGV4_CONFIG."""
    return f"https://s3.{region}.amazonaws.com"


def get_s3_client(region: str) -> Any:
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client(
            "s3",
            region_name=region,
            endpoint_url=regional_s3_endpoint(region),
            config=S3_SIGV4_CONFIG,
        )
    return _s3_client


def bucket_host(bucket: str, region: str) -> str:
    """The host get_s3_client's presigned URLs use for `bucket`."""
    return f"{bucket}.s3.{region}.amazonaws.com"


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


# ---------------------------------------------------------------------------
# Keys, not URLs (EDGE-05)
# ---------------------------------------------------------------------------

UPLOAD_KEY_PREFIX = "uploads/"
# ":" is in ninety-day-plan field keys ("act:{activityId}:{fieldK}", see
# schemas/ninety_day_plan.py _FIELD_KEY_RE), which build_upload_key puts in the path.
_UPLOAD_KEY_RE = re.compile(r"^uploads/[A-Za-z0-9._:/-]+$")


def child_upload_prefix(location: str, child_id: str) -> str:
    """The prefix every upload for this child lives under — build_upload_key's
    uploads/{location}/{child_id}/...."""
    return f"{UPLOAD_KEY_PREFIX}{location}/{child_id}/"


def upload_key_from_ref(ref: str, settings: Settings) -> str | None:
    """The S3 key a stored or client-sent value refers to, or None if it isn't
    one of ours.

    Accepts a bare key (uploads/...), or an https URL on our uploads bucket's
    host — with or without the presigned query string, since clients echo
    back what they were given. Anything else (external hosts, http:, data:,
    path tricks) → None.
    """
    candidate: str
    if ref.startswith(UPLOAD_KEY_PREFIX):
        candidate = ref
    else:
        if not (settings.uploads_bucket_name and settings.aws_region):
            return None
        parts = urlsplit(ref)
        if parts.scheme != "https" or parts.netloc != bucket_host(
            settings.uploads_bucket_name, settings.aws_region
        ):
            return None
        # Presigned URLs percent-encode the key (":" → "%3A").
        candidate = unquote(parts.path.removeprefix("/"))
    if not _UPLOAD_KEY_RE.match(candidate) or any(
        seg in ("", ".", "..") for seg in candidate.split("/")
    ):
        return None
    return candidate


def require_child_upload_key(ref: str, settings: Settings, location: str, child_id: str) -> str:
    """upload_key_from_ref, restricted to this child's own prefix — raises
    ValueError otherwise. The server presigns whatever key is stored, so
    without the prefix check a client could store (and get a working URL for)
    another child's photo (APP-08)."""
    key = upload_key_from_ref(ref, settings)
    if key is None or not key.startswith(child_upload_prefix(location, child_id)):
        raise ValueError("must be a photo uploaded for this child")
    return key


# ---------------------------------------------------------------------------
# Presigned reads
# ---------------------------------------------------------------------------


def upload_url_for(ref: str, settings: Settings, client_factory: Any = get_s3_client) -> str:
    """The URL a client renders for a stored upload reference: an S3
    presigned GET valid for settings.uploads_url_ttl_seconds.

    `client_factory` is the router's own get_s3_client, so tests that swap
    the router's S3 client cover reads too. The write paths only ever store
    keys, so a value that isn't ours can't normally occur, and with no bucket
    configured there's nothing to presign against; both are returned
    unchanged rather than raising.
    """
    key = upload_key_from_ref(ref, settings)
    if key is None or not (settings.uploads_bucket_name and settings.aws_region):
        return ref
    url: str = client_factory(settings.aws_region).generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.uploads_bucket_name, "Key": key},
        ExpiresIn=settings.uploads_url_ttl_seconds,
    )
    return url
