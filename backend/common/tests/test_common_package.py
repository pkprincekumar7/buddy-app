"""The `common` package's packaging contract (build plan 0.1).

Installing it for real (core and extras) is a CI step, because it needs a build backend;
these tests check the declarations that step relies on.
"""

import re
import tomllib
from pathlib import Path

import common

COMMON_DIR = Path(common.__file__).parent
PYPROJECT = tomllib.loads((COMMON_DIR / "pyproject.toml").read_text())


def test_version_is_semantic():
    assert re.fullmatch(r"\d+\.\d+\.\d+", common.__version__)


def test_version_comes_from_the_package():
    project = PYPROJECT["project"]
    assert project["dynamic"] == ["version"]
    assert PYPROJECT["tool"]["setuptools"]["dynamic"]["version"] == {"attr": "common.__version__"}


def test_package_is_the_directory_itself_without_its_tests():
    setuptools = PYPROJECT["tool"]["setuptools"]
    assert setuptools["package-dir"] == {"common": "."}
    # Subpackages are listed explicitly, so common/tests never ships.
    assert setuptools["packages"] == ["common", "common.events", "common.generation"]


def test_the_event_catalogue_and_schemas_ship_with_the_package():
    data = PYPROJECT["tool"]["setuptools"]["package-data"]
    assert data == {"common.events": ["catalogue.json", "schemas/*.json"]}


def test_extras_match_the_design():
    # Section 2: generation for discover, grow, transform, release; uploads for
    # children and transform. No other extras.
    assert set(PYPROJECT["project"]["optional-dependencies"]) == {"generation", "uploads"}


def test_requires_the_backend_python():
    assert PYPROJECT["project"]["requires-python"] == ">=3.13"
