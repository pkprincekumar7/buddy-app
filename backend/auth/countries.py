"""Country → location for registration. Only auth resolves a location, so this lives in
the auth service rather than in common (docs/auth-users-split.md, section 2).

The tables are generated into countries_data.py from shared/routing.json by
`node scripts/sync-routing.mjs` (CI fails if stale).
"""

from auth.countries_data import BLOCKED_COUNTRIES, COUNTRY_TO_REGION

__all__ = ["BLOCKED_COUNTRIES", "COUNTRY_TO_REGION", "is_blocked", "resolve_region"]


def _normalise(country_code: str) -> str:
    return country_code.strip().upper()


def is_blocked(country_code: str) -> bool:
    """True for a country the service is never offered in (registration returns
    403 country_not_supported, and the WAF geo-blocks it)."""
    return _normalise(country_code) in BLOCKED_COUNTRIES


def resolve_region(country_code: str) -> str:
    """Location for a country code.

    Raises ValueError for a code not in COUNTRY_TO_REGION. Callers validate the code
    first and refuse blocked countries, so reaching that is a bug, never a user error;
    there's deliberately no fallback location to hide it.
    """
    location = COUNTRY_TO_REGION.get(_normalise(country_code))
    if location is None:
        raise ValueError(f"no location for country code {country_code!r}")
    return location
