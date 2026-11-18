#!/usr/bin/env bash
# SC2015: `cond && ok || fail` is intended — ok/fail only echo and count.
# shellcheck disable=SC2015
# Tests for scripts/valkey-capacity.sh against a fake `aws` and `terraform` on PATH — no
# AWS access needed. Run: bash scripts/valkey-capacity.test.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export FAKE="$WORK/fake"
mkdir -p "$FAKE/bin"

GROUP=superpower-backend-redis-dev
SUBNETS=superpower-backend-redis-subnet-group-dev
REGION=ap-south-1

# -- fake aws --------------------------------------------------------------------
# The group's status is $FAKE/status (no file: not found); its events, $FAKE/events.json.
# FAKE_DESCRIBE_FAILS makes describe-replication-groups fail with another error.
cat > "$FAKE/bin/aws" <<'EOF'
#!/usr/bin/env bash
echo "aws $*" >> "$FAKE/calls"
case "$1 $2" in
  "elasticache describe-replication-groups")
    [ -z "${FAKE_DESCRIBE_FAILS:-}" ] || { echo "ThrottlingException: Rate exceeded" >&2; exit 254; }
    [ -f "$FAKE/status" ] && cat "$FAKE/status" \
      || { echo "An error occurred (ReplicationGroupNotFoundFault)" >&2; exit 254; } ;;
  "elasticache describe-events") cat "$FAKE/events.json" 2>/dev/null || echo '{"Events": []}' ;;
  "elasticache describe-cache-subnet-groups") echo '["ap-south-1b", "ap-south-1a", "ap-south-1c"]' ;;
  "elasticache delete-replication-group") rm -f "$FAKE/status"; echo '{}' ;;
  "elasticache wait") ;;
  *) echo "fake aws: unexpected call: $*" >&2; exit 2 ;;
esac
EOF

# -- fake terraform --------------------------------------------------------------
# Each apply takes the next outcome from $FAKE/outcomes: "ok"; "full:<zone>" (the group
# ends create-failed with that zone's capacity event); or "other" (fails, group fine).
cat > "$FAKE/bin/terraform" <<'EOF'
#!/usr/bin/env bash
echo "terraform $*" >> "$FAKE/calls"
[ "$1" = apply ] || exit 0
n=$(( $(cat "$FAKE/applies" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$FAKE/applies"
outcome=$(sed -n "${n}p" "$FAKE/outcomes")
case "$outcome" in
  ok) exit 0 ;;
  full:*)
    echo create-failed > "$FAKE/status"
    jq -n --arg z "${outcome#full:}" '{Events: [
      {SourceIdentifier: "superpower-backend-redis-dev", Message: "Failed to create replication group"},
      {SourceIdentifier: "superpower-backend-redis-dev-001",
       Message: "Failed to create cache node superpower-backend-redis-dev-001 because \($z) AZ does not have sufficient capacity. Please try again with another AZ."}]}' \
      > "$FAKE/events.json"
    echo "Error: unexpected state 'create-failed'" >&2; exit 1 ;;
  *) echo available > "$FAKE/status"; echo '{"Events": []}' > "$FAKE/events.json"
     echo "Error: something else" >&2; exit 1 ;;
esac
EOF
chmod +x "$FAKE/bin/aws" "$FAKE/bin/terraform"
export PATH="$FAKE/bin:$PATH"

# shellcheck source=scripts/valkey-capacity.sh
source "$HERE/valkey-capacity.sh"

PASS=0
FAIL=0
ok() { echo "  ok   $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL $1"; FAIL=$((FAIL + 1)); }

