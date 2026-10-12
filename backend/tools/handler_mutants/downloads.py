"""Hand-built mutants for app/routers/downloads.py: GET /downloads/apk (the S3 helper itself is plain code mutmut covers)."""

# ruff: noqa: E501

TARGET = "app/routers/downloads.py"
TESTS = ["tests/test_downloads.py"]

MUTANTS: list[tuple[str, str, str]] = [
    (
        "apk: not-configured check skipped",
        "    if not settings.assets_bucket_name:",
        "    if False:",
    ),
    (
        "apk: error status lost",
        "raise HTTPException(status_code=exc.status, detail=exc.detail) from exc",
        "raise HTTPException(status_code=500, detail=exc.detail) from exc",
    ),
    (
        "apk: expiry reported wrong",
        "        expires_in=_PRESIGN_EXPIRES_SECONDS,",
        "        expires_in=3600,",
    ),
    (
        "apk: user id logged unsanitised",
        'str(raw_user_id).replace("\\r", "").replace("\\n", "")',
        "str(raw_user_id)",
    ),
    (
        "apk: missing user id logged as None",
        '        else "unknown"',
        "        else str(raw_user_id)",
    ),
    (
        "apk: rate limit 10 -> 100",
        'dependencies=[Depends(rate_limit("10/minute"))],',
        'dependencies=[Depends(rate_limit("100/minute"))],',
    ),
    # Expected survivor: no test can observe whether boto3 runs on a worker thread.
    (
        "apk: blocking S3 calls on the event loop",
        "result = await asyncio.to_thread(_resolve_apk_download, settings.assets_bucket_name)",
        "result = _resolve_apk_download(settings.assets_bucket_name)",
    ),
]
