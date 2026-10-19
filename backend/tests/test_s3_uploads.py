"""app/services/s3_uploads.py — the shared presigned-upload helpers.

The S3 client is real boto3 (fake credentials, no config files, no network: presigning is
local signing), so the URL a client would PUT to is checked as botocore produces it.
"""

import re
import uuid
from urllib.parse import parse_qs, quote, urlsplit

import boto3
import pytest

import app.services.s3_uploads as s3_uploads
from app.services.s3_uploads import (
    ALLOWED_IMAGE_CONTENT_TYPES,
    bucket_host,
    build_upload_key,
    child_upload_prefix,
    get_s3_client,
    require_child_upload_key,
    upload_key_from_ref,
    upload_url_for,
)
from app.settings import settings


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
    # Virtual-hosted on the bucket's regional endpoint.
    assert (parts.scheme, parts.netloc, parts.path) == ("https", bucket_host(bucket, "ap-south-1"),
                                                        f"/{key}")  # fmt: skip
    assert query["X-Amz-Algorithm"] == "AWS4-HMAC-SHA256"
    assert query["X-Amz-Expires"] == "300"
    assert "/ap-south-1/s3/aws4_request" in query["X-Amz-Credential"]
    assert "content-type" in query["X-Amz-SignedHeaders"]  # a PUT with another type fails


@pytest.mark.parametrize("region", ["eu-west-1", "us-east-1"])
def test_every_region_presigns_with_sigv4_on_its_regional_host(region):
    # botocore's default presigns with legacy SigV2 in these regions, which S3
    # rejects for buckets created after June 2020 — S3_SIGV4_CONFIG forces SigV4.
    url = get_s3_client(region).generate_presigned_url(
        "get_object", Params={"Bucket": "bkt", "Key": "uploads/eu/c1/a.png"}, ExpiresIn=60
    )
    parts = urlsplit(url)
    query = parse_qs(parts.query)
    assert parts.netloc == f"bkt.s3.{region}.amazonaws.com"
    assert query["X-Amz-Algorithm"] == ["AWS4-HMAC-SHA256"]
    assert "AWSAccessKeyId" not in query


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


# ── EDGE-05: keys, not URLs, and presigned reads ─────────────────────────────

KEY = "uploads/eu/c1/9b2f.png"
PLAN_KEY = "uploads/eu/c1/ninety-day-plan/act:m101:sketch/1a2b.webp"
HOST = "bkt.s3.eu-west-1.amazonaws.com"


def _cfg(**overrides):
    values = {"uploads_bucket_name": "bkt", "aws_region": "eu-west-1",
              "uploads_url_ttl_seconds": 3600, **overrides}  # fmt: skip
    return settings.model_copy(update=values)


def test_child_upload_prefix_matches_build_upload_key():
    assert child_upload_prefix("eu", "c1") == "uploads/eu/c1/"
    assert build_upload_key("eu", "c1", ext="png").startswith(child_upload_prefix("eu", "c1"))


@pytest.mark.parametrize(
    ("ref", "key"),
    [
        (KEY, KEY),
        (PLAN_KEY, PLAN_KEY),  # ":" from ninety-day-plan field keys
        (f"https://{HOST}/{KEY}", KEY),
        (f"https://{HOST}/{KEY}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=x", KEY),
        (f"https://{HOST}/{quote(PLAN_KEY)}?X-Amz-Expires=3600", PLAN_KEY),  # %3A decoded
        (f"https://{HOST}/{KEY}#frag", KEY),
    ],
)
def test_our_keys_and_urls_reduce_to_the_key(ref, key):
    assert upload_key_from_ref(ref, _cfg()) == key


@pytest.mark.parametrize(
    "ref",
    [
        f"http://{HOST}/{KEY}",
        f"https://evil.example/{KEY}",
        f"https://{HOST}.evil.example/{KEY}",
        f"https://bkt.s3.amazonaws.com/{KEY}",  # not the host our client signs for
        f"https://other.s3.eu-west-1.amazonaws.com/{KEY}",
        "data:image/png;base64,AAAA",
        f"https://{HOST}/app-assets/x.png",
        f"https://{HOST}/uploads/eu/%2E%2E/x.png",  # encoded traversal
        "uploads/eu/../other/x.png",
        "uploads/eu//x.png",
        "uploads/eu/./x.png",
        "uploads/eu/x y.png",
        "uploads/",
        "",
    ],
)
def test_anything_else_is_not_ours(ref):
    assert upload_key_from_ref(ref, _cfg()) is None


def test_urls_are_only_recognised_when_bucket_and_region_are_set():
    for cfg in (_cfg(aws_region=""), _cfg(uploads_bucket_name="")):
        assert upload_key_from_ref(f"https://{HOST}/{KEY}", cfg) is None
        assert upload_key_from_ref(KEY, cfg) == KEY


def test_require_child_upload_key_only_accepts_this_childs_prefix():
    assert require_child_upload_key(f"https://{HOST}/{KEY}", _cfg(), "eu", "c1") == KEY
    for location, child in (("eu", "c2"), ("in", "c1")):
        with pytest.raises(ValueError, match="uploaded for this child"):
            require_child_upload_key(KEY, _cfg(), location, child)
    with pytest.raises(ValueError):
        require_child_upload_key("https://evil.example/x.png", _cfg(), "eu", "c1")


def test_upload_url_for_presigns_a_get_with_the_configured_ttl():
    url = upload_url_for(f"https://{HOST}/{quote(PLAN_KEY)}?X-Amz-Signature=old", _cfg())
    parts = urlsplit(url)
    query = {k: v[0] for k, v in parse_qs(parts.query).items()}
    assert parts.netloc == HOST
    assert upload_key_from_ref(url, _cfg()) == PLAN_KEY  # round-trips back to the key
    assert query["X-Amz-Algorithm"] == "AWS4-HMAC-SHA256"
    assert query["X-Amz-Expires"] == "3600"
    assert query["X-Amz-Signature"] != "old"
    short = upload_url_for(KEY, _cfg(uploads_url_ttl_seconds=600))
    assert parse_qs(urlsplit(short).query)["X-Amz-Expires"] == ["600"]


def test_upload_url_for_uses_the_given_client_factory():
    calls = []

    class _Fake:
        def generate_presigned_url(self, method, Params, ExpiresIn):  # noqa: N803 — boto3's names
            calls.append((method, Params, ExpiresIn))
            return "https://signed.example/x"

    assert upload_url_for(KEY, _cfg(), lambda region: _Fake()) == "https://signed.example/x"
    assert calls == [("get_object", {"Bucket": "bkt", "Key": KEY}, 3600)]


def test_upload_url_for_leaves_foreign_or_unconfigured_values_alone():
    assert upload_url_for("https://elsewhere.example/a.png", _cfg()) == (
        "https://elsewhere.example/a.png"
    )
    assert upload_url_for(KEY, _cfg(uploads_bucket_name="", aws_region="")) == KEY
