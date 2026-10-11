import logging
import re

from app.settings import settings

log = logging.getLogger(__name__)

LOCATION_RE = re.compile(r"^[a-z0-9_-]{1,16}$")

# Every ISO-3166-1 country/territory a user can register from, mapped to the
# location value stored on the account (and carried in its JWT). Covers all 249
# ISO codes plus XK (Kosovo, user-assigned but widely used) except
# BLOCKED_COUNTRIES and the six with no permanent population (AQ, BV, GS, HM,
# TF, UM). Any other code is rejected at registration rather than silently
# defaulted.
#
# Mirrored in frontend{,-app}/src/lib/locationHint.ts (X-Client-Location
# registration hint) and frontend{,-app}/src/lib/countries.ts (the country
# selector) — tests/test_routing.py fails if any copy drifts from this one.
#
# Grouping rules: EU/US territories follow their sovereign's data-protection
# law (EU outermost regions → eu, US territories → us) rather than geography;
# everything else is grouped by geography/latency, except where noted.
COUNTRY_TO_REGION: dict[str, str] = {
    # -- Europe (EU/EEA, UK, wider Europe) → eu
    "AD": "eu",  # Andorra
    "AL": "eu",  # Albania
    "AT": "eu",  # Austria
    "AX": "eu",  # Åland Islands
    "BA": "eu",  # Bosnia and Herzegovina
    "BE": "eu",  # Belgium
    "BG": "eu",  # Bulgaria
    "CH": "eu",  # Switzerland
    "CY": "eu",  # Cyprus
    "CZ": "eu",  # Czech Republic
    "DE": "eu",  # Germany
    "DK": "eu",  # Denmark
    "EE": "eu",  # Estonia
    "ES": "eu",  # Spain
    "FI": "eu",  # Finland
    "FO": "eu",  # Faroe Islands
    "FR": "eu",  # France
    "GB": "eu",  # United Kingdom
    "GG": "eu",  # Guernsey
    "GI": "eu",  # Gibraltar
    "GL": "eu",  # Greenland
    "GR": "eu",  # Greece
    "HR": "eu",  # Croatia
    "HU": "eu",  # Hungary
    "IE": "eu",  # Ireland
    "IM": "eu",  # Isle of Man
    "IS": "eu",  # Iceland
    "IT": "eu",  # Italy
    "JE": "eu",  # Jersey
    "LI": "eu",  # Liechtenstein
    "LT": "eu",  # Lithuania
    "LU": "eu",  # Luxembourg
    "LV": "eu",  # Latvia
    "MC": "eu",  # Monaco
    "MD": "eu",  # Moldova
    "ME": "eu",  # Montenegro
    "MK": "eu",  # North Macedonia
    "MT": "eu",  # Malta
    "NL": "eu",  # Netherlands
    "NO": "eu",  # Norway
    "PL": "eu",  # Poland
    "PT": "eu",  # Portugal
    "RO": "eu",  # Romania
    "RS": "eu",  # Serbia
    "SE": "eu",  # Sweden
    "SI": "eu",  # Slovenia
    "SJ": "eu",  # Svalbard and Jan Mayen
    "SK": "eu",  # Slovakia
    "SM": "eu",  # San Marino
    "TR": "eu",  # Turkey
    "UA": "eu",  # Ukraine
    "VA": "eu",  # Vatican City
    "XK": "eu",  # Kosovo
    # -- EU outermost regions — EU territory, GDPR applies, despite geography → eu
    "GF": "eu",  # French Guiana
    "GP": "eu",  # Guadeloupe
    "MF": "eu",  # Saint Martin
    "MQ": "eu",  # Martinique
    "RE": "eu",  # Réunion
    "YT": "eu",  # Mayotte
    # -- Caucasus & Central Asia → eu
    "AM": "eu",  # Armenia
    "AZ": "eu",  # Azerbaijan
    "GE": "eu",  # Georgia
    "KG": "eu",  # Kyrgyzstan
    "KZ": "eu",  # Kazakhstan
    "TJ": "eu",  # Tajikistan
    "TM": "eu",  # Turkmenistan
    "UZ": "eu",  # Uzbekistan
    # -- Africa (except Egypt) → eu
    # Sub-Saharan Africa → eu for cross-border-transfer-law reasons as much as
    # latency: Nigeria's NDPA, South Africa's POPIA, Kenya's DPA and similar laws
    # are GDPR-modelled and reference GDPR-style adequacy — eu-west-1 is the more
    # defensible destination than ap-south-1 or us-east-1. Not a substitute for
    # an actual privacy-law review before launching in these markets. Egypt
    # stays in me.
    "AO": "eu",  # Angola
    "BF": "eu",  # Burkina Faso
    "BI": "eu",  # Burundi
    "BJ": "eu",  # Benin
    "BW": "eu",  # Botswana
    "CD": "eu",  # Democratic Republic of the Congo
    "CF": "eu",  # Central African Republic
    "CG": "eu",  # Republic of the Congo
    "CI": "eu",  # Côte d'Ivoire
    "CM": "eu",  # Cameroon
    "CV": "eu",  # Cape Verde
    "DJ": "eu",  # Djibouti
    "DZ": "eu",  # Algeria
    "EH": "eu",  # Western Sahara
    "ER": "eu",  # Eritrea
    "ET": "eu",  # Ethiopia
    "GA": "eu",  # Gabon
    "GH": "eu",  # Ghana
    "GM": "eu",  # Gambia
    "GN": "eu",  # Guinea
    "GQ": "eu",  # Equatorial Guinea
    "GW": "eu",  # Guinea-Bissau
    "KE": "eu",  # Kenya
    "KM": "eu",  # Comoros
    "LR": "eu",  # Liberia
    "LS": "eu",  # Lesotho
    "LY": "eu",  # Libya
    "MA": "eu",  # Morocco
    "MG": "eu",  # Madagascar
    "ML": "eu",  # Mali
    "MR": "eu",  # Mauritania
    "MU": "eu",  # Mauritius
    "MW": "eu",  # Malawi
    "MZ": "eu",  # Mozambique
    "NA": "eu",  # Namibia
    "NE": "eu",  # Niger
    "NG": "eu",  # Nigeria
    "RW": "eu",  # Rwanda
    "SC": "eu",  # Seychelles
    "SD": "eu",  # Sudan
    "SH": "eu",  # Saint Helena
    "SL": "eu",  # Sierra Leone
    "SN": "eu",  # Senegal
    "SO": "eu",  # Somalia
    "SS": "eu",  # South Sudan
    "ST": "eu",  # São Tomé and Príncipe
    "SZ": "eu",  # Eswatini
    "TD": "eu",  # Chad
    "TG": "eu",  # Togo
    "TN": "eu",  # Tunisia
    "TZ": "eu",  # Tanzania
    "UG": "eu",  # Uganda
    "ZA": "eu",  # South Africa
    "ZM": "eu",  # Zambia
    "ZW": "eu",  # Zimbabwe
    # -- Middle East → me
    "AE": "me",  # United Arab Emirates
    "BH": "me",  # Bahrain
    "EG": "me",  # Egypt
    "IL": "me",  # Israel
    "IQ": "me",  # Iraq
    "JO": "me",  # Jordan
    "KW": "me",  # Kuwait
    "LB": "me",  # Lebanon
    "OM": "me",  # Oman
    "PS": "me",  # Palestine
    "QA": "me",  # Qatar
    "SA": "me",  # Saudi Arabia
    "YE": "me",  # Yemen
    # -- India → in
    "IN": "in",  # India
    # -- Asia-Pacific & rest of South Asia → apac
    # PK (and the rest of South Asia outside India) deliberately maps to "apac",
    # not "in" — same physical region (ap-south-1) as India, but avoids
    # labelling non-Indian accounts with the "in" location value.
    "AF": "apac",  # Afghanistan
    "AU": "apac",  # Australia
    "BD": "apac",  # Bangladesh
    "BN": "apac",  # Brunei
    "BT": "apac",  # Bhutan
    "CC": "apac",  # Cocos (Keeling) Islands
    "CK": "apac",  # Cook Islands
    "CX": "apac",  # Christmas Island
    "FJ": "apac",  # Fiji
    "FM": "apac",  # Micronesia
    "HK": "apac",  # Hong Kong
    "ID": "apac",  # Indonesia
    "IO": "apac",  # British Indian Ocean Territory
    "JP": "apac",  # Japan
    "KH": "apac",  # Cambodia
    "KI": "apac",  # Kiribati
    "KR": "apac",  # South Korea
    "LA": "apac",  # Laos
    "LK": "apac",  # Sri Lanka
    "MH": "apac",  # Marshall Islands
    "MM": "apac",  # Myanmar
    "MN": "apac",  # Mongolia
    "MO": "apac",  # Macau
    "MV": "apac",  # Maldives
    "MY": "apac",  # Malaysia
    "NC": "apac",  # New Caledonia
    "NF": "apac",  # Norfolk Island
    "NP": "apac",  # Nepal
    "NR": "apac",  # Nauru
    "NU": "apac",  # Niue
    "NZ": "apac",  # New Zealand
    "PF": "apac",  # French Polynesia
    "PG": "apac",  # Papua New Guinea
    "PH": "apac",  # Philippines
    "PK": "apac",  # Pakistan
    "PN": "apac",  # Pitcairn Islands
    "PW": "apac",  # Palau
    "SB": "apac",  # Solomon Islands
    "SG": "apac",  # Singapore
    "TH": "apac",  # Thailand
    "TK": "apac",  # Tokelau
    "TL": "apac",  # Timor-Leste
    "TO": "apac",  # Tonga
    "TV": "apac",  # Tuvalu
    "TW": "apac",  # Taiwan
    "VN": "apac",  # Vietnam
    "VU": "apac",  # Vanuatu
    "WF": "apac",  # Wallis and Futuna
    "WS": "apac",  # Samoa
    # -- North America, Central America & Caribbean, US Pacific territories → us
    "AG": "us",  # Antigua and Barbuda
    "AI": "us",  # Anguilla
    "AS": "us",  # American Samoa
    "AW": "us",  # Aruba
    "BB": "us",  # Barbados
    "BL": "us",  # Saint Barthélemy
    "BM": "us",  # Bermuda
    "BQ": "us",  # Caribbean Netherlands
    "BS": "us",  # Bahamas
    "BZ": "us",  # Belize
    "CA": "us",  # Canada
    "CR": "us",  # Costa Rica
    "CW": "us",  # Curaçao
    "DM": "us",  # Dominica
    "DO": "us",  # Dominican Republic
    "GD": "us",  # Grenada
    "GT": "us",  # Guatemala
    "GU": "us",  # Guam
    "HN": "us",  # Honduras
    "HT": "us",  # Haiti
    "JM": "us",  # Jamaica
    "KN": "us",  # Saint Kitts and Nevis
    "KY": "us",  # Cayman Islands
    "LC": "us",  # Saint Lucia
    "MP": "us",  # Northern Mariana Islands
    "MS": "us",  # Montserrat
    "MX": "us",  # Mexico
    "NI": "us",  # Nicaragua
    "PA": "us",  # Panama
    "PM": "us",  # Saint Pierre and Miquelon
    "PR": "us",  # Puerto Rico
    "SV": "us",  # El Salvador
    "SX": "us",  # Sint Maarten
    "TC": "us",  # Turks and Caicos Islands
    "TT": "us",  # Trinidad and Tobago
    "US": "us",  # United States
    "VC": "us",  # Saint Vincent and the Grenadines
    "VG": "us",  # British Virgin Islands
    "VI": "us",  # U.S. Virgin Islands
    # -- South America → br
    "AR": "br",  # Argentina
    "BO": "br",  # Bolivia
    "BR": "br",  # Brazil
    "CL": "br",  # Chile
    "CO": "br",  # Colombia
    "EC": "br",  # Ecuador
    "FK": "br",  # Falkland Islands
    "GY": "br",  # Guyana
    "PE": "br",  # Peru
    "PY": "br",  # Paraguay
    "SR": "br",  # Suriname
    "UY": "br",  # Uruguay
    "VE": "br",  # Venezuela
}

