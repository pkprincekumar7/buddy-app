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

accepts "bootstrap auto" check_bootstrap_region auto '["eu-west-1"]'
accepts "bootstrap in the list" check_bootstrap_region eu-west-1 '["ap-south-1","eu-west-1"]'
refuses "bootstrap outside the list" check_bootstrap_region us-east-1 '["eu-west-1"]'

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
