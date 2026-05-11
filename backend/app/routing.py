import logging
import re

from app.settings import settings

log = logging.getLogger(__name__)

LOCATION_RE = re.compile(r"^[a-z0-9_-]{1,16}$")

COUNTRY_TO_REGION: dict[str, str] = {
    "AT": "eu", "BE": "eu", "BG": "eu", "CY": "eu", "CZ": "eu",
    "DE": "eu", "DK": "eu", "EE": "eu", "ES": "eu", "FI": "eu",
    "FR": "eu", "GR": "eu", "HR": "eu", "HU": "eu", "IE": "eu",
    "IT": "eu", "LT": "eu", "LU": "eu", "LV": "eu", "MT": "eu",
    "NL": "eu", "PL": "eu", "PT": "eu", "RO": "eu", "SE": "eu",
    "SI": "eu", "SK": "eu",
    "GB": "eu",
    "NO": "eu", "IS": "eu", "LI": "eu",

    "US": "us", "CA": "us", "MX": "us",
    "BR": "br",

    "SG": "apac", "MY": "apac", "ID": "apac", "PH": "apac",
    "TH": "apac", "VN": "apac", "JP": "apac", "KR": "apac",
    "AU": "apac", "NZ": "apac", "HK": "apac", "TW": "apac",

    "IN": "in",

    "SA": "me", "AE": "me", "QA": "me", "KW": "me", "BH": "me", "OM": "me",

    "CN": "cn",

    "RU": "ru",
}


def resolve_region(country_code: str) -> str:
    if not country_code:
        return settings.default_location
    normalised = country_code.strip().upper()
    region = COUNTRY_TO_REGION.get(normalised)
    if region is None:
        log.debug(
            "resolve_region: unrecognised country code %r — falling back to DEFAULT_LOCATION=%r. "
            "Add it to COUNTRY_TO_REGION if this is a valid market.",
            normalised,
            settings.default_location,
        )
        return settings.default_location
    return region
