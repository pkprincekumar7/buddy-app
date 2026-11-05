#!/usr/bin/env bash
# shellcheck shell=bash
#
# Shared helpers for the deploy / restart / promote backend workflows (TF-01).
# Source it:  source scripts/ecs-services.sh
#
# The list of ECS services comes from the SSM parameter terraform-live-backend
# writes — /<app>/<env>/backend/<region>/ecs_services, a JSON array (in
# deploy_order) of { name, service, family, container, image_service,
# ecr_repository_url } (see infra-live-backend/terraform/services.tf): a worker's
# image_service and repository are its service's, the collector's are empty. So
# adding a service in Terraform needs no workflow logic change: these helpers
# loop over whatever is listed.
#
# Needs: aws (credentials configured), jq. All SSM reads go to us-east-1 (the
# control-plane region), whatever region the services run in.
#
# Tests: scripts/ecs-services.test.sh (runs against a fake `aws`).

# get_ssm NAME → the parameter's value, or "" if it doesn't exist.
get_ssm() {
  aws ssm get-parameter --region us-east-1 --name "$1" --query "Parameter.Value" --output text 2>/dev/null || true
}

# resolve_services SSM_BASE SELECTION → JSON array of the selected services, in
# deploy_order (services.tf) — the order they're listed in. SSM_BASE is /<app>/<env>/backend/<region>. SELECTION is "all"
# or a comma-separated list of service names (e.g. "users,users-worker"); unknown
# names are an error that lists the valid ones.
resolve_services() {
  local base="$1" selection="${2:-all}" manifest
  manifest=$(get_ssm "$base/ecs_services")
  if [ -z "$manifest" ] || ! jq -e 'type == "array" and length > 0' <<<"$manifest" >/dev/null 2>&1; then
    echo "ERROR: $base/ecs_services not found in SSM (or empty). Run the terraform-live-backend workflow (apply) for this environment and region first." >&2
    return 1
  fi
  if [ "$selection" = "all" ]; then
    jq -c '.' <<<"$manifest"
    return 0
  fi
  local wanted unknown
  wanted=$(jq -Rc 'split(",") | map(gsub("^\\s+|\\s+$"; "")) | map(select(length > 0)) | unique' <<<"$selection")
  unknown=$(jq -rn --argjson w "$wanted" --argjson m "$manifest" '[$w[] | select(. as $n | [$m[].name] | index($n) | not)] | join(", ")')
  if [ -n "$unknown" ]; then
    echo "ERROR: unknown service(s): $unknown. Valid: all, $(jq -r '[.[].name] | join(", ")' <<<"$manifest")." >&2
    return 1
  fi
  if [ "$(jq 'length' <<<"$wanted")" -eq 0 ]; then
    echo "ERROR: no service selected. Valid: all, $(jq -r '[.[].name] | join(", ")' <<<"$manifest")." >&2
    return 1
  fi
  # Keep the manifest's deploy_order, not the order they were typed in.
  jq -c --argjson w "$wanted" '[.[] | select(.name as $n | $w | index($n))]' <<<"$manifest"
}

# image_runtimes SERVICES_JSON [SELECTION] → the entries of SERVICES_JSON that run
# one of the app's own images (image_service set): what deploy and promote can
# roll out. The collector runs a public image Terraform pins
# (otel_collector_image), so "all" leaves it out, and naming it is an error.
image_runtimes() {
  local services="$1" selection="${2:-all}" pinned runtimes
  pinned=$(jq -r '[.[] | select((.image_service // "") == "") | .name] | join(", ")' <<<"$services")
  if [ -n "$pinned" ] && [ "$selection" != "all" ]; then
    echo "ERROR: $pinned runs an image Terraform pins (otel_collector_image), not one these workflows build. Change it in Terraform, apply, then run restart-live-backend." >&2
    return 1
  fi
  runtimes=$(jq -c '[.[] | select((.image_service // "") != "")]' <<<"$services")
  if [ "$(jq 'length' <<<"$runtimes")" -eq 0 ]; then
    echo "ERROR: none of the selected services runs an image these workflows build." >&2
    return 1
  fi
  printf '%s\n' "$runtimes"
}

