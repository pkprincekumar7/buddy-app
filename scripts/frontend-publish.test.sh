#!/usr/bin/env bash
# SC2015: `cond && ok || fail` is intended — ok/fail only echo and count.
# shellcheck disable=SC2015
# Tests for scripts/frontend-publish.sh against a fake `aws` on PATH — no AWS access
# needed. Run: bash scripts/frontend-publish.test.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export FAKE="$WORK/fake"
mkdir -p "$FAKE/bin"

# -- fake aws ------------------------------------------------------------------
# Logs every call (one per line) to $FAKE/calls; list-objects-v2 answers from
# $FAKE/listing.json; delete-objects keeps each --delete payload in $FAKE/deleted-N.json.
cat > "$FAKE/bin/aws" <<'EOF'
#!/usr/bin/env bash
echo "$*" >> "$FAKE/calls"
arg() { local want="$1"; shift; while [ $# -gt 0 ]; do [ "$1" = "$want" ] && { echo "$2"; return; }; shift; done; }
case "$1 $2" in
  "s3 sync") ;;
  "cloudfront create-invalidation") echo "I123" ;;
  "s3api list-objects-v2") cat "$FAKE/listing.json" ;;
  "s3api delete-objects")
    n=$(ls "$FAKE"/deleted-*.json 2>/dev/null | wc -l | tr -d ' ')
    arg --delete "$@" > "$FAKE/deleted-$n.json" ;;
  *) echo "fake aws: unexpected call: $*" >&2; exit 1 ;;
esac
EOF
chmod +x "$FAKE/bin/aws"
export PATH="$FAKE/bin:$PATH"

# shellcheck source=scripts/frontend-publish.sh
source "$HERE/frontend-publish.sh"

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok   - $1"; }
fail() { FAIL=$((FAIL + 1)); echo "FAIL - $1${2:+: $2}"; }
check() { local name="$1" got="$2" want="$3"; [ "$got" = "$want" ] && ok "$name" || fail "$name" "got '$got', want '$want'"; }
reset() { rm -f "$FAKE"/calls "$FAKE"/deleted-*.json; }

# A build: two hashed chunks, index.html and other unhashed files.
DIST="$WORK/dist"
mkdir -p "$DIST/assets" "$DIST/fonts"
touch "$DIST/assets/index-new1.js" "$DIST/assets/index-new2.css" "$DIST/index.html" \
  "$DIST/manifest.json" "$DIST/fonts/a.woff2" "$DIST/.DS_Store"

# -- publish_files -----------------------------------------------------------------
reset
publish_files "$DIST" bucket
first=$(sed -n 1p "$FAKE/calls")
second=$(sed -n 2p "$FAKE/calls")
[[ "$first" == "s3 sync $DIST/assets/ s3://bucket/assets/"* ]] && ok "assets go up first" || fail "assets go up first" "$first"
[[ "$first" != *"--delete"* ]] && ok "old chunks are kept (no --delete on assets/)" || fail "no --delete on assets/" "$first"
[[ "$first" == *"immutable"* ]] && ok "hashed assets are cached for a year" || fail "asset cache header" "$first"
[[ "$second" == *"--exclude assets/*"* && "$second" == *"--delete"* && "$second" == *"no-store"* ]] \
  && ok "then the rest, mirrored and not cached" || fail "the rest" "$second"

# -- invalidation_paths / invalidate -------------------------------------------------
check "only unhashed files are invalidated" "$(invalidation_paths "$DIST" | paste -sd, -)" \
  "/,/fonts/a.woff2,/index.html,/manifest.json"
reset
check "invalidate prints the invalidation id" "$(invalidate DIST1 "$DIST")" "I123"
call=$(cat "$FAKE/calls")
[[ "$call" == *"--paths / /fonts/a.woff2 /index.html /manifest.json --query"* && "$call" != *"/*"* ]] \
  && ok "no /* invalidation" || fail "invalidation paths" "$call"

# -- prune_assets ------------------------------------------------------------------
old=$(cutoff_date 60)
recent=$(cutoff_date 1)
cat > "$FAKE/listing.json" <<EOF
{"Contents": [
  {"Key": "assets/index-new1.js", "LastModified": "${old}.000Z"},
  {"Key": "assets/index-old.js", "LastModified": "${old}.000Z"},
  {"Key": "assets/index-yesterday.js", "LastModified": "${recent}.000Z"}
]}
EOF
reset
check "deletes only unused chunks older than the cut-off" "$(prune_assets "$DIST" bucket 30)" "1"
check "the deleted one is the old unused chunk" "$(jq -c '.Objects' "$FAKE/deleted-0.json")" '[{"Key":"assets/index-old.js"}]'
echo '{}' > "$FAKE/listing.json"
reset
check "an empty bucket deletes nothing" "$(prune_assets "$DIST" bucket 30)" "0"
[ ! -e "$FAKE/deleted-0.json" ] && ok "and calls delete-objects for nothing" || fail "no delete call for nothing"
if prune_assets "$DIST" bucket "x" >/dev/null 2>&1; then fail "a bad DAYS is refused"; else ok "a bad DAYS is refused"; fi

# 1,500 stale chunks: two delete-objects calls (1,000 is the API's maximum).
jq -n --arg m "${old}.000Z" '{Contents: [range(1500) | {Key: "assets/gone-\(.).js", LastModified: $m}]}' > "$FAKE/listing.json"
reset
check "a large prune is batched" "$(prune_assets "$DIST" bucket 30)" "1500"
check "in two calls of at most 1,000" "$(jq '.Objects | length' "$FAKE"/deleted-0.json "$FAKE"/deleted-1.json | paste -sd, -)" "1000,500"

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
