import json
import re
from pathlib import Path

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.routers.auth import GoogleAuthBody, RegisterBody, _reject_blocked_country
from app.routing import (
    ATLAS_ZONE_FOR_REGION,
    BLOCKED_COUNTRIES,
    COUNTRY_TO_REGION,
    REGION_TO_LOCATIONS,
    location_from_claims,
    locations_for_region,
    resolve_region,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
ROUTING_JSON = REPO_ROOT / "shared" / "routing.json"

# shared/routing.json isn't in the backend-only Docker build context.
needs_repo = pytest.mark.skipif(
    not ROUTING_JSON.exists(), reason="full repo checkout not available"
)


# -- worker region scoping ------------------------------------------------------


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


def test_every_assignable_location_has_a_worker_region():
    # A location a user can be assigned but no region serves would leave that
    # user's API calls 503ing and their jobs pending until the deadline fails them.
    covered = {loc for locs in REGION_TO_LOCATIONS.values() for loc in locs}
    assert set(COUNTRY_TO_REGION.values()) == covered


# -- location resolution ----------------------------------------------------------
# Every token and user record carries a valid location; there is no fallback
# location anywhere — an unmapped code or a token without one is an error, never
# silently treated as some default.


@pytest.mark.parametrize(("code", "location"), [("DE", "eu"), (" in ", "in"), ("us", "us")])
def test_resolve_region_maps_known_codes(code, location):
    assert resolve_region(code) == location


@pytest.mark.parametrize("code", ["", "ZZ", "IR"])  # empty, unknown, blocked (never mapped)
def test_resolve_region_has_no_fallback(code):
    with pytest.raises(ValueError, match="no location for country code"):
        resolve_region(code)


@pytest.mark.parametrize(
    ("claims", "expected"),
    [
        ({"location": "eu"}, "eu"),
        ({"location": "a_b-1"}, "a_b-1"),
        ({}, None),
        ({"location": ""}, None),
        ({"location": 7}, None),
        ({"location": None}, None),
        ({"location": "EU"}, None),
        ({"location": "EU; drop"}, None),
        ({"location": "x" * 17}, None),
        ({"location": "eu\n"}, None),  # $ would have allowed a trailing newline
    ],
)
def test_location_from_claims(claims, expected):
    assert location_from_claims(claims) == expected


# -- country table --------------------------------------------------------------


def test_country_codes_are_well_formed():
    assert all(re.fullmatch(r"[A-Z]{2}", code) for code in COUNTRY_TO_REGION)


def test_blocked_countries_are_never_mapped():
    assert not BLOCKED_COUNTRIES & COUNTRY_TO_REGION.keys()


def test_register_rejects_unknown_country():
    with pytest.raises(ValidationError, match="Unsupported country_code"):
        RegisterBody(email="a@example.com", password="password1", country_code="ZZ")


def test_register_normalises_and_accepts_known_country():
    body = RegisterBody(email="a@example.com", password="password1", country_code=" np ")
    assert body.country_code == "NP"


def test_google_country_is_optional_but_validated():
    assert GoogleAuthBody(id_token="t").country_code is None
    with pytest.raises(ValidationError):
        GoogleAuthBody(id_token="t", country_code="ZZ")


def test_blocked_country_gets_specific_403():
    # Blocked codes pass schema validation so the route can answer precisely.
    RegisterBody(email="a@example.com", password="password1", country_code="IR")
    with pytest.raises(HTTPException) as exc:
        _reject_blocked_country("IR")
    assert exc.value.status_code == 403
    assert exc.value.detail["code"] == "country_not_supported"
    _reject_blocked_country("IN")  # served → no error


# -- generated data must match the single source of truth -------------------------
# (The edge Terraform reads shared/routing.json directly; the frontends' generated
# copies are checked by `node scripts/sync-routing.mjs --check` in CI.)


@needs_repo
def test_routing_data_matches_shared_json():
    data = json.loads(ROUTING_JSON.read_text(encoding="utf-8"))
    assert {c["code"]: c["location"] for c in data["countries"]} == COUNTRY_TO_REGION
    assert set(data["blocked_countries"]) == BLOCKED_COUNTRIES
    assert {r: v["locations"] for r, v in data["regions"].items()} == REGION_TO_LOCATIONS
    assert {r: v["atlas_zone"] for r, v in data["regions"].items()} == ATLAS_ZONE_FOR_REGION
