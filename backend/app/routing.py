import logging
import re

from app.settings import settings

log = logging.getLogger(__name__)

LOCATION_RE = re.compile(r"^[a-z0-9_-]{1,16}$")

# Mirrored (best-effort, non-authoritative) in frontend/src/lib/locationHint.ts
# for the X-Client-Location registration header — keep both in sync when
# adding a country here. See that file's own comment for why drift there is
# low-risk (it only affects which region handles one bootstrap call, never
# the stored location value, which is always computed from this table).
COUNTRY_TO_REGION: dict[str, str] = {
    "AT": "eu",
    "BE": "eu",
    "BG": "eu",
    "CY": "eu",
    "CZ": "eu",
    "DE": "eu",
    "DK": "eu",
    "EE": "eu",
    "ES": "eu",
    "FI": "eu",
    "FR": "eu",
    "GR": "eu",
    "HR": "eu",
    "HU": "eu",
    "IE": "eu",
    "IT": "eu",
    "LT": "eu",
    "LU": "eu",
    "LV": "eu",
    "MT": "eu",
    "NL": "eu",
    "PL": "eu",
    "PT": "eu",
    "RO": "eu",
    "SE": "eu",
    "SI": "eu",
    "SK": "eu",
    "GB": "eu",
    "NO": "eu",
    "IS": "eu",
    "LI": "eu",
    "UA": "eu",
    "US": "us",
    "CA": "us",
    "MX": "us",
    "BR": "br",
    "AR": "br",
    "CL": "br",
    "CO": "br",
    "SG": "apac",
    "MY": "apac",
    "ID": "apac",
    "PH": "apac",
    "TH": "apac",
    "VN": "apac",
    "JP": "apac",
    "KR": "apac",
    "AU": "apac",
    "NZ": "apac",
    "HK": "apac",
    "TW": "apac",
    # PK deliberately maps to "apac", not "in" — same physical region
    # (ap-south-1) as India, but avoids literally labelling Pakistani
    # accounts with the "in" location value.
    "PK": "apac",
    "IN": "in",
    "SA": "me",
    "AE": "me",
    "QA": "me",
    "KW": "me",
    "BH": "me",
    "OM": "me",
    "EG": "me",
    "CN": "cn",
    "RU": "ru",
    # GH/NG/KE/ZA/TR map to "eu" for cross-border-transfer-law reasons, not
    # geography or latency: Nigeria's NDPA, South Africa's POPIA, Kenya's DPA,
    # and Turkey's KVKK are all GDPR-modelled and reference GDPR-style
    # adequacy — eu-west-1 is the more defensible destination under those
    # frameworks than ap-south-1 or us-east-1. Not a substitute for an actual
    # privacy-law review before launching in these markets.
    "GH": "eu",
    "NG": "eu",
    "KE": "eu",
    "ZA": "eu",
    "TR": "eu",
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