# image_services SERVICES_JSON → JSON array of the distinct image_service values,
# in order: the images to build (a worker shares its service's).
image_services() {
  jq -c '[.[].image_service | select(. != null and . != "")] | reduce .[] as $s ([]; if index($s) then . else . + [$s] end)' <<<"$1"
}

# repository_for SERVICES_JSON IMAGE_SERVICE → that service's ECR repository URL
# from the manifest, or an error if no entry has it.
repository_for() {
  local repo
  repo=$(jq -r --arg s "$2" '[.[] | select(.image_service == $s) | .ecr_repository_url][0] // ""' <<<"$1")
  if [ -z "$repo" ]; then
    echo "ERROR: no ECR repository for '$2' in the ecs_services list. Run the terraform-live-backend workflow (apply) for this environment and region first." >&2
    return 1
  fi
  printf '%s\n' "$repo"
}

# -- the scanned marker (production-readiness review, CI-03) -------------------
# deploy-live-backend scans each image it builds (Trivy, HIGH/CRITICAL) before
# pushing it, then gives that same image a second tag, <tag>-scanned. Promote
# moves an image only if its source has the marker on the same digest, and
# copies the marker along, so prod only ever runs an image a scan passed.
# Tags are IMMUTABLE and the "keep 30" lifecycle rule counts images, not tags.
SCANNED_SUFFIX="-scanned"

# image_digest REGION REPO_NAME TAG → the image's digest (sha256:…), or "" if
# the tag isn't in the repository.
image_digest() {
  aws ecr describe-images --region "$1" --repository-name "$2" --image-ids imageTag="$3" \
    --query 'imageDetails[0].imageDigest' --output text 2>/dev/null | grep '^sha256:' || true
}

# is_scanned REGION REPO_NAME TAG — true when TAG-scanned exists and is the
# same image as TAG.
is_scanned() {
  local digest marker
  digest=$(image_digest "$1" "$2" "$3")
  marker=$(image_digest "$1" "$2" "$3$SCANNED_SUFFIX")
  [ -n "$digest" ] && [ "$digest" = "$marker" ]
}

# mark_scanned REGION REPO_NAME TAG — add TAG-scanned to the image TAG names,
# by copying its manifest (no push, so the digest is the same by construction).
# The manifest goes through a file, byte for byte: $(…) would drop a trailing
# newline and so change the digest.
mark_scanned() {
  local region="$1" repo="$2" tag="$3" image media file rc=0
  is_scanned "$region" "$repo" "$tag" && return 0
  image=$(aws ecr batch-get-image --region "$region" --repository-name "$repo" --image-ids imageTag="$tag" \
    --query 'images[0].{manifest: imageManifest, media: imageManifestMediaType}' --output json) || return 1
  if ! jq -e '.manifest | type == "string"' <<<"$image" >/dev/null; then
    echo "ERROR: $repo:$tag isn't in ECR ($region), so it can't be marked scanned." >&2
    return 1
  fi
  media=$(jq -r '.media // empty' <<<"$image")
  file=$(mktemp)
  jq -j '.manifest' <<<"$image" > "$file"
  aws ecr put-image --region "$region" --repository-name "$repo" --image-tag "$tag$SCANNED_SUFFIX" \
    --image-manifest "file://$file" ${media:+--image-manifest-media-type "$media"} >/dev/null || rc=1
  rm -f "$file"
  [ "$rc" -eq 0 ] && is_scanned "$region" "$repo" "$tag"
}

# -- promoting by digest (production-readiness review, CI-09) --------------------
# promote-live-backend copies each image registry to registry with crane, so the
# target runs the exact digest the source scanned; no image moves through artifacts.

