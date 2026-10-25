"""Photo uploads straight to S3, for children (avatars) and transform (plan photos): `common[uploads]`.

Ported from today's `app/services/s3_uploads.py` (docs/auth-users-split.md, 4.1;
auth-users-split-api.md, avatar/presign and transform/photos/presign):

1. **Presign:** `new_key` mints `uploads/{location}/{child_id}/{kind}/{uuid}.{ext}` and
   `presign_put` a 5-minute PUT URL for it. The client uploads, then sends the **key** back.
2. **Save:** `check_key` accepts only a key under this child's prefix *for this kind*, so a
   plan photo can't become an avatar (and replacing an avatar can't delete transform's
   object), and `verify_uploaded` runs `HeadObject`: the object must exist, be an allowed
   image and be at most 5 MB. A presigned PUT can't limit size, so this is where it's enforced.
3. **Read:** the bucket is private; `presign_get` turns a stored key into a short-lived URL.

Locally, AWS_ENDPOINT_URL is where the service calls S3 (Moto) and AWS_PUBLIC_ENDPOINT_URL
what presigned URLs point at, so the browser on the same machine can open them (0.3).
"""

from __future__ import annotations

import asyncio
import os
import re
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from common.regions import LOCATION_RE

Kind = Literal["avatar", "ninety-day-plan"]
KINDS: tuple[Kind, ...] = ("avatar", "ninety-day-plan")

ALLOWED_IMAGE_CONTENT_TYPES: dict[str, str] = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
}
MAX_UPLOAD_BYTES = 5 * 1024 * 1024
PUT_URL_TTL_SECONDS = 300

_UUID4 = r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"
_KEY_RE = re.compile(
    rf"uploads/(?P<location>[^/]+)/(?P<child>{_UUID4})/(?P<kind>avatar|ninety-day-plan)/{_UUID4}\.(?:jpg|png|webp|gif)"
)

# SigV4 with virtual-hosted URLs on the regional endpoint, as today (legacy SigV2 is
# refused by buckets made after June 2020).
_AWS_CONFIG = Config(signature_version="s3v4", s3={"addressing_style": "virtual"})
# A local endpoint (Moto) has no per-bucket hostnames: path-style.
_LOCAL_CONFIG = Config(signature_version="s3v4", s3={"addressing_style": "path"})


