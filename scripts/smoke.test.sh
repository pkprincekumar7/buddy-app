#!/usr/bin/env bash
# SC2015: `cond && ok || fail` is intended — ok/fail only echo and count.
# shellcheck disable=SC2015
# Tests for scripts/smoke.sh against a fake `curl` on PATH — no network needed.
# Run: bash scripts/smoke.test.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export FAKE="$WORK/fake"
mkdir -p "$FAKE/bin"

# -- fake curl -----------------------------------------------------------------------
# Logs every call to $FAKE/calls. Answers from $FAKE/site/<path> (the URL's path, "/" as
# "_"): <path>.code holds one status per line, the Nth call getting line N (the last one
# from then on); <path>.body and <path>.headers are the response. An unknown path is 404.
cat > "$FAKE/bin/curl" <<'EOF'
#!/usr/bin/env bash
echo "$*" >> "$FAKE/calls"
out="" headers="" url=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -D) headers="$2"; shift 2 ;;
    -w | --proto | --max-time) shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
path="/${url#https://*/}"
key=$(tr '/' '_' <<<"$path")
site="$FAKE/site/$key"
n=$(( $(cat "$FAKE/count$key" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "$FAKE/count$key"
if [ -f "$site.code" ]; then
  code=$(sed -n "${n}p" "$site.code"); [ -n "$code" ] || code=$(tail -1 "$site.code")
else
  code=404
fi
# As curl does: -w still prints 000, and the exit status says why.
[ "$code" = 000 ] && { echo "curl: (6) Could not resolve host" >&2; printf 000; exit 6; }
cp "$site.body" "$out" 2>/dev/null || : > "$out"
cp "$site.headers" "$headers" 2>/dev/null || printf 'HTTP/2 %s\r\n' "$code" > "$headers"
printf '%s' "$code"
EOF
chmod +x "$FAKE/bin/curl"
export PATH="$FAKE/bin:$PATH"
export SMOKE_TRIES=3 SMOKE_DELAY=0

# shellcheck source=scripts/smoke.sh
source "$HERE/smoke.sh"

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok   - $1"; }
fail() { FAIL=$((FAIL + 1)); echo "FAIL - $1${2:+: $2}"; }
check() { local name="$1" got="$2" want="$3"; [ "$got" = "$want" ] && ok "$name" || fail "$name" "got '$got', want '$want'"; }
calls_to() { grep -c -- "$1\$" "$FAKE/calls" 2>/dev/null || true; }

# serve PATH CODES [BODY] [HEADER...]: what the fake answers for PATH.
serve() {
  local key codes
  key=$(tr '/' '_' <<<"$1")
  read -ra codes <<<"$2"
  printf '%s\n' "${codes[@]}" > "$FAKE/site/$key.code"
  printf '%s' "${3:-}" > "$FAKE/site/$key.body"
  shift 3 || shift $#
  { printf 'HTTP/2 200\r\n'; for h in "$@"; do printf '%s\r\n' "$h"; done; } > "$FAKE/site/$key.headers"
}
reset() { rm -rf "$FAKE/site" "$FAKE"/count* "$FAKE/calls"; mkdir -p "$FAKE/site"; }

# A healthy API: shared at abc1234 in ap-south-1, and the edge function's 401.
api() {
  reset
  serve /api/health 200 "{\"status\":\"ok\",\"commit\":\"${1:-abc1234}\",\"region\":\"${2:-ap-south-1}\"}"
  serve /api/v1/users/me 401 '{"detail":"unauthorized"}'
}
SECURITY=("Strict-Transport-Security: max-age=63072000" "Content-Security-Policy: default-src 'self'"
  "X-Content-Type-Options: nosniff" "X-Frame-Options: DENY")
# A healthy web app at commit COMMIT.
web() {
  reset
  serve /version.json 200 "{\"commit\":\"${1:-0123456789abcdef0123456789abcdef01234567}\"}" "Content-Type: application/json"
  serve / 200 '<html><script type="module" crossorigin src="/assets/index-AbC123.js"></script></html>' \
    "Content-Type: text/html" "${SECURITY[@]}"
  serve /assets/index-AbC123.js 200 'console.log(1)' "Content-Type: application/javascript"
  serve /smoke-check/client-route 200 '<html></html>' "Content-Type: text/html"
}
run() { local status=0; OUT=$("$@" 2>&1) || status=$?; return "$status"; }

# -- smoke_fqdn ------------------------------------------------------------------------
check "prod is subdomain.domain" "$(smoke_fqdn prod app example.com)" "app.example.com"
check "other environments are subdomain-env.domain" "$(smoke_fqdn stg app example.com)" "app-stg.example.com"
run smoke_fqdn stg "" example.com && fail "an empty SUBDOMAIN fails" \
  || { [[ "$OUT" == *"SUBDOMAIN and DOMAIN_NAME"* ]] && ok "an empty SUBDOMAIN fails, naming the variables" || fail "empty SUBDOMAIN" "$OUT"; }
run smoke_fqdn prod app "" && fail "an empty DOMAIN_NAME fails" || ok "an empty DOMAIN_NAME fails"

# -- smoke_api -------------------------------------------------------------------------
api
run smoke_api app.example.com abc1234 '["ap-south-1"]' && ok "a healthy API passes" || fail "a healthy API passes" "$OUT"
[[ "$OUT" == *"serves abc1234 (the release just deployed)"* ]] && ok "it says the new release answered" || fail "the new release" "$OUT"

api
run smoke_api app.example.com 0ld0000 '["ap-south-1"]' && fail "a wrong commit in a deployed region fails" \
  || { [[ "$OUT" == *"ap-south-1 serves commit abc1234, want 0ld0000"* ]] && ok "a wrong commit in a deployed region fails, saying so" || fail "wrong commit message" "$OUT"; }
check "it tried SMOKE_TRIES times" "$(calls_to /api/health)" 3
check "it didn't go on to the JWT check" "$(calls_to /api/v1/users/me)" 0

api abc1234 eu-west-1
run smoke_api app.example.com 0ld0000 '["ap-south-1"]' && ok "another region answering isn't checked for the commit" || fail "another region" "$OUT"

api
run smoke_api app.example.com && ok "no expected commit: health and the 401 only" || fail "no expected commit" "$OUT"

api abc1234
run smoke_api app.example.com abc1234def0123456789abcdef0123456789ab '["ap-south-1"]' \
  && ok "a full SHA matches the abbreviated one" || fail "a full SHA matches" "$OUT"

api abc
run smoke_api app.example.com abc '["ap-south-1"]' && fail "commits under 7 characters never match" || ok "commits under 7 characters never match"

api
serve /api/health "502 503 200" '{"status":"ok","commit":"abc1234","region":"ap-south-1"}'
run smoke_api app.example.com abc1234 '["ap-south-1"]' && ok "a 502 then a 200 passes on a retry" || fail "retry" "$OUT"
check "health was asked three times" "$(calls_to /api/health)" 3

api
serve /api/health 200 '{"status":"starting"}'
run smoke_api app.example.com && fail "a health body without status ok fails" || ok "a health body without status ok fails"

api
serve /api/health 000
run smoke_api app.example.com && fail "no answer fails" || { [[ "$OUT" == *"answered 000"* ]] && ok "no answer fails as 000" || fail "no answer" "$OUT"; }

api
serve /api/v1/users/me 200 '{"id":"x"}'
run smoke_api app.example.com && fail "an API open without a token fails" \
  || { [[ "$OUT" == *"answered 200, want 401"* ]] && ok "an API open without a token fails, saying so" || fail "open API message" "$OUT"; }

api
serve /api/v1/users/me 503
run smoke_api app.example.com && fail "a 503 instead of 401 fails" || ok "a 503 instead of 401 fails"
[[ "$OUT" == *"::error::Smoke test failed (JWT check"* ]] && ok "the failure is a GitHub error annotation" || fail "annotation" "$OUT"

# -- smoke_web -------------------------------------------------------------------------
web
run smoke_web app.example.com 0123456789abcdef0123456789abcdef01234567 && ok "a healthy web app passes" || fail "a healthy web app passes" "$OUT"
check "the main script was loaded" "$(calls_to /assets/index-AbC123.js)" 1

web
run smoke_web app.example.com && ok "no expected commit passes" || fail "no expected commit" "$OUT"
check "no expected commit: version.json isn't asked" "$(calls_to /version.json)" 0

web 1111111111111111111111111111111111111111
run smoke_web app.example.com 0123456789abcdef0123456789abcdef01234567 && fail "the old build still live fails" \
  || { [[ "$OUT" == *"the live build is 1111111111111111111111111111111111111111"* ]] && ok "the old build still live fails, saying so" || fail "old build" "$OUT"; }
check "and the page isn't checked after it" "$(grep -c 'example.com/$' "$FAKE/calls" || true)" 0

web
serve /version.json "404 200" '{"commit":"0123456789abcdef0123456789abcdef01234567"}'
run smoke_web app.example.com 0123456789abcdef0123456789abcdef01234567 && ok "version.json not there yet, then there: passes" || fail "version retry" "$OUT"

web
serve / 200 '<html><script src="/assets/index-AbC123.js"></script></html>' "Content-Type: text/html" \
  "Strict-Transport-Security: max-age=1" "X-Content-Type-Options: nosniff" "X-Frame-Options: DENY"
run smoke_web app.example.com && fail "a page without CSP fails" \
  || { [[ "$OUT" == *"no content-security-policy header"* ]] && ok "a page without CSP fails, naming it" || fail "csp" "$OUT"; }

web
serve / 200 '<html></html>' "Content-Type: text/html; charset=utf-8" "${SECURITY[@]}"
run smoke_web app.example.com && fail "a page naming no script fails" || ok "a page naming no script fails"

web
serve /assets/index-AbC123.js 404
run smoke_web app.example.com && fail "a missing main script fails" \
  || { [[ "$OUT" == *"GET /assets/index-AbC123.js answered 404"* ]] && ok "a missing main script fails, saying so" || fail "script" "$OUT"; }

web
serve /assets/index-AbC123.js 200 '<html>' "Content-Type: text/html"
run smoke_web app.example.com && fail "a script served as HTML fails" || ok "a script served as HTML fails"

web
serve /smoke-check/client-route 404
run smoke_web app.example.com && fail "a client route that 404s fails" || ok "a client route that 404s fails"

web
serve / 200 '<html></html>' "content-type: text/html" "${SECURITY[@]}"
check "header names are case-insensitive" "$(mkdir -p "$WORK/h"; _smoke_get https://app.example.com/ "$WORK/h" >/dev/null; _smoke_header "$WORK/h" Content-Type)" "text/html"

# -- what's sent ---------------------------------------------------------------------------
api
smoke_api app.example.com >/dev/null 2>&1 || true
web
smoke_web app.example.com >/dev/null 2>&1 || true
grep -qE -- '(^| )(-H|--header|-u|--user|-b|--cookie)( |$)' "$FAKE/calls" && fail "every request is anonymous" || ok "every request is anonymous"
grep -qv -- "--proto =https" "$FAKE/calls" && fail "every request is HTTPS only" || ok "every request is HTTPS only"

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
