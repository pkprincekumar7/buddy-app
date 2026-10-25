"""Location ↔ AWS region ↔ Atlas zone lookups shared by every service.

The tables live in shared/routing.json, the single source of truth also used by the
edge and both frontends, and are generated into regions_data.py by
`node scripts/sync-routing.mjs` (CI fails if stale). Workers and outbox relays use them
to handle only their own region's locations (docs/auth-users-split.md, 4.1 and 7.3).
"""

import re
from collections.abc import Mapping
from typing import Any

from common.regions_data import ATLAS_ZONE_FOR_REGION, REGION_TO_LOCATIONS

LOCATION_RE = re.compile(r"^[a-z0-9_-]{1,16}\Z")  # \Z: $ would allow a trailing "\n"

__all__ = [
    "ATLAS_ZONE_FOR_REGION",
    "LOCATION_RE",
    "REGION_TO_LOCATIONS",
    "location_from_claims",
    "locations_for_region",
]


def locations_for_region(aws_region: str) -> list[str] | None:
    """Locations whose jobs and outbox rows a task in ``aws_region`` handles.

    Returns None when ``aws_region`` is empty (local dev: no region scoping, one task
    handles every location). Raises ValueError for a region with no entry in
    shared/routing.json, so a misconfigured task fails at startup instead of silently
    handling nothing while that region's work piles up.
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


def location_from_claims(claims: Mapping[str, Any]) -> str | None:
    """The ``location`` claim of a verified token, or None if it's missing or malformed.

    Every token auth issues carries a valid location, so callers treat None as an invalid
    token, never as a default location.
    """
    location = claims.get("location")
    return location if isinstance(location, str) and LOCATION_RE.match(location) else None
