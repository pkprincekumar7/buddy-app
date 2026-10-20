"""GET /downloads/apk, against a real boto3 S3 client with botocore's Stubber.

The listing responses are stubbed, but pagination, request parameters and the
presigned URL itself are produced by botocore — so the URL's expiry, signed
Content-Disposition and region are checked for real. Stubber rejects any call
not queued up, so nothing ever reaches AWS.
"""

import logging
from urllib.parse import parse_qs, urlsplit

import boto3
import pytest
from botocore.stub import Stubber
from fastapi.testclient import TestClient

import app.routers.downloads as downloads
from app.auth_utils import create_access_token
from app.database import get_db
from app.deps import get_current_parent
from app.limiter import user_limiter
from app.main import app
from app.services.s3_uploads import S3_SIGV4_CONFIG, regional_s3_endpoint
from app.settings import get_settings, settings

URL = "/api/v1/downloads/apk"
BUCKET = "superpower-assets"
PREFIX = "app-assets/applications/android/"
PARENT = {"_id": "p1", "location": "eu", "role": "parent"}
ADMIN = {"_id": "a1", "location": "eu", "role": "admin"}


class _Users:
    def __init__(self):
        self.lookups = 0

    async def find_one(self, query):
        self.lookups += 1
        return next((u for u in (PARENT, ADMIN) if u["_id"] == query["_id"]), None)


@pytest.fixture(autouse=True)
def isolated_aws(monkeypatch, tmp_path):
    """Fake credentials, no config files, no instance-metadata lookups."""
    for var in ("AWS_PROFILE", "AWS_SESSION_TOKEN", "AWS_DEFAULT_REGION", "AWS_REGION"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "AKIDEXAMPLE")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "secret")
    monkeypatch.setenv("AWS_CONFIG_FILE", str(tmp_path / "config"))
    monkeypatch.setenv("AWS_SHARED_CREDENTIALS_FILE", str(tmp_path / "credentials"))
    monkeypatch.setenv("AWS_EC2_METADATA_DISABLED", "true")


@pytest.fixture
def s3(monkeypatch):
    """The stubbed client the route will get; `.regions` records what it asked for."""
    # A fresh session: boto3's default one caches credentials across tests.
    # Built with the same SigV4 options the route passes, so the URL it signs
    # is the real one.
    client = boto3.session.Session().client(
        "s3",
        region_name="us-east-1",
        endpoint_url=regional_s3_endpoint("us-east-1"),
        config=S3_SIGV4_CONFIG,
    )
    stubber = Stubber(client)
    stubber.regions = []
    stubber.client_kwargs = []

    def make_client(service, region_name, **kwargs):
        assert service == "s3"
        stubber.regions.append(region_name)
        stubber.client_kwargs.append(kwargs)
        return client

    monkeypatch.setattr(downloads.boto3, "client", make_client)
    with stubber:
        yield stubber
    stubber.assert_no_pending_responses()


@pytest.fixture
def users():
    users = _Users()
    app.dependency_overrides[get_db] = lambda: {"users": users}
    app.dependency_overrides[get_settings] = lambda: settings.model_copy(
        update={"assets_bucket_name": BUCKET, "aws_region": "eu-west-1"}
    )
    user_limiter.reset()
    try:
        yield users
    finally:
        for dep in (get_db, get_settings, get_current_parent):
            app.dependency_overrides.pop(dep, None)
        user_limiter.reset()


@pytest.fixture
def client():
    return TestClient(app)


def _auth(user=PARENT):
    return {"Authorization": f"Bearer {create_access_token(user['_id'], user['location'])}"}


def _page(*keys, next_token=None):
    response = {"Contents": [{"Key": PREFIX + k} for k in keys], "IsTruncated": bool(next_token)}
    if next_token:
        response["NextContinuationToken"] = next_token
    return response


def _expect_listing(s3, *pages):
    token = None
    for page in pages:
        params = {"Bucket": BUCKET, "Prefix": PREFIX}
        if token:
            params["ContinuationToken"] = token
        s3.add_response("list_objects_v2", page, params)
        token = page.get("NextContinuationToken")


# ── happy path ───────────────────────────────────────────────────────────────


