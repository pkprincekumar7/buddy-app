#!/usr/bin/env bash
# Publishing a frontend build to its S3 bucket and CloudFront, for deploy-live-frontend.yml
# and promote-live-frontend.yml (production-readiness review, CI-07). Source it, then call
# the functions:
#
#   source scripts/frontend-publish.sh
#   publish_files frontend/dist "$BUCKET"
#   invalidate "$DISTRIBUTION_ID" frontend/dist      # prints the invalidation id
#   prune_assets frontend/dist "$BUCKET" 30
#
# A deploy must never break a page that's already open, or the next page load:
# - assets/ (Vite's hashed JS and CSS) is synced WITHOUT --delete. The live index.html
#   names the current chunks until the new one replaces it, and a tab opened before the
#   deploy keeps loading the old ones (lazy routes).
# - Everything else (index.html, manifest, fonts, sounds) goes up afterwards, with --delete,
#   so index.html only ever points at chunks that are already there.
# - Only those unhashed files are invalidated. A hashed file never changes, so purging it
#   only costs cache hits; app routes are all cached as /index.html (the spa_rewrite
#   function rewrites them before the cache lookup).
# - Old chunks are pruned after a successful deploy: only ones the new build doesn't use
#   AND that are older than the given number of days.
#
# Tested against a fake aws CLI: scripts/frontend-publish.test.sh.

set -uo pipefail

# publish_files DIST BUCKET: hashed assets first (kept), then the rest (mirrored).
publish_files() {
  local dist="$1" bucket="$2"
  aws s3 sync "$dist/assets/" "s3://$bucket/assets/" \
    --cache-control "public,max-age=31536000,immutable" || return 1
  aws s3 sync "$dist/" "s3://$bucket/" \
    --exclude "assets/*" \
    --cache-control "no-cache,no-store,must-revalidate" \
    --delete || return 1
}

# invalidation_paths DIST: one CloudFront path per unhashed file, plus "/".
invalidation_paths() {
  local dist="$1"
  echo "/"
  (cd "$dist" && find . -type f -not -path './assets/*' -not -name '.DS_Store' | sed 's#^\./#/#' | sort)
}

# invalidate DISTRIBUTION_ID DIST: invalidates the unhashed files; prints the invalidation id.
invalidate() {
  local distribution="$1" dist="$2" paths
  paths=()
  while IFS= read -r path; do paths+=("$path"); done < <(invalidation_paths "$dist")
  aws cloudfront create-invalidation --distribution-id "$distribution" \
    --paths "${paths[@]}" --query "Invalidation.Id" --output text
}

# cutoff_date DAYS: the UTC timestamp DAYS ago, as S3 prints LastModified (GNU or BSD date).
cutoff_date() {
  local days="$1"
  date -u -d "$days days ago" +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -u -v-"$days"d +%Y-%m-%dT%H:%M:%S
}

# prune_assets DIST BUCKET DAYS: deletes assets/ objects the build in DIST doesn't contain
# and that were last written more than DAYS ago. Prints how many it deleted.
prune_assets() {
  local dist="$1" bucket="$2" days="$3" cutoff current listing stale
  [[ "$days" =~ ^[0-9]+$ ]] || { echo "ERROR: prune_assets: DAYS must be a whole number." >&2; return 1; }
  cutoff=$(cutoff_date "$days") || return 1
  current=$(cd "$dist/assets" && find . -type f | sed 's#^\./#assets/#' | jq -R . | jq -sc .) || return 1
  listing=$(aws s3api list-objects-v2 --bucket "$bucket" --prefix assets/ --output json) || return 1
  # LastModified is ISO 8601 (UTC); its first 19 characters compare as text.
  stale=$(jq -c --argjson current "$current" --arg cutoff "$cutoff" '
    [(.Contents // [])[]
      | select((.Key as $k | $current | index($k)) | not)
      | select(.LastModified[0:19] < $cutoff)
      | {Key}]' <<<"$listing") || return 1
  local count
  count=$(jq length <<<"$stale")
  # delete-objects takes at most 1000 keys a call.
  local i
  for ((i = 0; i < count; i += 1000)); do
    aws s3api delete-objects --bucket "$bucket" \
      --delete "$(jq -c --argjson i "$i" '{Objects: .[$i:$i + 1000], Quiet: true}' <<<"$stale")" \
      >/dev/null || return 1
  done
  echo "$count"
}
