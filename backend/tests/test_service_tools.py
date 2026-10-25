"""tools/services.py and tools/import_contracts.py: services found from the tree (build plan 0.5).

The contract tests build throwaway packages shaped like the real backend (common, today's
app and two services), lint them with the generated config, and check that each import the
design forbids (docs/auth-users-split.md, section 2) breaks the right contract.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from tools import import_contracts, services

LINT_IMPORTS = Path(sys.executable).with_name("lint-imports")


def _write(root: Path, files: dict[str, str]) -> None:
    for name, body in files.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body)


def _service(name: str, http: bool = True) -> dict[str, str]:
    files = {f"{name}/__init__.py": "", f"{name}/requirements.txt": "buddy-common==0.1.0\n"}
    if http:
        files[f"{name}/app/__init__.py"] = ""
        files[f"{name}/app/main.py"] = "app = None\n"
    return files


# ── discovery ──────────────────────────────────────────────────────────────────


def test_the_real_tree_has_auth_and_hello():
    assert {"auth", "hello"} <= set(services.discover())
    assert services.serves_http("hello")
    assert services.problems() == []


def test_a_service_needs_requirements_and_an_init(tmp_path: Path):
    _write(tmp_path, {**_service("alpha"), **_service("beta", http=False)})
    _write(tmp_path, {"common/__init__.py": "", "common/pyproject.toml": ""})  # not a service
    _write(tmp_path, {"app/__init__.py": "", "requirements.txt": ""})  # today's app
    _write(tmp_path, {"docs/requirements.txt": ""})  # no __init__.py
    assert services.discover(tmp_path) == ["alpha", "beta"]
    assert services.serves_http("alpha", tmp_path)
    assert not services.serves_http("beta", tmp_path)


def test_a_bad_service_name_fails_loudly(tmp_path: Path):
    _write(tmp_path, {"Bad-Name/__init__.py": "", "Bad-Name/requirements.txt": ""})
    with pytest.raises(ValueError, match="Bad-Name"):
        services.discover(tmp_path)
    assert services.problems(tmp_path) == ["backend/Bad-Name: not a valid service name"]


def test_problems_reports_a_missing_init(tmp_path: Path):
    _write(tmp_path, {"half/requirements.txt": ""})
    assert services.problems(tmp_path) == ["backend/half: has requirements.txt but no __init__.py"]


def test_problems_reports_a_spec_without_a_service(tmp_path: Path):
    _write(tmp_path, {**_service("alpha"), **_service("beta", http=False)})
    _write(tmp_path, {f"openapi/{n}.json": "{}" for n in ("alpha", "beta", "gone")})
    assert services.problems(tmp_path) == [
        "backend/openapi/beta.json: no service backend/beta/app/main.py",
        "backend/openapi/gone.json: no service backend/gone/app/main.py",
    ]


def test_cli_outputs(capsys):
    names = services.discover()
    assert services.main([]) == 0
    assert capsys.readouterr().out.split() == names
    assert services.main(["--json"]) == 0
    assert json.loads(capsys.readouterr().out) == names
    assert services.main(["--paths", "backend/"]) == 0
    assert capsys.readouterr().out.split() == [f"backend/{n}/" for n in names]
    assert services.main(["--check"]) == 0
    assert "services:" in capsys.readouterr().out


def test_cli_check_fails_on_a_problem(monkeypatch, capsys):
    monkeypatch.setattr(services, "problems", lambda: ["backend/x: broken"])
    assert services.main(["--check"]) == 1
    assert "backend/x: broken" in capsys.readouterr().err


# ── generated contracts ────────────────────────────────────────────────────────


def test_render_scales_with_the_services():
    assert "independence" not in import_contracts.render(["solo"])
    assert "independent" in import_contracts.render(["a", "b"])
    assert "today's backend" not in import_contracts.render(["a", "b"], legacy=None)
    assert "contracts" not in import_contracts.render([], legacy=None)


def test_cli_prints_the_config(capsys):
    assert import_contracts.main(["--print"]) == 0
    assert capsys.readouterr().out == import_contracts.render(services.discover())
    assert import_contracts.main(["--bogus"]) == 2


def test_missing_lint_imports_is_reported(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(import_contracts.sys, "executable", str(tmp_path / "python"))
    monkeypatch.setattr(import_contracts.shutil, "which", lambda _: None)
    with pytest.raises(FileNotFoundError, match="lint-imports"):
        import_contracts.lint_imports_path()


needs_lint_imports = pytest.mark.skipif(
    not LINT_IMPORTS.is_file(), reason="import-linter not installed"
)


def _lint(root: Path) -> subprocess.CompletedProcess[str]:
    config = import_contracts.render(["svc_a", "svc_b"], common="demo_common", legacy="demo_app")
    (root / "pyproject.toml").write_text(config)
    return subprocess.run(
        [str(LINT_IMPORTS), "--config", str(root / "pyproject.toml"), "--no-cache"],
        cwd=root,
        env={**os.environ, "PYTHONPATH": str(root)},
        capture_output=True,
        text=True,
        check=False,
    )


@pytest.fixture
def project(tmp_path: Path) -> Path:
    _write(
        tmp_path,
        {
            "demo_common/__init__.py": "",
            "demo_common/authz.py": "VALUE = 1\n",
            "demo_app/__init__.py": "",
            "demo_app/main.py": "from demo_common import authz\n",
            "svc_a/__init__.py": "",
            "svc_a/app.py": "from demo_common.authz import VALUE\n",
            "svc_b/__init__.py": "",
            "svc_b/app.py": "from demo_common import authz\n",
        },
    )
    return tmp_path


@needs_lint_imports
def test_services_using_only_common_pass(project: Path):
    result = _lint(project)
    assert result.returncode == 0, result.stdout + result.stderr


@needs_lint_imports
@pytest.mark.parametrize(
    ("path", "source", "contract"),
    [
        ("svc_a/app.py", "from svc_b import app\n", "services are independent"),
        ("svc_a/app.py", "from demo_app import main\n", "services never import today's backend"),
        ("demo_common/authz.py", "from svc_a import app\n", "common never imports service code"),
        ("demo_common/authz.py", "import demo_app\n", "common never imports service code"),
    ],
)
def test_forbidden_imports_break_their_contract(project: Path, path, source, contract):
    _write(project, {path: source})
    result = _lint(project)
    assert result.returncode != 0
    assert f"{contract} BROKEN" in result.stdout


@needs_lint_imports
def test_main_lints_the_real_tree():
    assert import_contracts.main([]) == 0
