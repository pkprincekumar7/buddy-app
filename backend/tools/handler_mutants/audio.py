"""Hand-built mutants for app/routers/audio.py: POST /audio/transcribe."""

# ruff: noqa: E501

TARGET = "app/routers/audio.py"
TESTS = ["tests/test_audio.py"]

MUTANTS: list[tuple[str, str, str]] = [
    (
        "auth: parent check removed",
        'dependencies=[Depends(rate_limit("10/minute")), Depends(get_current_parent)]',
        'dependencies=[Depends(rate_limit("10/minute"))]',
    ),
    ("rate limit raised 10 → 100/min", 'rate_limit("10/minute")', 'rate_limit("100/minute")'),
    (
        "client-None check inverted",
        "    if _openai_client is None:\n",
        "    if _openai_client is not None:\n",
    ),
    (
        "missing-key branch skipped",
        "        if not settings.openai_api_key:\n",
        "        if False:\n",
    ),
    ("init-error branch skipped", "        elif _openai_init_error:\n", "        elif False:\n"),
    (
        "init error not logged",
        '            log.error("OpenAI client init error: %s", _openai_init_error)\n',
        "",
    ),
    (
        "init error leaked to client",
        '            detail = "Audio service failed to initialize. Check server logs."',
        '            detail = f"Audio service failed: {_openai_init_error}"',
    ),
    (
        "503 status changed to 500",
        "        raise HTTPException(status_code=503, detail=detail)",
        "        raise HTTPException(status_code=500, detail=detail)",
    ),
    (
        "size limit +1 byte",
        "    max_bytes = 10 * 1024 * 1024  # 10 MB",
        "    max_bytes = 10 * 1024 * 1024 + 1  # 10 MB",
    ),
    (
        "size limit -1 byte",
        "    max_bytes = 10 * 1024 * 1024  # 10 MB",
        "    max_bytes = 10 * 1024 * 1024 - 1  # 10 MB",
    ),
    ("size check > → >=", "    if len(content) > max_bytes:", "    if len(content) >= max_bytes:"),
    (
        "size check removed",
        '    if len(content) > max_bytes:\n        raise HTTPException(status_code=413, detail="Audio file too large (max 10 MB).")\n',
        "",
    ),
    ("413 status changed to 400", "status_code=413,", "status_code=400,"),
    (
        "control chars not stripped",
        '    filename = re.sub(r"[\\x00-\\x1f\\x7f]", "", raw_name) or "recording.webm"',
        '    filename = raw_name or "recording.webm"',
    ),
    ("only NUL stripped (not all controls)", 'r"[\\x00-\\x1f\\x7f]"', 'r"[\\x00]"'),
    (
        "all-control filename not defaulted",
        '"", raw_name) or "recording.webm"',
        '"", raw_name) or raw_name',
    ),
    (
        "missing filename default changed",
        '    raw_name = audio.filename or "recording.webm"',
        '    raw_name = audio.filename or "recording.mp3"',
    ),
    (
        "extension not lower-cased",
        '    raw_ext = filename.rsplit(".", 1)[-1].lower() if',
        '    raw_ext = filename.rsplit(".", 1)[-1] if',
    ),
    (
        "first extension wins (split, not rsplit)",
        'filename.rsplit(".", 1)[-1]',
        'filename.split(".", 1)[-1]',
    ),
    (
        "no-extension default changed",
        '.lower() if "." in filename else "webm"',
        '.lower() if "." in filename else "mp3"',
    ),
    (
        "allowlist check inverted",
        "    if raw_ext not in _ALLOWED_AUDIO_EXTS:",
        "    if raw_ext in _ALLOWED_AUDIO_EXTS:",
    ),
    ("allowlist check removed", "    if raw_ext not in _ALLOWED_AUDIO_EXTS:", "    if False:"),
    ("415 status changed to 400", "status_code=415,", "status_code=400,"),
    (
        "client Content-Type trusted",
        "    mime = _MIME_MAP[ext]",
        "    mime = audio.content_type or _MIME_MAP[ext]",
    ),
    ("mp3 MIME wrong in map", '"mp3": "audio/mpeg"', '"mp3": "audio/mp3"'),
    (
        "user filename sent to OpenAI",
        'file=(f"recording.{ext}", io.BytesIO(content), mime)',
        "file=(filename, io.BytesIO(content), mime)",
    ),
    ("wrong model", 'model="whisper-1"', 'model="whisper-2"'),
    ("language changed", 'language="en"', 'language="fr"'),
    ("upload bytes not sent", "io.BytesIO(content)", "io.BytesIO(b'')"),
    (
        "transcript object returned, not text",
        'return {"transcript": transcript.text}',
        'return {"transcript": str(transcript)}',
    ),
    (
        "upstream error leaked to client",
        'status_code=502, detail="Transcription service is temporarily unavailable."',
        'status_code=502, detail=f"Transcription failed: {e}"',
    ),
    ("502 changed to 500", "            status_code=502,", "            status_code=500,"),
    ("upstream error not logged", '        log.warning("audio.transcribe.error: %s", e)\n', ""),
]
