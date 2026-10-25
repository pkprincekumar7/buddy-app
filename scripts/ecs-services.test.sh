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
# logs every call to $FAKE/calls. State is per service / family (deploys run
# in parallel): states-<service> (else states), polls-<service>,
# registered-<family>.json.
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
    j="$(arg --cli-input-json "$@")"; fam="$(jq -r .family <<<"$j")"
    printf '%s' "$j" > "$FAKE/registered-$fam.json"
    echo "arn:aws:ecs:ap-south-1:1:task-definition/$fam:99" ;;
  "ecs describe-services")
    if [ "$(arg --query "$@")" = "services[0]" ]; then
      # One state per call; the last one repeats.
      svc="$(arg --services "$@")"; st="$FAKE/states-$svc"; [ -f "$st" ] || st="$FAKE/states"
      [ -n "${FAKE_POLL_SECONDS:-}" ] && sleep "$FAKE_POLL_SECONDS"
      n=$(( $(cat "$FAKE/polls-$svc" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$FAKE/polls-$svc"
      total=$(wc -l < "$st"); [ "$n" -gt "$total" ] && n=$total
      sed -n "${n}p" "$st"
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
reset_polls() { rm -f "$FAKE"/polls-* "$FAKE"/states-* "$FAKE/calls"; }

# -- resolve_services ----------------------------------------------------------
check "all → every service, rollout order" "$(resolve_services "$BASE" all | jq -r '[.[].name] | join(",")')" "backend,worker,reports"
check "a subset keeps rollout order, not typed order" "$(resolve_services "$BASE" "reports, backend" | jq -r '[.[].name] | join(",")')" "backend,reports"
check "duplicates collapse" "$(resolve_services "$BASE" "worker,worker" | jq -r 'length')" "1"
if out=$(resolve_services "$BASE" "backend,nope" 2>&1); then fail "unknown name is an error"; else
  [[ "$out" == *"unknown service(s): nope. Valid: all, backend, worker, reports."* ]] && ok "unknown name is an error listing the valid ones" || fail "unknown name message" "$out"; fi
if out=$(resolve_services "$BASE" " , " 2>&1); then fail "empty selection is an error"; else ok "empty selection is an error"; fi
if out=$(resolve_services "/superpower/dev/backend/eu-west-1" all 2>&1); then fail "missing manifest is an error"; else
  [[ "$out" == *"ecs_services not found in SSM"* ]] && ok "missing manifest is an error that says to apply Terraform" || fail "missing manifest message" "$out"; fi

# -- image_runtimes / image_services / repository_for ----------------------------
SPLIT='[{"name":"otel-collector","image_service":"","ecr_repository_url":""},{"name":"users","image_service":"users","ecr_repository_url":"1.dkr.ecr/superpower/prod/users"},{"name":"users-worker","image_service":"users","ecr_repository_url":"1.dkr.ecr/superpower/prod/users"},{"name":"platform","image_service":"platform","ecr_repository_url":"1.dkr.ecr/superpower/prod/platform"}]'
check "all leaves out the collector's pinned image" "$(image_runtimes "$SPLIT" all | jq -r '[.[].name] | join(",")')" "users,users-worker,platform"
if out=$(image_runtimes "$(jq -c '.[:2]' <<<"$SPLIT")" "otel-collector,users" 2>&1); then fail "naming the collector is an error"; else
  [[ "$out" == *"otel-collector runs an image Terraform pins"* ]] && ok "naming the collector says to change it in Terraform" || fail "collector message" "$out"; fi
if image_runtimes "$(jq -c '.[:1]' <<<"$SPLIT")" all >/dev/null 2>&1; then fail "nothing to build is an error"; else ok "nothing to build is an error"; fi
check "one image per service, in order: a worker shares its service's" "$(image_services "$SPLIT" | jq -r 'join(",")')" "users,platform"
check "a service's repository comes from the manifest" "$(repository_for "$SPLIT" platform)" "1.dkr.ecr/superpower/prod/platform"
if out=$(repository_for "$SPLIT" grow 2>&1); then fail "an unknown image service is an error"; else
  [[ "$out" == *"no ECR repository for 'grow'"* ]] && ok "an unknown image service is an error" || fail "unknown repository message" "$out"; fi

# -- register_with_image -------------------------------------------------------
cat > "$FAKE/td-superpower-backend-prod.json" <<'EOF'
{"family":"superpower-backend-prod","taskDefinitionArn":"arn:old","revision":4,"status":"ACTIVE","registeredAt":1,"registeredBy":"x","compatibilities":["FARGATE"],"requiresAttributes":[],"cpu":"4096",
 "containerDefinitions":[{"name":"backend","image":"repo:old","environment":[{"name":"A","value":"1"}]},{"name":"aws-otel-collector","image":"otel:v0.40.0"}]}
EOF
arn=$(register_with_image superpower-backend-prod backend repo:new)
check "register returns the new revision" "$arn" "arn:aws:ecs:ap-south-1:1:task-definition/superpower-backend-prod:99"
REG="$FAKE/registered-superpower-backend-prod.json"
check "only the named container's image changes" "$(jq -c '[.containerDefinitions[].image]' "$REG")" '["repo:new","otel:v0.40.0"]'
check "everything else is kept" "$(jq -c '[.cpu, .containerDefinitions[0].environment]' "$REG")" '["4096",[{"name":"A","value":"1"}]]'
check "read-only fields are stripped" "$(jq -c '[has("taskDefinitionArn"), has("revision"), has("status"), has("registeredAt"), has("compatibilities")]' "$REG")" '[false,false,false,false,false]'
if out=$(register_with_image superpower-backend-prod nope repo:new 2>&1); then fail "unknown container is an error"; else
  [[ "$out" == *"has no container named 'nope'"* ]] && ok "unknown container is an error" || fail "unknown container message" "$out"; fi

# -- live_image ----------------------------------------------------------------
cp "$FAKE/td-superpower-backend-prod.json" "$FAKE/td-live.json"
check "live image of a container" "$(live_image cluster superpower-backend-prod backend)" "repo:old"
if live_image cluster superpower-backend-prod nope >/dev/null 2>&1; then fail "live image of a missing container is an error"; else ok "live image of a missing container is an error"; fi

# -- wait_stable ---------------------------------------------------------------
reset_polls; printf '%s\n%s\n' "$ROLLING" "$STABLE" > "$FAKE/states"
wait_stable cluster svc 5 0 >/dev/null && check "waits through a rollout until stable" "$(cat "$FAKE/polls-svc")" "2" || fail "waits through a rollout until stable"
reset_polls; printf '%s\n' "$FAILED" > "$FAKE/states"
if out=$(wait_stable cluster svc 5 0 2>&1); then fail "FAILED rollout is an error"; else
  [[ "$out" == *"rollout FAILED"* ]] && ok "FAILED rollout fails at once" || fail "FAILED message" "$out"; fi
reset_polls; printf '%s\n' "$ROLLING" > "$FAKE/states"
if out=$(wait_stable cluster svc 3 0 2>&1); then fail "timeout is an error"; else
  [[ "$out" == *"did not stabilise"* ]] && check "gives up after ATTEMPTS polls" "$(cat "$FAKE/polls-svc")" "3" || fail "timeout message" "$out"; fi

# -- deploy_image --------------------------------------------------------------
for s in worker reports; do
  jq --arg s "$s" '.family = "superpower-\($s)-prod" | .containerDefinitions = [{"name": $s, "image": "repo:old"}]' \
    "$FAKE/td-superpower-backend-prod.json" > "$FAKE/td-superpower-$s-prod.json"
done
image_for() { echo "repo:sha-$(jq -r .name <<<"$1")"; }
ALL="$(resolve_services "$BASE" all)"
updated() { grep -o 'update-service --cluster cluster --service [a-z-]*' "$FAKE/calls" | awk '{print $NF}' | sort | paste -sd, -; }

reset_polls; printf '%s\n' "$STABLE" > "$FAKE/states"
out=$(deploy_image cluster "$ALL" image_for 2>&1)
check "deploys every selected service" "$(updated)" "superpower-backend-prod,superpower-reports-prod,superpower-worker-prod"
check "each gets its own image" "$(for s in backend worker reports; do jq -r '.containerDefinitions[0].image' "$FAKE/registered-superpower-$s-prod.json"; done | paste -sd, -)" "repo:sha-backend,repo:sha-worker,repo:sha-reports"
[[ "$out" == *"[worker] Registered arn:aws:ecs:ap-south-1:1:task-definition/superpower-worker-prod:99"* && "$out" == *"[backend] superpower-backend-prod is stable"* ]] \
  && ok "output lines are prefixed with the service name" || fail "output prefix" "$out"

# Each status poll takes 2 s: one after another would be >= 6 s for three services.
reset_polls; printf '%s\n' "$STABLE" > "$FAKE/states"
start=$SECONDS
FAKE_POLL_SECONDS=2 deploy_image cluster "$ALL" image_for >/dev/null 2>&1
elapsed=$((SECONDS - start))
[ "$elapsed" -lt 5 ] && ok "services roll out in parallel (${elapsed}s for three 2s rollouts)" || fail "services roll out in parallel" "took ${elapsed}s"

reset_polls; printf '%s\n' "$STABLE" > "$FAKE/states"; printf '%s\n' "$FAILED" > "$FAKE/states-superpower-worker-prod"
if out=$(deploy_image cluster "$ALL" image_for 2>&1); then fail "a failed rollout fails the deploy"; else
  check "a failed rollout doesn't stop the others" "$(updated)" "superpower-backend-prod,superpower-reports-prod,superpower-worker-prod"
  [[ "$out" == *"rollout failed for: worker."* && "$out" == *"service=worker"* && "$out" == *"Rolled out: backend reports"* ]] \
    && ok "the failure names the failed service and how to re-run it" || fail "failure summary" "$out"
fi

reset_polls; printf '%s\n' "$STABLE" > "$FAKE/states"
broken_image() { [ "$(jq -r .name <<<"$1")" = "reports" ] && return 1; echo "repo:x"; }
if out=$(deploy_image cluster "$ALL" broken_image 2>&1); then fail "an IMAGE_FOR failure fails the deploy"; else
  [[ "$out" == *"rollout failed for: reports."* ]] && check "an IMAGE_FOR failure skips only that service" "$(updated)" "superpower-backend-prod,superpower-worker-prod" || fail "IMAGE_FOR failure" "$out"
fi

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
