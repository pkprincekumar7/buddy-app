import logging
import re

from app.routing_data import (
    ATLAS_ZONE_FOR_REGION,
    BLOCKED_COUNTRIES,
    COUNTRY_TO_REGION,
    REGION_TO_LOCATIONS,
)
from app.settings import settings

log = logging.getLogger(__name__)

LOCATION_RE = re.compile(r"^[a-z0-9_-]{1,16}$")

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
    if not country_code:
        return settings.default_location
    normalised = country_code.strip().upper()
    region = COUNTRY_TO_REGION.get(normalised)
    if region is None:
        log.debug(
            "resolve_region: unrecognised country code %r — falling back to DEFAULT_LOCATION=%r. "
            "Add it to shared/routing.json if this is a valid market.",
            normalised,
            settings.default_location,
        )
        return settings.default_location
    return region
