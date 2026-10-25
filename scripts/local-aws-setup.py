#!/usr/bin/env python3
"""Create the local S3 buckets in Moto for end-to-end runs (build plan 0.3).

Run with the backend venv once Moto is up:

    backend/.venv/bin/moto_server -H 0.0.0.0 -p 5050
    backend/.venv/bin/python scripts/local-aws-setup.py

Creates the uploads and assets buckets with a CORS rule for the local frontend origins, so
the browser can PUT to a presigned URL and GET the result. Safe to re-run: existing buckets
are kept and their CORS rule is reset. Moto keeps everything in memory, so run this again
after restarting it.

Topics and queues aren't created here: they come from the events definition (build plan 1.2).
"""

import os
import sys

import boto3
from botocore.exceptions import ClientError

MOTO_URL = os.environ.get("LOCAL_MOTO_URL", "http://localhost:5050")
REGION = os.environ.get("AWS_REGION", "ap-south-1")
BUCKETS = (
    os.environ.get("UPLOADS_BUCKET_NAME", "person-local-uploads-bucket-ap-south-1"),
    os.environ.get("ASSETS_BUCKET_NAME", "person-local-assets-bucket"),
)
ORIGINS = [
    o
    for o in os.environ.get(
        "CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8080,http://127.0.0.1:8080",
    ).split(",")
    if o
]


def main() -> int:
    s3 = boto3.client(
        "s3",
        endpoint_url=MOTO_URL,
        region_name=REGION,
        aws_access_key_id="local",
        aws_secret_access_key="local",
    )
    for bucket in BUCKETS:
        try:
            s3.create_bucket(
                Bucket=bucket, CreateBucketConfiguration={"LocationConstraint": REGION}
            )
            print(f"Created  {bucket}")
        except ClientError as exc:
            if exc.response["Error"]["Code"] not in (
                "BucketAlreadyOwnedByYou",
                "BucketAlreadyExists",
            ):
                raise
            print(f"Exists   {bucket}")
        s3.put_bucket_cors(
            Bucket=bucket,
            CORSConfiguration={
                "CORSRules": [
                    {
                        "AllowedOrigins": ORIGINS,
                        "AllowedMethods": ["GET", "PUT", "HEAD"],
                        "AllowedHeaders": ["*"],
                        "ExposeHeaders": ["ETag"],
                        "MaxAgeSeconds": 3600,
                    }
                ]
            },
        )
        print(f"CORS set {bucket} ({', '.join(ORIGINS)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
