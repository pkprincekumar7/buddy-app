# ---------------------------------------------------------------------------
# Routing data — read from the repo-wide single source of truth,
# shared/routing.json (country → location → AWS region → Atlas zone; see
# shared/README.md). The backend and both frontends get generated copies of the
# same file (scripts/sync-routing.mjs); Terraform reads it directly, so the
# Lambda@Edge routing, the CloudFront uploads routing and the WAF geo-block can
# never drift from what the backend assigns at registration.
# ---------------------------------------------------------------------------

locals {
  routing = jsondecode(file("${path.module}/../../shared/routing.json"))

  # location => AWS region, e.g. { eu = "eu-west-1", in = "ap-south-1", ... }.
  # Used by the Lambda@Edge (API routing by the token's location claim) and by
  # the /uploads/{location}/* behaviours — both must agree, or a user's API
  # calls and photo uploads would land in different regions. Locations not in
  # the file (legacy cn/ru accounts) have no entry: the Lambda answers 503 and
  # uploads fall through to the default behaviour, which 404s them (spa_rewrite
  # leaves /uploads/ alone).
  location_to_region = merge([
    for region, cfg in local.routing.regions : { for loc in cfg.locations : loc => region }
  ]...)

  # Countries never served — the IP-geolocation half of the block. The backend
  # refuses registration for the same list (self-declared country); this
  # catches a user in a blocked country who picks another one. CN: AWS China
  # partition required; the rest: comprehensive sanctions (OFAC/EAR). Not
  # VPN-proof — IP geolocation never is.
  blocked_country_codes = local.routing.blocked_countries
}