# reset OUTCOME...: a fresh fake, whose applies have these outcomes in turn.
reset() {
  rm -f "$FAKE/calls" "$FAKE/applies" "$FAKE/status" "$FAKE/events.json"
  touch "$FAKE/calls"
  printf '%s\n' "$@" > "$FAKE/outcomes"
}
apply() {
  valkey_apply_with_zone_retry "$REGION" "$GROUP" "$SUBNETS" -- terraform plan -out=tfplan.bin \
    -var-file=tfvars/dev.tfvars > "$WORK/out" 2>&1
}
count() { grep -c -- "$1" "$FAKE/calls" || true; }
plans() { grep '^terraform plan' "$FAKE/calls" | sed 's/.*-var //'; }

echo "valkey_zones_var"
[ "$(valkey_zones_var ap-south-1 ap-south-1b ap-south-1a)" = 'elasticache_preferred_azs={"ap-south-1"=["ap-south-1b","ap-south-1a"]}' ] \
  && ok "the region's zones, in order, as HCL" || fail "zones var: $(valkey_zones_var ap-south-1 ap-south-1b ap-south-1a)"

echo "valkey_zone_order"
[ "$(valkey_zone_order "$REGION" "$SUBNETS" | tr '\n' ' ')" = "ap-south-1a ap-south-1b ap-south-1c " ] \
  && ok "none full: every zone, in name order" || fail "order with none full"
[ "$(valkey_zone_order "$REGION" "$SUBNETS" ap-south-1a | tr '\n' ' ')" = "ap-south-1b ap-south-1c ap-south-1a " ] \
  && ok "a full zone goes last" || fail "order with 1a full"
valkey_zone_order "$REGION" "$SUBNETS" ap-south-1a ap-south-1b ap-south-1c > "$WORK/out" 2>&1 \
  && fail "every zone full was accepted" \
  || { grep -q "every zone of $SUBNETS (ap-south-1a, ap-south-1b, ap-south-1c) had no capacity" "$WORK/out" \
    && ok "every zone full fails, naming them" || fail "every-zone message: $(cat "$WORK/out")"; }

echo "valkey_capacity_zone"
reset
valkey_capacity_zone "$REGION" "$GROUP" 2026-11-18T00:00:00Z > /dev/null && fail "no group counted as a capacity failure" \
  || { [ $? -eq 1 ] && ok "no group: not a capacity failure" || fail "no group: wrong status"; }
echo available > "$FAKE/status"
valkey_capacity_zone "$REGION" "$GROUP" 2026-11-18T00:00:00Z > /dev/null && fail "available counted" \
  || { [ $? -eq 1 ] && ok "a group that isn't create-failed: not one" || fail "available: wrong status"; }
echo create-failed > "$FAKE/status"
echo '{"Events": [{"SourceIdentifier": "superpower-backend-redis-dev-001", "Message": "Failed: subnet ran out of IPs"}]}' > "$FAKE/events.json"
valkey_capacity_zone "$REGION" "$GROUP" 2026-11-18T00:00:00Z > /dev/null && fail "another reason counted" \
  || { [ $? -eq 1 ] && ok "create-failed for another reason: not one" || fail "other reason: wrong status"; }
echo '{"Events": [{"SourceIdentifier": "other-group-001", "Message": "because ap-south-1a AZ does not have sufficient capacity"}]}' > "$FAKE/events.json"
valkey_capacity_zone "$REGION" "$GROUP" 2026-11-18T00:00:00Z > /dev/null && fail "another group's event counted" \
  || ok "another group's capacity event isn't this one's"
grep -q -- "--start-time 2026-11-18T00:00:00Z" "$FAKE/calls" && ok "events are read from the attempt's start only" \
  || fail "no --start-time"
FAKE_DESCRIBE_FAILS=1 valkey_capacity_zone "$REGION" "$GROUP" 2026-11-18T00:00:00Z > "$WORK/out" 2>&1 \
  && fail "an AWS error counted" \
  || { [ $? -eq 2 ] && grep -q "could not read the replication group" "$WORK/out" \
    && ok "an AWS error is reported, not taken as no capacity failure" || fail "AWS error: $(cat "$WORK/out")"; }

