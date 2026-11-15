"""common.upload_tracking against MongoDB and Moto: a photo presigned but never saved is
swept after a day; a saved one leaves no row; a deleted child's rows are swept once its
presigned forms have expired, with anything uploaded late; a replaced photo at once (review)."""

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
            # The deleted child's was presigned just now: a form that's still valid.
            await rows.update_many(
                {"_id": {"$nin": [fresh, gone]}}, {"$set": {"created_at": day_ago}}
            )
            async with (
                client.start_session() as session,
                await session.start_transaction(),
            ):
                await tracking.attached(db, [saved], location="in", session=session)
                await tracking.forget_children(db, [other], location="in", session=session)
            # Only the abandoned one: the saved one has no row, the fresh one is under a day
            # old, and the deleted child's isn't due until its forms have expired.
            assert await tracking.sweep(db, uploads, ["us"]) == 0  # another region's
            assert await tracking.sweep(db, uploads, None) == 1
            left = {o["Key"] for o in s3.list_objects_v2(Bucket=BUCKET)["Contents"]}
            assert left == {saved, fresh, gone}
            assert {row["_id"] for row in await rows.find({}).to_list(None)} == {fresh, gone}
            row = await rows.find_one({"_id": gone})
            assert row is not None and set(row) == {
                "_id", "location", "child_id", "created_at", "sweep_after"
            }  # ids only  # fmt: skip
            due = row["sweep_after"].replace(tzinfo=UTC) - datetime.now(UTC)
            assert timedelta(minutes=14) < due <= tracking.DELETED_SWEEP_AFTER
            # The window over, the sweep deletes the late upload, then the row.
            await rows.update_one({"_id": gone}, {"$set": {"sweep_after": datetime.now(UTC)}})
            assert await tracking.sweep(db, uploads, None) == 1
            left = {o["Key"] for o in s3.list_objects_v2(Bucket=BUCKET)["Contents"]}
            assert left == {saved, fresh}
            assert {row["_id"] for row in await rows.find({}).to_list(None)} == {fresh}

            # A failed delete keeps its row for the next sweep.
            await rows.update_one({"_id": fresh}, {"$set": {"created_at": day_ago}})

            async def broken(key: str) -> None:
                raise ConnectionError("s3 down")

            uploads.delete = broken  # type: ignore[method-assign]
            assert await tracking.sweep(db, uploads, ["in"]) == 0
            assert await rows.count_documents({}) == 1

    mongo_run(body)


def test_a_presigned_form_used_after_the_deletion_leaves_nothing(mongo_run):
    # The form is presigned, the child is deleted (prefix emptied, rows marked), and only then
    # does the upload land: the sweep after the window still finds and deletes it.
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
            child = str(uuid.uuid4())
            late = _key(child)
            await tracking.record_presigned(db, late, location="in", child_id=child)
            assert await uploads.delete_child("in", child, "avatar") == 0
            async with client.start_session() as session, await session.start_transaction():
                await tracking.forget_children(db, [child], location="in", session=session)
            s3.put_object(Bucket=BUCKET, Key=late, Body=b"x")  # the late upload
            assert await tracking.sweep(db, uploads, None) == 0  # the form may still be used
            rows = db[tracking.PENDING_UPLOADS]
            past = datetime.now(UTC) - timedelta(seconds=1)
            await rows.update_one({"_id": late}, {"$set": {"sweep_after": past}})
            assert await tracking.sweep(db, uploads, None) == 1
            assert s3.list_objects_v2(Bucket=BUCKET).get("Contents") is None
            assert await rows.count_documents({}) == 0

    mongo_run(body)


def test_a_replaced_photo_is_deleted_now_or_by_the_sweep(mongo_run):
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
            child = str(uuid.uuid4())
            old, older = _key(child), _key(child)
            rows = db[tracking.PENDING_UPLOADS]
            for key in (old, older):
                s3.put_object(Bucket=BUCKET, Key=key, Body=b"x")
                async with client.start_session() as session, await session.start_transaction():
                    await tracking.replaced(db, key, location="in", child_id=child, session=session)
            assert await tracking.delete_now(db, uploads, old, location="in")
            assert await rows.find_one({"_id": old}) is None

            real = uploads.delete

            async def broken(key: str) -> None:
                raise ConnectionError("s3 down")

            uploads.delete = broken  # type: ignore[method-assign]
            assert not await tracking.delete_now(db, uploads, older, location="in")
            assert await rows.find_one({"_id": older}) is not None  # kept for the sweep
            uploads.delete = real  # type: ignore[method-assign]
            # A deletion after it doesn't push it back (it's due already).
            async with client.start_session() as session, await session.start_transaction():
                await tracking.forget_children(db, [child], location="in", session=session)
            assert await tracking.sweep(db, uploads, ["in"]) == 1
            assert s3.list_objects_v2(Bucket=BUCKET).get("Contents") is None
            assert await rows.count_documents({}) == 0

    mongo_run(body)
