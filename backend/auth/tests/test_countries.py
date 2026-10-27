"""auth.countries: the country → location lookup registration uses."""

import json
from pathlib import Path

import pytest

from auth.countries import BLOCKED_COUNTRIES, COUNTRY_TO_REGION, is_blocked, resolve_region
from common.regions import REGION_TO_LOCATIONS

ROUTING_JSON = Path(__file__).resolve().parents[3] / "shared" / "routing.json"

needs_repo = pytest.mark.skipif(
    not ROUTING_JSON.exists(), reason="full repo checkout not available"
)


@pytest.mark.parametrize("code", ["IN", "in", " in ", "GB", "US", "BR"])
def test_resolve_region_normalises_the_code(code):
    assert resolve_region(code) == COUNTRY_TO_REGION[code.strip().upper()]


def test_resolve_region_has_no_fallback():
    with pytest.raises(ValueError, match="ZZ"):
        resolve_region("ZZ")


def test_blocked_countries_are_never_mapped():
    assert not BLOCKED_COUNTRIES & set(COUNTRY_TO_REGION)
    with pytest.raises(ValueError):
        resolve_region(next(iter(BLOCKED_COUNTRIES)))


@pytest.mark.parametrize("code", ["IR", "ir", " kp "])
def test_is_blocked_normalises_the_code(code):
    assert is_blocked(code)


def test_is_blocked_is_false_for_a_served_country():
    assert not is_blocked("IN")


def test_every_mapped_location_is_served_by_a_region():
    # A location a user can be assigned but no region serves would leave that user's
    # requests failing and their jobs pending.
    covered = {loc for locs in REGION_TO_LOCATIONS.values() for loc in locs}
    assert set(COUNTRY_TO_REGION.values()) == covered


@needs_repo
def test_generated_data_matches_shared_json():
    data = json.loads(ROUTING_JSON.read_text(encoding="utf-8"))
    assert {c["code"]: c["location"] for c in data["countries"]} == COUNTRY_TO_REGION
    assert set(data["blocked_countries"]) == BLOCKED_COUNTRIES
