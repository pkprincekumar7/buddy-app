#!/usr/bin/env bash
# SC2015: `cond && ok || fail` is intended — ok/fail only echo and count.
# shellcheck disable=SC2015
# Tests for scripts/drift.sh against a fake `terraform` and `aws` — no AWS access needed.
# Run: bash scripts/drift.test.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export FAKE="$WORK/fake"
mkdir -p "$FAKE/bin"
export RUNNER_TEMP="$WORK/runner-temp" GITHUB_OUTPUT="$WORK/output" GITHUB_STEP_SUMMARY="$WORK/summary"
mkdir -p "$RUNNER_TEMP"

# -- fake terraform --------------------------------------------------------------------
# state list: $FAKE/state (FAKE_STATE_FAILS: an error; FAKE_NO_STATE: no state file, as
# Terraform says it for a stack never applied). plan: logs its arguments to
# $FAKE/plan-args, writes its -out file, exits $FAKE_PLAN_RC. show -json: $FAKE/show.json.
cat > "$FAKE/bin/terraform" <<'EOF'
#!/usr/bin/env bash
case "$1 ${2:-}" in
  "state list")
    [ -z "${FAKE_STATE_FAILS:-}" ] || { echo "Error: Failed to load state: AccessDenied" >&2; exit 1; }
    [ -z "${FAKE_NO_STATE:-}" ] || { printf '%s\n' "No state file was found!" "" \
      "State management commands require a state file. Run this command" >&2; exit 1; }
    cat "$FAKE/state" ;;
  plan*)
    shift
    printf '%s\n' "$@" > "$FAKE/plan-args"
    for a in "$@"; do case "$a" in -out=*) echo "binary plan" > "${a#-out=}" ;; esac; done
    echo "Refreshing state... (the plan's own output)"
    exit "${FAKE_PLAN_RC:-0}" ;;
  "show -json") cat "$FAKE/show.json" ;;
  # Never called by drift.sh (no plan text is published); answered so a test can catch it.
  "show -no-color") echo "Note: Objects have changed outside of Terraform" ;;
  *) echo "fake terraform: unexpected call: $*" >&2; exit 1 ;;
