"""Hand-built mutants for app/routers/users.py: preferences, completed growth areas, observations, the 90-day plan and its photo presign."""

# ruff: noqa: E501

TARGET = "app/routers/users.py"
TESTS = ["tests/test_users.py"]

MUTANTS: list[tuple[str, str, str]] = [
    # preferences
    (
        "prefs: tts_enabled ignored",
        '    if "tts_enabled" in body.model_fields_set:\n        set_fields["preferences.tts_enabled"] = body.tts_enabled\n',
        "",
    ),
    (
        "prefs: dark_mode ignored",
        '    if "dark_mode" in body.model_fields_set:\n        set_fields["preferences.dark_mode"] = body.dark_mode\n',
        "",
    ),
    (
        "prefs: last_visited_path ignored",
        '    if "last_visited_path" in body.model_fields_set:\n        set_fields["preferences.last_visited_path"] = body.last_visited_path\n',
        "",
    ),
    ("prefs: unsent field written", '    if "dark_mode" in body.model_fields_set:', "    if True:"),
    (
        "prefs: wrong user updated",
        '        {"_id": user["_id"], "location": user["location"]},\n        {"$set": set_fields},',
        '        {"location": user["location"], "role": "parent"},\n        {"$set": set_fields},',
    ),
    (
        "prefs: response ignores the update",
        "    return _doc_to_preferences(updated or user)",
        "    return _doc_to_preferences(user)",
    ),
    (
        "prefs: read rate limit 60 -> 600",
        '    description="Retrieve the authenticated user\'s app preferences.",\n    dependencies=[Depends(rate_limit("60/minute"))],',
        '    description="Retrieve the authenticated user\'s app preferences.",\n    dependencies=[Depends(rate_limit("600/minute"))],',
    ),
    (
        "prefs: write rate limit 30 -> 300",
        'dependencies=[Depends(rate_limit("30/minute"))],',
        'dependencies=[Depends(rate_limit("300/minute"))],',
    ),
    # completed growth areas: list
    (
        "areas list: other parents' areas",
        '.find({"user_id": user["_id"], "child_id": child_id, "location": user["location"]})',
        '.find({"child_id": child_id, "location": user["location"]})',
    ),
    ("areas list: newest first", '.sort("created_at", 1)', '.sort("created_at", -1)'),
    ("areas list: offset ignored", ".skip(offset)", ".skip(0)"),
    ("areas list: limit ignored", ".to_list(limit)", ".to_list(200)"),
    (
        "areas list: limit max 200 -> 1000",
        "limit: int = Query(default=50, ge=1, le=200),",
        "limit: int = Query(default=50, ge=1, le=1000),",
    ),
    # completed growth areas: save
    (
        "areas save: Discover not required",
        '    if not child.get("discover_completed"):',
        "    if False:",
    ),
    (
        "areas save: unsent optional fields nulled",
        "        if field in body.model_fields_set:",
        "        if True:",
    ),
    (
        "areas save: child_activity dropped",
        '        set_fields["child_activity"] = body.child_activity.model_dump()\n',
        "        pass\n",
    ),
    (
        "areas save: created_at not stamped",
        '    set_on_insert: dict = {"_id": str(uuid.uuid4()), "created_at": now}',
        '    set_on_insert: dict = {"_id": str(uuid.uuid4())}',
    ),
    (
        "areas save: completion keeps wizard state",
        '    if body.status == "completed":',
        "    if False:",
    ),
    (
        "areas save: path in both $set and $unset",
        "            set_fields.pop(transient, None)\n",
        "            pass\n",
    ),
    (
        "areas save: not upserted",
        "        update_doc,\n        upsert=True,",
        "        update_doc,\n        upsert=False,",
    ),
    (
        "areas save: one document per child, not per area",
        '            "area_id": body.area_id,\n',
        "",
    ),
    (
        "areas save: 204 -> 200",
        '    status_code=204,\n    description="Upsert a growth area',
        '    status_code=200,\n    description="Upsert a growth area',
    ),
    # completed growth areas: clear
    (
        "areas clear: ownership not checked",
        "    await _require_child(db, child_id, user)\n    await db[models.GROWTH_AREAS].delete_many(",
        "    await db[models.GROWTH_AREAS].delete_many(",
    ),
    (
        "areas clear: siblings' areas deleted too",
        'delete_many(\n        {"user_id": user["_id"], "child_id": child_id, "location": user["location"]}',
        'delete_many(\n        {"user_id": user["_id"], "location": user["location"]}',
    ),
    (
        "areas clear: rate limit 10 -> 100",
        'dependencies=[Depends(rate_limit("10/minute"))],',
        'dependencies=[Depends(rate_limit("100/minute"))],',
    ),
    # observations
    (
        "obs read: other parents' document",
        '    doc = await db[models.OBSERVATIONS].find_one(\n        {"_id": child_id, "user_id": user["_id"], "location": user["location"]}\n    )',
        '    doc = await db[models.OBSERVATIONS].find_one(\n        {"_id": child_id}\n    )',
    ),
    (
        "obs read: non-string watching kept",
        "        watching=[w for w in raw_watching if isinstance(w, str)],",
        "        watching=raw_watching,",
    ),
    (
        "obs read: non-list watching not coerced",
        "    if not isinstance(raw_watching, list):\n        raw_watching = []\n",
        "",
    ),
    (
        "obs read: staged set dropped",
        '        pending_observations=doc.get("pending_observations"),\n',
        "",
    ),
    (
        "obs write: Transform not required",
        '    if not child.get("transform_visited"):\n        raise HTTPException(\n            status_code=403, detail="Visit Transform (Life Pathway) before recording Observations."',
        '    if False:\n        raise HTTPException(\n            status_code=403, detail="Visit Transform (Life Pathway) before recording Observations."',
    ),
    (
        "obs write: explicit nulls written",
        '    for key in ("source", "items", "watching", "span", "started_at"):\n        if key in updates and updates[key] is not None:',
        '    for key in ("source", "items", "watching", "span", "started_at"):\n        if key in updates:',
    ),
    (
        "obs write: staged set kept after promotion",
        '    if "items" in set_fields:\n        unset_fields["pending_observations"] = ""\n',
        "",
    ),
    (
        "obs write: not upserted",
        'doc = await db[models.OBSERVATIONS].find_one_and_update(\n        {"_id": child_id, "user_id": user["_id"], "location": user["location"]},\n        update_op,\n        upsert=True,',
        'doc = await db[models.OBSERVATIONS].find_one_and_update(\n        {"_id": child_id, "user_id": user["_id"], "location": user["location"]},\n        update_op,\n        upsert=False,',
    ),
    (
        "obs write: response drops items",
        '        items=doc.get("items", []) if doc else [],',
        "        items=[],",
    ),
    (
        "obs write: rate limit 20 -> 200",
        '    dependencies=[Depends(rate_limit("20/minute"))],\n)\nasync def patch_observations(',
        '    dependencies=[Depends(rate_limit("200/minute"))],\n)\nasync def patch_observations(',
    ),
    # 90-day plan
    (
        "plan read: other parents' document",
        '    doc = await db[models.NINETY_DAY_PLANS].find_one(\n        {"_id": child_id, "user_id": user["_id"], "location": user["location"]}\n    )',
        '    doc = await db[models.NINETY_DAY_PLANS].find_one(\n        {"_id": child_id}\n    )',
    ),
    (
        "plan write: Transform not required",
        '    if not child.get("transform_visited"):\n        raise HTTPException(\n            status_code=403,\n            detail="Visit Transform (Life Pathway) before starting the 90-day plan.",\n        )\n    now = datetime.now(UTC)',
        '    if False:\n        raise HTTPException(\n            status_code=403,\n            detail="Visit Transform (Life Pathway) before starting the 90-day plan.",\n        )\n    now = datetime.now(UTC)',
    ),
    (
        "plan write: explicit nulls written",
        "    for key in _NINETY_DAY_PLAN_PATCH_FIELDS:\n        if key in updates and updates[key] is not None:",
        "    for key in _NINETY_DAY_PLAN_PATCH_FIELDS:\n        if key in updates:",
    ),
    (
        "plan write: old tracker kept on retarget",
        '    if body.clear_track_steps:\n        unset_fields["track_steps"] = ""\n',
        "",
    ),
    (
        "plan write: not upserted",
        'doc = await db[models.NINETY_DAY_PLANS].find_one_and_update(\n        {"_id": child_id, "user_id": user["_id"], "location": user["location"]},\n        update_op,\n        upsert=True,',
        'doc = await db[models.NINETY_DAY_PLANS].find_one_and_update(\n        {"_id": child_id, "user_id": user["_id"], "location": user["location"]},\n        update_op,\n        upsert=False,',
    ),
    # 90-day plan photo presign
    (
        "photo: configuration not checked",
        "    if not settings.uploads_bucket_name or not settings.aws_region:",
        "    if False:",
    ),
    (
        "photo: any content type",
        "    if payload.content_type not in ALLOWED_IMAGE_CONTENT_TYPES:",
        "    if False:",
    ),
    (
        "photo: Transform not required",
        '    child = await _require_child(db, child_id, user)\n    if not child.get("transform_visited"):',
        "    child = await _require_child(db, child_id, user)\n    if False:",
    ),
    (
        "photo: key not namespaced by field",
        'user["location"], child_id, "ninety-day-plan", payload.field_key, ext=ext',
        'user["location"], child_id, "ninety-day-plan", ext=ext',
    ),
    ("photo: URL valid 1 hour", "            ExpiresIn=300,", "            ExpiresIn=3600,"),
    (
        "photo: content type not signed",
        'Params={"Bucket": bucket, "Key": key, "ContentType": payload.content_type},',
        'Params={"Bucket": bucket, "Key": key},',
    ),
    (
        "photo: S3 error becomes a 500",
        "    except (botocore.exceptions.BotoCoreError, botocore.exceptions.ClientError) as exc:",
        "    except ZeroDivisionError as exc:",
    ),
    (
        "photo: viewable URL replaced by the bare key",
        "photo_url = upload_url_for(key, settings, get_s3_client)",
        "photo_url = key",
    ),
    (
        "photo: rate limit 20 -> 200",
        '    dependencies=[Depends(rate_limit("20/minute"))],\n)\nasync def presign_ninety_day_plan_photo(',
        '    dependencies=[Depends(rate_limit("200/minute"))],\n)\nasync def presign_ninety_day_plan_photo(',
    ),
]
