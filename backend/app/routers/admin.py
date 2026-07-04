import hashlib
import logging
from datetime import UTC, datetime

from email_validator import EmailNotValidError
from email_validator import validate_email as _validate_email
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel, Field, field_validator
from pymongo.errors import DuplicateKeyError

from app import models
from app.database import get_db
from app.deps import get_current_admin
from app.limiter import user_limiter

router = APIRouter(tags=["admin"])
log = logging.getLogger(__name__)


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


def _normalize_email_param(email: str) -> str:
    try:
        return _validate_email(email.strip(), check_deliverability=False).normalized.lower()
    except EmailNotValidError:
        raise HTTPException(status_code=422, detail="Invalid email address") from None


@router.get(
    "/admin/allowed-emails",
    description="List allowed emails with pagination. Admin only.",
)
@user_limiter.limit("60/minute")
async def list_allowed_emails(
    request: Request,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    _user: dict = Depends(get_current_admin),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    pipeline = [
        {"$facet": {
            "items": [{"$skip": skip}, {"$limit": limit}],
            "total": [{"$count": "n"}],
        }}
    ]
    result = await db[models.ALLOWED_EMAILS].aggregate(pipeline).to_list(1)
    facet = result[0] if result else {"items": [], "total": []}
    total = facet["total"][0]["n"] if facet["total"] else 0
    return {
        "items": [{"email": d["_id"], "added_at": d.get("added_at")} for d in facet["items"]],
        "total": total,
        "skip": skip,
        "limit": limit,
    }


@router.get(
    "/admin/allowed-emails/{email:path}",
    description="Fetch a single allowed email record. Admin only.",
)
@user_limiter.limit("60/minute")
async def get_allowed_email(
    request: Request,
    email: str,
    _user: dict = Depends(get_current_admin),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    normalized = _normalize_email_param(email)
    doc = await db[models.ALLOWED_EMAILS].find_one({"_id": normalized})
    if not doc:
        raise HTTPException(status_code=404, detail="Email not found in allowlist")
    return {"email": doc["_id"], "added_at": doc.get("added_at")}


@router.post(
    "/admin/allowed-emails",
    status_code=201,
    description="Add an email to the allowlist. Admin only.",
)
@user_limiter.limit("60/minute")
async def add_allowed_email(
    request: Request,
    body: AllowedEmailBody,
    _user: dict = Depends(get_current_admin),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    now = datetime.now(UTC)
    try:
        await db[models.ALLOWED_EMAILS].insert_one({"_id": body.email, "added_at": now})
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Email already in allowlist") from None
    log.info("admin.allowed_emails.add email_hash=%s", hashlib.sha256(body.email.encode()).hexdigest()[:16])
    return {"email": body.email, "added_at": now}


@router.delete(
    "/admin/allowed-emails/{email:path}",
    status_code=204,
    description="Remove an email from the allowlist. Admin only.",
)
@user_limiter.limit("60/minute")
async def remove_allowed_email(
    request: Request,
    email: str,
    _user: dict = Depends(get_current_admin),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    normalized = _normalize_email_param(email)
    result = await db[models.ALLOWED_EMAILS].delete_one({"_id": normalized})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Email not found in allowlist")
    log.info("admin.allowed_emails.remove email_hash=%s", hashlib.sha256(normalized.encode()).hexdigest()[:16])
