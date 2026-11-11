#!/usr/bin/env bash
# SC2015: `cond && ok || fail` is intended — ok/fail only echo and count.
# shellcheck disable=SC2015
# Tests for scripts/workflow-inputs.sh, the reusable workflows' input checks
# (SEC-07). No AWS access needed. Run: bash scripts/workflow-inputs.test.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"

# shellcheck source=scripts/workflow-inputs.sh
source "$HERE/workflow-inputs.sh"

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok   - $1"; }
fail() { FAIL=$((FAIL + 1)); echo "FAIL - $1${2:+: $2}"; }
accepts() { "${@:2}" >/dev/null 2>&1 && ok "$1" || fail "$1"; }
refuses() { "${@:2}" >/dev/null 2>&1 && fail "$1" || ok "$1"; }
check() { [ "$2" = "$3" ] && ok "$1" || fail "$1" "got '$2', want '$3'"; }

check_regions_list="$(allowed_regions | paste -sd, -)"
[ "$check_regions_list" = "ap-south-1,eu-west-1,us-east-1" ] && ok "the allow-list is routing.json's regions" \
  || fail "the allow-list is routing.json's regions" "$check_regions_list"

for env in dev sbx stg prod; do accepts "environment $env" check_environment "$env"; done
refuses "an unknown environment" check_environment qa
refuses "a path in the environment" check_environment "../prod"
refuses "an environment with a newline" check_environment $'dev\nprod'
refuses "an empty environment" check_environment ""

for env in dev sbx stg; do accepts "deploy to $env" check_deploy_environment "$env"; done
refuses "a direct deploy to prod" check_deploy_environment prod
refuses "a deploy to an unknown environment" check_deploy_environment qa
check "prod's refusal says to promote" "$(check_deploy_environment prod 2>&1 || true)" \
  "::error::prod isn't deployed directly: promote the release from stg with promote-live-backend and promote-live-frontend."

accepts "no SHA: the previous release" check_optional_sha ""
accepts "a full SHA" check_optional_sha "$(printf 'a%.0s' {1..40})"
refuses "a short SHA" check_optional_sha abc123
# shellcheck disable=SC2016 # the literal text is the point
refuses "shell in a SHA" check_optional_sha '$(id)'

for action in plan apply plan-destroy destroy; do accepts "action $action" check_action "$action"; done
refuses "an unknown action" check_action import
refuses "shell in the action" check_action 'plan; id'

accepts "a supported region" check_region eu-west-1
refuses "an unsupported region" check_region us-west-2
# shellcheck disable=SC2016 # the literal text is the point
refuses "shell in a region" check_region '$(id)'
refuses "a region pattern" check_region '.*'

accepts "one region" check_regions '["ap-south-1"]'
accepts "every region" check_regions '["ap-south-1","eu-west-1","us-east-1"]'
refuses "an empty list" check_regions '[]'
refuses "a repeated region" check_regions '["eu-west-1","eu-west-1"]'
refuses "an unsupported region in the list" check_regions '["eu-west-1","us-west-2"]'
refuses "a bare string" check_regions 'eu-west-1'
refuses "not JSON" check_regions "['eu-west-1']"
refuses "a non-string entry" check_regions '[1]'
check "a comma list becomes a JSON array" "$(regions_json 'ap-south-1, eu-west-1')" '["ap-south-1","eu-west-1"]'
check "one region" "$(regions_json eu-west-1)" '["eu-west-1"]'
check "a JSON array passes through, compacted" "$(regions_json '[ "us-east-1" ]')" '["us-east-1"]'
check "stray commas and spaces are ignored" "$(regions_json ' ap-south-1 ,, ')" '["ap-south-1"]'
refuses "nothing typed" regions_json ""
refuses "only commas" regions_json " , "
refuses "an unsupported region in the comma list" regions_json "ap-south-1,us-west-2"
refuses "a repeated region in the comma list" regions_json "eu-west-1,eu-west-1"
# shellcheck disable=SC2016 # the literal text is the point
refuses "shell in the comma list" regions_json 'eu-west-1,$(id)'
refuses "a broken JSON array" regions_json '["eu-west-1"'

accepts "bootstrap auto" check_bootstrap_region auto '["eu-west-1"]'
accepts "bootstrap in the list" check_bootstrap_region eu-west-1 '["ap-south-1","eu-west-1"]'
refuses "bootstrap outside the list" check_bootstrap_region us-east-1 '["eu-west-1"]'

