"""common.upload_tracking against MongoDB and Moto: a photo presigned but never saved is
swept after a day; a saved one, or one of a deleted child, leaves no row (review)."""

import uuid
from datetime import UTC, datetime, timedelta

import boto3
import pytest
from moto import mock_aws

from common import upload_tracking as tracking
from common.uploads import Uploads, UploadsConfig

pytestmark = pytest.mark.live_service

BUCKET = "buddy-test-uploads"
REGION = "ap-south-1"


def _key(child: str) -> str:
    return f"uploads/in/{child}/avatar/{uuid.uuid4()}.png"


def test_pending_saved_swept_and_forgotten(mongo_run):
    async def body(db, client):
        with mock_aws():
            s3 = boto3.client(
                "s3", region_name=REGION, aws_access_key_id="t", aws_secret_access_key="t"
            )
            s3.create_bucket(
                Bucket=BUCKET, CreateBucketConfiguration={"LocationConstraint": REGION}
            )
            uploads = Uploads(UploadsConfig(bucket=BUCKET, region=REGION), client=s3)
            await tracking.ensure_pending_uploads(db)
            await tracking.ensure_pending_uploads(db)  # safe to repeat
            child, other = str(uuid.uuid4()), str(uuid.uuid4())
            saved, abandoned, fresh, gone = _key(child), _key(child), _key(child), _key(other)
            for key in (saved, abandoned, fresh, gone):
                s3.put_object(Bucket=BUCKET, Key=key, Body=b"x")
                await tracking.record_presigned(
                    db, key, location="in", child_id=other if key == gone else child
                )
            rows = db[tracking.PENDING_UPLOADS]
            day_ago = datetime.now(UTC) - timedelta(days=2)
            await rows.update_many({"_id": {"$ne": fresh}}, {"$set": {"created_at": day_ago}})
            async with (
                client.start_session() as session,
                await session.start_transaction(),
            ):
                await tracking.attached(db, [saved], location="in", session=session)
                await tracking.forget_children(db, [other], location="in", session=session)
            # Only the abandoned one: the saved one and the deleted child's have no row, and
            # the fresh one is under a day old.
            assert await tracking.sweep(db, uploads, ["us"]) == 0  # another region's
            assert await tracking.sweep(db, uploads, None) == 1
            left = {o["Key"] for o in s3.list_objects_v2(Bucket=BUCKET)["Contents"]}
            assert left == {saved, fresh, gone}
            assert {row["_id"] for row in await rows.find({}).to_list(None)} == {fresh}

            # A failed delete keeps its row for the next sweep.
            await rows.update_one({"_id": fresh}, {"$set": {"created_at": day_ago}})

            async def broken(key: str) -> None:
                raise ConnectionError("s3 down")

            uploads.delete = broken  # type: ignore[method-assign]
            assert await tracking.sweep(db, uploads, ["in"]) == 0
            assert await rows.count_documents({}) == 1

    mongo_run(body)
