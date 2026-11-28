#!/usr/bin/env bash
# shellcheck shell=bash
#
# Drift detection: does AWS still match what Terraform last applied? A console change, a
# CLI hotfix never written back, or AWS rewriting a value itself (Valkey's resetchannels,
# 2026-11) shows here, not as a surprise in the next apply.
#
# The check is `terraform plan -refresh-only`: it reads every resource in the state from
# AWS and reports what changed outside Terraform. It never proposes the code's changes, so
# a commit merged but not yet applied (or a branch ahead of what an environment runs) is
# not drift. Read-only: -lock=false (it never blocks an apply waiting on the state lock),
# and the plan file, which holds every variable unredacted, is deleted at once.
#
# Source it (from the stack's terraform/ directory, after terraform init):
#   source ../../scripts/drift.sh
#   drift_up_output                     # up=true|false to $GITHUB_OUTPUT
#   drift_plan LABEL [PLAN_ARG...]      # e.g. drift_plan "backend / prod / ap-south-1" -var-file=…
# and in terraform-drift-env.yml, with AWS credentials:
#   drift_backend_regions APP ENVIRONMENT REGION...
#
# Changes the workflows make on purpose (a deploy's new task definition, autoscaling's task
# count, the filled-in secrets) aren't drift: scripts/drift-ignore.json lists them, each
# with its reason, by resource (type.name) and attribute. ignore_changes alone can't do
# this: a refresh-only plan reports an attribute even when Terraform ignores it.
#
# $TERRAFORM overrides `terraform` (tests); $DRIFT_IGNORE the ignore list. Needs:
# terraform, jq, aws. Tests: scripts/drift.test.sh (a fake terraform and aws).
DRIFT_IGNORE="${DRIFT_IGNORE:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/drift-ignore.json}"

# drift_stack_up → 0 when the stack's state has resources, 1 when it has none (never
# applied, or destroyed: the scheduler destroys dev, sbx and stg every night), 2 when the
# state can't be read. A stack never applied has no state file at all, and `state list`
# fails with "No state file was found!": that's not deployed too, not an unreadable state
# (stg's and prod's frontend, 2026-11-25). Any other failure (access denied, a lock error)
# still fails the check.
drift_stack_up() {
  local list
  if ! list=$("${TERRAFORM:-terraform}" state list 2>&1); then
    [[ "$list" == *"No state file was found"* ]] && return 1
    echo "::error::Could not read the Terraform state: $list" >&2
    return 2
  fi
  [ -n "$list" ]
}

# drift_up_output: drift_stack_up as a step output (up=true or up=false), with a notice
# when the stack isn't deployed; fails when the state can't be read.
drift_up_output() {
  local status=0
  drift_stack_up || status=$?
  case "$status" in
    0) echo "up=true" >>"${GITHUB_OUTPUT:-/dev/null}" ;;
    1)
      echo "::notice title=Not deployed::This stack has no resources in its state (not applied, or destroyed): no drift check."
      echo "up=false" >>"${GITHUB_OUTPUT:-/dev/null}"
      ;;
    *) return 1 ;;
  esac
}

# drift_backend_regions APP ENVIRONMENT REGION... → a JSON array of the REGIONs whose
# backend is deployed: the ones with the /APP/ENVIRONMENT/backend/REGION/alb_internal_fqdn
# parameter the backend stack writes (in us-east-1, where the edge reads it). Fails when
# SSM answers anything but "not found".
drift_backend_regions() {
  local app="$1" environment="$2" region out up=()
  shift 2
  for region in "$@"; do
    if out=$(aws ssm get-parameter --region us-east-1 \
      --name "/$app/$environment/backend/$region/alb_internal_fqdn" --query Parameter.Name --output text 2>&1); then
      up+=("$region")
    elif [[ "$out" != *ParameterNotFound* ]]; then
      echo "::error::Could not read SSM for $environment's backend in $region: $out" >&2
      return 1
    fi
  done
  printf '%s\n' "${up[@]+"${up[@]}"}" | jq -Rsc 'split("\n") | map(select(length > 0))'
}

