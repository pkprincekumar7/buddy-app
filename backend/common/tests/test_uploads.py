"""common.uploads against Moto (design 4.1; API: avatar/presign, transform/photos/presign).

The build plan's 1.7 check: a 6 MB object is rejected, and a key under the wrong prefix is
rejected. A real presigned PUT and GET run through a Moto server started here, so the
URLs a browser would get are exercised end to end.
"""

import asyncio
import socket
import uuid
from typing import Any

import boto3
import httpx
import pytest
from botocore.exceptions import ClientError
from moto import mock_aws
from moto.server import ThreadedMotoServer

from common.uploads import (
    MAX_UPLOAD_BYTES,
    UploadError,
    Uploads,
    UploadsConfig,
    child_prefix,
)

BUCKET = "buddy-test-uploads"
REGION = "ap-south-1"
CHILD = str(uuid.uuid4())
OTHER_CHILD = str(uuid.uuid4())


@pytest.fixture
def s3():
    with mock_aws():
        client = boto3.client(
            "s3", region_name=REGION, aws_access_key_id="t", aws_secret_access_key="t"
        )
        client.create_bucket(
            Bucket=BUCKET, CreateBucketConfiguration={"LocationConstraint": REGION}
        )
        yield client


@pytest.fixture
def uploads(s3) -> Uploads:
    return Uploads(UploadsConfig(bucket=BUCKET, region=REGION), client=s3, presign_client=s3)


def _put(s3, key: str, size: int, content_type: str = "image/png") -> None:
    s3.put_object(Bucket=BUCKET, Key=key, Body=b"x" * size, ContentType=content_type)


# ── keys ───────────────────────────────────────────────────────────────────────


def test_new_keys_live_under_the_childs_prefix_for_their_kind(uploads):
    key = uploads.new_key("in", CHILD, "avatar", "image/webp")
    assert key.startswith(f"uploads/in/{CHILD}/avatar/") and key.endswith(".webp")
    plan = uploads.new_key("in", CHILD, "ninety-day-plan", "image/jpeg")
    assert plan.startswith(child_prefix("in", CHILD, "ninety-day-plan")) and plan.endswith(".jpg")


def test_new_key_refuses_other_types_and_bad_ids(uploads):
    with pytest.raises(UploadError) as caught:
        uploads.new_key("in", CHILD, "avatar", "image/svg+xml")
    assert caught.value.code == "unsupported_image_type"
    with pytest.raises(ValueError, match="malformed"):
        uploads.new_key("IN", CHILD, "avatar", "image/png")
    with pytest.raises(ValueError, match="malformed"):
        uploads.new_key("in", "../x", "avatar", "image/png")
    with pytest.raises(ValueError, match="unknown upload kind"):
        child_prefix("in", CHILD, "documents")  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("make", "code"),
    [
        pytest.param(
            lambda u: u.new_key("in", CHILD, "ninety-day-plan", "image/png"),
            "invalid_avatar_key",
            id="a plan photo as avatar",
        ),
        pytest.param(
            lambda u: u.new_key("in", OTHER_CHILD, "avatar", "image/png"),
            "invalid_avatar_key",
            id="another child",
        ),
        pytest.param(
            lambda u: u.new_key("eu", CHILD, "avatar", "image/png"),
            "invalid_avatar_key",
            id="another location",
        ),
        pytest.param(
            lambda u: f"uploads/in/{CHILD}/avatar/../../x.png",
            "invalid_avatar_key",
            id="path tricks",
        ),
        pytest.param(
            lambda u: f"https://{BUCKET}.s3.{REGION}.amazonaws.com/uploads/in/{CHILD}/avatar/a.png",
            "invalid_avatar_key",
            id="a URL",
        ),
        pytest.param(lambda u: None, "invalid_avatar_key", id="not a string"),
    ],
)
def test_a_key_under_the_wrong_prefix_is_rejected(uploads, make, code):
    with pytest.raises(UploadError) as caught:
        uploads.check_key(make(uploads), "in", CHILD, "avatar")
    assert caught.value.code == code


def test_a_plan_photo_key_error_has_its_own_code(uploads):
    with pytest.raises(UploadError) as caught:
        uploads.check_key("nope", "in", CHILD, "ninety-day-plan")
    assert caught.value.code == "invalid_photo_key"


# ── HeadObject: present, an image, ≤ 5 MB ──────────────────────────────────────


def test_a_6_mb_object_is_rejected(uploads, s3):
    key = uploads.new_key("in", CHILD, "avatar", "image/png")
    _put(s3, key, 6 * 1024 * 1024)
    with pytest.raises(UploadError) as caught:
        asyncio.run(uploads.accept(key, "in", CHILD, "avatar"))
    assert caught.value.code == "too_large"
    # Refused for good, so deleted at once: nothing will ever point at it (review).
    assert s3.list_objects_v2(Bucket=BUCKET).get("KeyCount") == 0


def test_exactly_5_mb_is_accepted(uploads, s3):
    key = uploads.new_key("in", CHILD, "avatar", "image/png")
    _put(s3, key, MAX_UPLOAD_BYTES)
    assert asyncio.run(uploads.accept(key, "in", CHILD, "avatar")) == key


def test_a_missing_or_non_image_object_is_rejected(uploads, s3):
    missing = uploads.new_key("in", CHILD, "avatar", "image/png")
    with pytest.raises(UploadError) as caught:
        asyncio.run(uploads.verify_uploaded(missing))
    assert caught.value.code == "not_uploaded"
    html = uploads.new_key("in", CHILD, "avatar", "image/png")
    _put(s3, html, 10, content_type="text/html")
    with pytest.raises(UploadError) as caught:
        asyncio.run(uploads.verify_uploaded(html))
    assert caught.value.code == "unsupported_image_type"
    assert s3.list_objects_v2(Bucket=BUCKET).get("KeyCount") == 0  # refused: deleted


