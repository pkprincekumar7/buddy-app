#!/usr/bin/env python3
"""Check that the local stack can do what the new services rely on (build plan 0.3).

Run with the backend venv once the stack is up:

    docker compose up -d mongo valkey moto
    backend/.venv/bin/python scripts/check-local-stack.py

Checks:
- MongoDB is a replica set: a multi-document transaction commits and rolls back, and a
  change stream sees an insert (design 7.3, 9.3);
- Valkey answers and stores a key (design 9.3);
- Moto: SNS → SQS fan-out with a filter policy, raw delivery off so the envelope keeps
  `TopicArn`, and an S3 put and get (design 7.2).

Everything it creates is dropped or deleted at the end. Exit code 0 when all pass.
"""

import json
import os
import sys
import uuid

import boto3
import pymongo
import redis

MONGO_URI = os.environ.get("LOCAL_MONGO_URI", "mongodb://localhost:27017/?directConnection=true")
VALKEY_URL = os.environ.get("LOCAL_VALKEY_URL", "redis://localhost:6379")
MOTO_URL = os.environ.get("LOCAL_MOTO_URL", "http://localhost:5050")

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {name}{f' ({detail})' if detail else ''}")
    if not ok:
        failures.append(name)


def check_mongo() -> None:
    client: pymongo.MongoClient = pymongo.MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    db = client[f"localstack_check_{uuid.uuid4().hex[:8]}"]
    try:
        hello = client.admin.command("hello")
        check(
            "mongo: replica set primary",
            bool(hello.get("setName")) and hello.get("isWritablePrimary"),
            f"set {hello.get('setName')}, version {client.server_info()['version']}",
        )

        db.create_collection("data")
        db.create_collection("outbox")

        with client.start_session() as session, session.start_transaction():
            db.data.insert_one({"_id": "a"}, session=session)
            db.outbox.insert_one({"_id": "event-a"}, session=session)
        check(
            "mongo: transaction commits both writes",
            db.data.count_documents({}) == 1 and db.outbox.count_documents({}) == 1,
        )

        try:
            with client.start_session() as session, session.start_transaction():
                db.data.insert_one({"_id": "b"}, session=session)
                raise RuntimeError("abort")
        except RuntimeError:
            pass
        check("mongo: transaction rolls back", db.data.count_documents({"_id": "b"}) == 0)

        with db.outbox.watch(
            [{"$match": {"operationType": "insert"}}], max_await_time_ms=2000
        ) as stream:
            db.outbox.insert_one({"_id": "event-b", "region": "ap-south-1"})
            change = stream.try_next() or stream.try_next()
        check(
            "mongo: change stream sees the insert",
            bool(change) and change["fullDocument"]["_id"] == "event-b",
        )
    finally:
        client.drop_database(db.name)
        client.close()


def check_valkey() -> None:
    client = redis.Redis.from_url(VALKEY_URL, socket_timeout=5)
    key = f"localstack_check:{uuid.uuid4().hex}"
    try:
        info = client.info("server")
        check(
            "valkey: answers",
            client.ping(),
            f"{info.get('server_name', 'redis')} {info.get('valkey_version') or info.get('redis_version')}",
        )
        client.set(key, "1", ex=30)
        check("valkey: stores a key", client.get(key) == b"1")
    finally:
        client.delete(key)


def check_moto() -> None:
    kwargs = {
        "endpoint_url": MOTO_URL,
        "region_name": "ap-south-1",
        "aws_access_key_id": "local",
        "aws_secret_access_key": "local",
    }
    sns, sqs, s3 = (boto3.client(name, **kwargs) for name in ("sns", "sqs", "s3"))
    suffix = uuid.uuid4().hex[:8]
    topic_arn = sns.create_topic(Name=f"check-discover-events-{suffix}")["TopicArn"]
    queue_url = sqs.create_queue(QueueName=f"check-grow-events-{suffix}")["QueueUrl"]
    queue_arn = sqs.get_queue_attributes(QueueUrl=queue_url, AttributeNames=["QueueArn"])[
        "Attributes"
    ]["QueueArn"]
    bucket = f"check-uploads-{suffix}"
    try:
        sns.subscribe(
            TopicArn=topic_arn,
            Protocol="sqs",
            Endpoint=queue_arn,
            Attributes={
                "FilterPolicy": json.dumps({"event_type": ["discover.personality_finalised"]}),
                "RawMessageDelivery": "false",
            },
        )
        for event_type in ("discover.completed", "discover.personality_finalised"):
            sns.publish(
                TopicArn=topic_arn,
                Message=json.dumps({"event_type": event_type}),
                MessageAttributes={"event_type": {"DataType": "String", "StringValue": event_type}},
            )
        messages = sqs.receive_message(
            QueueUrl=queue_url, MaxNumberOfMessages=10, WaitTimeSeconds=2
        ).get("Messages", [])
        bodies = [json.loads(m["Body"]) for m in messages]
        check(
            "moto: SNS → SQS with a filter policy",
            len(bodies) == 1
            and json.loads(bodies[0]["Message"])["event_type"] == "discover.personality_finalised",
            f"{len(bodies)} delivered of 2 published",
        )
        check(
            "moto: envelope keeps TopicArn (raw delivery off)",
            bool(bodies) and bodies[0].get("TopicArn") == topic_arn,
        )

        s3.create_bucket(
            Bucket=bucket, CreateBucketConfiguration={"LocationConstraint": "ap-south-1"}
        )
        s3.put_object(Bucket=bucket, Key="uploads/in/child/avatar/a.png", Body=b"png")
        body = s3.get_object(Bucket=bucket, Key="uploads/in/child/avatar/a.png")["Body"].read()
        check("moto: S3 put and get", body == b"png")
    finally:
        for obj in (
            s3.list_objects_v2(Bucket=bucket).get("Contents", [])
            if _bucket_exists(s3, bucket)
            else []
        ):
            s3.delete_object(Bucket=bucket, Key=obj["Key"])
        if _bucket_exists(s3, bucket):
            s3.delete_bucket(Bucket=bucket)
        sqs.delete_queue(QueueUrl=queue_url)
        sns.delete_topic(TopicArn=topic_arn)


def _bucket_exists(s3, bucket: str) -> bool:
    return any(b["Name"] == bucket for b in s3.list_buckets().get("Buckets", []))


def main() -> int:
    for name, fn in (("mongo", check_mongo), ("valkey", check_valkey), ("moto", check_moto)):
        try:
            fn()
        except Exception as exc:  # report and carry on, so one outage doesn't hide the rest
            check(f"{name}: reachable", False, f"{type(exc).__name__}: {exc}")
    print(f"\n{'All local-stack checks passed.' if not failures else f'{len(failures)} failed.'}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
