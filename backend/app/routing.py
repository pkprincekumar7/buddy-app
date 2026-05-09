"""
Regional routing helpers.

COUNTRY_TO_REGION maps ISO-3166-1 alpha-2 country codes to the region codes
used throughout the application (JWT claim, connection pool key, etc.).

Rules:
- Returns "local" for unknown/unmapped codes — routes to the default
  (main) database in single-instance mode.
- All lookups are case-insensitive (upper-cased before lookup).
- Add new country codes here as you expand into additional markets;
  the corresponding REGIONAL_DB_URLS env var entry activates the new cluster.
"""
import logging
import re

log = logging.getLogger(__name__)

# Allowlist pattern for region claim values (e.g. "eu", "us", "in", "local").
# Shared by database._region_from_request (routing) and auth.refresh_tokens
# (token forwarding) so the validation rule lives in exactly one place.
REGION_RE = re.compile(r"^[a-z0-9_-]{1,16}$")

COUNTRY_TO_REGION: dict[str, str] = {
    # ── European Union / EEA / UK (GDPR) ────────────────────────────────────
    "AT": "eu", "BE": "eu", "BG": "eu", "CY": "eu", "CZ": "eu",
    "DE": "eu", "DK": "eu", "EE": "eu", "ES": "eu", "FI": "eu",
    "FR": "eu", "GR": "eu", "HR": "eu", "HU": "eu", "IE": "eu",
    "IT": "eu", "LT": "eu", "LU": "eu", "LV": "eu", "MT": "eu",
    "NL": "eu", "PL": "eu", "PT": "eu", "RO": "eu", "SE": "eu",
    "SI": "eu", "SK": "eu",
    "GB": "eu",                          # UK GDPR
    "NO": "eu", "IS": "eu", "LI": "eu", # EEA non-EU

    # ── Americas ─────────────────────────────────────────────────────────────
    "US": "us", "CA": "us", "MX": "us",
    "BR": "br",                          # Brazil LGPD — isolated cluster

    # ── Asia-Pacific ─────────────────────────────────────────────────────────
    "SG": "apac", "MY": "apac", "ID": "apac", "PH": "apac",
    "TH": "apac", "VN": "apac", "JP": "apac", "KR": "apac",
    "AU": "apac", "NZ": "apac", "HK": "apac", "TW": "apac",

    # ── India (DPDP Act) ─────────────────────────────────────────────────────
    "IN": "in",

    # ── Middle East (Saudi PDPL, UAE DIFC) ───────────────────────────────────
    "SA": "me", "AE": "me", "QA": "me", "KW": "me", "BH": "me", "OM": "me",

    # ── China (PIPL — requires dedicated infra, see GLOBAL_ROUTING_AURORA.md) ─
    "CN": "cn",

    # ── Russia (FZ-242) ──────────────────────────────────────────────────────
    "RU": "ru",
}


def resolve_region(country_code: str) -> str:
    """
    Return the region code for a given ISO country code.

    Falls back to "local" (main database) for unknown countries.
    Logs a DEBUG message when an unrecognised code is received so frontend
    bugs (e.g. passing a full country name instead of a 2-char code) are
    visible in logs without raising an error.
    Safe to call with any string; never raises.
    """
    if not country_code:
        return "local"
    normalised = country_code.strip().upper()
    region = COUNTRY_TO_REGION.get(normalised)
    if region is None:
        log.debug(
            "resolve_region: unrecognised country code %r — routing to 'local'. "
            "Add it to COUNTRY_TO_REGION if this is a valid market.",
            normalised,
        )
        return "local"
    return region
