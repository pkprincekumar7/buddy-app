import re
from collections.abc import Mapping
from typing import Any

from app.routing_data import (
    ATLAS_ZONE_FOR_REGION,
    BLOCKED_COUNTRIES,
    COUNTRY_TO_REGION,
    REGION_TO_LOCATIONS,
)

LOCATION_RE = re.compile(r"^[a-z0-9_-]{1,16}\Z")  # \Z: $ would allow a trailing "\n"

# The routing tables live in shared/routing.json — the single source of truth for
# country → location → AWS region → Atlas zone — and are generated into
# app/routing_data.py by `node scripts/sync-routing.mjs` (CI fails if stale). The
# same JSON feeds both frontends' country selector and registration hint, and the
# edge's Lambda@Edge routing, CloudFront uploads routing and WAF geo-block. The
# reasoning behind the groupings (territories, Africa, South Asia, blocked
# countries) is in shared/README.md.
__all__ = [
    "ATLAS_ZONE_FOR_REGION",
    "BLOCKED_COUNTRIES",
    "COUNTRY_TO_REGION",
    "LOCATION_RE",
    "REGION_TO_LOCATIONS",
    "location_from_claims",
    "locations_for_region",
    "resolve_region",
]


def locations_for_region(aws_region: str) -> list[str] | None:
    """Locations whose jobs a worker in ``aws_region`` should process.

    Returns None when ``aws_region`` is empty (local dev — no region scoping,
    one worker handles every location). Raises ValueError for a region with
    no entry in shared/routing.json, so a misconfigured worker fails at
    startup instead of silently claiming nothing while that region's jobs pile
    up.
    """
    if not aws_region:
        return None
    locations = REGION_TO_LOCATIONS.get(aws_region)
    if not locations:
        raise ValueError(
            f"AWS_REGION={aws_region!r} has no entry in REGION_TO_LOCATIONS — "
            "add the region and its locations to shared/routing.json."
        )
    return locations


def resolve_region(country_code: str) -> str:
    """Location for a country code. Raises ValueError for a code not in
    COUNTRY_TO_REGION — callers validate the code first (and refuse
    BLOCKED_COUNTRIES), so reaching that is a bug, never a user error; there is
    deliberately no fallback location to hide it."""
    location = COUNTRY_TO_REGION.get(country_code.strip().upper())
    if location is None:
        raise ValueError(f"no location for country code {country_code!r}")
    return location


def location_from_claims(claims: Mapping[str, Any]) -> str | None:
    """The ``location`` claim of a verified token, or None if it is missing or
    malformed. Every token this backend issues carries a valid location, so
    callers treat None as an invalid token — never as a default location."""
    location = claims.get("location")
    return location if isinstance(location, str) and LOCATION_RE.match(location) else None
