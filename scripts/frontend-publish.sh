#!/usr/bin/env bash
# Publishing a frontend build to its S3 bucket and CloudFront, for deploy-live-frontend.yml
# and promote-live-frontend.yml (production-readiness review, CI-07). Source it, then call
# the functions:
#
#   source scripts/frontend-publish.sh
#   publish_files frontend/dist "$BUCKET"
#   save_release frontend/dist "$BUCKET" "$GIT_SHA"  # kept for rollback-live-frontend.yml
#   invalidate "$DISTRIBUTION_ID" frontend/dist      # prints the invalidation id
#   prune_releases "$BUCKET"                         # keeps the last RELEASES_KEPT
#   prune_assets frontend/dist "$BUCKET" 30
#
# And to roll back (rollback-live-frontend.yml), with no rebuild:
#
#   restore_release "$BUCKET" "$GIT_SHA" restored    # the release's files, into restored/
#   publish_unhashed restored "$BUCKET"
#   invalidate "$DISTRIBUTION_ID" restored
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
# - Old chunks are pruned after a successful deploy: only ones the new build doesn't use,
#   no kept release uses, AND that are older than the given number of days.
# - Each build's unhashed files are also kept under releases/<sha>/, with the list of the
#   chunks it uses (release-assets.json), for the last RELEASES_KEPT builds. A rollback
#   copies one back over the root: its chunks are still there, since pruning keeps them
#   (production-readiness review, CI-07, fix 4). A release is about 450 KB.
#
# Tested against a fake aws CLI: scripts/frontend-publish.test.sh.

set -uo pipefail

RELEASES_KEPT=10
RELEASE_ASSETS="release-assets.json"

# publish_files DIST BUCKET: hashed assets first (kept), then the rest (mirrored).
publish_files() {
  local dist="$1" bucket="$2"
  aws s3 sync "$dist/assets/" "s3://$bucket/assets/" \
    --cache-control "public,max-age=31536000,immutable" || return 1
  publish_unhashed "$dist" "$bucket"
}

# publish_unhashed DIST BUCKET: index.html and the other unhashed files, mirrored at the
# root (assets/ and the kept releases left alone).
publish_unhashed() {
  local dist="$1" bucket="$2"
  aws s3 sync "$dist/" "s3://$bucket/" \
    --exclude "assets/*" \
    --exclude "releases/*" \
    --exclude ".DS_Store" \
    --cache-control "no-cache,no-store,must-revalidate" \
    --delete || return 1
}

_check_sha() {
  [[ "$1" =~ ^[0-9a-f]{40}$ ]] && return 0
  echo "ERROR: '$1' isn't a 40-character commit SHA." >&2
  return 1
}

# build_assets DIST: the build's chunks, as a JSON array of keys (assets/...).
build_assets() {
  (cd "$1/assets" && find . -type f | sed 's#^\./#assets/#' | sort | jq -R . | jq -sc .)
}

# save_release DIST BUCKET SHA: keeps DIST's unhashed files under releases/SHA/, with the
# list of its chunks, so rollback-live-frontend can restore this build later.
save_release() {
  local dist="$1" bucket="$2" sha="$3"
  _check_sha "$sha" || return 1
  aws s3 sync "$dist/" "s3://$bucket/releases/$sha/" \
    --exclude "assets/*" \
    --exclude ".DS_Store" \
    --delete || return 1
  build_assets "$dist" | aws s3 cp - "s3://$bucket/releases/$sha/$RELEASE_ASSETS" \
    --content-type application/json || return 1
}

