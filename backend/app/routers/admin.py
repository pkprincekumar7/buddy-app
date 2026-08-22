import hashlib
import logging
from datetime import UTC, datetime

from email_validator import EmailNotValidError
from email_validator import validate_email as _validate_email
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field, field_validator
from pymongo.errors import DuplicateKeyError

from app import models
from app.deps import CurrentAdmin, Db, get_current_admin
from app.limiter import user_limiter

# Every route in this router requires an authenticated admin. Declaring the
# dependency here (rather than on each function) enforces it even if a future
# route is added without remembering to add the check locally. Handlers that
# also need the admin's own user document still declare it as a parameter
# (e.g. lock_user) — FastAPI caches the dependency result per-request, so it
# does not run get_current_admin twice.
router = APIRouter(tags=["admin"], dependencies=[Depends(get_current_admin)])
log = logging.getLogger(__name__)


def _sanitize_for_log(value: str) -> str:
    return value.replace("\r", "").replace("\n", "")


class AllowedEmailBody(BaseModel):
    email: str = Field(max_length=255)

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        try:
            info = _validate_email(v.strip(), check_deliverability=False)
            return info.normalized.lower()
        except EmailNotValidError as exc:
            raise ValueError(str(exc)) from exc


class AllowedEmailResponse(BaseModel):
    email: str
    added_at: datetime | None = None


class AllowedEmailListResponse(BaseModel):
    items: list[AllowedEmailResponse]
    total: int
    skip: int
    limit: int


class AdminUserSummary(BaseModel):
    id: str
    email: str | None = None
    full_name: str | None = None
    location: str | None = None
    created_at: datetime | None = None
    locked: bool = False


class AdminUserListResponse(BaseModel):
    items: list[AdminUserSummary]
    total: int
    skip: int
    limit: int


class LockUserResponse(BaseModel):
    id: str
    locked: bool


def _normalize_email_param(email: str) -> str:
    try:
        return _validate_email(email.strip(), check_deliverability=False).normalized.lower()
    except EmailNotValidError:
        raise HTTPException(status_code=422, detail="Invalid email address") from None


@router.get(
    "/admin/allowed-emails",
    response_model=AllowedEmailListResponse,
    description="List allowed emails with pagination. Admin only.",
)
@user_limiter.limit("60/minute")
async def list_allowed_emails(
    request: Request,
    db: Db,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
):
    pipeline = [
        {
            "$facet": {
                "items": [{"$skip": skip}, {"$limit": limit}],
                "total": [{"$count": "n"}],
            }
        }
    ]
    result = await db[models.ALLOWED_EMAILS].aggregate(pipeline).to_list(1)
    facet = result[0] if result else {"items": [], "total": []}
    total = facet["total"][0]["n"] if facet["total"] else 0
    return AllowedEmailListResponse(
        items=[
            AllowedEmailResponse(email=d["_id"], added_at=d.get("added_at")) for d in facet["items"]
        ],
        total=total,
        skip=skip,
        limit=limit,
    )


@router.get(
    "/admin/allowed-emails/{email:path}",
    response_model=AllowedEmailResponse,
    description="Fetch a single allowed email record. Admin only.",
)
@user_limiter.limit("60/minute")
async def get_allowed_email(
    request: Request,
    email: str,
    db: Db,
):
    normalized = _normalize_email_param(email)
    doc = await db[models.ALLOWED_EMAILS].find_one({"_id": normalized})
    if not doc:
        raise HTTPException(status_code=404, detail="Email not found in allowlist")
    return AllowedEmailResponse(email=doc["_id"], added_at=doc.get("added_at"))


@router.post(
    "/admin/allowed-emails",
    response_model=AllowedEmailResponse,
    status_code=201,
    description="Add an email to the allowlist. Admin only.",
)
@user_limiter.limit("60/minute")
async def add_allowed_email(
    request: Request,
    body: AllowedEmailBody,
    db: Db,
):
    now = datetime.now(UTC)
    try:
        await db[models.ALLOWED_EMAILS].insert_one({"_id": body.email, "added_at": now})
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Email already in allowlist") from None
    log.info(
        "admin.allowed_emails.add email_hash=%s",
        hashlib.sha256(body.email.encode()).hexdigest()[:16],
    )
    return AllowedEmailResponse(email=body.email, added_at=now)


