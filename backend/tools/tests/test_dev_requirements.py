"""backend/requirements-dev.txt is exactly the union of the services' runtime pins."""

import re
from pathlib import Path

from tools import services

BACKEND = Path(__file__).resolve().parents[2]


def _pins(path: Path) -> set[str]:
    lines = (line.split("#")[0].strip() for line in path.read_text(encoding="utf-8").splitlines())
    return {line for line in lines if line and not line.startswith("buddy-common")}


def _name(pin: str) -> str:
    return re.match(r"[A-Za-z0-9_.\-]+", pin).group(0).lower()  # type: ignore[union-attr]


def test_dev_requirements_are_the_union_of_the_services_pins():
    union: set[str] = set()
    for service in services.discover():
        union |= _pins(BACKEND / service / "requirements.txt")
    assert _pins(BACKEND / "requirements-dev.txt") == union


def test_the_services_agree_on_every_version():
    seen: dict[str, str] = {}
    for service in services.discover():
        for pin in _pins(BACKEND / service / "requirements.txt"):
            assert seen.setdefault(_name(pin), pin) == pin, f"{service} pins {pin}"
