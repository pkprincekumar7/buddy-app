#!/usr/bin/env python3
"""Run import-linter with the service-boundary contracts for the services in the tree.

The contracts (docs/auth-users-split.md, section 2) are generated from tools/services.py,
so a new service is covered without editing any list:
- common never imports service code (nor today's backend);
- services never import today's backend, which is removed in build plan 8.6;
- services are independent: they share only common, and anything else crosses through
  events or internal calls.

    python tools/import_contracts.py          run lint-imports (CI and check.sh)
    python tools/import_contracts.py --print  print the generated config
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from services import BACKEND, discover  # noqa: E402


def _toml_list(items: list[str]) -> str:
    return "[" + ", ".join(f'"{item}"' for item in items) + "]"


def render(services: list[str], common: str = "common", legacy: str | None = "app") -> str:
    """The import-linter config, in pyproject.toml form."""
    old = [legacy] if legacy else []
    lines = [
        "[tool.importlinter]",
        f"root_packages = {_toml_list([*old, common, *services])}",
    ]
    if old or services:
        lines += [
            "",
            "[[tool.importlinter.contracts]]",
            'name = "common never imports service code"',
            'type = "forbidden"',
            f"source_modules = {_toml_list([common])}",
            f"forbidden_modules = {_toml_list([*old, *services])}",
        ]
    if old and services:
        lines += [
            "",
            "[[tool.importlinter.contracts]]",
            '''name = "services never import today's backend"''',
            'type = "forbidden"',
            f"source_modules = {_toml_list(services)}",
            f"forbidden_modules = {_toml_list(old)}",
        ]
    if len(services) > 1:
        lines += [
            "",
            "[[tool.importlinter.contracts]]",
            'name = "services are independent"',
            'type = "independence"',
            f"modules = {_toml_list(services)}",
        ]
    return "\n".join(lines) + "\n"


def lint_imports_path() -> str:
    # The venv's own copy first, so `python tools/import_contracts.py` needs no activated venv.
    beside = Path(sys.executable).with_name("lint-imports")
    found = str(beside) if beside.is_file() else shutil.which("lint-imports")
    if not found:
        raise FileNotFoundError("lint-imports not found: pip install -r requirements-lint.txt")
    return found


def main(argv: list[str]) -> int:
    config = render(discover())
    if argv == ["--print"]:
        print(config, end="")
        return 0
    if argv:
        print("usage: python tools/import_contracts.py [--print]", file=sys.stderr)
        return 2
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "pyproject.toml"
        path.write_text(config, encoding="utf-8")
        # --no-cache: the cache lives next to the config, which is thrown away.
        # A fixed argv and no shell.
        return subprocess.run(  # nosec B603
            [lint_imports_path(), "--config", str(path), "--no-cache"],
            cwd=BACKEND,
            env={**os.environ, "PYTHONPATH": str(BACKEND)},
            check=False,
        ).returncode


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
