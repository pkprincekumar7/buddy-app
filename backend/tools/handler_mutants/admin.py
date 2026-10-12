"""Hand-built mutants for app/routers/admin.py: the 8 admin routes and the allowlist email validator."""

# ruff: noqa: E501

TARGET = "app/routers/admin.py"
TESTS = ["tests/test_admin.py"]

MUTANTS: list[tuple[str, str, str]] = [
    (
        "router-level token check removed",
        'router = APIRouter(tags=["admin"], dependencies=[Depends(get_token_claims)])',
        'router = APIRouter(tags=["admin"])',
    ),
    (
        "list_allowed_emails: admin check removed",
        '    description="List allowed emails with pagination. Admin only.",\n    dependencies=[Depends(rate_limit("60/minute")), Depends(get_current_admin)],',
        '    description="List allowed emails with pagination. Admin only.",\n    dependencies=[Depends(rate_limit("60/minute"))],',
    ),
    (
        "get_allowed_email: admin check removed",
        '    description="Fetch a single allowed email record. Admin only.",\n    dependencies=[Depends(rate_limit("60/minute")), Depends(get_current_admin)],',
        '    description="Fetch a single allowed email record. Admin only.",\n    dependencies=[Depends(rate_limit("60/minute"))],',
    ),
    (
        "add_allowed_email: admin check removed",
        '    description="Add an email to the allowlist. Admin only.",\n    dependencies=[Depends(rate_limit("60/minute")), Depends(get_current_admin)],',
        '    description="Add an email to the allowlist. Admin only.",\n    dependencies=[Depends(rate_limit("60/minute"))],',
    ),
    (
        "remove_allowed_email: admin check removed",
        '    description="Remove an email from the allowlist. Admin only.",\n    dependencies=[Depends(rate_limit("60/minute")), Depends(get_current_admin)],',
        '    description="Remove an email from the allowlist. Admin only.",\n    dependencies=[Depends(rate_limit("60/minute"))],',
    ),
    (
        "list_users: admin check removed",
        '    description="List registered users with pagination. Admin only.",\n    dependencies=[Depends(rate_limit("60/minute")), Depends(get_current_admin)],',
        '    description="List registered users with pagination. Admin only.",\n    dependencies=[Depends(rate_limit("60/minute"))],',
    ),
    (
        "get_user_by_email: admin check removed",
        '    description="Look up a registered user by email address. Admin only.",\n    dependencies=[Depends(rate_limit("60/minute")), Depends(get_current_admin)],',
        '    description="Look up a registered user by email address. Admin only.",\n    dependencies=[Depends(rate_limit("60/minute"))],',
    ),
    (
        "lock_user: admin check removed",
        "    admin: CurrentAdmin,\n",
        "    admin: Db,  # any token holder\n",
    ),
    (
        "unlock_user: admin check removed",
        '    description="Unlock a previously locked user account. Admin only.",\n    dependencies=[Depends(rate_limit("60/minute")), Depends(get_current_admin)],',
        '    description="Unlock a previously locked user account. Admin only.",\n    dependencies=[Depends(rate_limit("60/minute"))],',
    ),
    (
        "rate limit 60 → 600/min (list_users)",
        '    description="List registered users with pagination. Admin only.",\n    dependencies=[Depends(rate_limit("60/minute")),',
        '    description="List registered users with pagination. Admin only.",\n    dependencies=[Depends(rate_limit("600/minute")),',
    ),
    (
        "body email not stripped",
        "            info = _validate_email(v.strip(), check_deliverability=False)",
        "            info = _validate_email(v, check_deliverability=False)",
    ),
    (
        "body email not lower-cased",
        "            return info.normalized.lower()",
        "            return info.normalized",
    ),
    (
        "invalid body email accepted",
        "            raise ValueError(str(exc)) from exc",
        "            return v",
    ),
    (
        "allowlist: skip ignored",
        '                "items": [{"$skip": skip}, {"$limit": limit}],',
        '                "items": [{"$skip": 0}, {"$limit": limit}],',
    ),
    (
        "allowlist: limit ignored",
        '                "items": [{"$skip": skip}, {"$limit": limit}],',
        '                "items": [{"$skip": skip}, {"$limit": 100}],',
    ),
    (
        "allowlist: total = page size",
        '    result = await db[models.ALLOWED_EMAILS].aggregate(pipeline).to_list(1)\n    facet = result[0] if result else {"items": [], "total": []}\n    total = facet["total"][0]["n"] if facet["total"] else 0',
        '    result = await db[models.ALLOWED_EMAILS].aggregate(pipeline).to_list(1)\n    facet = result[0] if result else {"items": [], "total": []}\n    total = len(facet["items"])',
    ),
    (
        "allowlist: empty result crashes",
        '    result = await db[models.ALLOWED_EMAILS].aggregate(pipeline).to_list(1)\n    facet = result[0] if result else {"items": [], "total": []}',
        "    result = await db[models.ALLOWED_EMAILS].aggregate(pipeline).to_list(1)\n    facet = result[0]",
    ),
    (
        "allowlist: added_at dropped",
        'AllowedEmailResponse(email=d["_id"], added_at=d.get("added_at"))',
        'AllowedEmailResponse(email=d["_id"], added_at=None)',
    ),
    (
        "limit max 100 → 1000",
        '    limit: int = Query(20, ge=1, le=100),\n):\n    pipeline = [\n        {\n            "$facet": {\n                "items": [{"$skip"',
        '    limit: int = Query(20, ge=1, le=1000),\n):\n    pipeline = [\n        {\n            "$facet": {\n                "items": [{"$skip"',
    ),
    (
        "limit min 1 → 0",
        '    limit: int = Query(20, ge=1, le=100),\n):\n    pipeline = [\n        {\n            "$facet": {\n                "items": [{"$skip"',
        '    limit: int = Query(20, ge=0, le=100),\n):\n    pipeline = [\n        {\n            "$facet": {\n                "items": [{"$skip"',
    ),
    (
        "skip may be negative",
        '    skip: int = Query(0, ge=0),\n    limit: int = Query(20, ge=1, le=100),\n):\n    pipeline = [\n        {\n            "$facet": {\n                "items": [{"$skip"',
        '    skip: int = Query(0),\n    limit: int = Query(20, ge=1, le=100),\n):\n    pipeline = [\n        {\n            "$facet": {\n                "items": [{"$skip"',
    ),
    (
        "users: default limit 20 → 50",
        '    limit: int = Query(20, ge=1, le=100),\n):\n    pipeline = [\n        {\n            "$facet": {\n                "items": [\n',
        '    limit: int = Query(50, ge=1, le=100),\n):\n    pipeline = [\n        {\n            "$facet": {\n                "items": [\n',
    ),
    (
        "get: not-found check inverted",
        '    doc = await db[models.ALLOWED_EMAILS].find_one({"_id": normalized})\n    if not doc:',
        '    doc = await db[models.ALLOWED_EMAILS].find_one({"_id": normalized})\n    if doc:',
    ),
    (
        "get: raw (un-normalized) lookup",
        '    doc = await db[models.ALLOWED_EMAILS].find_one({"_id": normalized})',
        '    doc = await db[models.ALLOWED_EMAILS].find_one({"_id": email})',
    ),
    (
        "add: duplicate not turned into 409",
        '        raise HTTPException(status_code=409, detail="Email already in allowlist") from None',
        "        raise",
    ),
    ("add: 201 → 200", "    status_code=201,", "    status_code=200,"),
    ("add: added_at not stored", '{"_id": body.email, "added_at": now}', '{"_id": body.email}'),
    (
        "add: raw email logged",
        "hashlib.sha256(body.email.encode()).hexdigest()[:16],",
        "body.email,",
    ),
    (
        "remove: not-found check inverted",
        "    if result.deleted_count == 0:",
        "    if result.deleted_count != 0:",
    ),
    (
        "remove: raw (un-normalized) delete",
        '    result = await db[models.ALLOWED_EMAILS].delete_one({"_id": normalized})',
        '    result = await db[models.ALLOWED_EMAILS].delete_one({"_id": email})',
    ),
    ("remove: 204 → 200", "    status_code=204,", "    status_code=200,"),
    (
        "remove: raw email logged",
        "hashlib.sha256(normalized.encode()).hexdigest()[:16],",
        "normalized,",
    ),
    ("users: oldest first", '{"$sort": {"created_at": -1}}', '{"$sort": {"created_at": 1}}'),
    (
        "users: password_hash projected",
        '                            "is_locked": 1,\n',
        '                            "is_locked": 1,\n                            "password_hash": 1,\n',
    ),
    ("users: is_locked not projected", '                            "is_locked": 1,\n', ""),
    (
        "users: locked always False",
        '                locked=bool(d.get("is_locked")),',
        "                locked=False,",
    ),
    (
        "users: location ← email",
        '                location=d.get("location"),\n                created_at=d.get("created_at"),\n                locked=bool(d.get("is_locked")),\n            )\n            for d',
        '                location=d.get("email"),\n                created_at=d.get("created_at"),\n                locked=bool(d.get("is_locked")),\n            )\n            for d',
    ),
    (
        "users: skip ignored",
        '                    {"$skip": skip},',
        '                    {"$skip": 0},',
    ),
    (
        "users: total = page size",
        '    result = await db[models.USERS].aggregate(pipeline).to_list(1)\n    facet = result[0] if result else {"items": [], "total": []}\n    total = facet["total"][0]["n"] if facet["total"] else 0',
        '    result = await db[models.USERS].aggregate(pipeline).to_list(1)\n    facet = result[0] if result else {"items": [], "total": []}\n    total = len(facet["items"])',
    ),
    (
        "by-email: raw (un-normalized) lookup",
        '    email_doc = await db[models.EMAIL_INDEX].find_one({"_id": normalized})',
        '    email_doc = await db[models.EMAIL_INDEX].find_one({"_id": email})',
    ),
    (
        "by-email: missing index entry not 404",
        '    if not email_doc:\n        raise HTTPException(status_code=404, detail="User not found")\n',
        "",
    ),
    (
        "by-email: lookup ignores location",
        '{"_id": email_doc["user_id"], "location": email_doc["location"]}',
        '{"_id": email_doc["user_id"]}',
    ),
    (
        "by-email: orphan not 404",
        '    if not user:\n        raise HTTPException(status_code=404, detail="User not found")\n    return AdminUserSummary(',
        "    return AdminUserSummary(",
    ),
    (
        "by-email: password_hash in projection",
        '{"_id": 1, "email": 1, "full_name": 1, "location": 1, "created_at": 1, "is_locked": 1},',
        '{"_id": 1, "email": 1, "full_name": 1, "location": 1, "created_at": 1, "is_locked": 1, "password_hash": 1},',
    ),
    (
        "by-email: locked always False",
        '        locked=bool(user.get("is_locked")),',
        "        locked=False,",
    ),
    ("lock: self-lock allowed", '    if user_id == str(admin["_id"]):', "    if False:"),
    (
        "lock: is_locked set False",
        '{"$set": {"is_locked": True, "tokens_revoked_at": now, "updated_at": now}}',
        '{"$set": {"is_locked": False, "tokens_revoked_at": now, "updated_at": now}}',
    ),
    (
        "lock: tokens not revoked",
        '{"$set": {"is_locked": True, "tokens_revoked_at": now, "updated_at": now}}',
        '{"$set": {"is_locked": True, "updated_at": now}}',
    ),
    (
        "lock: updated_at not set",
        '{"$set": {"is_locked": True, "tokens_revoked_at": now, "updated_at": now}}',
        '{"$set": {"is_locked": True, "tokens_revoked_at": now}}',
    ),
    (
        "lock: filter ignores location",
        '    result = await db[models.USERS].update_one(\n        {"_id": user_id, "location": location},\n        {"$set": {"is_locked": True',
        '    result = await db[models.USERS].update_one(\n        {"_id": user_id},\n        {"$set": {"is_locked": True',
    ),
    (
        "lock: not-found check removed",
        '        {"$set": {"is_locked": True, "tokens_revoked_at": now, "updated_at": now}},\n    )\n    if result.matched_count == 0:',
        '        {"$set": {"is_locked": True, "tokens_revoked_at": now, "updated_at": now}},\n    )\n    if False:',
    ),
    (
        "lock: log not sanitized",
        '    safe_location = location.replace("\\r", "").replace("\\n", "")',
        "    safe_location = location",
    ),
    (
        "lock: response says unlocked",
        "    return LockUserResponse(id=user_id, locked=True)",
        "    return LockUserResponse(id=user_id, locked=False)",
    ),
    (
        "unlock: is_locked left True",
        '{"$set": {"is_locked": False, "tokens_revoked_at": None, "updated_at": now}}',
        '{"$set": {"is_locked": True, "tokens_revoked_at": None, "updated_at": now}}',
    ),
    (
        "unlock: revocation not cleared",
        '{"$set": {"is_locked": False, "tokens_revoked_at": None, "updated_at": now}}',
        '{"$set": {"is_locked": False, "updated_at": now}}',
    ),
    (
        "unlock: filter ignores location",
        '    result = await db[models.USERS].update_one(\n        {"_id": user_id, "location": location},\n        {"$set": {"is_locked": False',
        '    result = await db[models.USERS].update_one(\n        {"_id": user_id},\n        {"$set": {"is_locked": False',
    ),
    (
        "unlock: not-found check removed",
        '        {"$set": {"is_locked": False, "tokens_revoked_at": None, "updated_at": now}},\n    )\n    if result.matched_count == 0:',
        '        {"$set": {"is_locked": False, "tokens_revoked_at": None, "updated_at": now}},\n    )\n    if False:',
    ),
    (
        "unlock: log not sanitized",
        "    safe_location = _sanitize_for_log(location)",
        "    safe_location = location",
    ),
    (
        "unlock: response says locked",
        "    return LockUserResponse(id=user_id, locked=False)",
        "    return LockUserResponse(id=user_id, locked=True)",
    ),
]
