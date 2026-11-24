#!/usr/bin/env bash
# shellcheck shell=bash
#
# Post-deploy smoke tests: the public path a user's request takes, checked after a deploy,
# promote, restart or rollback has finished. The rollout waits already prove each task
# answers its own /health; these prove the whole path works: CloudFront, the JWT edge
# function, the ALB (and its origin-verify header), the gateway and the service, and for
# the web app, the S3 files, the SPA rewrite and the response headers. No credentials:
# every request is anonymous. Each check is retried ($SMOKE_TRIES times, $SMOKE_DELAY s
# apart) while CloudFront and the ALB catch up, then fails with what it saw.
#
# Source it:
#   source scripts/smoke.sh
#   smoke_api "$(smoke_fqdn "$ENVIRONMENT" "$SUBDOMAIN" "$DOMAIN_NAME")" "$COMMIT" "$REGIONS"
#   smoke_web "$(smoke_fqdn "$ENVIRONMENT" "$SUBDOMAIN" "$DOMAIN_NAME")" "$COMMIT"
#
# Needs: curl, jq. Tests: scripts/smoke.test.sh (a fake curl).
#
# What it can't see: /api/health is a bootstrap path, so the edge function sends it to one
# region (infra-live-edge's bootstrap_region) whatever the request carries. The other
# regions are reached only by a signed-in user from there, so their check is the rollout's.

# smoke_fqdn ENVIRONMENT SUBDOMAIN DOMAIN_NAME → the public host, as infra-live-edge names
# it: prod is {subdomain}.{domain}, every other environment {subdomain}-{env}.{domain}.
# Fails, naming the variables, when one is empty.
smoke_fqdn() {
  if [ -z "$1" ] || [ -z "$2" ] || [ -z "$3" ]; then
    echo "::error::The smoke test needs the environment's SUBDOMAIN and DOMAIN_NAME variables (got '$2' and '$3' for '$1')." >&2
    return 1
  fi
  if [ "$1" = prod ]; then echo "$2.$3"; else echo "$2-$1.$3"; fi
}

# _smoke_get URL DIR → the HTTP status (000 when nothing answered); the body in DIR/body,
# the headers in DIR/headers. Anonymous, HTTPS only, no redirects followed.
_smoke_get() {
  local code
  rm -f "$2/body" "$2/headers"
  : >"$2/headers"
  code=$(curl -sS --proto '=https' --max-time 15 -o "$2/body" -D "$2/headers" -w '%{http_code}' \
    "$1" 2>"$2/err") || true
  echo "${code:-000}"
}

# _smoke_header DIR NAME → that response header's value (the last one, case-insensitive).
_smoke_header() {
  tr -d '\r' <"$1/headers" | awk -v want="$(tr '[:upper:]' '[:lower:]' <<<"$2")" '
    { i = index($0, ":"); if (i && tolower(substr($0, 1, i - 1)) == want) v = substr($0, i + 1) }
    END { sub(/^[ \t]+/, "", v); print v }'
}

# _smoke_same_commit A B: the same commit, one possibly abbreviated (at least 7 characters).
_smoke_same_commit() {
  [ "${#1}" -ge 7 ] && [ "${#2}" -ge 7 ] && { [[ "$1" == "$2"* ]] || [[ "$2" == "$1"* ]]; }
}

# _smoke_retry DESCRIPTION FUNCTION ARGS...: calls FUNCTION until it succeeds; it explains
# a failure in SMOKE_ERROR.
_smoke_retry() {
  local what="$1" i tries="${SMOKE_TRIES:-12}"
  shift
  for ((i = 1; i <= tries; i++)); do
    SMOKE_ERROR=""
    if "$@"; then return 0; fi
    echo "  try $i/$tries: $SMOKE_ERROR" >&2
    [ "$i" -eq "$tries" ] || sleep "${SMOKE_DELAY:-10}"
  done
  echo "::error::Smoke test failed ($what): $SMOKE_ERROR"
  return 1
}

# smoke_api FQDN [EXPECTED_COMMIT] [REGIONS_JSON]:
#  - GET /api/health answers 200 with status ok. When EXPECTED_COMMIT is given and the
#    region that answered is in REGIONS_JSON (the regions just rolled out), its commit
#    must be EXPECTED_COMMIT: the new shared image serves through the whole path.
#  - GET /api/v1/users/me with no token is 401: the edge function still turns away a
#    request without a valid JWT (a 200 would be an open API, a 5xx a broken one).
smoke_api() {
  local fqdn="$1" expected="${2:-}" regions="${3:-[]}" dir status
  dir=$(mktemp -d)
  status=0
  if ! _smoke_retry "API health, https://$fqdn/api/health" _smoke_health "$fqdn" "$expected" "$regions" "$dir"; then
    status=1
  elif ! _smoke_retry "JWT check, https://$fqdn/api/v1/users/me" _smoke_unauthenticated "$fqdn" "$dir"; then
    status=1
  fi
  rm -rf "$dir"
  return "$status"
}