@router.delete(
    "/admin/allowed-emails/{email:path}",
    status_code=204,
    description="Remove an email from the allowlist. Admin only.",
)
@user_limiter.limit("60/minute")
async def remove_allowed_email(
    request: Request,
    email: str,
    db: Db,
):
    normalized = _normalize_email_param(email)
    result = await db[models.ALLOWED_EMAILS].delete_one({"_id": normalized})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Email not found in allowlist")
    log.info(
        "admin.allowed_emails.remove email_hash=%s",
        hashlib.sha256(normalized.encode()).hexdigest()[:16],
    )


# ── Registered users ──────────────────────────────────────────────────────────


@router.get(
    "/admin/users",
    response_model=AdminUserListResponse,
    description="List registered users with pagination. Admin only.",
)
@user_limiter.limit("60/minute")
async def list_users(
    request: Request,
    db: Db,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
):
    pipeline = [
        {
            "$facet": {
                "items": [
                    {"$sort": {"created_at": -1}},
                    {"$skip": skip},
                    {"$limit": limit},
                    {
                        "$project": {
                            "_id": 1,
                            "email": 1,
                            "full_name": 1,
                            "location": 1,
                            "created_at": 1,
                            "is_locked": 1,
                        }
                    },
                ],
                "total": [{"$count": "n"}],
            }
        }
    ]
    result = await db[models.USERS].aggregate(pipeline).to_list(1)
    facet = result[0] if result else {"items": [], "total": []}
    total = facet["total"][0]["n"] if facet["total"] else 0
    return AdminUserListResponse(
        items=[
            AdminUserSummary(
                id=str(d["_id"]),
                email=d.get("email"),
                full_name=d.get("full_name"),
                location=d.get("location"),
                created_at=d.get("created_at"),
                locked=bool(d.get("is_locked")),
            )
            for d in facet["items"]
        ],
        total=total,
        skip=skip,
        limit=limit,
    )


@router.get(
    "/admin/users/by-email/{email:path}",
    response_model=AdminUserSummary,
    description="Look up a registered user by email address. Admin only.",
)
@user_limiter.limit("60/minute")
async def get_user_by_email(
    request: Request,
    email: str,
    db: Db,
):
    normalized = _normalize_email_param(email)
    email_doc = await db[models.EMAIL_INDEX].find_one({"_id": normalized})
    if not email_doc:
        raise HTTPException(status_code=404, detail="User not found")
    user = await db[models.USERS].find_one(
        {"_id": email_doc["user_id"], "location": email_doc["location"]},
        {"_id": 1, "email": 1, "full_name": 1, "location": 1, "created_at": 1, "is_locked": 1},
    )
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return AdminUserSummary(
        id=str(user["_id"]),
        email=user.get("email"),
        full_name=user.get("full_name"),
        location=user.get("location"),
        created_at=user.get("created_at"),
        locked=bool(user.get("is_locked")),
    )


@router.patch(
    "/admin/users/{user_id}/lock",
    response_model=LockUserResponse,
    description="Lock a user account — revokes all tokens and blocks login. Admin only.",
)
@user_limiter.limit("60/minute")
async def lock_user(
    request: Request,
    user_id: str,
    admin: CurrentAdmin,
    db: Db,
    location: str = Query(..., description="User's location shard (returned by /admin/users)"),
):
    if user_id == str(admin["_id"]):
        raise HTTPException(status_code=400, detail="Cannot lock your own account")
    now = datetime.now(UTC)
    result = await db[models.USERS].update_one(
        {"_id": user_id, "location": location},
        {"$set": {"is_locked": True, "tokens_revoked_at": now, "updated_at": now}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    safe_user_id = user_id.replace("\r", "").replace("\n", "")
    safe_location = location.replace("\r", "").replace("\n", "")
    log.info("admin.users.lock user_id=%s location=%s", safe_user_id, safe_location)
    return LockUserResponse(id=user_id, locked=True)


@router.patch(
    "/admin/users/{user_id}/unlock",
    response_model=LockUserResponse,
    description="Unlock a previously locked user account. Admin only.",
)
@user_limiter.limit("60/minute")
async def unlock_user(
    request: Request,
    user_id: str,
    db: Db,
    location: str = Query(..., description="User's location shard (returned by /admin/users)"),
):
    now = datetime.now(UTC)
    result = await db[models.USERS].update_one(
        {"_id": user_id, "location": location},
        {"$set": {"is_locked": False, "updated_at": now}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    safe_user_id = _sanitize_for_log(user_id)
    safe_location = _sanitize_for_log(location)
    log.info("admin.users.unlock user_id=%s location=%s", safe_user_id, safe_location)
    return LockUserResponse(id=user_id, locked=False)
