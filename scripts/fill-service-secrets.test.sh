#!/usr/bin/env bash
# SC2015: `cond && ok || fail` is intended — ok/fail only echo and count.
# shellcheck disable=SC2015
# Tests for scripts/fill-service-secrets.sh against a fake `aws` on PATH — no AWS
# access needed, and only fake values. Run: bash scripts/fill-service-secrets.test.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export FAKE="$WORK/fake"
mkdir -p "$FAKE/bin" "$FAKE/secrets"

# -- fake aws ------------------------------------------------------------------
# A secret is $FAKE/secrets/<last part of its ARN>; put-secret-value overwrites it
# and logs the ARN to $FAKE/puts.
cat > "$FAKE/bin/aws" <<'EOF'
#!/usr/bin/env bash
arg() { local want="$1"; shift; while [ $# -gt 0 ]; do [ "$1" = "$want" ] && { echo "$2"; return; }; shift; done; }
f="$FAKE/secrets/$(arg --secret-id "$@" | sed 's/.*://')"
case "$1 $2" in
  "secretsmanager get-secret-value") [ -f "$f" ] && cat "$f" || { echo "ResourceNotFoundException" >&2; exit 254; } ;;
  "secretsmanager put-secret-value") printf '%s' "$(arg --secret-string "$@")" > "$f"; arg --secret-id "$@" >> "$FAKE/puts" ;;
  *) echo "fake aws: unexpected call: $*" >&2; exit 1 ;;
esac
EOF
chmod +x "$FAKE/bin/aws"
export PATH="$FAKE/bin:$PATH"

# shellcheck source=scripts/fill-service-secrets.sh
source "$HERE/fill-service-secrets.sh"

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok   - $1"; }
fail() { FAIL=$((FAIL + 1)); echo "FAIL - $1${2:+: $2}"; }
check() { local name="$1" got="$2" want="$3"; [ "$got" = "$want" ] && ok "$name" || fail "$name" "got '$got', want '$want'"; }

ARNS='{"auth":"arn:aws:secretsmanager:ap-south-1:1:secret:auth","grow":"arn:aws:secretsmanager:ap-south-1:1:secret:grow","shared":"arn:aws:secretsmanager:ap-south-1:1:secret:shared"}'
placeholders() {
  rm -f "$FAKE/puts"
  echo '{"MONGODB_URI":"REPLACE_ME","JWT_PRIVATE_KEY":"REPLACE_ME","GOOGLE_CLIENT_ID":"REPLACE_ME","EMAIL_HMAC_PEPPER":"REPLACE_ME"}' > "$FAKE/secrets/auth"
  echo '{"MONGODB_URI":"REPLACE_ME","OPENAI_API_KEY":"REPLACE_ME","ANTHROPIC_API_KEY":"REPLACE_ME","GEMINI_API_KEY":"REPLACE_ME"}' > "$FAKE/secrets/grow"
  echo '{"OPENAI_API_KEY":"REPLACE_ME"}' > "$FAKE/secrets/shared"
}
export MONGODB_URIS='{"auth":"mongodb+srv://auth-user@test","grow":"mongodb+srv://grow-user@test"}'
export JWT_PRIVATE_KEY="fake-private-key" EMAIL_HMAC_PEPPER="fake-pepper" GOOGLE_CLIENT_ID="fake-client" OPENAI_API_KEY="fake-openai"
unset ANTHROPIC_API_KEY GEMINI_API_KEY

# -- first apply ---------------------------------------------------------------
placeholders
out=$(fill_service_secrets "$ARNS" 2>&1)
check "auth gets its own keys" "$(jq -c . "$FAKE/secrets/auth")" '{"MONGODB_URI":"mongodb+srv://auth-user@test","JWT_PRIVATE_KEY":"fake-private-key","GOOGLE_CLIENT_ID":"fake-client","EMAIL_HMAC_PEPPER":"fake-pepper"}'
check "each service gets its own MONGODB_URI; an unset LLM key stays REPLACE_ME" "$(jq -c . "$FAKE/secrets/grow")" '{"MONGODB_URI":"mongodb+srv://grow-user@test","OPENAI_API_KEY":"fake-openai","ANTHROPIC_API_KEY":"REPLACE_ME","GEMINI_API_KEY":"REPLACE_ME"}'
check "shared, with no database, needs no MONGODB_URI" "$(jq -c . "$FAKE/secrets/shared")" '{"OPENAI_API_KEY":"fake-openai"}'
[[ "$out" != *fake-* && "$out" != *mongodb* ]] && ok "no value is printed" || fail "no value is printed" "$out"

# -- later applies ---------------------------------------------------------------
rm -f "$FAKE/puts"
echo '{"MONGODB_URI":"rotated","JWT_PRIVATE_KEY":"rotated","GOOGLE_CLIENT_ID":"","EMAIL_HMAC_PEPPER":"rotated"}' > "$FAKE/secrets/auth"
out=$(fill_service_secrets "$ARNS" 2>&1)
check "a filled secret is never overwritten" "$(jq -r .JWT_PRIVATE_KEY "$FAKE/secrets/auth")" "rotated"
check "nothing is written when nothing needs it (optional LLM keys still REPLACE_ME)" "$(cat "$FAKE/puts" 2>/dev/null || echo none)" "none"
[[ "$out" == *"auth: already set"* ]] && ok "says which secrets it left alone" || fail "left-alone message" "$out"

echo '{"MONGODB_URI":"REPLACE_ME","OPENAI_API_KEY":"x","ANTHROPIC_API_KEY":"y","GEMINI_API_KEY":"z"}' > "$FAKE/secrets/grow"
fill_service_secrets "$ARNS" >/dev/null 2>&1
check "a required key still REPLACE_ME refills that secret only" "$(sed 's/.*://' "$FAKE/puts" | paste -sd, -)" "grow"

# -- missing values -----------------------------------------------------------------
placeholders
if out=$(MONGODB_URIS='{"auth":"mongodb+srv://auth-user@test"}' fill_service_secrets "$ARNS" 2>&1); then fail "a missing MONGODB_URIS entry is an error"; else
  [[ "$out" == *"MONGODB_URIS has no entry for 'grow'"* ]] && ok "a missing MONGODB_URIS entry names the service" || fail "missing entry message" "$out"
  check "nothing is written when any secret can't be built" "$(cat "$FAKE/puts" 2>/dev/null || echo none)" "none"
fi
placeholders
if out=$(EMAIL_HMAC_PEPPER="" fill_service_secrets "$ARNS" 2>&1); then fail "a missing pepper is an error"; else
  [[ "$out" == *"EMAIL_HMAC_PEPPER is not set (needed by auth)"* ]] && ok "a missing required value names it" || fail "missing value message" "$out"; fi
placeholders
echo '{"NEW_KEY":"REPLACE_ME"}' > "$FAKE/secrets/shared"
if out=$(fill_service_secrets "$ARNS" 2>&1); then fail "an unknown key is an error"; else
  [[ "$out" == *"doesn't know: NEW_KEY"* ]] && ok "an unknown key says where to add it" || fail "unknown key message" "$out"; fi

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