class UploadError(ValueError):
    """A refused upload; `code` is the API's error code."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class UploadsConfig:
    bucket: str
    region: str
    endpoint_url: str | None = None
    public_endpoint_url: str | None = None
    url_ttl_seconds: int = 3600

    @classmethod
    def from_env(cls, environ: Mapping[str, str] = os.environ) -> UploadsConfig:
        """UPLOADS_BUCKET_NAME, AWS_REGION, AWS_ENDPOINT_URL, AWS_PUBLIC_ENDPOINT_URL, UPLOADS_URL_TTL_SECONDS."""
        bucket = environ.get("UPLOADS_BUCKET_NAME", "")
        if not bucket:
            raise UploadError("uploads_not_configured", "UPLOADS_BUCKET_NAME is not set")
        endpoint = environ.get("AWS_ENDPOINT_URL") or None
        ttl = int(environ.get("UPLOADS_URL_TTL_SECONDS", "3600"))
        if not 300 <= ttl <= 86400:
            raise ValueError("UPLOADS_URL_TTL_SECONDS must be between 300 and 86400")
        return cls(
            bucket=bucket,
            region=environ.get("AWS_REGION", "ap-south-1"),
            endpoint_url=endpoint,
            public_endpoint_url=environ.get("AWS_PUBLIC_ENDPOINT_URL") or endpoint,
            url_ttl_seconds=ttl,
        )


def _client(region: str, endpoint: str | None) -> Any:
    return boto3.client(
        "s3",
        region_name=region,
        endpoint_url=endpoint or f"https://s3.{region}.amazonaws.com",
        config=_LOCAL_CONFIG if endpoint else _AWS_CONFIG,
    )


def child_prefix(location: str, child_id: str, kind: Kind) -> str:
    """Everything of this kind for this child lives under here (and its IAM access is scoped to it)."""
    if kind not in KINDS:
        raise ValueError(f"unknown upload kind {kind!r}")
    return f"uploads/{location}/{child_id}/{kind}/"


class Uploads:
    def __init__(
        self, config: UploadsConfig, *, client: Any = None, presign_client: Any = None
    ) -> None:
        self.config = config
        self.client = client if client is not None else _client(config.region, config.endpoint_url)
        self.presign_client = (
            presign_client
            if presign_client is not None
            else _client(config.region, config.public_endpoint_url)
            if config.public_endpoint_url != config.endpoint_url
            else self.client
        )

    # ── 1. presign ──

    def new_key(self, location: str, child_id: str, kind: Kind, content_type: str) -> str:
        ext = ALLOWED_IMAGE_CONTENT_TYPES.get(content_type)
        if ext is None:
            allowed = ", ".join(sorted(ALLOWED_IMAGE_CONTENT_TYPES))
            raise UploadError(
                "unsupported_image_type", f"Unsupported image type. Allowed: {allowed}"
            )
        if not LOCATION_RE.fullmatch(location) or not re.fullmatch(_UUID4, child_id):
            raise ValueError("location or child id is malformed")
        return f"{child_prefix(location, child_id, kind)}{uuid.uuid4()}.{ext}"

    async def presign_put(self, key: str, content_type: str) -> str:
        """A URL the client PUTs the file to within 5 minutes, with the same Content-Type."""
        url: str = await asyncio.to_thread(
            self.presign_client.generate_presigned_url,
            "put_object",
            Params={"Bucket": self.config.bucket, "Key": key, "ContentType": content_type},
            ExpiresIn=PUT_URL_TTL_SECONDS,
        )
        return url

    # ── 2. save ──

    @staticmethod
    def check_key(key: object, location: str, child_id: str, kind: Kind) -> str:
        """`key`, if it's one of ours for this child and kind; UploadError otherwise."""
        match = _KEY_RE.fullmatch(key) if isinstance(key, str) else None
        if (
            match is None
            or match["location"] != location
            or match["child"] != child_id
            or match["kind"] != kind
        ):
            raise UploadError(
                "invalid_avatar_key" if kind == "avatar" else "invalid_photo_key",
                f"must be a {kind} photo uploaded for this child",
            )
        return match.string

    async def verify_uploaded(self, key: str) -> int:
        """The object's size, after checking it exists, is an allowed image and is ≤ 5 MB."""
        try:
            head = await asyncio.to_thread(
                self.client.head_object, Bucket=self.config.bucket, Key=key
            )
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
                raise UploadError("not_uploaded", "the photo hasn't been uploaded") from exc
            raise
        if head.get("ContentType") not in ALLOWED_IMAGE_CONTENT_TYPES:
            raise UploadError("unsupported_image_type", "the uploaded file isn't an allowed image")
        size = int(head.get("ContentLength", 0))
        if size > MAX_UPLOAD_BYTES:
            raise UploadError("too_large", "the photo is larger than 5 MB")
        return size

    async def accept(self, key: object, location: str, child_id: str, kind: Kind) -> str:
        """`check_key` then `verify_uploaded`: what a PATCH runs before storing a key."""
        checked = self.check_key(key, location, child_id, kind)
        await self.verify_uploaded(checked)
        return checked

    # ── 3. read ──

    async def presign_get(self, key: str) -> str:
        url: str = await asyncio.to_thread(
            self.presign_client.generate_presigned_url,
            "get_object",
            Params={"Bucket": self.config.bucket, "Key": key},
            ExpiresIn=self.config.url_ttl_seconds,
        )
        return url

    # ── deleting ──

    async def delete(self, key: str) -> None:
        """A replaced or cleared photo, after the change commits."""
        await asyncio.to_thread(self.client.delete_object, Bucket=self.config.bucket, Key=key)

    async def delete_child(self, location: str, child_id: str, kind: Kind) -> int:
        """Every object of this kind for a deleted child (10.2). Returns how many."""
        prefix = child_prefix(location, child_id, kind)
        deleted = 0
        token: str | None = None
        while True:
            params: dict[str, Any] = {"Bucket": self.config.bucket, "Prefix": prefix}
            if token:
                params["ContinuationToken"] = token
            page = await asyncio.to_thread(self.client.list_objects_v2, **params)
            keys = [{"Key": obj["Key"]} for obj in page.get("Contents", [])]
            if keys:
                await asyncio.to_thread(
                    self.client.delete_objects,
                    Bucket=self.config.bucket,
                    Delete={"Objects": keys, "Quiet": True},
                )
                deleted += len(keys)
            token = page.get("NextContinuationToken")
            if not token:
                return deleted