# saved_releases BUCKET: the SHAs with a saved release, newest first (by their list's date).
saved_releases() {
  local listing
  listing=$(aws s3api list-objects-v2 --bucket "$1" --prefix releases/ --output json) || return 1
  jq -r --arg name "$RELEASE_ASSETS" '
    [(.Contents // [])[] | select(.Key | endswith("/" + $name))]
    | sort_by(.LastModified) | reverse | .[].Key | split("/")[1]' <<<"$listing"
}

# previous_release BUCKET CURRENT: the newest saved release that isn't CURRENT (the
# deployed SHA): what a rollback restores when it isn't given one. Fails if there's none.
previous_release() {
  local sha
  sha=$(saved_releases "$1" | grep -vxF -- "$2" | head -n 1) || true
  if [ -z "$sha" ]; then
    echo "ERROR: no earlier saved release in $1 to roll back to." >&2
    return 1
  fi
  printf '%s\n' "$sha"
}

# release_assets BUCKET SHA...: every chunk those releases use, as one JSON array.
release_assets() {
  local bucket="$1" sha lists="[]" list
  shift
  for sha in "$@"; do
    list=$(aws s3 cp "s3://$bucket/releases/$sha/$RELEASE_ASSETS" -) || return 1
    lists=$(jq -c --argjson more "$list" '. + $more | unique' <<<"$lists") || return 1
  done
  printf '%s\n' "$lists"
}

# prune_releases BUCKET [KEEP]: deletes every saved release but the newest KEEP
# (RELEASES_KEPT). Prints how many it deleted.
prune_releases() {
  local bucket="$1" keep="${2:-$RELEASES_KEPT}" old listing keys count i
  [[ "$keep" =~ ^[1-9][0-9]*$ ]] || { echo "ERROR: prune_releases: KEEP must be at least 1." >&2; return 1; }
  old=$(saved_releases "$bucket" | tail -n +"$((keep + 1))" | jq -R . | jq -sc .) || return 1
  listing=$(aws s3api list-objects-v2 --bucket "$bucket" --prefix releases/ --output json) || return 1
  keys=$(jq -c --argjson old "$old" '
    [(.Contents // [])[] | select((.Key | split("/")[1]) as $sha | $old | index($sha)) | {Key}]' <<<"$listing") || return 1
  count=$(jq length <<<"$keys")
  for ((i = 0; i < count; i += 1000)); do
    aws s3api delete-objects --bucket "$bucket" \
      --delete "$(jq -c --argjson i "$i" '{Objects: .[$i:$i + 1000], Quiet: true}' <<<"$keys")" \
      >/dev/null || return 1
  done
  jq length <<<"$old"
}

# restore_release BUCKET SHA DIR: the saved release's unhashed files into DIR, after
# checking every chunk it uses is still in the bucket. Then publish_unhashed DIR.
restore_release() {
  local bucket="$1" sha="$2" dir="$3" needed present missing
  _check_sha "$sha" || return 1
  if ! needed=$(aws s3 cp "s3://$bucket/releases/$sha/$RELEASE_ASSETS" - 2>/dev/null); then
    echo "ERROR: no saved release for $sha in $bucket (only the last $RELEASES_KEPT are kept)." >&2
    return 1
  fi
  present=$(aws s3api list-objects-v2 --bucket "$bucket" --prefix assets/ --output json \
    | jq -c '[(.Contents // [])[].Key]') || return 1
  missing=$(jq -r --argjson present "$present" '[.[] | select(. as $k | $present | index($k) | not)] | join(", ")' <<<"$needed")
  if [ -n "$missing" ]; then
    echo "ERROR: release $sha needs chunks that are gone: $missing" >&2
    return 1
  fi
  aws s3 sync "s3://$bucket/releases/$sha/" "$dir/" --exclude "$RELEASE_ASSETS" || return 1
  [ -f "$dir/index.html" ] || { echo "ERROR: release $sha has no index.html." >&2; return 1; }
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

# prune_assets DIST BUCKET DAYS: deletes assets/ objects that neither the build in DIST nor
# any kept release uses, and that were last written more than DAYS ago. Prints how many
# it deleted.
prune_assets() {
  local dist="$1" bucket="$2" days="$3" cutoff current kept listing stale releases
  [[ "$days" =~ ^[0-9]+$ ]] || { echo "ERROR: prune_assets: DAYS must be a whole number." >&2; return 1; }
  cutoff=$(cutoff_date "$days") || return 1
  current=$(build_assets "$dist") || return 1
  releases=()
  while IFS= read -r sha; do [ -n "$sha" ] && releases+=("$sha"); done < <(saved_releases "$bucket")
  kept=$(release_assets "$bucket" ${releases[@]+"${releases[@]}"}) || return 1
  current=$(jq -c --argjson kept "$kept" '. + $kept | unique' <<<"$current") || return 1
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