# drift_plan LABEL [PLAN_ARG...]: the refresh-only plan. 0 when AWS matches the state;
# 1 on drift, listing each resource and whether it was changed or deleted; 1 when the
# plan itself fails, with its output.
#
# Addresses only, never the plan text: the repository is public, so a run's log and
# summary are too, and the text would show the drifted values (rules, ARNs, account IDs;
# Terraform hides only what's marked sensitive). Run a plan of the stack to see them.
drift_plan() {
  local label="$1" plan log status=0 report changes count line
  shift
  plan="$(mktemp "${RUNNER_TEMP:-/tmp}/drift.XXXXXX")"
  log="$(mktemp "${RUNNER_TEMP:-/tmp}/drift-log.XXXXXX")"
  "${TERRAFORM:-terraform}" plan -refresh-only -detailed-exitcode -lock=false -input=false -no-color \
    -out="$plan" "$@" >"$log" 2>&1 || status=$?
  case "$status" in
    0)
      rm -f "$plan" "$log"
      echo "No drift: $label matches its Terraform state."
      _drift_summary "### ✅ No drift — $label"
      return 0
      ;;
    2) ;;
    *)
      cat "$log"
      rm -f "$plan" "$log"
      echo "::error::The drift check for $label failed (terraform plan exited $status): see its output above."
      return 1
      ;;
  esac
  # Each drifted resource with the attributes that changed (names only, never values),
  # less the ones the workflows change on purpose (drift-ignore.json). A deletion always
  # counts; so does a change whose attributes can't be told apart.
  if ! report=$("${TERRAFORM:-terraform}" show -json "$plan" | jq -c --slurpfile ignore "$DRIFT_IGNORE" '
      ($ignore[0] | map_values(.attributes)) as $ig
      | [.resource_drift[]? | select(.change.actions != ["no-op"])] as $all
      | [$all[]
         | (.change.before // {}) as $b | (.change.after // {}) as $a
         | ([$b, $a] | map(if type == "object" then keys else [] end) | add | unique
            | map(select($b[.] != $a[.]))) as $attrs
         | ($attrs - ($ig[.type + "." + .name] // [])) as $left
         | if (.change.actions | index("delete")) then "deleted outside Terraform: \(.address)"
           elif ($attrs | length) == 0 then "changed outside Terraform: \(.address)"
           elif ($left | length) > 0 then "changed outside Terraform (\($left | join(", "))): \(.address)"
           else empty end] as $drift
      | {total: ($all | length), drift: $drift}'); then
    rm -f "$plan" "$log"
    echo "::error::Could not read the drift plan for $label."
    return 1
  fi
  changes=$(jq -r '.drift[]' <<<"$report")
  if [ -z "$changes" ]; then
    rm -f "$plan" "$log"
    if [ "$(jq '.total' <<<"$report")" -gt 0 ]; then
      echo "No drift: $label's only changes are the ones its workflows make on purpose (scripts/drift-ignore.json)."
      _drift_summary "### ✅ No drift — $label (only expected changes)"
    else
      echo "No drift: only $label's outputs would change (code not applied yet, not a change in AWS)."
      _drift_summary "### ✅ No drift — $label (outputs only)"
    fi
    return 0
  fi
  count=$(wc -l <<<"$changes" | tr -d ' ')
  echo "Drift in $label: $count resource(s) no longer match the state."
  while IFS= read -r line; do echo "::error title=Drift ($label)::$line"; done < <(head -50 <<<"$changes")
  {
    echo "### ❌ Drift — $label ($count)"
    echo
    while IFS= read -r line; do echo "- $line"; done <<<"$changes"
    echo
    echo "To see what changed, run terraform-live-<stack> with action plan for this environment."
  } >>"${GITHUB_STEP_SUMMARY:-/dev/null}"
  rm -f "$plan" "$log"
  return 1
}

_drift_summary() {
  echo "$1" >>"${GITHUB_STEP_SUMMARY:-/dev/null}"
}