# ecr_login REGION HOST...: crane signed in to each ECR registry HOST with one ECR
# token for the current role (valid for any registry the role may read or write). The
# token goes through stdin only, never an argument or the log.
ecr_login() {
  local region="$1" password host
  shift
  password=$(aws ecr get-login-password --region "$region") || return 1
  for host in $(printf '%s\n' "$@" | sort -u); do
    crane auth login "$host" -u AWS --password-stdin <<<"$password" >/dev/null || return 1
  done
}

# copy_image REGION SOURCE REPO REPO_NAME TAG: copies SOURCE (<repo>@sha256:...) to
# REPO:TAG in the target, unless TAG is already that very image; fails if TAG holds
# another one, or if the copy didn't keep the digest.
copy_image() {
  local region="$1" source="$2" repo="$3" repo_name="$4" tag="$5" want got
  want="${source##*@}"
  if [[ ! "$want" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    echo "ERROR: $source isn't pinned to a digest." >&2
    return 1
  fi
  got=$(image_digest "$region" "$repo_name" "$tag")
  if [ -n "$got" ]; then
    if [ "$got" != "$want" ]; then
      echo "ERROR: $repo:$tag is already in the target as $got, not $want: another build of the same tag. Deploy a new release to the source, then promote that." >&2
      return 1
    fi
    echo "$repo:$tag is already $want in the target."
    return 0
  fi
  crane copy "$source" "$repo:$tag" || return 1
  got=$(image_digest "$region" "$repo_name" "$tag")
  if [ "$got" != "$want" ]; then
    echo "ERROR: $repo:$tag was copied as ${got:-nothing}, not $want." >&2
    return 1
  fi
  echo "Copied $source to $repo:$tag."
}

# register_with_image FAMILY CONTAINER IMAGE → ARN of a new revision of FAMILY
# that is the current one with CONTAINER's image swapped for IMAGE. Everything
# else (env vars, secrets refs, CPU/memory, logging, sidecars) is kept exactly
# as Terraform last registered it.
register_with_image() {
  local family="$1" container="$2" image="$3" current new_json
  current=$(aws ecs describe-task-definition --task-definition "$family" --query 'taskDefinition' --output json) || return 1
  if ! jq -e --arg c "$container" 'any(.containerDefinitions[]; .name == $c)' <<<"$current" >/dev/null; then
    echo "ERROR: task definition $family has no container named '$container'." >&2
    return 1
  fi
  # Strip read-only fields that register-task-definition rejects.
  new_json=$(jq --arg c "$container" --arg img "$image" '
    del(.taskDefinitionArn, .revision, .status, .requiresAttributes,
        .compatibilities, .registeredAt, .registeredBy, .deregisteredAt)
    | .containerDefinitions = [.containerDefinitions[] | if .name == $c then .image = $img else . end]' <<<"$current")
  aws ecs register-task-definition --cli-input-json "$new_json" --query 'taskDefinition.taskDefinitionArn' --output text
}

# live_image CLUSTER SERVICE CONTAINER → the image CONTAINER runs in SERVICE's
# deployment — what's actually running, not a stored tag. Only a finished
# rollout counts: the service must have one deployment, PRIMARY and COMPLETED.
# PRIMARY alone means "newest", which mid-rollout may still fail and be rolled
# back (production-readiness review, CI-14).
live_image() {
  local cluster="$1" service="$2" container="$3" info td image
  info=$(aws ecs describe-services --cluster "$cluster" --services "$service" --query 'services[0]' --output json) || return 1
  if ! td=$(jq -er '.deployments | select(length == 1) | .[0]
      | select(.status == "PRIMARY" and .rolloutState == "COMPLETED") | .taskDefinition' <<<"$info" 2>/dev/null); then
    echo "ERROR: $service isn't settled on one completed deployment (now: $(jq -r '[.deployments[]? | "\(.status)/\(.rolloutState)"] | join(", ") | if . == "" then "none" else . end' <<<"$info")). Promote it once its rollout has finished." >&2
    return 1
  fi
  image=$(aws ecs describe-task-definition --task-definition "$td" \
    --query "taskDefinition.containerDefinitions[?name=='$container'].image | [0]" --output text)
  if [ -z "$image" ] || [ "$image" = "None" ]; then
    echo "ERROR: task definition $td has no container named '$container'." >&2
    return 1
  fi
  printf '%s\n' "$image"
}

# same_release IMAGES_JSON... — promote's per-region exports (each a file of
# [{name, image, image_service}]) must list the same services at the same tags,
# or the target's regions would get different releases (CI-14). Each file's
# directory name labels it in the error (promote-images-<region>). The
# registry part of an image differs per region (ECR is regional), so only the
# tag is compared: deploy-live-backend pushes one build under one tag everywhere.
same_release() {
  local f
  if jq -se 'map(map({name, tag: (.image | sub("^.*:"; ""))}) | sort_by(.name)) | unique | length == 1' "$@" >/dev/null; then
    return 0
  fi
  echo "ERROR: the source regions don't run the same release, so promote would give the target's regions different images. Deploy one release to every region first:" >&2
  for f in "$@"; do
    echo "  $(basename "$(dirname "$f")"): $(jq -r 'sort_by(.name) | map("\(.name)=\(.image | sub("^.*:"; ""))") | join(", ")' "$f")" >&2
  done
  return 1
}

# wait_stable CLUSTER SERVICE DEPLOYMENT_ID [ATTEMPTS] [INTERVAL] — poll until
# DEPLOYMENT_ID (the one update-service created) is the service's only
# deployment, PRIMARY and COMPLETED, with every desired task running, for up to
# ATTEMPTS × INTERVAL seconds (default 60 × 15 s = 15 minutes; `aws ecs wait
# services-stable` has a hard 10-minute ceiling).
# It follows that deployment, not .deployments[0]: when the ECS circuit breaker
# rolls back, it starts a new PRIMARY deployment of the old revision and moves the
# failed one behind it, so "one deployment, all tasks running" would otherwise
# report the old version as a success (production-readiness review, CI-11). So it
# fails as soon as that deployment is FAILED, or is no longer listed.
wait_stable() {
  local cluster="$1" service="$2" id="$3" attempts="${4:-60}" interval="${5:-15}"
  local i info deployment deployments running pending desired rollout status
  echo "Waiting for $service deployment $id to complete (up to $((attempts * interval / 60)) minutes)..."
  for ((i = 1; i <= attempts; i++)); do
    info=$(aws ecs describe-services --cluster "$cluster" --services "$service" --query 'services[0]' --output json) || return 1
    deployments=$(jq '.deployments | length' <<<"$info")
    running=$(jq '.runningCount' <<<"$info")
    pending=$(jq '.pendingCount' <<<"$info")
    desired=$(jq '.desiredCount' <<<"$info")
    deployment=$(jq -c --arg id "$id" 'first(.deployments[] | select(.id == $id)) // empty' <<<"$info")

    if [ -z "$deployment" ]; then
      echo "ERROR: $service deployment $id is no longer listed: ECS replaced it (a rollback, or another deployment). The service isn't running this release." >&2
      return 1
    fi
    rollout=$(jq -r '.rolloutState' <<<"$deployment")
    status=$(jq -r '.status' <<<"$deployment")
    if [ "$rollout" = "FAILED" ]; then
      echo "ERROR: $service rollout FAILED — the ECS circuit breaker has rolled back. Check ECS events and CloudWatch logs." >&2
      return 1
    fi
    if [ "$status" = "PRIMARY" ] && [ "$rollout" = "COMPLETED" ] && [ "$deployments" -eq 1 ] \
      && [ "$running" -eq "$desired" ] && [ "$pending" -eq 0 ] && [ "$desired" -gt 0 ]; then
      echo "$service is stable ($running/$desired tasks running)."
      return 0
    fi
    echo "[$i/$attempts] $service — deployment: $status/$rollout, deployments: $deployments, running: $running, pending: $pending, desired: $desired — retrying in ${interval}s..."
    sleep "$interval"
  done
  echo "ERROR: $service did not stabilise in time (deployment: $status/$rollout, deployments: $deployments, running: $running, pending: $pending, desired: $desired)." >&2
  return 1
}

# roll_out CLUSTER SERVICE [TASK_DEFINITION_ARN] — point SERVICE at the new
# revision (or, without one, replace its tasks on the current revision) and wait
# until the deployment that starts is complete.
roll_out() {
  local cluster="$1" service="$2" td="${3:-}" result id
  local -a change=(--force-new-deployment)
  [ -n "$td" ] && change=(--task-definition "$td")
  # shellcheck disable=SC2016  # backticks are JMESPath literals, not shell
  result=$(aws ecs update-service --cluster "$cluster" --service "$service" "${change[@]}" \
    --query '{serviceName: service.serviceName, status: service.status, desiredCount: service.desiredCount, deployment: service.deployments[?status==`PRIMARY`] | [0].id}' \
    --output json) || return 1
  printf '%s\n' "$result"
  id=$(jq -r '.deployment // empty' <<<"$result")
  if [ -z "$id" ]; then
    echo "ERROR: update-service returned no PRIMARY deployment for $service." >&2
    return 1
  fi
  wait_stable "$cluster" "$service" "$id"
}

# deploy_one CLUSTER SERVICE_ENTRY_JSON IMAGE_FOR — register one service's
# family with the image IMAGE_FOR prints for it, and roll it out.
deploy_one() {
  local cluster="$1" entry="$2" image_for="$3" service family container image td
  service=$(jq -r '.service' <<<"$entry")
  family=$(jq -r '.family' <<<"$entry")
  container=$(jq -r '.container' <<<"$entry")
  image=$("$image_for" "$entry") || return 1
  echo "Image: $image"
  td=$(register_with_image "$family" "$container" "$image") || return 1
  echo "Registered $td"
  roll_out "$cluster" "$service" "$td"
}

# deploy_image CLUSTER SERVICES_JSON IMAGE_FOR — roll every service in
# SERVICES_JSON onto the image IMAGE_FOR prints for it, all at once: each
# service is an independent ECS service, so they don't wait for each other
# and the deploy takes as long as the slowest one. Output lines are prefixed
# with the service name. A failure doesn't stop the others; the function
# returns non-zero naming the failed services (each was already rolled back
# by the ECS circuit breaker), which leaves them on the previous image while
# the rest run the new one.
# IMAGE_FOR is a function name, called as: IMAGE_FOR <service-entry-json>.
deploy_image() {
  local cluster="$1" services="$2" image_for="$3" entry name status_dir i
  local -a names=() pids=() failed=() succeeded=()
  status_dir=$(mktemp -d)
  while IFS= read -r entry; do
    name=$(jq -r '.name' <<<"$entry")
    names+=("$name")
    (
      rc=0
      deploy_one "$cluster" "$entry" "$image_for" 2>&1 || rc=$?
      echo "$rc" > "$status_dir/$name"
    ) | while IFS= read -r line; do printf '[%s] %s\n' "$name" "$line"; done &
    pids+=($!)
  done < <(jq -c '.[]' <<<"$services")

  for i in "${!pids[@]}"; do
    wait "${pids[$i]}" || true
    if [ "$(cat "$status_dir/${names[$i]}" 2>/dev/null || echo 1)" = "0" ]; then
      succeeded+=("${names[$i]}")
    else
      failed+=("${names[$i]}")
    fi
  done
  rm -rf "$status_dir"

  echo "Rolled out: ${succeeded[*]:-none}"
  if [ "${#failed[@]}" -gt 0 ]; then
    echo "ERROR: rollout failed for: ${failed[*]}. Those services are back on their previous image (ECS circuit breaker); the others run the new one. Fix and re-run with service=$(IFS=,; echo "${failed[*]}")." >&2
    return 1
  fi
}
