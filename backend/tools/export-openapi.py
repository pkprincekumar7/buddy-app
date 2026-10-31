#!/usr/bin/env python3
"""Export a service's OpenAPI specification to stdout.

Run via:  python backend/tools/export-openapi.py --service auth > backend/openapi/auth.json

A service's spec is its public app only (`<service>.app.main:app`); the internal app on
port 8001 is never published (docs/auth-users-split.md, 13.2).

Used by check.sh and CI (each "spec up to date" check and the Spectral lint) without a
running server. app.openapi() builds the spec from the route definitions only — no startup
handlers, no DB connections — and the spec does not depend on any setting, so this works the
same from any directory, needs no .env, and never reads one (so no real key or connection
string is loaded just to print the spec).
"""

import argparse
import importlib
import json
import os
import sys
import tempfile

_parser = argparse.ArgumentParser(description="Print a service's OpenAPI spec.")
_parser.add_argument(
    "--service", required=True, help="a service under backend/ (tools/services.py)"
)
_args = _parser.parse_args()

# The script's own directory (tools/) is on sys.path.
from services import NAME_RE, discover, serves_http  # noqa: E402

if not (
    NAME_RE.fullmatch(_args.service) and _args.service in discover() and serves_http(_args.service)
):
    _parser.error(f"{_args.service!r} is not a service with app/main.py")

# ── import from backend/, but from an empty directory ────────────────────────
# Settings read ".env" relative to the current directory; an empty temp dir
# means no .env (and none of its secrets) is ever picked up here.
_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _BACKEND)

with tempfile.TemporaryDirectory() as _empty:
    os.chdir(_empty)
    app = importlib.import_module(f"{_args.service}.app.main").app
    print(json.dumps(app.openapi(), indent=2))
