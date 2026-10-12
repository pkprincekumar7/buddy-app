"""Hand-built mutants for app/routers/auth.py: register, login, refresh, logout, Google sign-in, /auth/me and account deletion, plus the request models' validators."""

# ruff: noqa: E501

TARGET = "app/routers/auth.py"
TESTS = ["tests/test_auth.py"]

MUTANTS: list[tuple[str, str, str]] = [
    (
        "unknown country accepted",
        "    if v not in COUNTRY_TO_REGION and v not in BLOCKED_COUNTRIES:",
        "    if False:",
    ),
    (
        "blocked country rejected at validation",
        "    if v not in COUNTRY_TO_REGION and v not in BLOCKED_COUNTRIES:",
        "    if v not in COUNTRY_TO_REGION:",
    ),
    (
        "blocked country not 403",
        "    if country_code in BLOCKED_COUNTRIES:\n        raise",
        "    if False:\n        raise",
    ),
    (
        "blocked 403 → 400",
        '        raise HTTPException(\n            status_code=403,\n            detail={\n                "code": "country_not_supported"',
        '        raise HTTPException(\n            status_code=400,\n            detail={\n                "code": "country_not_supported"',
    ),
    (
        "reject helper doesn't clear cookies",
        "    clear_auth_cookies(res)\n    return res",
        "    return res",
    ),
    (
        "reject helper status ignored",
        "JSONResponse(status_code=status_code, content",
        "JSONResponse(status_code=400, content",
    ),
    (
        "register email not stripped",
        "            info = _validate_email(v.strip(), check_deliverability=False)\n            return info.normalized\n        except EmailNotValidError as exc:",
        "            info = _validate_email(v, check_deliverability=False)\n            return info.normalized\n        except EmailNotValidError as exc:",
    ),
    (
        "register invalid email accepted",
        "            raise ValueError(str(exc)) from exc",
        "            return v",
    ),
    ("password repeated-char rule off", "        if len(set(v)) == 1:", "        if False:"),
    ("password digit rule off", "        if not any(c.isdigit() for c in v):", "        if False:"),
    (
        "password letter rule off",
        "        if not any(c.isalpha() for c in v):",
        "        if False:",
    ),
    (
        "password min 8 → 6",
        "password: str = Field(min_length=8, max_length=128)",
        "password: str = Field(min_length=6, max_length=128)",
    ),
    (
        "register country not upper-cased",
        '    @field_validator("country_code", mode="before")\n    @classmethod\n    def normalise_country_code(cls, v: object) -> object:\n        return v.strip().upper() if isinstance(v, str) else v\n\n    @field_validator("country_code")\n    @classmethod\n    def check_country_code(cls, v: str) -> str:',
        '    @field_validator("country_code", mode="before")\n    @classmethod\n    def normalise_country_code(cls, v: object) -> object:\n        return v\n\n    @field_validator("country_code")\n    @classmethod\n    def check_country_code(cls, v: str) -> str:',
    ),
    (
        "login invalid email not lowered",
        "            return v.strip().lower()\n\n\nclass GoogleAuthBody",
        "            return v.strip()\n\n\nclass GoogleAuthBody",
    ),
    (
        "login valid email not normalised",
        "            info = _validate_email(v.strip(), check_deliverability=False)\n            return info.normalized\n        except EmailNotValidError:\n            return v.strip().lower()",
        "            return v.strip().lower()\n        except EmailNotValidError:\n            return v.strip().lower()",
    ),
    (
        "google country not upper-cased",
        '    @field_validator("country_code", mode="before")\n    @classmethod\n    def normalise_country_code(cls, v: object) -> object:\n        return v.strip().upper() if isinstance(v, str) else v\n\n    @field_validator("country_code")\n    @classmethod\n    def check_country_code(cls, v: str | None)',
        '    @field_validator("country_code", mode="before")\n    @classmethod\n    def normalise_country_code(cls, v: object) -> object:\n        return v\n\n    @field_validator("country_code")\n    @classmethod\n    def check_country_code(cls, v: str | None)',
    ),
    (
        "google country not validated",
        "        return _validate_country_code(v) if v is not None else v",
        "        return v",
    ),
    (
        "register: allowlist skipped",
        '    if not await db[models.ALLOWED_EMAILS].find_one({"_id": body.email.lower()}):\n        raise HTTPException(status_code=403, detail="Registration is not open.")\n\n    _reject_blocked_country(body.country_code)\n    location = resolve_region(body.country_code)\n    now = datetime.now(UTC)\n    new_user_id = str(uuid.uuid4())\n\n    # Step 1',
        "    _reject_blocked_country(body.country_code)\n    location = resolve_region(body.country_code)\n    now = datetime.now(UTC)\n    new_user_id = str(uuid.uuid4())\n\n    # Step 1",
    ),
    (
        "register: allowlist case-sensitive",
        '    if not await db[models.ALLOWED_EMAILS].find_one({"_id": body.email.lower()}):\n        raise HTTPException(status_code=403, detail="Registration is not open.")\n\n    _reject_blocked_country(body.country_code)\n    location = resolve_region(body.country_code)\n    now = datetime.now(UTC)\n    new_user_id = str(uuid.uuid4())\n\n    # Step 1',
        '    if not await db[models.ALLOWED_EMAILS].find_one({"_id": body.email}):\n        raise HTTPException(status_code=403, detail="Registration is not open.")\n\n    _reject_blocked_country(body.country_code)\n    location = resolve_region(body.country_code)\n    now = datetime.now(UTC)\n    new_user_id = str(uuid.uuid4())\n\n    # Step 1',
    ),
    (
        "register: blocked check skipped",
        "    _reject_blocked_country(body.country_code)\n    location = resolve_region(body.country_code)\n    now = datetime.now(UTC)\n    new_user_id = str(uuid.uuid4())\n\n    # Step 1",
        '    location = resolve_region(body.country_code) if body.country_code in COUNTRY_TO_REGION else "eu"\n    now = datetime.now(UTC)\n    new_user_id = str(uuid.uuid4())\n\n    # Step 1',
    ),
    ("register: 201 → 200", "    status_code=201,", "    status_code=200,"),
    (
        "register: index location wrong",
        '                "_id": body.email,\n                "user_id": new_user_id,\n                "location": location,',
        '                "_id": body.email,\n                "user_id": new_user_id,\n                "location": "eu",',
    ),
    (
        "register: no orphan check (always 409)",
        "        if existing_entry and not orphaned_user:\n            # Reclaim orphaned reservation",
        "        if False:\n            # Reclaim orphaned reservation",
    ),
    (
        "register: orphan lookup ignores loc",
        '                    "_id": existing_entry["user_id"],\n                    "location": existing_entry["location"],',
        '                    "_id": existing_entry["user_id"],',
    ),
    (
        "register: reclaim without TOCTOU guard",
        '                {"_id": body.email, "user_id": existing_entry["user_id"]},',
        '                {"_id": body.email},',
    ),
    (
        "register: reclaim keeps old location",
        '                {"$set": {"user_id": new_user_id, "location": location}},\n            )\n            if reclaim.modified_count == 0:\n                await',
        '                {"$set": {"user_id": new_user_id}},\n            )\n            if reclaim.modified_count == 0:\n                await',
    ),
    (
        "register: lost reclaim race ignored",
        "            if reclaim.modified_count == 0:\n                await async_verify_password(body.password, _DUMMY_HASH)\n                raise",
        "            if False:\n                await async_verify_password(body.password, _DUMMY_HASH)\n                raise",
    ),
    (
        "register: lost race no dummy hash",
        "            if reclaim.modified_count == 0:\n                await async_verify_password(body.password, _DUMMY_HASH)\n",
        "            if reclaim.modified_count == 0:\n",
    ),
    (
        "register: reclaim log leaks email",
        '                "register: reclaimed orphaned email_index entry for email_hash=%s",\n                hashlib.sha256(body.email.encode()).hexdigest()[:16],',
        '                "register: reclaimed orphaned email_index entry for email_hash=%s",\n                body.email,',
    ),
    (
        "register: duplicate no dummy hash",
        "            # Live user exists — constant-time dummy hash to prevent email enumeration.\n            await async_verify_password(body.password, _DUMMY_HASH)\n",
        "            # Live user exists — constant-time dummy hash to prevent email enumeration.\n",
    ),
    (
        "register: duplicate 409 → 400",
        '            await async_verify_password(body.password, _DUMMY_HASH)\n            raise HTTPException(status_code=409, detail="Email already registered") from None\n\n    # Step 2',
        '            await async_verify_password(body.password, _DUMMY_HASH)\n            raise HTTPException(status_code=400, detail="Email already registered") from None\n\n    # Step 2',
    ),
    (
        "register: password stored in plain",
        '        "password_hash": await async_hash_password(body.password),',
        '        "password_hash": body.password,',
    ),
    (
        "register: default name changed",
        '        "full_name": body.full_name or "Parent",',
        '        "full_name": body.full_name or "",',
    ),
    (
        "register: role admin",
        '        "full_name": body.full_name or "Parent",\n        "role": "parent",',
        '        "full_name": body.full_name or "Parent",\n        "role": "admin",',
    ),
    (
        "register: tts off",
        '        "country_code": body.country_code,\n        "location": location,\n        "preferences": {"tts_enabled": True, "last_visited_path": None},\n        "tokens_revoked_at": None,\n        "is_being_deleted": False,\n        "created_at": now,\n        "updated_at": now,\n    }\n    try:\n        await db[models.USERS].insert_one(user_doc)\n    except Exception:\n        # Compensating',
        '        "country_code": body.country_code,\n        "location": location,\n        "preferences": {"tts_enabled": False, "last_visited_path": None},\n        "tokens_revoked_at": None,\n        "is_being_deleted": False,\n        "created_at": now,\n        "updated_at": now,\n    }\n    try:\n        await db[models.USERS].insert_one(user_doc)\n    except Exception:\n        # Compensating',
    ),
    (
        "register: no compensating release",
        '        try:\n            await db[models.EMAIL_INDEX].delete_one({"_id": body.email})\n        except Exception:',
        "        try:\n            pass\n        except Exception:",
    ),
    (
        "register: release failure not caught",
        '        try:\n            await db[models.EMAIL_INDEX].delete_one({"_id": body.email})\n        except Exception:\n            log.exception(',
        '        await db[models.EMAIL_INDEX].delete_one({"_id": body.email})\n        if False:\n            log.exception(',
    ),
    (
        "register: insert failure 500 → 503",
        '            status_code=500, detail="Registration failed — please try again"',
        '            status_code=503, detail="Registration failed — please try again"',
    ),
    (
        "register: tokens for wrong location",
        '    log.info("user.register id=%s location=%s", new_user_id, location)\n    tokens = await set_auth_cookies(response, new_user_id, location, db)',
        '    log.info("user.register id=%s location=%s", new_user_id, location)\n    tokens = await set_auth_cookies(response, new_user_id, "eu", db)',
    ),
    (
        "register: limit 5 → 50",
        '@limiter.limit("5/minute")\nasync def register(',
        '@limiter.limit("50/minute")\nasync def register(',
    ),
    (
        "login: user lookup ignores location",
        '        user = await db[models.USERS].find_one(\n            {\n                "_id": email_doc["user_id"],\n                "location": email_doc["location"],',
        '        user = await db[models.USERS].find_one(\n            {\n                "_id": email_doc["user_id"],',
    ),
    (
        "login: being-deleted allowed",
        '    if user and user.get("is_being_deleted"):\n        await async_verify_password(body.password, _DUMMY_HASH)\n        raise',
        "    if False:\n        await async_verify_password(body.password, _DUMMY_HASH)\n        raise",
    ),
    (
        "login: being-deleted no dummy hash",
        '    if user and user.get("is_being_deleted"):\n        await async_verify_password(body.password, _DUMMY_HASH)\n',
        '    if user and user.get("is_being_deleted"):\n',
    ),
    (
        "login: locked allowed",
        '    if user and user.get("is_locked"):\n        await async_verify_password(body.password, _DUMMY_HASH)\n        raise',
        "    if False:\n        await async_verify_password(body.password, _DUMMY_HASH)\n        raise",
    ),
    (
        "login: locked no dummy hash",
        '    if user and user.get("is_locked"):\n        await async_verify_password(body.password, _DUMMY_HASH)\n',
        '    if user and user.get("is_locked"):\n',
    ),
    (
        "login: empty hash → dummy (truthiness)",
        "    target_hash = pw_hash if pw_hash is not None else _DUMMY_HASH",
        "    target_hash = pw_hash or _DUMMY_HASH",
    ),
    ("login: password not checked", "    if not user or not password_ok:", "    if not user:"),
    (
        "login: unknown user passes",
        "    if not user or not password_ok:",
        "    if not password_ok and user:",
    ),
    (
        "login: failure log leaks email",
        '            "auth.login.failed email_hash=%s", hashlib.sha256(body.email.encode()).hexdigest()[:16]',
        '            "auth.login.failed email_hash=%s", body.email',
    ),
    ("login: limit 10 → 100", '@limiter.limit("10/minute")', '@limiter.limit("100/minute")'),
    (
        "refresh: missing token passes",
        '    if not refresh_token_val:\n        raise HTTPException(status_code=401, detail="Missing refresh token")',
        '    if False:\n        raise HTTPException(status_code=401, detail="Missing refresh token")',
    ),
    (
        "refresh: accepts access tokens",
        '    refresh_payload = decode_token_of_type(refresh_token_val, "refresh")\n    if not refresh_payload:\n        log.warning',
        '    refresh_payload = decode_access_token_ignore_exp(refresh_token_val) or decode_token_of_type(refresh_token_val, "refresh")\n    if not refresh_payload:\n        log.warning',
    ),
    (
        "refresh: mismatch check skipped",
        '        if access_payload and access_payload.get("sub") != refresh_payload.get("sub"):\n            log.warning(',
        "        if False:\n            log.warning(",
    ),
    (
        "refresh: garbage access = mismatch",
        '        if access_payload and access_payload.get("sub") != refresh_payload.get("sub"):\n            log.warning(',
        '        if (access_payload or {}).get("sub") != refresh_payload.get("sub"):\n            log.warning(',
    ),
    (
        "refresh: jti not required",
        '    jti = refresh_payload.get("jti")\n    if not jti:',
        '    jti = refresh_payload.get("jti")\n    if False:',
    ),
    (
        "refresh: sub not required",
        '    uid = refresh_payload.get("sub")\n    if not uid:',
        '    uid = refresh_payload.get("sub")\n    if False:',
    ),
    (
        "refresh: session ignores user",
        'find_one({"_id": jti, "user_id": uid, "location": location})',
        'find_one({"_id": jti, "location": location})',
    ),
    ("refresh: missing session passes", "    if not session:\n", "    if not session and False:\n"),
    (
        "refresh: naive expiry not UTC",
        "    if expires_at.tzinfo is None:\n        expires_at = expires_at.replace(tzinfo=UTC)\n    if expires_at",
        "    if expires_at.tzinfo is None:\n        expires_at = expires_at.replace(tzinfo=UTC) - (datetime.now() - datetime.utcnow())\n    if expires_at",
    ),
    ("refresh: expiry check skipped", "    if expires_at < datetime.now(UTC):", "    if False:"),
    (
        "refresh: expired session kept",
        '    if expires_at < datetime.now(UTC):\n        await db[models.SESSIONS].delete_one({"_id": jti, "location": location})\n',
        "    if expires_at < datetime.now(UTC):\n",
    ),
    (
        "refresh: user lookup ignores location",
        '    refresh_user = await db[models.USERS].find_one({"_id": uid, "location": location})',
        '    refresh_user = await db[models.USERS].find_one({"_id": uid})',
    ),
    (
        "refresh: missing user passes",
        "    if not refresh_user:\n",
        "    if not refresh_user and False:\n",
    ),
    ("refresh: locked passes", '    if refresh_user.get("is_locked"):', "    if False:"),
    (
        "refresh: locked session kept",
        '    if refresh_user.get("is_locked"):\n        await db[models.SESSIONS].delete_one({"_id": jti, "location": location})\n',
        '    if refresh_user.get("is_locked"):\n',
    ),
    (
        "refresh: revocation ignored",
        '    if refresh_user.get("tokens_revoked_at") is not None:',
        "    if False:",
    ),
    (
        "refresh: missing iat passes",
        '        if iat is None:\n            await db[models.SESSIONS].delete_one({"_id": jti, "location": location})\n            return',
        "        if iat is None:\n            iat = 2**31\n        if False:\n            return",
    ),
    (
        "refresh: iat==revoked accepted",
        "        if token_issued_at <= revoked_at:",
        "        if token_issued_at < revoked_at:",
    ),
    (
        "refresh: naive revoked_at not UTC",
        "        if revoked_at.tzinfo is None:\n            revoked_at = revoked_at.replace(tzinfo=UTC)",
        "        if revoked_at.tzinfo is None:\n            revoked_at = revoked_at.astimezone(UTC)",
    ),
    (
        "refresh: revoked session kept",
        '        if token_issued_at <= revoked_at:\n            await db[models.SESSIONS].delete_one({"_id": jti, "location": location})\n',
        "        if token_issued_at <= revoked_at:\n",
    ),
    (
        "refresh: old session not deleted",
        '    tokens = await set_auth_cookies(response, uid, location, db)\n    await db[models.SESSIONS].delete_one({"_id": jti, "location": location})\n',
        "    tokens = await set_auth_cookies(response, uid, location, db)\n",
    ),
    (
        "refresh: delete before insert",
        '    tokens = await set_auth_cookies(response, uid, location, db)\n    await db[models.SESSIONS].delete_one({"_id": jti, "location": location})\n',
        '    await db[models.SESSIONS].delete_one({"_id": jti, "location": location})\n    tokens = await set_auth_cookies(response, uid, location, db)\n',
    ),
    (
        "refresh: limit 20 → 200",
        '@user_limiter.limit("20/minute")\nasync def refresh_tokens(',
        '@user_limiter.limit("200/minute")\nasync def refresh_tokens(',
    ),
    (
        "logout: mismatch check skipped",
        '                if access_payload and access_payload.get("sub") != refresh_payload.get("sub"):\n                    return',
        "                if False:\n                    return",
    ),
    (
        "logout: session not deleted",
        '                await db[models.SESSIONS].delete_one({"_id": jti, "location": location})\n    clear_auth_cookies(response)',
        "                pass\n    clear_auth_cookies(response)",
    ),
    (
        "logout: cookies not cleared",
        "    clear_auth_cookies(response)\n    return None",
        "    return None",
    ),
    (
        "logout: accepts access tokens",
        '        refresh_payload = decode_token_of_type(refresh_token_val, "refresh")\n        if refresh_payload and (jti',
        "        refresh_payload = decode_token(refresh_token_val)\n        if refresh_payload and (jti",
    ),
    (
        "logout: limit 20 → 200",
        '@user_limiter.limit("20/minute")\nasync def logout(',
        '@user_limiter.limit("200/minute")\nasync def logout(',
    ),
    (
        "google: id token not passed through",
        "    info = verify_google_token(body.id_token)",
        '    info = verify_google_token("x")',
    ),
    (
        "google: empty email accepted",
        "    if not raw_email:\n        raise",
        "    if False:\n        raise",
    ),
    (
        "google: unverified email accepted",
        '    if not info.get("email_verified"):',
        "    if False:",
    ),
    (
        "google: invalid email accepted",
        '        email = _validate_email(raw_email, check_deliverability=False).normalized\n    except EmailNotValidError:\n        raise HTTPException(status_code=400, detail="Google did not return a valid email") from None',
        "        email = _validate_email(raw_email, check_deliverability=False).normalized\n    except EmailNotValidError:\n        email = raw_email",
    ),
    (
        "google: email not normalised",
        "        email = _validate_email(raw_email, check_deliverability=False).normalized",
        "        _validate_email(raw_email, check_deliverability=False)\n        email = raw_email",
    ),
    (
        "google: existing lookup ignores loc",
        '        existing = await db[models.USERS].find_one(\n            {\n                "_id": email_doc["user_id"],\n                "location": email_doc["location"],',
        '        existing = await db[models.USERS].find_one(\n            {\n                "_id": email_doc["user_id"],',
    ),
    (
        "google: existing being-deleted allowed",
        '        if existing.get("is_being_deleted"):',
        "        if False:",
    ),
    (
        "google: existing locked allowed",
        '        if existing.get("is_locked"):',
        "        if False:",
    ),
    (
        "google: allowlist skipped",
        '        if not await db[models.ALLOWED_EMAILS].find_one({"_id": email.lower()}):\n            raise',
        "        if False:\n            raise",
    ),
    (
        "google: country not required",
        "        if not body.country_code:\n            raise",
        '        if not body.country_code:\n            body.country_code = "US"\n        if False:\n            raise',
    ),
    (
        "google: blocked check skipped",
        "        _reject_blocked_country(body.country_code)\n        location = resolve_region(body.country_code)\n        now",
        '        location = resolve_region(body.country_code) if body.country_code in COUNTRY_TO_REGION else "eu"\n        now',
    ),
    (
        "google: control chars kept",
        're.sub(r"[\\x00-\\x1f\\x7f]", "", (info.get("name") or "").strip())',
        '(info.get("name") or "").strip()',
    ),
    (
        "google: name not truncated",
        '        full_name = (raw_name or email.split("@")[0])[:255]',
        '        full_name = raw_name or email.split("@")[0]',
    ),
    (
        "google: no name fallback",
        '        full_name = (raw_name or email.split("@")[0])[:255]',
        "        full_name = raw_name[:255]",
    ),
    (
        "google: fixed password",
        "await async_hash_password(secrets.token_urlsafe(32))",
        'await async_hash_password("google")',
    ),
    (
        "google: short random password",
        "await async_hash_password(secrets.token_urlsafe(32))",
        "await async_hash_password(secrets.token_urlsafe(8))",
    ),
    (
        "google: role admin",
        '            "full_name": full_name,\n            "role": "parent",',
        '            "full_name": full_name,\n            "role": "admin",',
    ),
    (
        "google: race winner treated as orphan",
        "            if not race_user:\n                if race_doc:",
        "            if True:\n                if race_doc:",
    ),
    (
        "google: race lookup ignores loc",
        '                        "_id": race_doc["user_id"],\n                        "location": race_doc["location"],',
        '                        "_id": race_doc["user_id"],',
    ),
    (
        "google: race reclaim no TOCTOU guard",
        '                        {"_id": email, "user_id": race_doc["user_id"]},',
        '                        {"_id": email},',
    ),
    (
        "google: race reclaim keeps location",
        '                        {"$set": {"user_id": new_user_id, "location": location}},\n                    )\n                    if reclaim.modified_count == 0:\n                        # Slot',
        '                        {"$set": {"user_id": new_user_id}},\n                    )\n                    if reclaim.modified_count == 0:\n                        # Slot',
    ),
    (
        "google: lost reclaim race ignored",
        "                    if reclaim.modified_count == 0:\n                        # Slot",
        "                    if False:\n                        # Slot",
    ),
    (
        "google: reclaim log leaks email",
        '                        "google_auth: reclaimed orphaned email_index entry for email_hash=%s",\n                        hashlib.sha256(email.encode()).hexdigest()[:16],',
        '                        "google_auth: reclaimed orphaned email_index entry for email_hash=%s",\n                        email,',
    ),
    (
        "google: vanished reservation proceeds",
        '                else:\n                    # email_index entry exists but user doc not yet committed —\n                    # extremely narrow window; ask the client to retry.\n                    raise HTTPException(  # noqa: B904\n                        status_code=500, detail="Sign-in failed — please try again"\n                    ) from None',
        "                else:\n                    pass",
    ),
    (
        "google: race being-deleted allowed",
        '                if race_user.get("is_being_deleted"):',
        "                if False:",
    ),
    (
        "google: race locked allowed",
        '                if race_user.get("is_locked"):',
        "                if False:",
    ),
    (
        "google: race winner tokens wrong loc",
        '                    race_user["_id"],\n                    race_user["location"],',
        '                    race_user["_id"],\n                    "eu",',
    ),
    (
        "google: no rollback on insert failure",
        '        except Exception:\n            await db[models.EMAIL_INDEX].delete_one({"_id": email})\n',
        "        except Exception:\n",
    ),
    (
        "google: rollback log leaks email",
        '                "google_auth: users insert failed; rolled back email_index for email_hash=%s",\n                hashlib.sha256(email.encode()).hexdigest()[:16],',
        '                "google_auth: users insert failed; rolled back email_index for email_hash=%s",\n                email,',
    ),
    (
        "google: new user tokens wrong loc",
        "        tokens = await set_auth_cookies(response, new_user_id, location, db)",
        '        tokens = await set_auth_cookies(response, new_user_id, "eu", db)',
    ),
    (
        "google: limit 5 → 50",
        '@limiter.limit("5/minute")\nasync def google_auth(',
        '@limiter.limit("50/minute")\nasync def google_auth(',
    ),
    (
        "me: name None not defaulted",
        '        full_name=user.get("full_name") or "",',
        '        full_name=user.get("full_name") or "Parent",',
    ),
    (
        "me: role default admin",
        '        role=user.get("role", "parent"),',
        '        role=user.get("role", "admin"),',
    ),
    (
        "me: limit 60 → 600",
        '    dependencies=[Depends(rate_limit("60/minute"))],',
        '    dependencies=[Depends(rate_limit("600/minute"))],',
    ),
    (
        "delete: confirmation not checked",
        '    if normalized_confirm != user["email"]:',
        "    if False:",
    ),
    (
        "delete: confirm not normalised",
        "        normalized_confirm = _validate_email(\n            body.confirm_email.strip(), check_deliverability=False\n        ).normalized",
        "        _validate_email(body.confirm_email.strip(), check_deliverability=False)\n        normalized_confirm = body.confirm_email",
    ),
    (
        "delete: fallback not lowered",
        "        normalized_confirm = body.confirm_email.strip().lower()",
        "        normalized_confirm = body.confirm_email.strip()",
    ),
    (
        "delete: tokens not revoked first",
        '        {"$set": {"tokens_revoked_at": now, "is_being_deleted": True, "updated_at": now}},',
        '        {"$set": {"is_being_deleted": True, "updated_at": now}},',
    ),
    (
        "delete: not marked being-deleted",
        '        {"$set": {"tokens_revoked_at": now, "is_being_deleted": True, "updated_at": now}},',
        '        {"$set": {"tokens_revoked_at": now, "updated_at": now}},',
    ),
    (
        "delete: sessions kept",
        '    await db[models.SESSIONS].delete_many({"user_id": user_id, "location": location})\n',
        "",
    ),
    (
        "delete: children kept",
        '        db[models.CHILDREN].delete_many({"user_id": user_id, "location": location}),\n',
        "",
    ),
    (
        "delete: growth areas kept",
        '        db[models.GROWTH_AREAS].delete_many({"user_id": user_id, "location": location}),\n',
        "",
    ),
    (
        "delete: observations kept",
        '        db[models.OBSERVATIONS].delete_many({"user_id": user_id, "location": location}),\n',
        "",
    ),
    (
        "delete: plans kept",
        '        db[models.NINETY_DAY_PLANS].delete_many({"user_id": user_id, "location": location}),\n',
        "",
    ),
    (
        "delete: children of everyone",
        '        db[models.CHILDREN].delete_many({"user_id": user_id, "location": location}),',
        '        db[models.CHILDREN].delete_many({"location": location}),',
    ),
    (
        "delete: user doc kept",
        '    await db[models.USERS].delete_one({"_id": user_id, "location": location})\n',
        "",
    ),
    (
        "delete: email slot kept",
        '        await db[models.EMAIL_INDEX].delete_one({"_id": user["email"]})',
        "        pass",
    ),
    (
        "delete: slot failure not caught",
        '    try:\n        await db[models.EMAIL_INDEX].delete_one({"_id": user["email"]})\n    except Exception:\n        log.exception(',
        '    await db[models.EMAIL_INDEX].delete_one({"_id": user["email"]})\n    if False:\n        log.exception(',
    ),
    (
        "delete: cookies not cleared",
        "            user_id,\n        )\n\n    clear_auth_cookies(response)",
        "            user_id,\n        )",
    ),
    (
        "delete: limit 3 → 30",
        '    dependencies=[Depends(rate_limit("3/minute"))],',
        '    dependencies=[Depends(rate_limit("30/minute"))],',
    ),
]
