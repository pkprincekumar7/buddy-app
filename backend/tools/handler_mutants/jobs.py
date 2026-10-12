"""Hand-built mutants for app/routers/jobs.py: POST /jobs (enqueue) and GET /jobs/{job_id}."""

# ruff: noqa: E501

TARGET = "app/routers/jobs.py"
TESTS = ["tests/test_jobs.py"]

MUTANTS: list[tuple[str, str, str]] = [
    (
        "enqueue: another parent's child accepted",
        '            "_id": body.child_id,\n            "user_id": user_id,\n            "location": user["location"],\n            "is_deleted": False,',
        '            "_id": body.child_id,\n            "location": user["location"],\n            "is_deleted": False,',
    ),
    (
        "enqueue: deleted child accepted",
        '            "_id": body.child_id,\n            "user_id": user_id,\n            "location": user["location"],\n            "is_deleted": False,',
        '            "_id": body.child_id,\n            "user_id": user_id,\n            "location": user["location"],',
    ),
    (
        "enqueue: Life Pathway not gated",
        'if body.type == "generate_life_pathway" and not await has_completed_growth_area(',
        "if False and not await has_completed_growth_area(",
    ),
    ("enqueue: journey gates not enforced", "        if not child.get(flag):", "        if False:"),
    (
        "enqueue: growth areas scoped by _id",
        '    if collection == "growth_areas":',
        "    if False:",
    ),
    (
        "enqueue: client user_id kept",
        '            "user_id": user_id,  # always scope writes to the authenticated user\n',
        "",
    ),
    (
        "enqueue: client location kept",
        '            "location": user["location"],  # overwrite any client-supplied location\n',
        "",
    ),
    (
        "enqueue: client filter overrides the child scope",
        '            **wb_dict["filter"],\n            **child_scope,',
        '            **child_scope,\n            **wb_dict["filter"],',
    ),
    (
        "enqueue: not immediately claimable",
        '        "retry_after": now,',
        '        "retry_after": None,',
    ),
    (
        "enqueue: stored as processing",
        '        "status": "pending",',
        '        "status": "processing",',
    ),
    (
        "enqueue: LLM retry budget 3 -> 1",
        '        "max_llm_attempts": 3,',
        '        "max_llm_attempts": 1,',
    ),
    (
        "enqueue: in-flight cap 2 -> 3",
        "            if existing >= _MAX_IN_FLIGHT_PER_TYPE:",
        "            if existing > _MAX_IN_FLIGHT_PER_TYPE:",
    ),
    (
        "enqueue: finished jobs count towards the cap",
        '"status": {"$in": ["pending", "processing", "result_ready"]},',
        '"status": {"$in": ["pending", "processing", "result_ready", "completed", "failed"]},',
    ),
    ("enqueue: cap shared across job types", '                    "type": body.type,\n', ""),
    (
        "enqueue: per-key lock bypassed",
        "async with _get_enqueue_lock((user_id, body.child_id, body.type)):",
        "async with asyncio.Lock():",
    ),
    (
        "enqueue: queue failure becomes a 500",
        '    except Exception as e:\n        log.error("job.enqueue_failed',
        '    except ZeroDivisionError as e:\n        log.error("job.enqueue_failed',
    ),
    (
        "enqueue: active_jobs failure is fatal",
        '    except Exception:\n        log.warning(\n            "job.active_jobs_update_failed',
        '    except ZeroDivisionError:\n        log.warning(\n            "job.active_jobs_update_failed',
    ),
    (
        "enqueue: active_jobs not recorded",
        '{"$set": {f"active_jobs.{body.type}": job_id, "updated_at": now}},',
        '{"$set": {"updated_at": now}},',
    ),
    (
        "enqueue: child id logged unsanitised",
        "    safe_child_id = _sanitize_for_log(body.child_id)\n",
        "    safe_child_id = body.child_id\n",
    ),
    ("enqueue: 201 -> 200", "    status_code=201,", "    status_code=200,"),
    (
        "enqueue: rate limit 30 -> 300",
        'dependencies=[Depends(rate_limit("30/minute"))],',
        'dependencies=[Depends(rate_limit("300/minute"))],',
    ),
    (
        "status: another user's job",
        '{"location": user["location"], "job_id": job_id, "user_id": user["_id"]}',
        '{"location": user["location"], "job_id": job_id}',
    ),
    ("status: error dropped", '        error=doc.get("error"),', "        error=None,"),
    (
        "status: rate limit 60 -> 600",
        'dependencies=[Depends(rate_limit("60/minute"))],',
        'dependencies=[Depends(rate_limit("600/minute"))],',
    ),
]
