"""common.regions: region scoping for workers and relays, and the token location check."""

import json
from pathlib import Path

import pytest

from common.regions import (
    ATLAS_ZONE_FOR_REGION,
    REGION_TO_LOCATIONS,
    location_from_claims,
    locations_for_region,
)

ROUTING_JSON = Path(__file__).resolve().parents[3] / "shared" / "routing.json"

# shared/routing.json isn't in a backend-only Docker build context.
needs_repo = pytest.mark.skipif(
    not ROUTING_JSON.exists(), reason="full repo checkout not available"
)


def test_empty_region_means_no_scoping():
    assert locations_for_region("") is None


def test_known_region_returns_its_locations():
    assert locations_for_region("eu-west-1") == ["eu"]
    assert locations_for_region("ap-south-1") == ["in", "apac", "me"]
    assert locations_for_region("us-east-1") == ["us", "br"]


def test_unknown_region_fails_fast():
    with pytest.raises(ValueError, match="sa-east-1"):
        locations_for_region("sa-east-1")


def test_each_location_belongs_to_exactly_one_region():
    all_locations = [loc for locs in REGION_TO_LOCATIONS.values() for loc in locs]
    assert len(all_locations) == len(set(all_locations))


def test_every_region_has_an_atlas_zone():
    assert set(ATLAS_ZONE_FOR_REGION) == set(REGION_TO_LOCATIONS)


@pytest.mark.parametrize("location", ["in", "eu", "us", "a-b_1"])
def test_valid_location_claim_is_returned(location):
    assert location_from_claims({"location": location}) == location


@pytest.mark.parametrize(
    "claims",
    [
        {},
        {"location": None},
        {"location": 7},
        {"location": ""},
        {"location": "EU"},
        {"location": "in\n"},
        {"location": "x" * 17},
    ],
)
def test_missing_or_malformed_location_claim_is_none(claims):
    assert location_from_claims(claims) is None


@needs_repo
def test_generated_data_matches_shared_json():
    data = json.loads(ROUTING_JSON.read_text(encoding="utf-8"))
    assert {r: v["locations"] for r, v in data["regions"].items()} == REGION_TO_LOCATIONS
    assert {r: v["atlas_zone"] for r, v in data["regions"].items()} == ATLAS_ZONE_FOR_REGION