_smoke_health() {
  local fqdn="$1" expected="$2" regions="$3" dir="$4" code commit region
  code=$(_smoke_get "https://$fqdn/api/health" "$dir")
  [ "$code" = 200 ] || { SMOKE_ERROR="GET /api/health answered $code, want 200"; return 1; }
  jq -e '.status == "ok"' "$dir/body" >/dev/null 2>&1 \
    || { SMOKE_ERROR="GET /api/health: no status ok in $(head -c 200 "$dir/body")"; return 1; }
  commit=$(jq -r '.commit // ""' "$dir/body")
  region=$(jq -r '.region // ""' "$dir/body")
  if [ -n "$expected" ] && jq -e --arg r "$region" 'index($r)' <<<"$regions" >/dev/null; then
    _smoke_same_commit "$commit" "$expected" \
      || { SMOKE_ERROR="$region serves commit $commit, want $expected"; return 1; }
    echo "API health: ok, $region serves $commit (the release just deployed)."
  else
    echo "API health: ok, ${region:-an unnamed region} serves ${commit:-an unknown commit}."
  fi
}

_smoke_unauthenticated() {
  local fqdn="$1" dir="$2" code
  code=$(_smoke_get "https://$fqdn/api/v1/users/me" "$dir")
  [ "$code" = 401 ] || { SMOKE_ERROR="GET /api/v1/users/me with no token answered $code, want 401"; return 1; }
  echo "JWT check: ok, a request with no token gets 401."
}

# smoke_web FQDN [EXPECTED_COMMIT]:
#  - GET /version.json (written at build time) names EXPECTED_COMMIT, when one is given.
#  - GET / is HTML with the security headers (HSTS, CSP, nosniff, frame options).
#  - The page's main script loads as JavaScript: the S3 sync put the build's chunks there.
#  - A client route (no file extension) gets the page: the SPA rewrite.
smoke_web() {
  local fqdn="$1" expected="${2:-}" dir status
  dir=$(mktemp -d)
  status=0
  if [ -n "$expected" ] \
    && ! _smoke_retry "web version, https://$fqdn/version.json" _smoke_version "$fqdn" "$expected" "$dir"; then
    status=1
  elif ! _smoke_retry "web page, https://$fqdn/" _smoke_page "$fqdn" "$dir"; then
    status=1
  elif ! _smoke_retry "SPA route, https://$fqdn/smoke-check/client-route" _smoke_route "$fqdn" "$dir"; then
    status=1
  fi
  rm -rf "$dir"
  return "$status"
}

_smoke_version() {
  local fqdn="$1" expected="$2" dir="$3" code commit
  code=$(_smoke_get "https://$fqdn/version.json" "$dir")
  [ "$code" = 200 ] || { SMOKE_ERROR="GET /version.json answered $code, want 200"; return 1; }
  commit=$(jq -r '.commit // ""' "$dir/body" 2>/dev/null)
  _smoke_same_commit "$commit" "$expected" \
    || { SMOKE_ERROR="the live build is ${commit:-unknown}, want $expected"; return 1; }
  echo "Web version: ok, $commit is live."
}

_smoke_page() {
  local fqdn="$1" dir="$2" code header missing=() script
  code=$(_smoke_get "https://$fqdn/" "$dir")
  [ "$code" = 200 ] || { SMOKE_ERROR="GET / answered $code, want 200"; return 1; }
  [[ "$(_smoke_header "$dir" content-type)" == text/html* ]] \
    || { SMOKE_ERROR="GET / is $(_smoke_header "$dir" content-type), want text/html"; return 1; }
  for header in strict-transport-security content-security-policy x-content-type-options x-frame-options; do
    [ -n "$(_smoke_header "$dir" "$header")" ] || missing+=("$header")
  done
  [ "${#missing[@]}" -eq 0 ] || { SMOKE_ERROR="GET / has no ${missing[*]} header"; return 1; }
  script=$(grep -oE 'src="/assets/[^"]+\.js"' "$dir/body" | head -1 | sed -E 's/^src="(.*)"$/\1/')
  [ -n "$script" ] || { SMOKE_ERROR="GET / names no /assets/*.js script"; return 1; }
  code=$(_smoke_get "https://$fqdn$script" "$dir")
  [ "$code" = 200 ] || { SMOKE_ERROR="GET $script answered $code, want 200"; return 1; }
  [[ "$(_smoke_header "$dir" content-type)" == *javascript* ]] \
    || { SMOKE_ERROR="GET $script is $(_smoke_header "$dir" content-type), want JavaScript"; return 1; }
  echo "Web page: ok, HTML with its security headers, and $script loads."
}

_smoke_route() {
  local fqdn="$1" dir="$2" code
  code=$(_smoke_get "https://$fqdn/smoke-check/client-route" "$dir")
  [ "$code" = 200 ] && [[ "$(_smoke_header "$dir" content-type)" == text/html* ]] \
    || { SMOKE_ERROR="a client route answered $code ($(_smoke_header "$dir" content-type)), want 200 HTML"; return 1; }
  echo "SPA route: ok, a client route gets the page."
}
