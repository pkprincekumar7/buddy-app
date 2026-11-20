#!/usr/bin/env bash
# Waits up to 3 minutes for the compose stack (CI: check.yml's dast and e2e jobs): the
# gateway's own health, then each service's /health, read inside its container, since the
# gateway publishes only shared's /api/health. On a timeout, prints the containers' state
# and their last log lines and fails.
#
# Usage: scripts/ci-wait-stack.sh [COMPOSE_ARG...]
#   e.g. scripts/ci-wait-stack.sh --env-file .env --env-file .env.test
# The arguments go before each `docker compose` subcommand: the same env files the stack
# was started with.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Listed once, first: a failed list stops here, where a `for` over $(…) would run no
# iterations and pass, waiting for no service.
svcs=$(python backend/tools/services.py)
[ -n "$svcs" ] || { echo "::error::backend/tools/services.py listed no services."; exit 1; }

up() {
  curl -sf http://localhost:8088/gateway/health > /dev/null || return 1
  local svc
  for svc in $svcs; do
    docker compose "$@" exec -T "$svc" python -c \
      "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')" \
      > /dev/null 2>&1 || return 1
  done
}

for i in {1..60}; do
  if up "$@"; then echo "The stack is up"; exit 0; fi
  echo "Waiting... ($i/60)"
  sleep 3
done
docker compose "$@" ps
docker compose "$@" logs --tail 50
echo "The stack failed to start within 3 minutes"
exit 1
