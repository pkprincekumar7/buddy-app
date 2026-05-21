#!/usr/bin/env python3
"""Export the FastAPI OpenAPI specification to stdout.

Run via:  python backend/tools/export-openapi.py > openapi.json

Used by check.sh (Spectral lint) without requiring a running server.
Sets minimal env vars so pydantic-settings validation passes, then
calls app.openapi() — which builds the spec from route definitions only,
without executing startup event handlers or opening any DB connections.
"""

import json
import os
import sys

# ── minimal env to satisfy pydantic-settings validation ──────────────────────
os.environ.setdefault("MONGODB_URI", "mongodb://localhost:27017")
os.environ.setdefault("JWT_SECRET", "a" * 64)  # 64 chars — passes dev + prod checks
os.environ.setdefault("REDIS_URL", "redis://localhost:6379")
os.environ.setdefault("APP_ENV", "dev")

# ── add backend/ to sys.path so `from app.main import app` resolves ──────────
_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _BACKEND)

from app.main import app  # noqa: E402 — must come after env setup

print(json.dumps(app.openapi(), indent=2))
