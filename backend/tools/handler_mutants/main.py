"""Hand-built mutants for app/main.py: the lifespan, exception handlers, request-id middleware, health endpoints and module-level wiring. Runs the whole suite: a change here can affect any route."""

# ruff: noqa: E501

TARGET = "app/main.py"
TESTS = ["tests"]

MUTANTS: list[tuple[str, str, str]] = [
    (
        "lifespan: indexes not created",
        "    await init_indexes(db)\n    app.state.db = db",
        "    app.state.db = db",
    ),
    (
        "lifespan: app.state.db not set",
        "    await init_indexes(db)\n    app.state.db = db\n",
        "    await init_indexes(db)\n",
    ),
    (
        "lifespan: cleanup task not started",
        "asyncio.create_task(_cleanup_expired_sessions(db)) if settings.can_mint_tokens",
        "asyncio.create_task(asyncio.sleep(0)) if settings.can_mint_tokens",
    ),
    (
        "lifespan: session sweep runs on every component",
        "_cleanup_expired_sessions(db)) if settings.can_mint_tokens else None",
        "_cleanup_expired_sessions(db)) if True else None",
    ),
    (
        "lifespan: session sweep only where auth isn't mounted",
        "_cleanup_expired_sessions(db)) if settings.can_mint_tokens else None",
        "_cleanup_expired_sessions(db)) if not settings.can_mint_tokens else None",
    ),
    ("lifespan: cleanup task not cancelled", "        cleanup_task.cancel()\n", ""),
    (
        "lifespan: cleanup task not awaited",
        "        await asyncio.gather(cleanup_task, return_exceptions=True)\n",
        "",
    ),
    ("lifespan: Mongo not closed", "        client.close()\n", ""),
    ("lifespan: LLM clients not closed", "        await llm_service.aclose_clients()\n", ""),
    (
        "lifespan: close before cancel",
        "            cleanup_task.cancel()\n            await asyncio.gather(cleanup_task, return_exceptions=True)\n        client.close()\n",
        "            client.close()\n            cleanup_task.cancel()\n            await asyncio.gather(cleanup_task, return_exceptions=True)\n",
    ),
    (
        "lifespan: wrong database name",
        "    db = client[settings.mongodb_db_name]",
        '    db = client["test"]',
    ),
    ("limiter not on app.state", "app.state.limiter = limiter\n", ""),
    (
        "429 handler not registered",
        "app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)",
        "pass  #",
    ),
    ("SlowAPIMiddleware not added", "app.add_middleware(SlowAPIMiddleware)\n", ""),
    (
        "422 → 400",
        '    return JSONResponse(status_code=422, content={"detail": jsonable_encoder(exc.errors())})',
        '    return JSONResponse(status_code=400, content={"detail": jsonable_encoder(exc.errors())})',
    ),
    (
        "422 not JSON-encoded (regression)",
        'content={"detail": jsonable_encoder(exc.errors())}',
        'content={"detail": exc.errors()}',
    ),
    (
        "422 details hidden",
        'content={"detail": jsonable_encoder(exc.errors())}',
        'content={"detail": "invalid"}',
    ),
    (
        "422 not logged",
        '    log.warning("422 validation_error path=%s errors=%s", request.url.path, exc.errors())\n',
        "",
    ),
    (
        "HTTPException handler turns all into 500",
        "    return await http_exception_handler(request, exc)",
        '    return JSONResponse(status_code=500, content={"detail": "x"})',
    ),
    (
        "500 handler leaks error",
        'content={"detail": "Internal server error"}',
        'content={"detail": str(exc)}',
    ),
    (
        "500 → 200",
        '    return JSONResponse(status_code=500, content={"detail": "Internal server error"})',
        '    return JSONResponse(status_code=200, content={"detail": "Internal server error"})',
    ),
    (
        "500 not logged",
        '    log.exception("Unhandled error on %s %s", request.method, request.url.path)\n',
        "",
    ),
    (
        "request id not validated",
        "    request_id = client_id if _REQUEST_ID_RE.match(client_id) else str(uuid.uuid4())",
        "    request_id = client_id or str(uuid.uuid4())",
    ),
    (
        "request id max 64 → 128",
        '_REQUEST_ID_RE = re.compile(r"^[a-zA-Z0-9\\-_]{1,64}\\Z")',
        '_REQUEST_ID_RE = re.compile(r"^[a-zA-Z0-9\\-_]{1,128}\\Z")',
    ),
    (
        "request id allows any char",
        '_REQUEST_ID_RE = re.compile(r"^[a-zA-Z0-9\\-_]{1,64}\\Z")',
        '_REQUEST_ID_RE = re.compile(r"^.{1,64}\\Z")',
    ),
    ("request id not echoed", '    response.headers["X-Request-Id"] = request_id\n', ""),
    ("no-store not set", '        response.headers["Cache-Control"] = "no-store"', "        pass"),
    ("no-store → no-cache", '"Cache-Control"] = "no-store"', '"Cache-Control"] = "no-cache"'),
    (
        "health exemption inverted",
        "    if request.url.path not in _HEALTH_PATHS:",
        "    if request.url.path in _HEALTH_PATHS:",
    ),
    (
        "/api/health not exempt",
        '_HEALTH_PATHS = {"/health", "/api/health"}',
        '_HEALTH_PATHS = {"/health"}',
    ),
    ("CORS: credentials off", "    allow_credentials=True,", "    allow_credentials=False,"),
    ("CORS: X-Client-Location dropped", '"X-Request-Id", "X-Client-Location"]', '"X-Request-Id"]'),
    (
        "CORS: POST not allowed",
        'allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"]',
        'allow_methods=["GET", "PATCH", "DELETE", "OPTIONS"]',
    ),
    ("CORS: any origin", "    allow_origins=_allow_origins,", '    allow_origins=["*"],'),
    (
        "admin router missing from all",
        '"all": [auth_router, admin_router, *_API_ROUTERS]',
        '"all": [auth_router, *_API_ROUTERS]',
    ),
    ("admin component serves nothing", '"admin": [admin_router]', '"admin": []'),
    (
        "admin component serves the API too",
        '"admin": [admin_router]',
        '"admin": [admin_router, *_API_ROUTERS]',
    ),
    ("users router not in the api component", "    users_router,\n", ""),
    ("audio router not in the api component", "    audio_router,\n", ""),
    (
        "auth router missing from all",
        '"all": [auth_router, admin_router, *_API_ROUTERS]',
        '"all": [admin_router, *_API_ROUTERS]',
    ),
    (
        "auth component serves the API too",
        '"auth": [auth_router]',
        '"auth": [auth_router, *_API_ROUTERS]',
    ),
    ("api component serves auth too", '"api": _API_ROUTERS', '"api": [auth_router, *_API_ROUTERS]'),
    ("worker component serves routers", '"worker": []', '"worker": _API_ROUTERS'),
    (
        "routers mounted without /api/v1",
        "    app.include_router(_router, prefix=API_V1_PREFIX)",
        "    app.include_router(_router)",
    ),
    (
        "component ignored: always mounts all",
        "for _router in routers_for(settings.app_component):",
        'for _router in routers_for("all"):',
    ),
    ("/health wrong body", '    return {"status": "ok"}\n', '    return {"status": "up"}\n'),
    (
        "/api/health without git info",
        '    return {"status": "ok", **_GIT_INFO}',
        '    return {"status": "ok"}',
    ),
    ("/api/health limit 30 → 300", '@limiter.limit("30/minute")', '@limiter.limit("300/minute")'),
]
