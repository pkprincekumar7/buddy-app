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
# backend and frontends route with): the one place a region is added (TF-01). The
# workflows take regions as free text and turn them into a checked JSON array
# (regions_json) in their validate job, so there's no list of every combination to keep.
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

# check_deploy_environment VALUE → check_environment, and refuse prod: prod gets
# only what promote-live-backend/-frontend bring from stg, never a fresh build
# (production-readiness review, CI-03).
check_deploy_environment() {
  check_environment "$1" || return 1
  [[ "$1" != "prod" ]] && return 0
  echo "::error::prod isn't deployed directly: promote the release from stg with promote-live-backend and promote-live-frontend."
  return 1
}

# check_optional_sha VALUE → error unless empty or a 40-character commit SHA.
check_optional_sha() {
  [[ -z "$1" || "$1" =~ ^[0-9a-f]{40}$ ]] && return 0
  echo "::error::git_sha must be empty (the release before the current one) or a 40-character commit SHA, not '$1'."
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

# regions_json VALUE → VALUE as a checked JSON array of regions (TF-01). VALUE is what a
# person types, a comma-separated list ("ap-south-1, eu-west-1"), or what a caller passes,
# already a JSON array ('["ap-south-1"]', as terraform-live-all and the scheduler do).
# Prints the array on stdout; refuses anything check_regions refuses.
regions_json() {
  local value="$1" json
  if [[ "$value" == \[* ]]; then
    json="$value"
  else
    json=$(jq -cn --arg v "$value" '$v | split(",") | map(gsub("^\\s+|\\s+$"; "")) | map(select(length > 0))')
  fi
  check_regions "$json" || return 1
  jq -c . <<<"$json"
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

# prod applies only what stg applied first: the same commit, through the same stack
# (backend, edge or frontend), either on its own or in a full-stack run. Checked against
# this repo's successful workflow runs for the commit, by their titles (each workflow's
# run-name), so no AWS access to stg is needed.

# stg_apply_titles STACK → the run-title prefixes that mean "STACK was applied to stg".
stg_apply_titles() {
  case "$1" in
    backend)  echo "Terraform Live Backend (apply, stg," ;;
    edge)     echo "Terraform Live Edge (apply, stg," ;;
    frontend) echo "Terraform Live Frontend (apply, stg)" ;;
    *) echo "::error::unknown stack '$1'." >&2; return 1 ;;
  esac
  echo "Full Stack (apply, stg,"
}

# stg_applied_in RUNS_JSON STACK → success if RUNS_JSON (the runs API's answer for one
# commit, successful runs only) has a run that applied STACK to stg.
stg_applied_in() {
  local titles
  titles="$(stg_apply_titles "$2")" || return 1
  jq -e --arg titles "$titles" '
    ($titles | split("\n")) as $prefixes
    | [.workflow_runs[]? | select(.conclusion == "success") | .display_title
       | select(. as $t | any($prefixes[]; . as $p | $t | startswith($p)))]
    | length > 0' <<<"$1" >/dev/null
}

# check_stg_first STACK ACTION ENVIRONMENT SHA → for a prod apply, error unless stg
# applied STACK at SHA in a successful run. Anything else passes. Needs gh with GH_TOKEN
# (actions: read) and GITHUB_REPOSITORY.
check_stg_first() {
  local stack="$1" action="$2" environment="$3" sha="$4" runs
  [[ "$environment" == "prod" && "$action" == "apply" ]] || return 0
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo "::error::'$sha' isn't a commit SHA."; return 1; }
  runs="$(gh api "repos/${GITHUB_REPOSITORY}/actions/runs?head_sha=${sha}&status=success&per_page=100")" || {
    echo "::error::Couldn't list this commit's runs to check that stg applied it first."
    return 1
  }
  stg_applied_in "$runs" "$stack" && return 0
  echo "::error::prod applies only what stg applied first: no successful stg apply of the $stack stack at ${sha:0:12}. Apply this commit to stg (terraform-live-$stack or terraform-live-all), then prod."
  return 1
}
