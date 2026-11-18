"""auth's collections (docs/auth-users-split.md, 5.1, 5.2, 14).

Sharded on `{location, _id}` later (per user): `auth`, `sessions`, `audit`.
Unsharded, so never inside a zone's transaction: `email_index`, `allowed_emails`,
`deletions`, `admin_count` (14). They hold HMAC keys and ids only, never an email.

`auth.auth` holds the one plaintext copy of each email, in the user's own zone, and has no
unique index on it: `email_index` enforces uniqueness (14). `authz_version` orders writes to
the authz cache and is bumped by every change to role, lock, deletion or revocation (9.3).
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from typing import Any

from pymongo import ASCENDING, DESCENDING

from common.events.store import Db, ensure_outbox, ensure_tombstones, ensure_validated_collection

AUTH = "auth"
SESSIONS = "sessions"
EMAIL_INDEX = "email_index"
ALLOWED_EMAILS = "allowed_emails"
DELETIONS = "deletions"
AUDIT = "audit"
ADMIN_COUNT = "admin_count"
# Per-region worker state (the change stream's resume token); tiny and unsharded.
WORKER_STATE = "worker_state"

# The fields the authz cache mirrors: changing any of them must bump authz_version (9.3).
AUTHZ_FIELDS = ("role", "is_locked", "is_being_deleted", "tokens_revoked_at")

SCHEMA_VERSION = 1
ROLES = ("parent", "admin")
PROVIDERS = ("password", "google")
EMAIL_STATUSES = ("reserved", "active")
AUDIT_RETENTION_SECONDS = 365 * 24 * 3600  # the agreed audit retention (14)

_STRING = {"bsonType": "string"}
_DATE = {"bsonType": "date"}
_INT = {"bsonType": ["int", "long"]}
_BOOL = {"bsonType": "bool"}
_HMAC_KEY = {"bsonType": "string", "pattern": "^[0-9a-f]{64}$"}


def _schema(required: list[str], properties: Mapping[str, Any]) -> dict[str, Any]:
    return {"$jsonSchema": {"bsonType": "object", "required": required, "properties": properties}}


VALIDATORS: dict[str, dict[str, Any]] = {
    AUTH: _schema(
        [
            "_id", "email", "password_hash", "role", "country_code", "location",
            "auth_provider", "authz_version", "created_at", "updated_at", "schema_version",
        ],
        {
            "_id": _STRING,
            "email": _STRING,
            "password_hash": _STRING,
            "role": {"enum": list(ROLES)},
            "country_code": {"bsonType": "string", "pattern": "^[A-Z]{2}$"},
            "location": _STRING,
            "auth_provider": {"enum": list(PROVIDERS)},
            "tokens_revoked_at": {"bsonType": ["date", "null"]},
            "authz_version": {"bsonType": ["int", "long"], "minimum": 1},
            "is_locked": _BOOL,
            "is_being_deleted": _BOOL,
            "created_at": _DATE,
            "updated_at": _DATE,
            "schema_version": _INT,
        },
    ),
    SESSIONS: _schema(
        ["_id", "user_id", "location", "family_id", "expires_at", "created_at"],
        {
            "_id": _STRING,
            "user_id": _STRING,
            "location": _STRING,
            "family_id": _STRING,
            "expires_at": _DATE,
            "rotated_at": {"bsonType": ["date", "null"]},
            "replaced_by": {"bsonType": ["string", "null"]},
            "created_at": _DATE,
        },
    ),
    EMAIL_INDEX: _schema(
        ["_id", "key_version", "user_id", "location", "status", "reserved_at"],
        {
            "_id": _HMAC_KEY,
            "key_version": {"bsonType": ["int", "long"], "minimum": 1},
            "user_id": _STRING,
            "location": _STRING,
            "status": {"enum": list(EMAIL_STATUSES)},
            "reserved_at": _DATE,
        },
    ),
    ALLOWED_EMAILS: _schema(
        ["_id", "key_version", "email_hint", "added_by", "created_at"],
        {
            "_id": _HMAC_KEY,
            "key_version": {"bsonType": ["int", "long"], "minimum": 1},
            "email_hint": _STRING,
            "added_by": _STRING,
            "created_at": _DATE,
        },
    ),
    DELETIONS: _schema(
        ["_id", "location", "requested_at", "expected", "confirmed"],
        {
            "_id": _STRING,
            "location": _STRING,
            "requested_at": _DATE,
            "expected": {"bsonType": "array", "items": _STRING},
            "confirmed": {"bsonType": "array", "items": _STRING},
        },
    ),
    AUDIT: _schema(
        [
            "_id", "actor_id", "actor_role", "location", "permission", "privileged",
            "outcome", "status_code", "route", "created_at",
        ],
        {
            "_id": _STRING,
            "actor_id": _STRING,
            "actor_role": _STRING,
            "location": _STRING,
            "permission": _STRING,
            "subject_id": {"bsonType": ["string", "null"]},
            "privileged": _BOOL,
            "outcome": {"enum": ["allowed", "denied"]},
            "status_code": _INT,
            "request_id": {"bsonType": ["string", "null"]},
            "source_ip": {"bsonType": ["string", "null"]},
            "route": _STRING,
            "changed_fields": {"bsonType": "array", "items": _STRING},
            "created_at": _DATE,
        },
    ),
    ADMIN_COUNT: _schema(
        ["_id", "active"], {"_id": _STRING, "active": {"bsonType": ["int", "long"], "minimum": 0}}
    ),
}  # fmt: skip


async def ensure_collections(db: Db) -> None:
    """Every auth collection with its validator and section-14 indexes. Safe on every start."""
    collections = {
        name: await ensure_validated_collection(db, name, validator)
        for name, validator in VALIDATORS.items()
    }
    shard_key = [("location", ASCENDING), ("_id", ASCENDING)]

    auth = collections[AUTH]
    await auth.create_index(shard_key, unique=True)
    await auth.create_index([("location", ASCENDING), ("created_at", DESCENDING)])
    await auth.create_index([("location", ASCENDING), ("role", ASCENDING)])
    for flag in ("is_being_deleted", "is_locked"):
        await auth.create_index(
            [("location", ASCENDING), (flag, ASCENDING)], partialFilterExpression={flag: True}
        )

    sessions = collections[SESSIONS]
    await sessions.create_index(shard_key, unique=True)
    await sessions.create_index([("location", ASCENDING), ("user_id", ASCENDING)])
    await sessions.create_index([("location", ASCENDING), ("family_id", ASCENDING)])
    # Replaces today's cleanup task: a session goes when its refresh token would expire.
    await sessions.create_index("expires_at", expireAfterSeconds=0)

    email_index = collections[EMAIL_INDEX]
    await email_index.create_index("user_id")
    await email_index.create_index(
        [("status", ASCENDING), ("reserved_at", ASCENDING)],
        partialFilterExpression={"status": "reserved"},
    )

    await collections[DELETIONS].create_index("requested_at")

    audit = collections[AUDIT]
    await audit.create_index(shard_key, unique=True)
    for who in ("actor_id", "subject_id"):
        await audit.create_index(
            [("location", ASCENDING), (who, ASCENDING), ("created_at", ASCENDING)]
        )
    await audit.create_index("created_at", expireAfterSeconds=AUDIT_RETENTION_SECONDS)

    if WORKER_STATE not in await db.list_collection_names():
        await db.create_collection(WORKER_STATE)

    # auth publishes user.deletion_requested (5.2); tombstones for deleted accounts (4.1).
    await ensure_outbox(db)
    await ensure_tombstones(db)


def new_credentials(
    *,
    user_id: str,
    email: str,
    password_hash: str,
    country_code: str,
    location: str,
    auth_provider: str,
    now: datetime,
) -> dict[str, Any]:
    """A new `auth.auth` document: a parent, in good standing, at authz_version 1 (9.3)."""
    return {
        "_id": user_id,
        "email": email,
        "password_hash": password_hash,
        "role": "parent",
        "country_code": country_code,
        "location": location,
        "auth_provider": auth_provider,
        "tokens_revoked_at": None,
        "authz_version": 1,
        "is_locked": False,
        "is_being_deleted": False,
        "created_at": now,
        "updated_at": now,
        "schema_version": SCHEMA_VERSION,
    }


def authz_change(fields: Mapping[str, Any], now: datetime) -> dict[str, Any]:
    """The update for any change to role, lock, deletion or revocation: always with
    `$inc: {authz_version: 1}`, so the cache's versioned write orders it (9.3). Every such
    write goes through here (a test checks the source for others)."""
    unknown = set(fields) - set(AUTHZ_FIELDS)
    if unknown or not fields:
        raise ValueError(f"authz_change takes only {AUTHZ_FIELDS}, got {sorted(fields)}")
    return {"$set": {**fields, "updated_at": now}, "$inc": {"authz_version": 1}}
