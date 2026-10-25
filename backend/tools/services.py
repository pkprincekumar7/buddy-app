#!/usr/bin/env python3
"""The backend services, found from the tree, so CI and check.sh keep no list (build plan 0.5).

A service is a directory directly under backend/ with an `__init__.py` and a
`requirements.txt`. One with `app/main.py` also serves HTTP, so it has a committed
OpenAPI spec at backend/openapi/<service>.json. `common` (a pyproject.toml, no
requirements.txt) and today's `app` (no requirements.txt of its own) aren't services.

    python tools/services.py                  names, one per line
    python tools/services.py --json           a JSON array (CI's matrix)
    python tools/services.py --paths backend/ each as a path: backend/auth/ backend/hello/
    python tools/services.py --check          exit 1 if a spec has no service, or a name is invalid

Standard library only, so CI can run it before installing anything.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
OPENAPI_DIR = "openapi"

# Also the Docker build's check (backend/Dockerfile) and common.serve's.
NAME_RE = re.compile(r"[a-z][a-z0-9_]{0,30}")


def _candidates(root: Path) -> list[Path]:
    return sorted(p for p in root.iterdir() if p.is_dir() and (p / "requirements.txt").is_file())


def discover(root: Path = BACKEND) -> list[str]:
    """Service names, sorted. Raises ValueError for a service directory with a bad name."""
    names = []
    for path in _candidates(root):
        if not NAME_RE.fullmatch(path.name):
            raise ValueError(f"backend/{path.name}: not a valid service name")
        if (path / "__init__.py").is_file():
            names.append(path.name)
    return names


def serves_http(name: str, root: Path = BACKEND) -> bool:
    return (root / name / "app" / "main.py").is_file()


def problems(root: Path = BACKEND) -> list[str]:
    """What --check reports: invalid names, packages missing __init__.py, orphaned specs."""
    found: list[str] = []
    for path in _candidates(root):
        if not NAME_RE.fullmatch(path.name):
            found.append(f"backend/{path.name}: not a valid service name")
        elif not (path / "__init__.py").is_file():
            found.append(f"backend/{path.name}: has requirements.txt but no __init__.py")
    if found:
        return found
    http = {name for name in discover(root) if serves_http(name, root)}
    for spec in sorted((root / OPENAPI_DIR).glob("*.json")):
        if spec.stem not in http:
            found.append(
                f"backend/{OPENAPI_DIR}/{spec.name}: no service backend/{spec.stem}/app/main.py"
            )
    return found


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--json", action="store_true", help="print a JSON array")
    group.add_argument(
        "--paths", metavar="PREFIX", help="print each as PREFIX<name>/, space-separated"
    )
    group.add_argument("--check", action="store_true", help="validate the tree")
    args = parser.parse_args(argv)

    if args.check:
        found = problems()
        for problem in found:
            print(problem, file=sys.stderr)
        if not found:
            print(f"{len(discover())} services: {', '.join(discover()) or 'none'}")
        return 1 if found else 0

    names = discover()
    if args.json:
        print(json.dumps(names))
    elif args.paths is not None:
        print(" ".join(f"{args.paths}{name}/" for name in names))
    else:
        print("\n".join(names))
    return 0


if __name__ == "__main__":
    sys.exit(main())
