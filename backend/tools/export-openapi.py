#!/usr/bin/env python3
"""Export the FastAPI OpenAPI specification to stdout.

Run via:  python backend/tools/export-openapi.py > openapi.json                  today's backend
          python backend/tools/export-openapi.py --service hello > backend/openapi/hello.json

A service's spec is its public app only (`<service>.app.main:app`); the internal app on
port 8001 is never published (docs/auth-users-split.md, 13.2).

Used by check.sh and CI (the "openapi.json up to date" check and the Spectral
lint) without a running server. app.openapi() builds the spec from the route
definitions only — no startup handlers, no DB connections — and the spec does
not depend on any setting, so this runs with throwaway values: it works the
same from any directory, needs no .env, and never reads one (so no real key or
connection string is loaded just to print the spec).
"""

import argparse
import importlib
import json
import os
import sys
import tempfile


def _throwaway_jwt_key() -> str:
    # Imported here: only today's app needs it, and a service's install may not have it.
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()


_parser = argparse.ArgumentParser(description="Print a FastAPI app's OpenAPI spec.")
_parser.add_argument(
    "--service", help="a service under backend/ (tools/services.py); default: today's app"
)
_args = _parser.parse_args()

if _args.service is None:
    # ── throwaway settings: enough for pydantic-settings validation ──────────
    os.environ.setdefault("JWT_PRIVATE_KEY", _throwaway_jwt_key())
    os.environ.setdefault("MONGODB_URI", "mongodb://localhost:27017")
    os.environ.setdefault("REDIS_URL", "redis://localhost:6379")
    os.environ.setdefault("APP_ENV", "dev")
    # The published spec is the whole API, whichever component this shell is set to.
    os.environ["APP_COMPONENT"] = "all"
else:
    # The script's own directory (tools/) is on sys.path.
    from services import NAME_RE, discover, serves_http

    if not (
        NAME_RE.fullmatch(_args.service)
        and _args.service in discover()
        and serves_http(_args.service)
    ):
        _parser.error(f"{_args.service!r} is not a service with app/main.py")

# ── import from backend/, but from an empty directory ────────────────────────
# Settings read ".env" relative to the current directory; an empty temp dir
# means no .env (and none of its secrets) is ever picked up here.
_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _BACKEND)

with tempfile.TemporaryDirectory() as _empty:
    os.chdir(_empty)
    if _args.service is None:
        from app.main import app  # noqa: E402 — must come after env setup
    else:
        app = importlib.import_module(f"{_args.service}.app.main").app

    print(json.dumps(app.openapi(), indent=2))
