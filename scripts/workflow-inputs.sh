#!/usr/bin/env bash
# shellcheck shell=bash
#
# Input checks for the reusable deploy and Terraform workflows (SEC-07).
# Source it:  source scripts/workflow-inputs.sh
#
# A workflow_call input is free text, unlike workflow_dispatch's choices, so
# each reusable workflow checks its inputs in a first job with no
# `environment:` — before any environment's secrets are loaded. The steps that
# use them read them from env:, quoted, never as ${{ }} inside a script.
#
# The region allow-list is shared/routing.json's `regions` (the same list the
# backend and frontends route with).
#
# Tests: scripts/workflow-inputs.test.sh

WORKFLOW_INPUTS_ROUTING="${WORKFLOW_INPUTS_ROUTING:-$(dirname "${BASH_SOURCE[0]}")/../shared/routing.json}"

# allowed_regions → the supported AWS regions, one per line.
allowed_regions() {
  jq -r '.regions | keys[]' "$WORKFLOW_INPUTS_ROUTING"
}

# check_environment VALUE → error unless dev, sbx, stg or prod.
check_environment() {
  [[ "$1" =~ ^(dev|sbx|stg|prod)$ ]] && return 0
  echo "::error::environment must be dev, sbx, stg or prod, not '$1'."
  return 1
}

# check_action VALUE → error unless plan, apply, plan-destroy or destroy.
check_action() {
  [[ "$1" =~ ^(plan|apply|plan-destroy|destroy)$ ]] && return 0
  echo "::error::action must be plan, apply, plan-destroy or destroy, not '$1'."
  return 1
}

# check_region VALUE → error unless VALUE is one of allowed_regions.
check_region() {
  if allowed_regions | grep -qxF -- "$1"; then
    return 0
  fi
  echo "::error::'$1' is not a supported region ($(allowed_regions | paste -sd, -))."
  return 1
}

# check_regions JSON → error unless JSON is a non-empty array of distinct
# supported regions, e.g. ["ap-south-1","eu-west-1"].
check_regions() {
  local region
  if ! jq -e 'type == "array" and length > 0 and all(.[]; type == "string") and (unique | length) == length' <<<"$1" >/dev/null 2>&1; then
    echo "::error::regions must be a JSON array of distinct region names, e.g. [\"ap-south-1\"], not '$1'."
    return 1
  fi
  while IFS= read -r region; do
    check_region "$region" || return 1
  done < <(jq -r '.[]' <<<"$1")
}

# check_bootstrap_region VALUE REGIONS_JSON → error unless VALUE is "auto" or
# one of REGIONS_JSON (which check_regions has already checked).
check_bootstrap_region() {
  [[ "$1" == "auto" ]] && return 0
  if jq -e --arg r "$1" 'index($r) != null' <<<"$2" >/dev/null 2>&1; then
    return 0
  fi
  echo "::error::bootstrap_region must be 'auto' or one of $2, not '$1'."
  return 1
}
