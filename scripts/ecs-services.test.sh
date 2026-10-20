#!/usr/bin/env bash
# SC2015: `cond && ok || fail` is intended — ok/fail only echo and count.
# shellcheck disable=SC2015
# Tests for scripts/ecs-services.sh against a fake `aws` on PATH — no AWS
# access needed. Run: bash scripts/ecs-services.test.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export FAKE="$WORK/fake"
mkdir -p "$FAKE/bin" "$FAKE/ssm"

# -- fake aws ------------------------------------------------------------------
# Answers only the calls ecs-services.sh makes, from files under $FAKE, and
# logs every call to $FAKE/calls.
cat > "$FAKE/bin/aws" <<'EOF'
#!/usr/bin/env bash
echo "$*" >> "$FAKE/calls"
arg() { local want="$1"; shift; while [ $# -gt 0 ]; do [ "$1" = "$want" ] && { echo "$2"; return; }; shift; done; }
case "$1 $2" in
  "ssm get-parameter")
    f="$FAKE/ssm/$(arg --name "$@" | tr '/' '_')"
    [ -f "$f" ] && cat "$f" || { echo "ParameterNotFound" >&2; exit 254; } ;;
  "ecs describe-task-definition")
    q="$(arg --query "$@")"
    if [ "$q" = "taskDefinition" ]; then cat "$FAKE/td-$(arg --task-definition "$@").json"
    else jq -r --arg c "$(sed -n "s/.*name=='\([^']*\)'.*/\1/p" <<<"$q")" \
           '[.containerDefinitions[] | select(.name == $c) | .image][0] // "None"' "$FAKE/td-live.json"; fi ;;
  "ecs register-task-definition")
    arg --cli-input-json "$@" > "$FAKE/registered.json"
    echo "arn:aws:ecs:ap-south-1:1:task-definition/$(jq -r .family "$FAKE/registered.json"):99" ;;
  "ecs describe-services")
    if [ "$(arg --query "$@")" = "services[0]" ]; then
      # One state per call; the last one repeats.
      n=$(( $(cat "$FAKE/polls" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$FAKE/polls"
      total=$(wc -l < "$FAKE/states"); [ "$n" -gt "$total" ] && n=$total
      sed -n "${n}p" "$FAKE/states"
    else echo "arn:aws:ecs:ap-south-1:1:task-definition/live:7"; fi ;;
  "ecs update-service") echo '{"serviceName":"x"}' ;;
  *) echo "fake aws: unexpected call: $*" >&2; exit 1 ;;
esac
EOF
chmod +x "$FAKE/bin/aws"
export PATH="$FAKE/bin:$PATH"

# shellcheck source=scripts/ecs-services.sh
source "$HERE/ecs-services.sh"

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok   - $1"; }
fail() { FAIL=$((FAIL + 1)); echo "FAIL - $1${2:+: $2}"; }
check() { local name="$1" got="$2" want="$3"; [ "$got" = "$want" ] && ok "$name" || fail "$name" "got '$got', want '$want'"; }

BASE="/superpower/prod/backend/ap-south-1"
MANIFEST='[{"name":"backend","service":"superpower-backend-prod","family":"superpower-backend-prod","container":"backend"},{"name":"worker","service":"superpower-worker-prod","family":"superpower-worker-prod","container":"worker"},{"name":"reports","service":"superpower-reports-prod","family":"superpower-reports-prod","container":"reports"}]'
echo "$MANIFEST" > "$FAKE/ssm/$(tr '/' '_' <<<"$BASE/ecs_services")"
STABLE='{"deployments":[{"rolloutState":"COMPLETED"}],"runningCount":2,"pendingCount":0,"desiredCount":2}'
ROLLING='{"deployments":[{"rolloutState":"IN_PROGRESS"},{"rolloutState":"COMPLETED"}],"runningCount":2,"pendingCount":1,"desiredCount":2}'
FAILED='{"deployments":[{"rolloutState":"FAILED"}],"runningCount":1,"pendingCount":0,"desiredCount":2}'
reset_polls() { rm -f "$FAKE/polls" "$FAKE/calls"; }

# -- resolve_services ----------------------------------------------------------
check "all → every service, rollout order" "$(resolve_services "$BASE" all | jq -r '[.[].name] | join(",")')" "backend,worker,reports"
check "a subset keeps rollout order, not typed order" "$(resolve_services "$BASE" "reports, backend" | jq -r '[.[].name] | join(",")')" "backend,reports"
check "duplicates collapse" "$(resolve_services "$BASE" "worker,worker" | jq -r 'length')" "1"
if out=$(resolve_services "$BASE" "backend,nope" 2>&1); then fail "unknown name is an error"; else
  [[ "$out" == *"unknown service(s): nope. Valid: all, backend, worker, reports."* ]] && ok "unknown name is an error listing the valid ones" || fail "unknown name message" "$out"; fi
if out=$(resolve_services "$BASE" " , " 2>&1); then fail "empty selection is an error"; else ok "empty selection is an error"; fi
if out=$(resolve_services "/superpower/dev/backend/eu-west-1" all 2>&1); then fail "missing manifest is an error"; else
  [[ "$out" == *"ecs_services not found in SSM"* ]] && ok "missing manifest is an error that says to apply Terraform" || fail "missing manifest message" "$out"; fi

# -- register_with_image -------------------------------------------------------
cat > "$FAKE/td-superpower-backend-prod.json" <<'EOF'
{"family":"superpower-backend-prod","taskDefinitionArn":"arn:old","revision":4,"status":"ACTIVE","registeredAt":1,"registeredBy":"x","compatibilities":["FARGATE"],"requiresAttributes":[],"cpu":"4096",
 "containerDefinitions":[{"name":"backend","image":"repo:old","environment":[{"name":"A","value":"1"}]},{"name":"aws-otel-collector","image":"otel:v0.40.0"}]}
EOF
arn=$(register_with_image superpower-backend-prod backend repo:new)
check "register returns the new revision" "$arn" "arn:aws:ecs:ap-south-1:1:task-definition/superpower-backend-prod:99"
check "only the named container's image changes" "$(jq -c '[.containerDefinitions[].image]' "$FAKE/registered.json")" '["repo:new","otel:v0.40.0"]'
check "everything else is kept" "$(jq -c '[.cpu, .containerDefinitions[0].environment]' "$FAKE/registered.json")" '["4096",[{"name":"A","value":"1"}]]'
check "read-only fields are stripped" "$(jq -c '[has("taskDefinitionArn"), has("revision"), has("status"), has("registeredAt"), has("compatibilities")]' "$FAKE/registered.json")" '[false,false,false,false,false]'
if out=$(register_with_image superpower-backend-prod nope repo:new 2>&1); then fail "unknown container is an error"; else
  [[ "$out" == *"has no container named 'nope'"* ]] && ok "unknown container is an error" || fail "unknown container message" "$out"; fi

# -- live_image ----------------------------------------------------------------
cp "$FAKE/td-superpower-backend-prod.json" "$FAKE/td-live.json"
check "live image of a container" "$(live_image cluster superpower-backend-prod backend)" "repo:old"
if live_image cluster superpower-backend-prod nope >/dev/null 2>&1; then fail "live image of a missing container is an error"; else ok "live image of a missing container is an error"; fi

# -- wait_stable ---------------------------------------------------------------
reset_polls; printf '%s\n%s\n' "$ROLLING" "$STABLE" > "$FAKE/states"
wait_stable cluster svc 5 0 >/dev/null && check "waits through a rollout until stable" "$(cat "$FAKE/polls")" "2" || fail "waits through a rollout until stable"
reset_polls; printf '%s\n' "$FAILED" > "$FAKE/states"
if out=$(wait_stable cluster svc 5 0 2>&1); then fail "FAILED rollout is an error"; else
  [[ "$out" == *"rollout FAILED"* ]] && ok "FAILED rollout fails at once" || fail "FAILED message" "$out"; fi
reset_polls; printf '%s\n' "$ROLLING" > "$FAKE/states"
if out=$(wait_stable cluster svc 3 0 2>&1); then fail "timeout is an error"; else
  [[ "$out" == *"did not stabilise"* ]] && check "gives up after ATTEMPTS polls" "$(cat "$FAKE/polls")" "3" || fail "timeout message" "$out"; fi

# -- deploy_image --------------------------------------------------------------
for s in worker reports; do
  jq --arg s "$s" '.family = "superpower-\($s)-prod" | .containerDefinitions = [{"name": $s, "image": "repo:old"}]' \
    "$FAKE/td-superpower-backend-prod.json" > "$FAKE/td-superpower-$s-prod.json"
done
image_for() { echo "repo:sha-$(jq -r .name <<<"$1")"; }
reset_polls; printf '%s\n' "$STABLE" > "$FAKE/states"
deploy_image cluster "$(resolve_services "$BASE" all)" image_for >/dev/null
check "deploys every selected service, in order" "$(grep -o 'update-service --cluster cluster --service [a-z-]*' "$FAKE/calls" | awk '{print $NF}' | paste -sd, -)" "superpower-backend-prod,superpower-worker-prod,superpower-reports-prod"
check "each gets its own image" "$(jq -r '.containerDefinitions[0].image' "$FAKE/registered.json")" "repo:sha-reports"
reset_polls; printf '%s\n' "$FAILED" > "$FAKE/states"
if deploy_image cluster "$(resolve_services "$BASE" all)" image_for >/dev/null 2>&1; then fail "a failed rollout stops the deploy"; else
  check "a failed rollout stops before the next service" "$(grep -c 'update-service' "$FAKE/calls")" "1"; fi

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
