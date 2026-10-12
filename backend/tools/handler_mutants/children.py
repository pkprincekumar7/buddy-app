"""Hand-built mutants for app/routers/children.py: list, create, get, patch, journey progress, delete and avatar presign."""

# ruff: noqa: E501

TARGET = "app/routers/children.py"
TESTS = ["tests/test_children.py"]

MUTANTS: list[tuple[str, str, str]] = [
    # list
    (
        "list: default sort oldest first",
        'sort_spec = [("created_at", DESCENDING if _sort.startswith("-") else ASCENDING)]',
        'sort_spec = [("created_at", ASCENDING if _sort.startswith("-") else DESCENDING)]',
    ),
    (
        "list: name sort reversed",
        'sort_spec = [("name", ASCENDING if _sort == "name" else DESCENDING)]',
        'sort_spec = [("name", DESCENDING if _sort == "name" else ASCENDING)]',
    ),
    (
        "list: soft-deleted children included",
        '{"user_id": user["_id"], "location": user["location"], "is_deleted": False},\n            _LIST_PROJECTION,',
        '{"user_id": user["_id"], "location": user["location"]},\n            _LIST_PROJECTION,',
    ),
    (
        "list: another parent's children",
        '{"user_id": user["_id"], "location": user["location"], "is_deleted": False},\n            _LIST_PROJECTION,',
        '{"location": user["location"], "is_deleted": False},\n            _LIST_PROJECTION,',
    ),
    (
        "list: full documents (no projection)",
        "            _LIST_PROJECTION,\n",
        "            None,\n",
    ),
    ("list: limit ignored", ".to_list(limit)", ".to_list(50)"),
    (
        "list: limit max 200 -> 1000",
        "limit: int = Query(default=50, ge=1, le=200),",
        "limit: int = Query(default=50, ge=1, le=1000),",
    ),
    (
        "list: rate limit 60 -> 600",
        'description="List all children linked to the authenticated user\'s account.",\n    dependencies=[Depends(rate_limit("60/minute"))],',
        'description="List all children linked to the authenticated user\'s account.",\n    dependencies=[Depends(rate_limit("600/minute"))],',
    ),
    # create
    ("create: cap 10 -> 11", "    if count >= 10:", "    if count > 10:"),
    (
        "create: cap counts deleted children",
        '    count = await db[models.CHILDREN].count_documents(\n        {"user_id": user["_id"], "location": user["location"], "is_deleted": False}\n    )',
        '    count = await db[models.CHILDREN].count_documents(\n        {"user_id": user["_id"], "location": user["location"]}\n    )',
    ),
    (
        "create: server-controlled fields accepted",
        "    for f in _CHILD_SYSTEM_FIELDS:\n        data.pop(f, None)\n",
        "",
    ),
    ("create: visited_tabs not initialised", '    data.setdefault("visited_tabs", [])\n', ""),
    (
        "create: stored as deleted",
        '        "is_deleted": False,\n        "deleted_at": None,',
        '        "is_deleted": True,\n        "deleted_at": None,',
    ),
    ("create: 201 -> 200", "    status_code=201,", "    status_code=200,"),
    (
        "create: rate limit 20 -> 200",
        '    description="Add a new child profile to the authenticated user\'s account (maximum 10).",\n    dependencies=[Depends(rate_limit("20/minute"))],',
        '    description="Add a new child profile to the authenticated user\'s account (maximum 10).",\n    dependencies=[Depends(rate_limit("200/minute"))],',
    ),
    # get
    (
        "get: ownership ignored",
        '        {"_id": child_id, "user_id": user["_id"], "location": user["location"], "is_deleted": False}\n    )\n    if not doc:\n        raise HTTPException(status_code=404, detail="Child not found")\n    return await _child_to_api_with_progress(doc, db, user)',
        '        {"_id": child_id}\n    )\n    if not doc:\n        raise HTTPException(status_code=404, detail="Child not found")\n    return await _child_to_api_with_progress(doc, db, user)',
    ),
    # patch
    (
        "patch: server-controlled fields writable",
        "        if k in _CHILD_SYSTEM_FIELDS:\n            continue\n",
        "",
    ),
    (
        "patch: null name written",
        '        if k == "name" and v is None:\n            continue  # name is required — ignore null patch\n',
        "",
    ),
    (
        "patch: visited_tabs replaced, not added to",
        'update_op["$addToSet"] = {"visited_tabs": {"$each": add_to_set_tabs}}',
        'update_op["$set"]["visited_tabs"] = add_to_set_tabs',
    ),
    (
        "patch: staged personality kept on commit",
        '    clear_pending_vm = "personality" in set_fields\n',
        "    clear_pending_vm = False\n",
    ),
    (
        "patch: staged field in both $set and $unset",
        '        set_fields.pop("pending_personality_vm", None)\n',
        "        pass\n",
    ),
    (
        "patch: conversational marked without profile step",
        '        if prev_profile and prev_profile.get("onboarding_profile_completed"):',
        "        if prev_profile:",
    ),
    (
        "patch: conversational never marked",
        '            set_fields["conversational_onboarding_completed"] = True\n',
        "            pass\n",
    ),
    (
        "patch: pathway invalidated on unchanged values",
        "prev.get(f) != set_fields[f] for f in touched_inputs",
        "f in set_fields for f in touched_inputs",
    ),
    (
        "patch: pathway never invalidated",
        "    touched_inputs = [f for f in _LIFE_PATHWAY_INPUTS if f in set_fields]",
        "    touched_inputs: list[str] = []",
    ),
    (
        "patch: invalidation hits sibling children",
        '                    "child_id": child_id,\n                    "location": user["location"],\n                },\n                {"$unset": {"life_pathway_milestones": ""}},',
        '                    "location": user["location"],\n                },\n                {"$unset": {"life_pathway_milestones": ""}},',
    ),
    (
        "patch: invalidation failure becomes a 500",
        '        except Exception:\n            log.exception("life pathway cache invalidation failed child_id=%s", child_id)',
        '        except ZeroDivisionError:\n            log.exception("life pathway cache invalidation failed child_id=%s", child_id)',
    ),
    (
        "patch: missing child not 404",
        '    if not doc:\n        raise HTTPException(status_code=404, detail="Child not found")\n\n    if invalidate_pathway:',
        "    if invalidate_pathway:",
    ),
    (
        "patch: soft-deleted child editable",
        '        "is_deleted": False,\n    }\n\n    # Auto-derive conversational',
        "    }\n\n    # Auto-derive conversational",
    ),
    (
        "patch: rate limit 30 -> 300",
        '    description="Update details of an existing child profile.",\n    dependencies=[Depends(rate_limit("30/minute"))],',
        '    description="Update details of an existing child profile.",\n    dependencies=[Depends(rate_limit("300/minute"))],',
    ),
    # journey progress
    (
        "progress: precondition skipped",
        "    if not await check(child, db, user, child_id):",
        "    if False:",
    ),
    (
        "progress: flag set False",
        '{"$set": {flag: True, "updated_at": datetime.now(UTC)}}',
        '{"$set": {flag: False, "updated_at": datetime.now(UTC)}}',
    ),
    (
        "progress: missing child not 404",
        '    child = await db[models.CHILDREN].find_one(owner_filter)\n    if not child:\n        raise HTTPException(status_code=404, detail="Child not found")',
        '    child = await db[models.CHILDREN].find_one(owner_filter) or {}\n    if False:\n        raise HTTPException(status_code=404, detail="Child not found")',
    ),
    (
        "progress: vanished child not 404",
        '        return_document=True,\n    )\n    if not doc:\n        raise HTTPException(status_code=404, detail="Child not found")\n    return await _child_to_api_with_progress(doc, db, user)\n\n\n@router.delete',
        '        return_document=True,\n    )\n    return await _child_to_api_with_progress(doc or {"_id": child_id, "created_at": None}, db, user)\n\n\n@router.delete',
    ),
    # delete
    (
        "delete: not marked deleted",
        '{"$set": {"is_deleted": True, "deleted_at": now, "updated_at": now}}',
        '{"$set": {"is_deleted": False, "deleted_at": now, "updated_at": now}}',
    ),
    (
        "delete: deleted_at not set",
        '{"$set": {"is_deleted": True, "deleted_at": now, "updated_at": now}}',
        '{"$set": {"is_deleted": True, "updated_at": now}}',
    ),
    (
        "delete: re-delete resets retention clock",
        '            "is_deleted": False,\n        },\n        {"$set": {"is_deleted": True',
        '        },\n        {"$set": {"is_deleted": True',
    ),
    ("delete: missing child not 404", "    if result.matched_count == 0:", "    if False:"),
    ("delete: 204 -> 200", "    status_code=204,", "    status_code=200,"),
    (
        "delete: rate limit 10 -> 100",
        'dependencies=[Depends(rate_limit("10/minute"))],',
        'dependencies=[Depends(rate_limit("100/minute"))],',
    ),
    # avatar presign
    (
        "presign: configuration not checked",
        "    if not settings.uploads_bucket_name or not settings.aws_region:",
        "    if False:",
    ),
    (
        "presign: any content type",
        "    if payload.content_type not in ALLOWED_IMAGE_CONTENT_TYPES:",
        "    if False:",
    ),
    (
        "presign: ownership ignored",
        '        {"_id": child_id, "user_id": user["_id"], "location": user["location"], "is_deleted": False}\n    )\n    if not doc:\n        raise HTTPException(status_code=404, detail="Child not found")\n\n    ext',
        '        {"_id": child_id}\n    )\n    if not doc:\n        raise HTTPException(status_code=404, detail="Child not found")\n\n    ext',
    ),
    (
        "presign: URL valid 1 hour",
        "                ExpiresIn=300,",
        "                ExpiresIn=3600,",
    ),
    (
        "presign: content type not signed",
        'Params={"Bucket": bucket, "Key": key, "ContentType": payload.content_type},',
        'Params={"Bucket": bucket, "Key": key},',
    ),
    (
        "presign: key ignores the user's location",
        'key = build_upload_key(user["location"], child_id, ext=ext)',
        'key = build_upload_key("us", child_id, ext=ext)',
    ),
    (
        "presign: S3 error becomes a 500",
        "    except (botocore.exceptions.BotoCoreError, botocore.exceptions.ClientError) as exc:",
        "    except ZeroDivisionError as exc:",
    ),
    (
        "presign: CDN domain ignored",
        "avatar_url = build_public_url(bucket, region, settings.uploads_cdn_domain, key)",
        'avatar_url = build_public_url(bucket, region, "", key)',
    ),
    (
        "presign: rate limit 20 -> 200",
        '    dependencies=[Depends(rate_limit("20/minute"))],\n)\nasync def presign_child_avatar(',
        '    dependencies=[Depends(rate_limit("200/minute"))],\n)\nasync def presign_child_avatar(',
    ),
]
