#!/usr/bin/env bash
# Installs one backend service's dependencies into the current Python environment, the way
# its image does (backend/Dockerfile): the service's `buddy-common[extras]==X.Y.Z` line from a
# wheel built from this tree's backend/common, never from PyPI, then the rest of its
# requirements.txt and any extra requirement files.
#
#   scripts/install-backend-service.sh <service> [extra requirements files...]
#   scripts/install-backend-service.sh hello backend/requirements-test.txt
#
# CI's per-service job uses it (check.yml); a mismatched common pin fails here, as in the build.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
service="${1:?usage: $0 <service> [extra requirements files...]}"
shift

[[ "$service" =~ ^[a-z][a-z0-9_]{0,30}$ ]] || { echo "invalid service name: $service" >&2; exit 1; }
req="$ROOT/backend/$service/requirements.txt"
[[ -f "$req" ]] || { echo "no backend/$service/requirements.txt" >&2; exit 1; }

common_lines="$(grep -cE '^buddy-common(\[[a-z,]+\])?==[0-9]+\.[0-9]+\.[0-9]+$' "$req" || true)"
[[ "$common_lines" == 1 ]] \
  || { echo "backend/$service/requirements.txt needs one buddy-common[extras]==X.Y.Z line" >&2; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
grep -E '^buddy-common' "$req" > "$tmp/common.txt"
# Built from a copy: setuptools writes build/ and *.egg-info next to the source it builds.
cp -R "$ROOT/backend/common" "$tmp/common-src"
python -m pip wheel --quiet --no-cache-dir --no-deps --wheel-dir "$tmp" "$tmp/common-src"
python -m pip install --quiet --no-index --no-deps --find-links "$tmp" -r "$tmp/common.txt"

extra=()
for file in "$@"; do extra+=(-r "$file"); done
python -m pip install --quiet -r "$req" ${extra[@]+"${extra[@]}"}
echo "Installed $service: $(python -m pip show buddy-common 2>/dev/null | sed -n 's/^Version: /buddy-common /p')"
