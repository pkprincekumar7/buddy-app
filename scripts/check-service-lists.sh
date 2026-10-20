#!/usr/bin/env bash
# Checks that the service names listed in the `service` input descriptions of
# deploy / restart / promote-live-backend.yml match the entries of
# local.services in infra-live-backend/terraform/services.tf, in deploy_order.
# The lists are only help text (the workflows validate the input against the
# ecs_services SSM list), but a stale one sends people looking for a service
# that doesn't exist. Run: bash scripts/check-service-lists.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVICES_TF="$ROOT/infra-live-backend/terraform/services.tf"
WORKFLOWS=(deploy-live-backend.yml restart-live-backend.yml promote-live-backend.yml)

# Each top-level entry of `services = { ... }` and its deploy_order, sorted by
# deploy_order → "auth, admin, backend, worker".
expected=$(awk '
  /^  services = \{/ { inside = 1; next }
  inside && /^  \}/  { inside = 0 }
  inside && /^    [a-z][a-z0-9-]* = \{/ { key = $1 }
  inside && key != "" && /^      deploy_order *=/ { print $3, key; key = "" }
' "$SERVICES_TF" | sort -n | awk '{print $2}' | paste -sd, - | sed 's/,/, /g')

if [ -z "$expected" ]; then
  echo "ERROR: found no services (with deploy_order) in $SERVICES_TF" >&2
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