# prod applies only what stg applied first (stg_applied_in, check_stg_first).
runs() { jq -n --argjson r "$1" '{workflow_runs: $r}'; }
run() { jq -n --arg t "$1" --arg c "${2:-success}" '{display_title: $t, conclusion: $c}'; }
STG_BACKEND="$(run 'Terraform Live Backend (apply, stg, ["ap-south-1"])')"
STG_FULL="$(run 'Full Stack (apply, stg, ["ap-south-1"])')"
STG_FRONTEND="$(run 'Terraform Live Frontend (apply, stg)')"
accepts "backend applied to stg on its own" stg_applied_in "$(runs "[$STG_BACKEND]")" backend
accepts "every stack applied to stg in a full-stack run" stg_applied_in "$(runs "[$STG_FULL]")" edge
accepts "frontend applied to stg" stg_applied_in "$(runs "[$STG_FRONTEND]")" frontend
refuses "another stack's stg apply doesn't count" stg_applied_in "$(runs "[$STG_BACKEND]")" edge
refuses "a stg plan doesn't count" stg_applied_in "$(runs "[$(run 'Terraform Live Backend (plan, stg, ["ap-south-1"])')]")" backend
refuses "a dev apply doesn't count" stg_applied_in "$(runs "[$(run 'Full Stack (apply, dev, ["ap-south-1"])')]")" backend
refuses "a failed stg apply doesn't count" stg_applied_in "$(runs "[$(run 'Full Stack (apply, stg, ["ap-south-1"])' failure)]")" backend
refuses "no runs for the commit" stg_applied_in "$(runs '[]')" backend
refuses "an unknown stack" stg_applied_in "$(runs "[$STG_FULL]")" scheduler
SHA="$(printf 'a%.0s' {1..40})"
accepts "a prod plan isn't checked" check_stg_first backend plan prod "$SHA"
accepts "a prod destroy isn't checked" check_stg_first backend destroy prod "$SHA"
accepts "a stg apply isn't checked" check_stg_first backend apply stg "$SHA"
refuses "a prod apply with a bad SHA" check_stg_first backend apply prod "main"
# shellcheck disable=SC2317,SC2329 # a stand-in for gh, called by check_stg_first (SC2317 on older shellcheck)
gh() { [ "$2" = "repos/o/r/actions/runs?head_sha=${SHA}&status=success&per_page=100" ] && echo "$GH_RUNS"; }
export GITHUB_REPOSITORY=o/r
GH_RUNS="$(runs "[$STG_FULL]")" accepts "a prod apply stg applied first" check_stg_first backend apply prod "$SHA"
GH_RUNS="$(runs '[]')" refuses "a prod apply stg never applied" check_stg_first backend apply prod "$SHA"
# shellcheck disable=SC2317,SC2329 # a stand-in for gh, called by check_stg_first (SC2317 on older shellcheck)
gh() { return 1; }
refuses "a prod apply whose runs can't be listed" check_stg_first backend apply prod "$SHA"
unset -f gh

# The destroy order (state_has_resources, edge_routes_to, check_destroy_order).
EMPTY='{"version":4,"resources":[]}'
FRONTEND_UP='{"resources":[{"mode":"managed","type":"aws_s3_bucket_policy","name":"x","instances":[{}]}]}'
FRONTEND_DATA_ONLY='{"resources":[{"mode":"data","type":"aws_ssm_parameter","name":"cloudfront_arn","instances":[{}]}]}'
EDGE_UP='{"resources":[{"mode":"data","type":"aws_ssm_parameter","name":"alb_internal_fqdn","instances":[{"index_key":"ap-south-1"},{"index_key":"eu-west-1"}]},{"mode":"managed","type":"aws_cloudfront_distribution","name":"x","instances":[{}]}]}'
accepts "a state with a resource has resources" state_has_resources "$FRONTEND_UP"
refuses "an emptied state has none" state_has_resources "$EMPTY"
refuses "data sources alone aren't resources" state_has_resources "$FRONTEND_DATA_ONLY"
refuses "no state file has none" state_has_resources '{}'
accepts "edge routes to a region it reads" edge_routes_to "$EDGE_UP" eu-west-1
refuses "edge doesn't route to a region it doesn't read" edge_routes_to "$EDGE_UP" us-east-1
refuses "a destroyed edge routes nowhere" edge_routes_to "$EMPTY" ap-south-1

# A stand-in for aws: FAKE_STATES maps a state key to its JSON; a missing key has no
# object, and FAKE_AWS_FAILS fails every call.
# shellcheck disable=SC2317,SC2329 # called by read_state (SC2317 on older shellcheck)
aws() {
  [ -z "${FAKE_AWS_FAILS:-}" ] || return 1
  local key
  case "$1 $2" in
    "s3api list-objects-v2") key="$8"; jq -r --arg k "$key" 'if has($k) then 1 else 0 end' <<<"$FAKE_STATES" ;;
    "s3 cp") key="${5#s3://b/}"; jq -r --arg k "$key" '.[$k]' <<<"$FAKE_STATES" ;;
    *) return 1 ;;
  esac
}
P=terraform-state-files/app/dev
FE="$P/frontend/us-east-1/terraform.tfstate"
ED="$P/edge/us-east-1/terraform.tfstate"
states() { jq -n --arg fe "$FE" --arg ed "$ED" --argjson f "$1" --argjson e "$2" '{($fe): $f, ($ed): $e}'; }
FAKE_STATES='{}'
accepts "a frontend destroy isn't checked" check_destroy_order frontend destroy b app dev
accepts "a plan-destroy isn't checked" check_destroy_order edge plan-destroy b app dev
FAKE_STATES="$(states "$FRONTEND_UP" "$EDGE_UP")"
refuses "an edge destroy while the frontend is applied" check_destroy_order edge destroy b app dev
refuses "a backend destroy while the edge routes there" check_destroy_order backend destroy b app dev ap-south-1
accepts "a backend destroy of a region the edge doesn't route to" check_destroy_order backend destroy b app dev us-east-1
FAKE_STATES="$(states "$EMPTY" "$EMPTY")"
accepts "an edge destroy after the frontend's" check_destroy_order edge destroy b app dev
accepts "a backend destroy after the edge's" check_destroy_order backend destroy b app dev ap-south-1
FAKE_STATES='{}'
accepts "an edge destroy with no frontend state file" check_destroy_order edge destroy b app dev
accepts "a backend destroy with no edge state file" check_destroy_order backend destroy b app dev eu-west-1
refuses "a backend destroy with no region" check_destroy_order backend destroy b app dev
refuses "an unknown stack" check_destroy_order scheduler destroy b app dev
FAKE_AWS_FAILS=1 refuses "a state that can't be read" check_destroy_order edge destroy b app dev
FAKE_STATES="$(jq -n --arg fe "$FE" '{($fe): "not json {"}')"
refuses "a state file that isn't JSON" check_destroy_order edge destroy b app dev
unset -f aws

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