echo "valkey_apply_with_zone_retry"
reset ok
apply && [ "$(count '^terraform apply')" = 1 ] && [ "$(count 'aws ')" = 0 ] \
  && ok "a working apply: once, and nothing else" || fail "first-time apply: $(cat "$FAKE/calls")"

reset full:ap-south-1a ok
apply && [ "$(count '^terraform apply')" = 2 ] && [ "$(count 'delete-replication-group')" = 1 ] \
  && [ "$(count 'wait replication-group-deleted')" = 1 ] \
  && [ "$(plans)" = 'elasticache_preferred_azs={"ap-south-1"=["ap-south-1b","ap-south-1c","ap-south-1a"]}' ] \
  && ok "one full zone: deleted, planned again with the others first, applied" \
  || fail "one full zone: $(cat "$FAKE/calls")"
grep -q "::warning::Valkey: ap-south-1a had no capacity for the node. Deleting the failed group" "$WORK/out" \
  && grep -q "::notice::Valkey: planning again with ap-south-1b first (ap-south-1b ap-south-1c ap-south-1a)." "$WORK/out" \
  && ok "the retry shows in the run: a warning for the full zone, a notice for the next" || fail "annotations: $(cat "$WORK/out")"
grep '^terraform plan' "$FAKE/calls" | grep -q -- "-var-file=tfvars/dev.tfvars -var " \
  && ok "the step's own plan command, with the zones last (so they win)" || fail "plan command: $(cat "$FAKE/calls")"

reset full:ap-south-1a full:ap-south-1b ok
apply && [ "$(plans | tail -1)" = 'elasticache_preferred_azs={"ap-south-1"=["ap-south-1c","ap-south-1a","ap-south-1b"]}' ] \
  && [ "$(count '^terraform apply')" = 3 ] \
  && ok "two full zones: the third, then the full ones" || fail "two full zones: $(cat "$FAKE/calls")"

reset full:ap-south-1a full:ap-south-1b full:ap-south-1c ok
apply && fail "every zone full passed" \
  || { [ "$(count '^terraform apply')" = 3 ] && [ "$(count 'delete-replication-group')" = 3 ] \
    && [ "$(count '^terraform plan')" = 2 ] && grep -q "had no capacity." "$WORK/out" \
    && ok "every zone full: stops after the third, its failed group deleted too (the next run can plan)" \
    || fail "every zone full: $(cat "$FAKE/calls")"; }

reset full:ap-south-1a full:ap-south-1a ok
apply && fail "the same zone twice passed" \
  || { [ "$(count '^terraform apply')" = 2 ] && grep -q "ap-south-1a had no capacity again" "$WORK/out" \
    && ok "the same zone twice: stops instead of looping" || fail "same zone twice: $(cat "$WORK/out")"; }

reset other
apply && fail "another failure passed" \
  || { [ "$(count '^terraform apply')" = 1 ] && [ "$(count 'delete-replication-group')" = 0 ] \
    && [ "$(count '^terraform plan')" = 0 ] && grep -q "not for want of Valkey capacity: no retry" "$WORK/out" \
    && ok "any other failure: fails as before, nothing deleted or retried" || fail "other failure: $(cat "$FAKE/calls")"; }

reset full:ap-south-1a ok
FAKE_DESCRIBE_FAILS=1 apply && fail "an AWS error passed" \
  || { [ "$(count 'delete-replication-group')" = 0 ] && [ "$(count '^terraform apply')" = 1 ] \
    && ok "AWS unreadable after a failure: fails, nothing deleted" || fail "AWS error: $(cat "$FAKE/calls")"; }

reset ok
valkey_apply_with_zone_retry "$REGION" "$GROUP" "$SUBNETS" -- > "$WORK/out" 2>&1 \
  && fail "no plan command passed" || { grep -q "no plan command" "$WORK/out" \
    && [ "$(count '^terraform')" = 0 ] && ok "no plan command: refused before applying" || fail "no plan command"; }

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
