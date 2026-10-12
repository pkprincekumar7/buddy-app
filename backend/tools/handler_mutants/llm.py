"""Hand-built mutants for app/routers/llm.py: POST /llm/invoke and GET /llm/providers."""

# ruff: noqa: E501

TARGET = "app/routers/llm.py"
TESTS = ["tests/test_llm.py"]

MUTANTS: list[tuple[str, str, str]] = [
    (
        "invoke: hourly quota skipped",
        '    await asyncio.to_thread(_enforce_user_rate_limit, user["_id"])\n',
        "",
    ),
    (
        "invoke: one quota for all users",
        '_enforce_user_rate_limit, user["_id"])',
        '_enforce_user_rate_limit, "everyone")',
    ),
    (
        "invoke: schema not passed on",
        "            schema=body.response_json_schema,",
        "            schema=None,",
    ),
    (
        "invoke: provider choice not passed on",
        "            provider=body.provider,",
        "            provider=None,",
    ),
    (
        "invoke: config error 503 -> 502",
        "        raise HTTPException(status_code=503, detail=str(e)) from e",
        "        raise HTTPException(status_code=502, detail=str(e)) from e",
    ),
    (
        "invoke: bad JSON leaks raw output",
        'status_code=502, detail="LLM service returned an unexpected response."',
        "status_code=502, detail=str(e)",
    ),
    ("invoke: HTTPException swallowed into 502", "    except HTTPException:\n        raise\n", ""),
    (
        "invoke: outage leaks the error",
        'status_code=502, detail="LLM service is temporarily unavailable."',
        "status_code=502, detail=str(e)",
    ),
    (
        "invoke: rate limit 30 -> 300",
        'dependencies=[Depends(rate_limit("30/minute"))],',
        'dependencies=[Depends(rate_limit("300/minute"))],',
    ),
    (
        "providers: admins allowed",
        'dependencies=[Depends(rate_limit("60/minute")), Depends(get_current_parent)],',
        'dependencies=[Depends(rate_limit("60/minute"))],',
    ),
    (
        "providers: rate limit 60 -> 600",
        'dependencies=[Depends(rate_limit("60/minute")), Depends(get_current_parent)],',
        'dependencies=[Depends(rate_limit("600/minute")), Depends(get_current_parent)],',
    ),
    (
        "providers: default ignores availability",
        "default = next((p for p in llm_service.PRIORITY if av[p]), None)",
        "default = llm_service.PRIORITY[0]",
    ),
]