esac
EOF
# -- fake aws ----------------------------------------------------------------------------
# ssm get-parameter: the names listed in $FAKE/ssm exist; FAKE_SSM_FAILS: access denied.
cat > "$FAKE/bin/aws" <<'EOF'
#!/usr/bin/env bash
name=""
while [ $# -gt 0 ]; do [ "$1" = --name ] && name="$2"; shift; done
[ -z "${FAKE_SSM_FAILS:-}" ] || { echo "An error occurred (AccessDeniedException)" >&2; exit 254; }
if grep -qxF -- "$name" "$FAKE/ssm" 2>/dev/null; then echo "$name"; exit 0; fi
echo "An error occurred (ParameterNotFound) when calling the GetParameter operation" >&2
exit 254
EOF
chmod +x "$FAKE/bin/terraform" "$FAKE/bin/aws"
export PATH="$FAKE/bin:$PATH"

# shellcheck source=scripts/drift.sh
source "$HERE/drift.sh"

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok   - $1"; }
fail() { FAIL=$((FAIL + 1)); echo "FAIL - $1${2:+: $2}"; }
check() { local name="$1" got="$2" want="$3"; [ "$got" = "$want" ] && ok "$name" || fail "$name" "got '$got', want '$want'"; }
reset() { rm -f "$GITHUB_OUTPUT" "$GITHUB_STEP_SUMMARY" "$FAKE"/plan-args "$FAKE"/show.json; : > "$GITHUB_OUTPUT"; : > "$GITHUB_STEP_SUMMARY"; }
run() { local status=0; OUT=$("$@" 2>&1) || status=$?; return "$status"; }
leftovers() { find "$RUNNER_TEMP" -type f | wc -l | tr -d ' '; }

# -- drift_up_output -------------------------------------------------------------------------
reset
printf 'aws_vpc.this\naws_ecs_cluster.this\n' > "$FAKE/state"
run drift_up_output && ok "a deployed stack passes" || fail "a deployed stack passes" "$OUT"
check "a deployed stack is up=true" "$(cat "$GITHUB_OUTPUT")" "up=true"

reset
: > "$FAKE/state"
run drift_up_output && ok "an empty state passes (nothing to check)" || fail "an empty state passes" "$OUT"
check "an empty state is up=false" "$(cat "$GITHUB_OUTPUT")" "up=false"
[[ "$OUT" == *"::notice title=Not deployed::"* ]] && ok "an empty state says so in a notice" || fail "not-deployed notice" "$OUT"

reset
run env FAKE_NO_STATE=1 bash -c "source '$HERE/drift.sh'; drift_up_output" && ok "no state file passes (never applied)" \
  || fail "no state file passes" "$OUT"
check "no state file is up=false" "$(cat "$GITHUB_OUTPUT")" "up=false"
[[ "$OUT" == *"::notice title=Not deployed::"* ]] && ok "no state file says so in a notice" || fail "no-state notice" "$OUT"
[[ "$OUT" != *"::error::"* ]] && ok "no state file is no error" || fail "no-state error" "$OUT"

reset
run env FAKE_STATE_FAILS=1 bash -c "source '$HERE/drift.sh'; drift_up_output" && fail "an unreadable state fails" \
  || { [[ "$OUT" == *"Could not read the Terraform state"* ]] && ok "an unreadable state fails, saying so" || fail "unreadable state" "$OUT"; }
check "an unreadable state writes no output" "$(cat "$GITHUB_OUTPUT")" ""

# -- drift_backend_regions -------------------------------------------------------------------
printf '%s\n' /superpower/prod/backend/ap-south-1/alb_internal_fqdn /superpower/prod/backend/eu-west-1/alb_internal_fqdn > "$FAKE/ssm"
check "the regions with a backend" "$(drift_backend_regions superpower prod ap-south-1 eu-west-1 us-east-1)" '["ap-south-1","eu-west-1"]'
check "another environment's parameters don't count" "$(drift_backend_regions superpower stg ap-south-1 eu-west-1)" '[]'
check "no regions given" "$(drift_backend_regions superpower prod)" '[]'
run env FAKE_SSM_FAILS=1 bash -c "source '$HERE/drift.sh'; drift_backend_regions superpower prod ap-south-1" \
  && fail "an SSM error isn't taken as not deployed" \
  || { [[ "$OUT" == *"AccessDeniedException"* ]] && ok "an SSM error isn't taken as not deployed" || fail "ssm error" "$OUT"; }

# -- drift_plan: no drift ---------------------------------------------------------------------
reset
run drift_plan "backend / prod / ap-south-1" -var-file=tfvars/prod.tfvars && ok "no drift passes" || fail "no drift passes" "$OUT"
for want in -refresh-only -detailed-exitcode -lock=false -input=false -no-color -var-file=tfvars/prod.tfvars; do
  grep -qxF -- "$want" "$FAKE/plan-args" && ok "the plan has $want" || fail "the plan has $want" "$(tr '\n' ' ' < "$FAKE/plan-args")"
done
grep -q "No drift — backend / prod / ap-south-1" "$GITHUB_STEP_SUMMARY" && ok "no drift goes in the summary" || fail "summary" "$(cat "$GITHUB_STEP_SUMMARY")"
check "no plan file is left" "$(leftovers)" 0

# -- drift_plan: drift --------------------------------------------------------------------------
reset
cat > "$FAKE/show.json" <<'EOF'
{"resource_drift": [
  {"address": "aws_security_group.alb", "change": {"actions": ["update"]}},
  {"address": "aws_ssm_parameter.alb_internal_fqdn", "change": {"actions": ["delete"]}},
  {"address": "aws_s3_bucket.logs", "change": {"actions": ["no-op"]}}
]}
EOF
run env FAKE_PLAN_RC=2 bash -c "source '$HERE/drift.sh'; drift_plan 'edge / stg'" && fail "drift fails" \
  || ok "drift fails"
[[ "$OUT" == *"::error title=Drift (edge / stg)::changed outside Terraform: aws_security_group.alb"* ]] \
  && ok "a changed resource is an error annotation" || fail "changed annotation" "$OUT"
[[ "$OUT" == *"deleted outside Terraform: aws_ssm_parameter.alb_internal_fqdn"* ]] \
  && ok "a deleted resource says deleted" || fail "deleted annotation" "$OUT"
[[ "$OUT" != *aws_s3_bucket.logs* ]] && ok "a no-op entry isn't drift" || fail "no-op shown" "$OUT"
[[ "$OUT" == *"2 resource(s) no longer match"* ]] && ok "it counts the drifted resources" || fail "count" "$OUT"
grep -q "Drift — edge / stg (2)" "$GITHUB_STEP_SUMMARY" && grep -q -- "- changed outside Terraform: aws_security_group.alb" "$GITHUB_STEP_SUMMARY" \
  && ok "the summary lists the drifted resources" || fail "drift summary" "$(cat "$GITHUB_STEP_SUMMARY")"
# The repository is public: no plan text (it shows the drifted values) in the summary or the log.
! grep -q "Objects have changed outside of Terraform" "$GITHUB_STEP_SUMMARY" && [[ "$OUT" != *"Objects have changed"* ]] \
  && ok "no plan text in the summary or the log" || fail "plan text published" "$(cat "$GITHUB_STEP_SUMMARY")"
check "no plan file is left after drift" "$(leftovers)" 0

# -- drift_plan: the changes the workflows make on purpose (drift-ignore.json) ---------------------
ECS='"address": "module.service[\"users\"].aws_ecs_service.this", "type": "aws_ecs_service", "name": "this"'
reset
cat > "$FAKE/show.json" <<EOF
{"resource_drift": [{$ECS, "change": {"actions": ["update"],
  "before": {"desired_count": 1, "task_definition": "arn:td:1", "tags": {"a": "b"}},
  "after":  {"desired_count": 3, "task_definition": "arn:td:2", "tags": {"a": "b"}}}}]}
EOF
run env FAKE_PLAN_RC=2 bash -c "source '$HERE/drift.sh'; drift_plan 'backend / dev / ap-south-1'" \
  && { [[ "$OUT" == *"only changes are the ones its workflows make on purpose"* ]] && ok "a deploy's task definition and autoscaling's count aren't drift" || fail "expected changes" "$OUT"; } \
  || fail "a deploy's task definition and autoscaling's count aren't drift" "$OUT"
grep -q "only expected changes" "$GITHUB_STEP_SUMMARY" && ok "the summary says only expected changes" || fail "expected summary" "$(cat "$GITHUB_STEP_SUMMARY")"

reset
cat > "$FAKE/show.json" <<EOF
{"resource_drift": [{$ECS, "change": {"actions": ["update"],
  "before": {"desired_count": 1, "network_configuration": [{"security_groups": ["sg-0aaa1111"]}]},
  "after":  {"desired_count": 3, "network_configuration": [{"security_groups": ["sg-0bbb2222"]}]}}}]}
EOF
run env FAKE_PLAN_RC=2 bash -c "source '$HERE/drift.sh'; drift_plan 'backend / dev / ap-south-1'" && fail "another attribute on the same resource is drift" \
  || { [[ "$OUT" == *"changed outside Terraform (network_configuration): module.service[\"users\"].aws_ecs_service.this"* ]] \
    && ok "another attribute on the same resource is drift, named without the ignored one" || fail "mixed attributes" "$OUT"; }
[[ "$OUT" != *sg-0aaa1111* && "$OUT" != *sg-0bbb2222* ]] && ! grep -q 'sg-0' "$GITHUB_STEP_SUMMARY" \
  && ok "the attribute's values aren't published" || fail "values published" "$OUT"

reset
cat > "$FAKE/show.json" <<EOF
{"resource_drift": [{$ECS, "change": {"actions": ["delete"], "before": {"desired_count": 1}, "after": null}}]}
EOF
run env FAKE_PLAN_RC=2 bash -c "source '$HERE/drift.sh'; drift_plan 'backend / dev / ap-south-1'" && fail "deleting an ignored resource is drift" \
  || { [[ "$OUT" == *"deleted outside Terraform: module.service"* ]] && ok "deleting an ignored resource is drift" || fail "ignored delete" "$OUT"; }

reset
cat > "$FAKE/show.json" <<'EOF'
{"resource_drift": [{"address": "aws_ssm_parameter.alb_internal_fqdn", "type": "aws_ssm_parameter", "name": "alb_internal_fqdn",
  "change": {"actions": ["update"], "before": {"value": "a"}, "after": {"value": "b"}}}]}
EOF
run env FAKE_PLAN_RC=2 bash -c "source '$HERE/drift.sh'; drift_plan 'backend / dev / ap-south-1'" && fail "an ignored attribute on another resource is drift" \
  || { [[ "$OUT" == *"changed outside Terraform (value): aws_ssm_parameter.alb_internal_fqdn"* ]] \
    && ok "the kill switch's value is ignored, not every SSM parameter's" || fail "other ssm param" "$OUT"; }

# The list itself: every entry has attributes and a reason.
jq -e 'length > 0 and all(.[]; (.attributes | type == "array" and length > 0) and (.why | type == "string" and length > 0))' \
  "$HERE/drift-ignore.json" >/dev/null && ok "every drift-ignore.json entry has attributes and a reason" \
  || fail "drift-ignore.json entries need attributes and a reason"

# -- drift_plan: only outputs -------------------------------------------------------------------
reset
echo '{"resource_drift": [{"address": "aws_s3_bucket.logs", "change": {"actions": ["no-op"]}}], "output_changes": {"x": {}}}' > "$FAKE/show.json"
run env FAKE_PLAN_RC=2 bash -c "source '$HERE/drift.sh'; drift_plan 'frontend / dev'" \
  && { [[ "$OUT" == *"only frontend / dev's outputs would change"* ]] && ok "outputs only isn't drift" || fail "outputs only" "$OUT"; } \
  || fail "outputs only isn't drift" "$OUT"

# -- drift_plan: the plan fails -------------------------------------------------------------------
reset
run env FAKE_PLAN_RC=1 bash -c "source '$HERE/drift.sh'; drift_plan 'scheduler / sbx'" && fail "a failed plan fails" \
  || { [[ "$OUT" == *"the plan's own output"* && "$OUT" == *"terraform plan exited 1"* ]] \
    && ok "a failed plan fails, with its output" || fail "failed plan" "$OUT"; }
check "no plan file is left after a failure" "$(leftovers)" 0

# -- under the step's own shell options -----------------------------------------------------------
reset
echo '{"resource_drift": [{"address": "aws_vpc.this", "change": {"actions": ["update"]}}]}' > "$FAKE/show.json"
run env FAKE_PLAN_RC=2 bash -c "set -euo pipefail; source '$HERE/drift.sh'; drift_plan 'backend / dev / ap-south-1'; echo after" \
  && fail "drift fails the step under set -e" || { [[ "$OUT" != *after* ]] && ok "drift fails the step under set -e" || fail "set -e" "$OUT"; }
reset
run bash -c "set -euo pipefail; source '$HERE/drift.sh'; drift_plan 'backend / dev / ap-south-1'; echo after" \
  && { [[ "$OUT" == *after* ]] && ok "no drift passes under set -e" || fail "set -e pass" "$OUT"; } || fail "no drift passes under set -e" "$OUT"

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
