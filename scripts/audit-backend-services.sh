#!/usr/bin/env bash
# Runs pip-audit on each backend service's requirements.txt (CI's security-scan job and check.sh).
#
#   scripts/audit-backend-services.sh [pip-audit [python]]
#
# The buddy-common line is left out: it's this repository's own package, built from
# backend/common, and pip-audit would otherwise look it up on PyPI.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIP_AUDIT="${1:-pip-audit}"
PYTHON="${2:-python3}"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

status=0
for service in $("$PYTHON" "$ROOT/backend/tools/services.py"); do
  reqs="$tmp/$service-requirements.txt"
  grep -vE '^buddy-common|^[[:space:]]*(#|$)' "$ROOT/backend/$service/requirements.txt" > "$reqs" || true
  if [[ ! -s "$reqs" ]]; then
    echo "backend/$service: nothing to audit beyond buddy-common"
    continue
  fi
  echo "backend/$service:"
  # PYSEC-2025-183: disputed, no fix (see backend/requirements.txt).
  "$PIP_AUDIT" -r "$reqs" --ignore-vuln PYSEC-2025-183 || status=1
done
exit "$status"
