#!/usr/bin/env bash
# shellcheck shell=bash
#
# Valkey's node placement when a zone is full. AWS places a new replication group's nodes
# itself; when that zone has no capacity for the node type, the group ends in
# `create-failed` ("<zone> AZ does not have sufficient capacity"), and Terraform stops with
# it in state. Which zone is full changes from day to day, so no fixed zone avoids it
# (dev ap-south-1: 1a full, then 1b, 2026-11-18). This script makes terraform-live-backend's
# apply try the subnet group's other zones in turn:
#
#   apply → capacity failure in zone Z → delete the failed group (it holds nothing)
#         → plan again with elasticache_preferred_azs = the zones not yet full, then Z
#         → apply → … until it works, or every zone has been full.
#
# Any other apply failure fails as before, with no retry.
#
# Source it (from infra-live-backend/terraform):
#   source ../../scripts/valkey-capacity.sh
#   valkey_apply_with_zone_retry REGION GROUP_ID SUBNET_GROUP -- PLAN_COMMAND...
#
# PLAN_COMMAND is the step's own `terraform plan -out=tfplan.bin …`; the retry appends one
# -var, which wins over the -var-file before it. $TERRAFORM overrides `terraform` (tests).
#
# Needs: aws (credentials for REGION), jq, terraform.
# Tests: scripts/valkey-capacity.test.sh (a fake `aws` and `terraform`).

# valkey_capacity_zone REGION GROUP_ID SINCE → the zone that was full, if GROUP_ID is in
# create-failed for want of capacity, from events since SINCE (UTC, ISO 8601).
# Returns 0 with the zone; 1 when it isn't that (no group, another state, another reason);
# 2 when AWS couldn't be read, so an unknown failure is never retried.
valkey_capacity_zone() {
  local region="$1" group="$2" since="$3" status events zone
  if ! status=$(aws elasticache describe-replication-groups --region "$region" \
    --replication-group-id "$group" --query 'ReplicationGroups[0].Status' --output text 2>&1); then
    [[ "$status" == *ReplicationGroupNotFound* ]] && return 1
    echo "ERROR: could not read the replication group $group: $status" >&2
    return 2
  fi
  [ "$status" = "create-failed" ] || return 1
  events=$(aws elasticache describe-events --region "$region" --source-type cache-cluster \
    --start-time "$since" --output json) || {
    echo "ERROR: could not read the ElastiCache events for $group." >&2
    return 2
  }
  # Newest first, so the first match is this attempt's. Nodes are <group>-001, -002…
  zone=$(jq -r --arg g "$group-" '[.Events[]
      | select(.SourceIdentifier | startswith($g))
      | .Message | capture("because (?<az>[a-z0-9-]+) AZ does not have sufficient capacity")
      | .az] | first // empty' <<<"$events") || return 2
  [ -n "$zone" ] || return 1
  printf '%s\n' "$zone"
}

# valkey_zone_order REGION SUBNET_GROUP FULL_ZONE... → the subnet group's zones, one per
# line: the ones not yet full first (in name order), then the full ones (so a group of
# more nodes than free zones still has one per node). Fails when every zone was full.
valkey_zone_order() {
  local region="$1" subnets="$2" listing full
  shift 2
  listing=$(aws elasticache describe-cache-subnet-groups --region "$region" \
    --cache-subnet-group-name "$subnets" \
    --query 'CacheSubnetGroups[0].Subnets[].SubnetAvailabilityZone.Name' --output json) || {
    echo "ERROR: could not read the cache subnet group $subnets." >&2
    return 1
  }
  full=$(printf '%s\n' "$@" | jq -Rsc 'split("\n") | map(select(length > 0))') || return 1
  jq -er --argjson full "$full" '
      (unique) as $all | ($all - $full) as $free
      | if ($free | length) == 0 then empty else ($free + ($all - $free)) | .[] end' \
    <<<"$listing" || {
    echo "ERROR: every zone of $subnets ($(jq -r 'unique | join(", ")' <<<"$listing")) had no capacity." >&2
    return 1
  }
}

# valkey_zones_var REGION ZONE... → the -var value that puts the nodes in those zones.
valkey_zones_var() {
  local region="$1"
  shift
  printf 'elasticache_preferred_azs={%s=%s}\n' "$(jq -cn --arg r "$region" '$r')" \
    "$(printf '%s\n' "$@" | jq -Rsc 'split("\n") | map(select(length > 0))')"
}

# valkey_delete_failed REGION GROUP_ID: deletes the failed group (no nodes, no data) and
# waits until it's gone, so the next plan creates it again.
valkey_delete_failed() {
  if ! aws elasticache delete-replication-group --region "$1" --replication-group-id "$2" >/dev/null \
    || ! aws elasticache wait replication-group-deleted --region "$1" --replication-group-id "$2"; then
    echo "ERROR: could not delete the failed replication group $2." >&2
    return 1
  fi
}

# valkey_apply_with_zone_retry REGION GROUP_ID SUBNET_GROUP -- PLAN_COMMAND...
valkey_apply_with_zone_retry() {
  local region="$1" group="$2" subnets="$3" since zone order status
  local -a full=() zones=()
  shift 3
  [ "${1:-}" = "--" ] && shift
  [ "$#" -gt 0 ] || { echo "ERROR: no plan command given." >&2; return 1; }
  while :; do
    since=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    "${TERRAFORM:-terraform}" apply -auto-approve tfplan.bin && return 0
    status=0
    zone=$(valkey_capacity_zone "$region" "$group" "$since") || status=$?
    if [ "$status" -eq 1 ]; then
      echo "The apply failed, and not for want of Valkey capacity: no retry." >&2
    fi
    [ "$status" -eq 0 ] || return 1
    # A zone again: AWS didn't place the node where asked, so another try would too.
    if [[ " ${full[*]-} " == *" $zone "* ]]; then
      echo "ERROR: $zone had no capacity again, though it was last in the order asked for." >&2
      return 1
    fi
    full+=("$zone")
    # Deleted whatever comes next: left in create-failed, it stops the next run's plan too.
    echo "::warning::Valkey: $zone had no capacity for the node. Deleting the failed group (it holds nothing)."
    valkey_delete_failed "$region" "$group" || return 1
    order=$(valkey_zone_order "$region" "$subnets" "${full[@]}") || return 1
    read -ra zones <<<"$(tr '\n' ' ' <<<"$order")"
    echo "::notice::Valkey: planning again with ${zones[0]} first (${zones[*]})."
    "$@" -var "$(valkey_zones_var "$region" "${zones[@]}")" || return 1
  done
}