def test_other_s3_errors_propagate(uploads):
    class Denied:
        def head_object(self, **kwargs: Any) -> None:
            raise ClientError({"Error": {"Code": "AccessDenied", "Message": "no"}}, "HeadObject")

    with pytest.raises(ClientError):
        asyncio.run(Uploads(uploads.config, client=Denied()).verify_uploaded("k"))


# ── deleting ───────────────────────────────────────────────────────────────────


def test_deleting_one_photo_and_a_childs_photos(uploads, s3, monkeypatch):
    keys = [uploads.new_key("in", CHILD, "ninety-day-plan", "image/png") for _ in range(3)]
    avatar = uploads.new_key("in", CHILD, "avatar", "image/png")
    for key in [*keys, avatar]:
        _put(s3, key, 1)
    asyncio.run(uploads.delete(keys[0]))
    real = s3.list_objects_v2

    def paged(**params: Any) -> dict[str, Any]:
        return real(**params, MaxKeys=1)  # one per page, to follow the continuation

    monkeypatch.setattr(s3, "list_objects_v2", paged)
    assert asyncio.run(uploads.delete_child("in", CHILD, "ninety-day-plan")) == 2
    monkeypatch.setattr(s3, "list_objects_v2", real)
    left = [o["Key"] for o in s3.list_objects_v2(Bucket=BUCKET).get("Contents", [])]
    assert left == [avatar]  # transform's cleanup never touches children's avatar
    assert asyncio.run(uploads.delete_child("in", OTHER_CHILD, "avatar")) == 0


# ── config ─────────────────────────────────────────────────────────────────────


def test_config_from_env():
    config = UploadsConfig.from_env(
        {
            "UPLOADS_BUCKET_NAME": BUCKET,
            "AWS_REGION": "eu-west-1",
            "AWS_ENDPOINT_URL": "http://host.docker.internal:5050",
            "AWS_PUBLIC_ENDPOINT_URL": "http://localhost:5050",
        }
    )
    assert (config.region, config.endpoint_url, config.public_endpoint_url) == (
        "eu-west-1",
        "http://host.docker.internal:5050",
        "http://localhost:5050",
    )
    aws = UploadsConfig.from_env({"UPLOADS_BUCKET_NAME": BUCKET})
    assert (
        aws.endpoint_url is None and aws.public_endpoint_url is None and aws.url_ttl_seconds == 3600
    )
    with pytest.raises(UploadError) as caught:
        UploadsConfig.from_env({})
    assert caught.value.code == "uploads_not_configured"
    with pytest.raises(ValueError, match="TTL"):
        UploadsConfig.from_env({"UPLOADS_BUCKET_NAME": BUCKET, "UPLOADS_URL_TTL_SECONDS": "60"})


@pytest.fixture
def fake_aws_credentials(monkeypatch, tmp_path):
    """Presigning is local, but never let a test pick up this machine's real AWS profile."""
    for name in ("AWS_PROFILE", "AWS_DEFAULT_PROFILE", "AWS_SESSION_TOKEN"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("AWS_CONFIG_FILE", str(tmp_path / "config"))
    monkeypatch.setenv("AWS_SHARED_CREDENTIALS_FILE", str(tmp_path / "credentials"))
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "local")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "local")


def test_aws_urls_are_virtual_hosted_on_the_regional_endpoint(fake_aws_credentials):
    uploads = Uploads(UploadsConfig(bucket=BUCKET, region=REGION))
    url = asyncio.run(uploads.presign_get(f"uploads/in/{CHILD}/avatar/{uuid.uuid4()}.png"))
    assert url.startswith(f"https://{BUCKET}.s3.{REGION}.amazonaws.com/uploads/in/")
    assert "X-Amz-Algorithm=AWS4-HMAC-SHA256" in url
    assert uploads.presign_client is uploads.client


# ── a real presigned PUT and GET through a Moto server ─────────────────────────


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def test_presigned_urls_work_end_to_end_locally(fake_aws_credentials):
    port = _free_port()
    server = ThreadedMotoServer(ip_address="127.0.0.1", port=port, verbose=False)
    server.start()
    try:
        endpoint = f"http://127.0.0.1:{port}"
        # The service calls S3 at one address, presigns for another (as in compose: the
        # container's host.docker.internal vs the browser's localhost); here both reach Moto.
        config = UploadsConfig(
            bucket=BUCKET,
            region=REGION,
            endpoint_url=endpoint,
            public_endpoint_url=f"http://localhost:{port}",
        )
        uploads = Uploads(config)
        uploads.client.create_bucket(
            Bucket=BUCKET, CreateBucketConfiguration={"LocationConstraint": REGION}
        )
        assert uploads.presign_client is not uploads.client

        key = uploads.new_key("in", CHILD, "avatar", "image/png")
        put_url = asyncio.run(uploads.presign_put(key, "image/png"))
        assert put_url.startswith(f"http://localhost:{port}/{BUCKET}/uploads/in/")  # path-style
        assert (
            httpx.put(
                put_url, content=b"\x89PNG photo", headers={"Content-Type": "image/png"}
            ).status_code
            == 200
        )
        assert asyncio.run(uploads.accept(key, "in", CHILD, "avatar")) == key
        get_url = asyncio.run(uploads.presign_get(key))
        assert httpx.get(get_url).content == b"\x89PNG photo"
    finally:
        server.stop()