def test_returns_a_presigned_link_to_the_newest_apk_across_pages(users, client, s3, caplog):
    _expect_listing(
        s3,
        _page("app-release-2026-03-01-10-00-00.apk", "notes.txt", next_token="t1"),
        _page(
            "app-release-2026-04-15-08-30-00.apk",
            "app-release-2026-04-15-08-30-00.apk.sha256",
            "app-release-2025-12-31-23-59-59.apk",
        ),  # fmt: skip
    )
    with caplog.at_level(logging.INFO, logger="app.routers.downloads"):
        res = client.get(URL, headers=_auth())
    assert res.status_code == 200
    body = res.json()
    assert (body["filename"], body["expires_in"]) == ("superpower-android.apk", 300)

    url = urlsplit(body["url"])
    query = {k: v[0] for k, v in parse_qs(url.query).items()}
    # Virtual-hosted on the bucket's regional endpoint, signed with SigV4 —
    # never legacy SigV2 (AWSAccessKeyId/Signature/Expires), which S3 rejects
    # for buckets created after June 2020.
    assert (url.scheme, url.netloc) == ("https", f"{BUCKET}.s3.us-east-1.amazonaws.com")
    assert url.path == f"/{PREFIX}app-release-2026-04-15-08-30-00.apk"
    assert query["response-content-disposition"] == 'attachment; filename="superpower-android.apk"'
    assert query["X-Amz-Algorithm"] == "AWS4-HMAC-SHA256"
    assert "/us-east-1/s3/aws4_request" in query["X-Amz-Credential"]
    assert query["X-Amz-Expires"] == "300"
    assert "AWSAccessKeyId" not in query
    # The bucket's own region, not the backend's (eu-west-1 here), with SigV4.
    assert s3.regions == ["us-east-1"]
    [kwargs] = s3.client_kwargs
    assert kwargs["config"] is S3_SIGV4_CONFIG
    assert kwargs["endpoint_url"] == "https://s3.us-east-1.amazonaws.com"
    assert "user=p1 requested APK pre-signed URL filename=superpower-android.apk" in caplog.text


def test_user_id_is_sanitised_in_the_log(users, client, s3, caplog):
    _expect_listing(s3, _page("app-release-2026-01-01-00-00-00.apk"))
    app.dependency_overrides[get_current_parent] = lambda: {"_id": "p1\r\nFORGED line"}
    with caplog.at_level(logging.INFO, logger="app.routers.downloads"):
        assert client.get(URL, headers=_auth()).status_code == 200
    assert "user=p1FORGED line requested" in caplog.text


def test_user_without_an_id_is_logged_as_unknown(users, client, s3, caplog):
    _expect_listing(s3, _page("app-release-2026-01-01-00-00-00.apk"))
    app.dependency_overrides[get_current_parent] = lambda: {}
    with caplog.at_level(logging.INFO, logger="app.routers.downloads"):
        assert client.get(URL, headers=_auth()).status_code == 200
    assert "user=unknown requested" in caplog.text


# ── failures ─────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "page",
    [{"IsTruncated": False}, _page("notes.txt", "app-release.apk.sha256")],  # empty / no .apk
)
def test_no_apk_build_is_404(users, client, s3, page):
    _expect_listing(s3, page)
    res = client.get(URL, headers=_auth())
    assert (res.status_code, res.json()["detail"]) == (404, "No APK build is available yet.")


def test_storage_listing_failure_is_503(users, client, s3, caplog):
    s3.add_client_error("list_objects_v2", "AccessDenied", "Access Denied", 403)
    with caplog.at_level(logging.ERROR, logger="app.routers.downloads"):
        res = client.get(URL, headers=_auth())
    assert (res.status_code, res.json()["detail"]) == (503, "Could not reach file storage.")
    assert "failed to list S3 objects" in caplog.text and "AccessDenied" in caplog.text
    assert "Access Denied" not in res.text  # S3's error stays in the log


def test_presign_failure_is_503(users, client, monkeypatch, caplog):
    # A client with no credentials at all: the stub serves the listing, and
    # signing the URL then fails for real (botocore's NoCredentialsError).
    monkeypatch.delenv("AWS_ACCESS_KEY_ID")
    monkeypatch.delenv("AWS_SECRET_ACCESS_KEY")
    unsigned = boto3.session.Session().client("s3", region_name="us-east-1")
    monkeypatch.setattr(downloads.boto3, "client", lambda service, region_name, **kw: unsigned)
    with Stubber(unsigned) as stub:
        _expect_listing(stub, _page("app-release-2026-01-01-00-00-00.apk"))
        with caplog.at_level(logging.ERROR, logger="app.routers.downloads"):
            res = client.get(URL, headers=_auth())
    assert (res.status_code, res.json()["detail"]) == (503, "Could not generate download link.")
    assert f"key={PREFIX}app-release-2026-01-01-00-00-00.apk" in caplog.text
    assert "Unable to locate credentials" in caplog.text


def test_not_configured_is_503_without_touching_s3(users, client, s3):
    app.dependency_overrides[get_settings] = lambda: settings.model_copy(
        update={"assets_bucket_name": ""}
    )
    res = client.get(URL, headers=_auth())
    assert (res.status_code, res.json()["detail"]) == (503, "APK downloads are not configured.")
    assert s3.regions == []


# ── access control ───────────────────────────────────────────────────────────


def test_requires_a_token(users, client, s3):
    res = client.get(URL)
    assert (res.status_code, res.json()["detail"]) == (401, "Not authenticated")
    assert s3.regions == []


def test_admins_cannot_download(users, client, s3):
    res = client.get(URL, headers=_auth(ADMIN))
    assert (res.status_code, res.json()["detail"]) == (403, "Not available for admin accounts")
    assert s3.regions == []


def test_rate_limited_to_10_per_minute_before_the_user_lookup(users, client, s3):
    app.dependency_overrides[get_settings] = lambda: settings.model_copy(
        update={"assets_bucket_name": ""}  # cheap 503s still count against the limit
    )
    for _ in range(10):
        assert client.get(URL, headers=_auth()).status_code == 503
    lookups = users.lookups
    assert client.get(URL, headers=_auth()).status_code == 429
    assert users.lookups == lookups