# Never served. Rejected at registration (403 country_not_supported) and left out
# of the frontend selectors. CN: China legitimately requires AWS's separate China
# partition (a different account/infrastructure entirely). The rest are under
# comprehensive sanctions (OFAC/EAR export-control exposure this business has
# decided not to take on). Accounts created before this list existed may still
# carry location "cn"/"ru" — Lambda@Edge keeps failing those closed with 503.
BLOCKED_COUNTRIES: frozenset[str] = frozenset({"BY", "CN", "CU", "IR", "KP", "RU", "SY"})

# Which locations each AWS region's backend/worker serves — the inverse of
# LOCATION_TO_REGION in infra-live-edge/functions/jwt-validator-lambda.js.tpl
# (and uploads_location_to_region in infra-live-edge/terraform/cloudfront.tf);
# keep all three in sync. tests/test_routing.py fails on drift with the
# Lambda's map. cn/ru are absent for the same compliance reasons given there.
REGION_TO_LOCATIONS: dict[str, list[str]] = {
    "ap-south-1": ["in", "apac", "me"],
    "eu-west-1": ["eu"],
    "us-east-1": ["us", "br"],
}


def locations_for_region(aws_region: str) -> list[str] | None:
    """Locations whose jobs a worker in ``aws_region`` should process.

    Returns None when ``aws_region`` is empty (local dev — no region scoping,
    one worker handles every location). Raises ValueError for a region with
    no entry above, so a misconfigured worker fails at startup instead of
    silently claiming nothing while that region's jobs pile up.
    """
    if not aws_region:
        return None
    locations = REGION_TO_LOCATIONS.get(aws_region)
    if not locations:
        raise ValueError(
            f"AWS_REGION={aws_region!r} has no entry in REGION_TO_LOCATIONS — "
            "add the locations this region serves."
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
            "Add it to COUNTRY_TO_REGION if this is a valid market.",
            normalised,
            settings.default_location,
        )
        return settings.default_location
    return region
