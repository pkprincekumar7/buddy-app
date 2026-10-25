#!/usr/bin/env bash
# Checks that the service names listed in the `service` input descriptions of
# deploy / restart / promote-live-backend.yml match the entries of
# the runtimes infra-live-backend/terraform/services.tf builds, in deploy_order.
# The lists are only help text (the workflows validate the input against the
# ecs_services SSM list), but a stale one sends people looking for a service
# that doesn't exist. Run: bash scripts/check-service-lists.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVICES_TF="$ROOT/infra-live-backend/terraform/services.tf"
WORKFLOWS=(deploy-live-backend.yml restart-live-backend.yml promote-live-backend.yml)

# The runtimes in deploy_order, derived the way services.tf derives them: the
# collector first, then each of local.split_services followed by its worker
# (every service except those excluded on the worker_services line). The stack
# test (tests/stack.tftest.hcl) asserts the same order of the real ecs_services
# list, so this and services.tf can't drift apart unnoticed.
services=$(sed -n 's/^  split_services *= *\[\(.*\)\]/\1/p' "$SERVICES_TF" | tr -d '" ' | tr ',' ' ')
no_worker=$(grep -E '^  worker_services *=' "$SERVICES_TF" | grep -oE 's != "[a-z0-9-]+"' | sed -E 's/s != "(.*)"/\1/' | tr '\n' ' ')
expected="otel-collector"
for s in $services; do
  expected="$expected, $s"
  case " $no_worker " in *" $s "*) ;; *) expected="$expected, $s-worker" ;; esac
done
[ -n "$services" ] || expected=""

if [ -z "$expected" ]; then
  echo "ERROR: found no split_services list in $SERVICES_TF" >&2
  exit 1
fi

status=0
for wf in "${WORKFLOWS[@]}"; do
  file="$ROOT/.github/workflows/$wf"
  listed=$(sed -n 's/.*a comma-separated list of: \([a-z0-9, -]*\) (e\.g\..*/\1/p' "$file" | head -n1)
  if [ "$listed" != "$expected" ]; then
    echo "FAIL $wf: the service input lists '${listed:-<nothing>}', services.tf has '$expected'"
    status=1
  else
    echo "ok   $wf: $listed"
  fi
done
[ "$status" -eq 0 ] || echo "Update the 'a comma-separated list of: …' text in those descriptions (deploy_order order)." >&2
exit "$status"
