#!/usr/bin/env bash
# shellcheck shell=bash
#
# Shared helpers for the deploy / restart / promote backend workflows (TF-01).
# Source it:  source scripts/ecs-services.sh
#
# The list of ECS services comes from the SSM parameter terraform-live-backend
# writes — /<app>/<env>/backend/<region>/ecs_services, a JSON array (in
# deploy_order) of { name, service, family, container } (see
# infra-live-backend/terraform/services.tf). So adding a service in Terraform
# needs no workflow logic change: these helpers loop over whatever is listed.
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
# or a comma-separated list of service names (e.g. "backend,worker"); unknown
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
# PRIMARY (live) deployment — what's actually running, not a stored tag.
live_image() {
  local cluster="$1" service="$2" container="$3" td image
  # Multiple PRIMARY deployments are near-impossible; take the first.
  # shellcheck disable=SC2016  # backticks are JMESPath literals, not shell
  td=$(aws ecs describe-services --cluster "$cluster" --services "$service" \
    --query 'services[0].deployments[?status==`PRIMARY`].taskDefinition' --output text | head -n1)
  if [ -z "$td" ] || [ "$td" = "None" ]; then
    echo "ERROR: no live (PRIMARY) task definition for $service." >&2
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

# wait_stable CLUSTER SERVICE [ATTEMPTS] [INTERVAL] — poll until the service
# has one deployment with every desired task running, for up to
# ATTEMPTS × INTERVAL seconds (default 60 × 15 s = 15 minutes; `aws ecs wait
# services-stable` has a hard 10-minute ceiling). Fails as soon as the ECS
# circuit breaker reports the rollout FAILED (it has already rolled back).
wait_stable() {
  local cluster="$1" service="$2" attempts="${3:-60}" interval="${4:-15}" i info deployments running pending desired rollout
  echo "Waiting for $service to reach steady state (up to $((attempts * interval / 60)) minutes)..."
  for ((i = 1; i <= attempts; i++)); do
    info=$(aws ecs describe-services --cluster "$cluster" --services "$service" --query 'services[0]' --output json) || return 1
    deployments=$(jq '.deployments | length' <<<"$info")
    running=$(jq '.runningCount' <<<"$info")
    pending=$(jq '.pendingCount' <<<"$info")
    desired=$(jq '.desiredCount' <<<"$info")
    rollout=$(jq -r '.deployments[0].rolloutState' <<<"$info")

    if [ "$rollout" = "FAILED" ]; then
      echo "ERROR: $service rollout FAILED — the ECS circuit breaker has rolled back. Check ECS events and CloudWatch logs." >&2
      return 1
    fi
    if [ "$deployments" -eq 1 ] && [ "$running" -eq "$desired" ] && [ "$pending" -eq 0 ] && [ "$desired" -gt 0 ]; then
      echo "$service is stable ($running/$desired tasks running)."
      return 0
    fi
    echo "[$i/$attempts] $service — deployments: $deployments, running: $running, pending: $pending, desired: $desired, rollout: $rollout — retrying in ${interval}s..."
    sleep "$interval"
  done
  echo "ERROR: $service did not stabilise in time (deployments: $deployments, running: $running, pending: $pending, desired: $desired)." >&2
  return 1
}

# roll_out CLUSTER SERVICE TASK_DEFINITION_ARN — point SERVICE at the new
# revision and wait until it's stable.
roll_out() {
  local cluster="$1" service="$2" td="$3"
  aws ecs update-service --cluster "$cluster" --service "$service" --task-definition "$td" \
    --query "{serviceName: service.serviceName, status: service.status, desiredCount: service.desiredCount}" \
    --output json | cat
  wait_stable "$cluster" "$service"
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
