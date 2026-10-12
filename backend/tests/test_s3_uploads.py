"""app/services/s3_uploads.py — the shared presigned-upload helpers.

The S3 client is real boto3 (fake credentials, no config files, no network: presigning is
local signing), so the URL a client would PUT to is checked as botocore produces it.
"""

import re
import uuid
from urllib.parse import parse_qs, urlsplit

import boto3
import pytest

import app.services.s3_uploads as s3_uploads
from app.services.s3_uploads import (
    ALLOWED_IMAGE_CONTENT_TYPES,
    build_public_url,
    build_upload_key,
    get_s3_client,
)


@pytest.fixture(autouse=True)
def isolated_aws(monkeypatch, tmp_path):
    for var in ("AWS_PROFILE", "AWS_SESSION_TOKEN", "AWS_DEFAULT_REGION", "AWS_REGION"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "AKIDEXAMPLE")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "secret")
    monkeypatch.setenv("AWS_CONFIG_FILE", str(tmp_path / "config"))
    monkeypatch.setenv("AWS_SHARED_CREDENTIALS_FILE", str(tmp_path / "credentials"))
    monkeypatch.setenv("AWS_EC2_METADATA_DISABLED", "true")
    # A fresh default session (it caches credentials) and no cached client.
    monkeypatch.setattr(boto3, "DEFAULT_SESSION", None)
    monkeypatch.setattr(s3_uploads, "_s3_client", None)


# ── content types ────────────────────────────────────────────────────────────


def test_only_raster_images_are_allowed():
    assert ALLOWED_IMAGE_CONTENT_TYPES == {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "image/gif": "gif",
    }
    assert "image/svg+xml" not in ALLOWED_IMAGE_CONTENT_TYPES  # SVG can carry script


# ── get_s3_client ────────────────────────────────────────────────────────────


def test_client_is_created_lazily_for_the_region_and_then_reused():
    assert s3_uploads._s3_client is None
    client = get_s3_client("eu-west-1")
    assert client.meta.service_model.service_name == "s3"
    assert client.meta.region_name == "eu-west-1"
    assert get_s3_client("eu-west-1") is client  # one connection pool per process


def test_the_first_region_wins_for_the_process_lifetime():
    # Callers always pass settings.aws_region, so this never differs in practice —
    # pinned here because a second region would need its own client.
    first = get_s3_client("eu-west-1")
    assert get_s3_client("us-east-1") is first
    assert first.meta.region_name == "eu-west-1"


def test_presigned_put_from_the_real_client_signs_the_content_type():
    # ap-south-1, the region .env.example configures: botocore signs with SigV4 there.
    bucket = "person-local-uploads-bucket-ap-south-1"
    key = build_upload_key("in", "c1", ext="png")
    url = get_s3_client("ap-south-1").generate_presigned_url(
        "put_object",
        Params={"Bucket": bucket, "Key": key, "ContentType": "image/png"},
        ExpiresIn=300,
    )
    parts = urlsplit(url)
    query = {k: v[0] for k, v in parse_qs(parts.query).items()}
    # Virtual-hosted on the global S3 domain, which DNS routes to the bucket's region.
    assert (parts.scheme, parts.netloc, parts.path) == ("https", f"{bucket}.s3.amazonaws.com",
                                                        f"/{key}")  # fmt: skip
    assert query["X-Amz-Algorithm"] == "AWS4-HMAC-SHA256"
    assert query["X-Amz-Expires"] == "300"
    assert "/ap-south-1/s3/aws4_request" in query["X-Amz-Credential"]
    assert "content-type" in query["X-Amz-SignedHeaders"]  # a PUT with another type fails


# ── build_public_url ─────────────────────────────────────────────────────────


def test_public_url_uses_the_cdn_when_configured():
    assert (
        build_public_url("bkt", "eu-west-1", "cdn.example.com", "uploads/eu/c1/x.png")
        == "https://cdn.example.com/uploads/eu/c1/x.png"
    )


@pytest.mark.parametrize("cdn", [None, ""])
def test_public_url_falls_back_to_the_regional_s3_endpoint(cdn):
    assert (
        build_public_url("bkt", "eu-west-1", cdn, "uploads/eu/c1/x.png")
        == "https://bkt.s3.eu-west-1.amazonaws.com/uploads/eu/c1/x.png"
    )


# ── build_upload_key ─────────────────────────────────────────────────────────

UUID_RE = r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"


def test_upload_key_leads_with_the_location_then_the_parts():
    key = build_upload_key("eu", "c1", "ninety-day-plan", "act:m1:sketch", ext="webp")
    assert re.fullmatch(rf"uploads/eu/c1/ninety-day-plan/act:m1:sketch/{UUID_RE}\.webp", key)


def test_upload_key_with_no_extra_parts():
    assert re.fullmatch(rf"uploads/us/{UUID_RE}\.jpg", build_upload_key("us", ext="jpg"))


def test_upload_keys_never_collide():
    keys = {build_upload_key("eu", "c1", ext="png") for _ in range(200)}
    assert len(keys) == 200
    for key in keys:
        uuid.UUID(key.rsplit("/", 1)[1].removesuffix(".png"))


def test_avatar_and_plan_photo_keys_live_in_separate_prefixes():
    avatar = build_upload_key("eu", "c1", ext="png").split("/")
    photo = build_upload_key("eu", "c1", "ninety-day-plan", "ideas", ext="png").split("/")
    assert avatar[:3] == photo[:3] == ["uploads", "eu", "c1"]
    # An avatar's next segment is its file name; a plan photo's is a fixed folder.
    assert re.fullmatch(rf"{UUID_RE}\.png", avatar[3])
    assert photo[3:5] == ["ninety-day-plan", "ideas"]
