import re
from pathlib import Path

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.routers.auth import GoogleAuthBody, RegisterBody, _reject_blocked_country
from app.routing import (
    BLOCKED_COUNTRIES,
    COUNTRY_TO_REGION,
    REGION_TO_LOCATIONS,
    locations_for_region,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
LAMBDA_TEMPLATE = REPO_ROOT / "infra-live-edge" / "functions" / "jwt-validator-lambda.js.tpl"
CLOUDFRONT_TF = REPO_ROOT / "infra-live-edge" / "terraform" / "cloudfront.tf"
WAF_TF = REPO_ROOT / "infra-live-edge" / "terraform" / "waf.tf"
# Both frontends keep their own copies of the country list and location hint.
FRONTEND_LIBS = [REPO_ROOT / app / "src" / "lib" for app in ("frontend", "frontend-app")]

# These files aren't in the backend-only Docker build context.
needs_repo = pytest.mark.skipif(
    not LAMBDA_TEMPLATE.exists(), reason="full repo checkout not available"
)


def _block(source: str, start: str, end: str) -> str:
    match = re.search(re.escape(start) + r"(.*?)" + re.escape(end), source, re.DOTALL)
    assert match, f"{start!r} not found"
    return match.group(1)


def _lambda_location_to_region() -> dict[str, str]:
    """Uncommented entries of LOCATION_TO_REGION in the Lambda@Edge template."""
    block = _block(LAMBDA_TEMPLATE.read_text(), "const LOCATION_TO_REGION = {", "\n}")
    return dict(re.findall(r"^\s+(\w+): '([a-z0-9-]+)',", block, re.MULTILINE))


def _cloudfront_uploads_location_to_region() -> dict[str, str]:
    """Uncommented entries of uploads_location_to_region in cloudfront.tf."""
    block = _block(CLOUDFRONT_TF.read_text(), "uploads_location_to_region = {", "\n  }")
    return dict(re.findall(r"^\s+(\w+)\s+=\s+\"([a-z0-9-]+)\"", block, re.MULTILINE))


def _expected_location_to_region() -> dict[str, str]:
    return {loc: region for region, locs in REGION_TO_LOCATIONS.items() for loc in locs}


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


# -- copies elsewhere in the repo must not drift ----------------------------------


@needs_repo
def test_lambda_edge_routes_each_location_to_its_worker_region():
    assert _lambda_location_to_region() == _expected_location_to_region()


@needs_repo
def test_cloudfront_uploads_routing_matches():
    assert _cloudfront_uploads_location_to_region() == _expected_location_to_region()


@needs_repo
def test_waf_geo_block_matches_blocked_countries():
    block = _block(WAF_TF.read_text(), "waf_blocked_country_codes = [", "]")
    assert set(re.findall(r'"([A-Z]{2})"', block)) == BLOCKED_COUNTRIES


@needs_repo
@pytest.mark.parametrize("lib", FRONTEND_LIBS, ids=lambda p: p.parents[1].name)
def test_frontend_location_hint_matches(lib: Path):
    block = _block((lib / "locationHint.ts").read_text(), "COUNTRY_TO_LOCATION_HINT", "\n};")
    hint = dict(re.findall(r"^\s+([A-Z]{2}): '([a-z]+)',", block, re.MULTILINE))
    assert hint == COUNTRY_TO_REGION


@needs_repo
@pytest.mark.parametrize("lib", FRONTEND_LIBS, ids=lambda p: p.parents[1].name)
def test_frontend_country_selector_matches(lib: Path):
    codes = re.findall(r"code: '([A-Z]{2})'", (lib / "countries.ts").read_text())
    assert len(codes) == len(set(codes)), "duplicate country in selector"
    assert set(codes) == COUNTRY_TO_REGION.keys()
