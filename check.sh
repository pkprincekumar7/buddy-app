#!/usr/bin/env bash
# SC2329: the checks' helper functions are called through run (run "name" fn).
# SC2030/SC2031: in --parallel, each group's PASSED/FAILED are its subshell's own, written
# to files and read back for the summary.
# shellcheck disable=SC2329,SC2030,SC2031
#
# Runs every check that CI runs, locally.
#
# Usage: ./check.sh [--parallel] [GROUP...]
#   ./check.sh                        every group, one after another
#   ./check.sh terraform scripts      only those groups
#   ./check.sh --parallel             every group at once, each into .check-logs/<group>.log
#   ./check.sh --parallel backend-lint backend-test frontend
#   ./check.sh --list                 the groups and what each runs
#
# Each check is independent — all run even if earlier ones fail. Exits non-zero if any
# check failed. The groups share nothing they write, so they can run side by side; they do
# share the CPU, memory and Docker (playwright, images and terraform are the heavy ones).
# The bootstrap (venvs, npm ci, yarn install) always runs first, once, and only for what the
# chosen groups need.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
FRONTEND_APP="$ROOT/frontend-app"

# ── colour helpers ────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

PASSED=(); FAILED=()

run() {
  local name="$1"; shift
  echo ""
  echo -e "${CYAN}${BOLD}── $name ${RESET}"
  if "$@"; then
    echo -e "${GREEN}✓ $name${RESET}"
    PASSED+=("$name")
  else
    echo -e "${RED}✗ $name${RESET}"
    FAILED+=("$name")
  fi
}

# A host tool a check needs: sets the variable named $2 to its path, or records the check as
# failed (with the install hint $3) so a missing tool never passes silently.
require_tool() {
  local path
  path="$(command -v "$1" 2>/dev/null || true)"
  if [ -z "$path" ]; then
    echo -e "${RED}✗ $1 not found in PATH — install: $3${RESET}"
    FAILED+=("$1 (not installed)")
    return 1
  fi
  printf -v "$2" '%s' "$path"
  return 0
}

# ── groups ────────────────────────────────────────────────────────────────────
# In the order a sequential run takes them (lint before tests, as check.yml). e2e runs only
# when named, or with RUN_E2E=1 (it needs the stack in test mode and makes LLM calls).
ALL_GROUPS=(backend-lint frontend app backend-test playwright scripts security images api terraform e2e)
group_info() {
  case "$1" in
    backend-lint) echo "ruff, mypy (tools, common, each service), service tree, import-linter, common installs" ;;
    frontend)     echo "API clients in sync, eslint, prettier, typecheck, build, bundle size, vitest" ;;
    app)          echo "frontend-app: eslint, prettier, typecheck, jest" ;;
    backend-test) echo "pytest + coverage for common, tools and each service (compose mongo and valkey)" ;;
    playwright)   echo "the web app's browser tests and their coverage floor" ;;
    scripts)      echo "edge functions, deploy/drift/smoke script tests, scheduler, shellcheck, actionlint, sync checks" ;;
    security)     echo "bandit, pip-audit, npm/yarn audit, retire.js, gitleaks, semgrep, hadolint, checkov, zizmor, trivy fs/config" ;;
    images)       echo "each service image built, then trivy, SBOM and dockle (Docker)" ;;
    api)          echo "each service's OpenAPI spec up to date, spectral" ;;
    terraform)    echo "fmt, validate, terraform test (and per environment), tflint" ;;
    e2e)          echo "the end-to-end journeys against the local stack in test mode (LLM calls)" ;;
  esac
}
usage() { sed -n '7,20p' "$ROOT/check.sh" | sed 's/^# \{0,1\}//'; }

PARALLEL=0
SELECTED=()
# selected GROUP… → true when any of them was chosen.
selected() {
  local want g
  for want in "$@"; do
    for g in ${SELECTED[@]+"${SELECTED[@]}"}; do [ "$g" = "$want" ] && return 0; done
  done
  return 1
}
while [ $# -gt 0 ]; do
  case "$1" in
    -p|--parallel) PARALLEL=1 ;;
    -l|--list)
      for g in "${ALL_GROUPS[@]}"; do printf '  %-13s %s\n' "$g" "$(group_info "$g")"; done
      exit 0 ;;
    -h|--help) usage; exit 0 ;;
    -*) echo -e "${RED}Unknown option: $1${RESET}"; usage; exit 2 ;;
    *)
      if [ -z "$(group_info "$1")" ]; then
        echo -e "${RED}Unknown group: $1${RESET} (./check.sh --list shows them)"; exit 2
      fi
      # Named twice: once is enough (two copies in --parallel would share one log).
      selected "$1" || SELECTED+=("$1") ;;
  esac
  shift
done
if [ ${#SELECTED[@]} -eq 0 ]; then
  for g in "${ALL_GROUPS[@]}"; do
    [ "$g" = e2e ] && [ "${RUN_E2E:-}" != "1" ] && continue
    SELECTED+=("$g")
  done
fi

# ── bootstrap ─────────────────────────────────────────────────────────────────
# Bootstrap failures exit immediately — these are hard prerequisites, not checks.

# Backend: create the venv on first run, then always sync packages so that
# requirements changes and tool-version bumps are picked up automatically. The venv holds
# every service's runtime packages (requirements-dev.txt, their union) plus the tools.
# pip install is fast (no-ops on already-correct versions).
# Python 3.13 everywhere: same as backend/Dockerfile and CI (check.yml).
PYTHON_VERSION="3.13"
if [ ! -d "$BACKEND/.venv" ]; then
  echo -e "${CYAN}Creating backend/.venv (Python $PYTHON_VERSION)...${RESET}"
  "python$PYTHON_VERSION" -m venv "$BACKEND/.venv" \
    || { echo -e "${RED}Failed to create backend/.venv — is python$PYTHON_VERSION installed? (brew install python@$PYTHON_VERSION)${RESET}"; exit 1; }
fi
VENV_PY_VERSION="$("$BACKEND/.venv/bin/python" -c 'import sys; print(f"{sys.version_info[0]}.{sys.version_info[1]}")' 2>/dev/null)"
if [ "$VENV_PY_VERSION" != "$PYTHON_VERSION" ]; then
  echo -e "${RED}backend/.venv is Python ${VENV_PY_VERSION:-unknown}, but CI and Docker use $PYTHON_VERSION — recreate it:${RESET}"
  echo "  rm -rf backend/.venv && ./check.sh"
  exit 1
fi
# The security tools (requirements-security.txt) get a venv of their own,
# backend/.venv-security, as CI installs them in a job of their own (check.yml,
# security-scan). They pin what the services can't share: semgrep OpenTelemetry ~=1.37
# (the services and requirements-test.txt pin 1.45.2, GHSA-mf5v-w3w3-f6cg), checkov
# boto3==1.35.49 (the services pin a newer boto3). So backend/.venv holds what CI's
# backend jobs install (dev, lint, test) and nothing else.
SECURITY_VENV="$BACKEND/.venv-security"

echo -e "${CYAN}Syncing backend/.venv...${RESET}"
"$BACKEND/.venv/bin/pip" install -q \
  -r "$BACKEND/requirements-dev.txt" \
  -r "$BACKEND/requirements-lint.txt" \
  -r "$BACKEND/requirements-test.txt" \
  || { echo -e "${RED}pip install failed — check your network or the requirements files${RESET}"; exit 1; }

# The security tools only run in the security group.
if selected security; then
if [ ! -d "$SECURITY_VENV" ]; then
  echo -e "${CYAN}Creating backend/.venv-security (Python $PYTHON_VERSION)...${RESET}"
  "python$PYTHON_VERSION" -m venv "$SECURITY_VENV" \
    || { echo -e "${RED}Failed to create backend/.venv-security${RESET}"; exit 1; }
fi
echo -e "${CYAN}Syncing backend/.venv-security...${RESET}"
"$SECURITY_VENV/bin/pip" install -q -r "$BACKEND/requirements-security.txt" \
  || { echo -e "${RED}pip install of the security tools failed — check your network or requirements-security.txt${RESET}"; exit 1; }
fi

# node_modules only for the groups that use them.
if selected frontend playwright security api; then

# Frontend: npm ci, as CI does — installs exactly what package-lock.json says and
# never rewrites it (npm install can, so local checks could run against different
# packages than CI). Slower: it deletes and reinstalls node_modules every run.
# --quiet suppresses progress bars but still shows warnings and errors.
echo -e "${CYAN}Installing frontend/node_modules (npm ci)...${RESET}"
(cd "$FRONTEND" && npm ci --quiet) \
  || { echo -e "${RED}npm ci failed — check your network, or run npm install if package-lock.json is out of sync with package.json${RESET}"; exit 1; }
fi

if selected app security; then

echo -e "${CYAN}Syncing frontend-app/node_modules...${RESET}"
(cd "$FRONTEND_APP" && yarn install --frozen-lockfile --quiet) \
  || { echo -e "${RED}yarn install failed — check your network or package.json${RESET}"; exit 1; }
fi

if selected security; then
# retire.js vulnerability database — download if absent or older than 7 days.
# Gitignored so it stays current without committing a static snapshot.
RETIRE_DB="$FRONTEND/retire-jsrepo.json"
if [ ! -f "$RETIRE_DB" ] || find "$RETIRE_DB" -mtime +7 | grep -q .; then
  echo -e "${CYAN}Refreshing retire.js vulnerability database...${RESET}"
  if ! curl -sSfL \
      "https://raw.githubusercontent.com/RetireJS/retire.js/master/repository/jsrepository-v5.json" \
      -o "$RETIRE_DB"; then
    if [ -f "$RETIRE_DB" ]; then
      echo -e "${CYAN}Network unavailable — using existing retire.js database (may be stale)${RESET}"
    else
      echo -e "${RED}Cannot download retire.js database and no local copy exists — check network${RESET}"
      exit 1
    fi
  fi
fi
fi

# ── tool discovery ────────────────────────────────────────────────────────────
# Prefer tools from backend/.venv; fall back to PATH for CI (which installs
# tools globally via pip install rather than using a venv).
VENV_BIN="$BACKEND/.venv/bin"
_tool() {
  # _tool <name>: return venv path if it exists, otherwise fall back to PATH.
  if [ -x "$VENV_BIN/$1" ]; then echo "$VENV_BIN/$1"; else echo "$1"; fi
}
RUFF="$(_tool ruff)"
MYPY="$(_tool mypy)"
PYTHON="$(_tool python)"
# The security tools: from their own venv (see the sync above), else PATH.
_security_tool() {
  if [ -x "$SECURITY_VENV/bin/$1" ]; then echo "$SECURITY_VENV/bin/$1"; else echo "$1"; fi
}
BANDIT="$(_security_tool bandit)"
PIP_AUDIT="$(_security_tool pip-audit)"
SEMGREP="$(_security_tool semgrep)"
CHECKOV="$(_security_tool checkov)"
ZIZMOR="$(_security_tool zizmor)"
PYTEST="$(_tool pytest)"

# The services in the tree (backend/tools/services.py): several groups go over each one.
SERVICES=()
read -ra SERVICES <<< "$("$VENV_BIN/python" "$BACKEND/tools/services.py" 2>/dev/null | tr '\n' ' ')"
# For the scanners: "auth/ users/ …" relative to backend/, and the same under $BACKEND.
SERVICE_DIRS="${SERVICES[*]+${SERVICES[*]/%//}}"
SERVICE_PATHS="${SERVICES[*]+${SERVICES[*]/#/$BACKEND/}}"

# Bodies aren't indented: some embed Python in strings, where indentation is code.
group_backend_lint() {
# ── backend lint ──────────────────────────────────────────────────────────────
# Lint first, every area, then the tests (as check.yml: each test job waits for its lint job).
echo -e "\n${BOLD}════ BACKEND LINT ════${RESET}"

run "ruff check" \
    bash -c "cd '$BACKEND' && '$RUFF' check ."

run "ruff format (check)" \
    bash -c "cd '$BACKEND' && '$RUFF' format --check ."

run "mypy" \
    bash -c "cd '$BACKEND' && '$MYPY' tools/ common/"

# Every directory under backend/ with requirements.txt is a service (tools/services.py);
# each is type-checked, tested and spec-checked on its own below.
run "service tree valid (tools/services.py --check)" \
    bash -c "cd '$BACKEND' && '$VENV_BIN/python' tools/services.py --check"

for svc in ${SERVICES[@]+"${SERVICES[@]}"}; do
  run "mypy ($svc)" \
      bash -c "cd '$BACKEND' && '$MYPY' '$svc/'"
done

# Service import boundaries (docs/auth-users-split.md, section 2), generated from the
# services in the tree.
run "import-linter (service boundaries)" \
    bash -c "cd '$BACKEND' && '$VENV_BIN/python' tools/import_contracts.py"

# The shared package must install on its own and with each extra, as every service
# image installs it. Into a throwaway venv, as an image does: a --target install was
# checked against the local venv's packages too, so pip printed conflicts that no image
# has (and couldn't fail on one that it did). pip check after each install fails on one.
run "common installs (core and extras)" \
    bash -c "tmp=\$(mktemp -d) && trap 'rm -rf \"\$tmp\"' EXIT \
      && cp -R '$BACKEND/common' \"\$tmp/src\" && '$PYTHON' -m venv \"\$tmp/venv\" \
      && pip() { \"\$tmp/venv/bin/pip\" --disable-pip-version-check \"\$@\"; } \
      && pip install -q \"\$tmp/src\" && pip check \
      && pip install -q \"\$tmp/src[generation,uploads]\" && pip check"
}

group_frontend() {
# ── frontend lint ─────────────────────────────────────────────────────────────
echo -e "\n${BOLD}════ FRONTEND LINT ════${RESET}"

# Both apps' typed API files, generated from backend/openapi/*.json (build plan 7.1).
run "API clients in sync (backend/openapi)" \
    node "$ROOT/scripts/sync-api-clients.mjs" --check

run "eslint" \
    bash -c "cd '$FRONTEND' && npm run lint"

run "prettier (check)" \
    bash -c "cd '$FRONTEND' && node_modules/.bin/prettier --check 'src/**/*.{ts,tsx,css}' 'e2e/**/*.ts' playwright.config.ts vitest.config.ts"

run "typecheck" \
    bash -c "cd '$FRONTEND' && npm run typecheck"

run "build" \
    bash -c "cd '$FRONTEND' && npm run build"

bundle_size_check() {
  local bundles=("$FRONTEND"/dist/assets/index-*.js) bundle
  bundle="${bundles[0]}"
  if [ ! -f "$bundle" ]; then echo "No bundle found in dist/assets/"; return 1; fi
  local size limit=1468006  # 1.4 MB = 1.4 * 1024 * 1024 — same as check.yml
  size=$(wc -c < "$bundle")
  echo "Bundle: $(basename "$bundle") — ${size} bytes (limit ${limit})"
  if [ "$size" -gt "$limit" ]; then
    echo "Main bundle exceeds 1.4 MB limit"
    return 1
  fi
}
run "bundle size (≤ 1.4 MB)" bundle_size_check

# ── frontend tests ────────────────────────────────────────────────────────────
echo -e "\n${BOLD}════ FRONTEND TESTS ════${RESET}"

# Component tests (jsdom) and browser tests (the app against a stubbed API), as check.yml's
# frontend-test and frontend-e2e jobs; docs/web-ui-test-plan.md.
run "vitest (frontend)" \
    bash -c "cd '$FRONTEND' && npm test"
}

group_app() {
# ── frontend-app lint ─────────────────────────────────────────────────────────
echo -e "\n${BOLD}════ FRONTEND-APP LINT ════${RESET}"

run "eslint (frontend-app)" \
    bash -c "cd '$FRONTEND_APP' && yarn lint"

run "prettier (check) (frontend-app)" \
    bash -c "cd '$FRONTEND_APP' && node_modules/.bin/prettier --check 'src/**/*.{ts,tsx}'"

run "typecheck (frontend-app)" \
    bash -c "cd '$FRONTEND_APP' && node_modules/.bin/tsc --noEmit"

# ── frontend-app tests ────────────────────────────────────────────────────────
echo -e "\n${BOLD}════ FRONTEND-APP TESTS ════${RESET}"

run "jest (frontend-app)" \
    bash -c "cd '$FRONTEND_APP' && CI=true yarn test --ci"
}

group_backend_test() {
# ── backend tests ─────────────────────────────────────────────────────────────
# common's and the tools' tests, then each service's. Same commands and coverage gates as CI.
# The real Mongo/Redis integration tests skip unless pointed at throwaway servers — never a
# real cluster — and without them the coverage gates fail. Each one unset defaults to its
# docker-compose container when it's running (docker compose up -d mongo valkey), on the port
# compose published (MONGO_PORT / VALKEY_PORT in .env); set MONGODB_TEST_URI / REDIS_URL
# yourself to use others.
echo -e "\n${BOLD}════ BACKEND TESTS ════${RESET}"

# compose_port SERVICE PORT → the host port compose published it on, or nothing if it isn't
# running.
compose_port() {
  local published
  published="$(docker compose -f "$ROOT/docker-compose.yml" port "$1" "$2" 2>/dev/null | head -1)"
  [ -n "$published" ] && echo "${published##*:}"
}

if [ -z "${MONGODB_TEST_URI:-}" ] && port="$(compose_port mongo 27017)"; then
  export MONGODB_TEST_URI="mongodb://localhost:${port}/?directConnection=true"
  echo -e "${CYAN}Live Mongo tests: the compose mongo container (port ${port}).${RESET}"
fi
if [ -z "${REDIS_URL:-}" ] && port="$(compose_port valkey 6379)"; then
  export REDIS_URL="redis://localhost:${port}"
  echo -e "${CYAN}Live Valkey tests: the compose valkey container (port ${port}).${RESET}"
fi
if [ -z "${MONGODB_TEST_URI:-}" ] || [ -z "${REDIS_URL:-}" ]; then
  echo -e "${RED}Live tests will skip and the coverage gates fail: start the compose mongo and valkey (docker compose up -d mongo valkey), or set MONGODB_TEST_URI and REDIS_URL.${RESET}"
fi

run "pytest + coverage (common, tools)" \
    bash -c "cd '$BACKEND' && '$PYTEST' common/tests tools/tests --cov=common --cov-branch --cov-report=term-missing --cov-fail-under=99 -q"

# Each service's tests, with its own coverage gate. Locally they share the backend venv;
# CI installs each service alone (scripts/install-backend-service.sh), which also proves
# its requirements.txt is complete.
for svc in ${SERVICES[@]+"${SERVICES[@]}"}; do
  run "pytest + coverage ($svc)" \
      bash -c "cd '$BACKEND' && '$PYTEST' '$svc/tests' --cov='$svc' --cov-branch --cov-report=term-missing --cov-fail-under=99 -q"
done
}

group_playwright() {
echo -e "\n${BOLD}════ PLAYWRIGHT ════${RESET}"
# Playwright's own Chromium when installed (cd frontend && npx playwright install chromium),
# else the installed Google Chrome (playwright.config.ts); skipped with neither.
browser_tests() {
  local bundled
  bundled=$(cd "$FRONTEND" && node -e "const fs=require('fs');const {chromium}=require('@playwright/test');process.stdout.write(fs.existsSync(chromium.executablePath())?'1':'')")
  if [ -z "$bundled" ] && [ ! -d "/Applications/Google Chrome.app" ] && ! command -v google-chrome >/dev/null 2>&1; then
    echo "Skipped: no browser. Install one with 'cd frontend && npx playwright install chromium'."
    return 0
  fi
  (cd "$FRONTEND" && npm run test:e2e:ci)
}
run "playwright (frontend)" browser_tests
}

group_scripts() {
# ── scripts, edge and scheduler ───────────────────────────────────────────────
# check.yml's lambda-edge-test job: the edge functions, the deploy scripts against fake
# CLIs, the scheduler, and the checks that generated or listed copies are in sync.
echo -e "\n${BOLD}════ SCRIPTS, EDGE AND SCHEDULER ════${RESET}"

# Renders the .tpl through real `terraform apply` (not a hand-rolled reimplementation
# of HCL's templatefile() syntax), so this exercises exactly what gets deployed.
# Uses Node's built-in test runner — no new dependency. Self-skips with a clear
# message if terraform isn't on PATH, rather than failing the whole run.
run "jwt-validator-lambda unit tests (infra-live-edge)" \
    node --test "$ROOT/infra-live-edge/functions/jwt-validator-lambda.test.js"

# The default behaviour's SPA fallback (CloudFront Function, EDGE-03). Plain
# Node — no terraform needed.
run "spa-rewrite CloudFront Function unit tests (infra-live-edge)" \
    node --test "$ROOT/infra-live-edge/functions/spa-rewrite.test.js"

# Shared helpers of the deploy / restart / promote backend workflows, against a
# fake aws CLI (no AWS access needed).
run "ecs-services.sh tests (scripts)" \
    bash "$ROOT/scripts/ecs-services.test.sh"
# terraform-live-backend's first-apply fill of the per-service secrets, against
# a fake aws CLI (fake values only).
run "fill-service-secrets.sh tests (scripts)" \
    bash "$ROOT/scripts/fill-service-secrets.test.sh"
# The service-token key pairs made outside Terraform (SEC-01), against a fake aws CLI.
run "service-token-keys.sh tests (scripts)" \
    bash "$ROOT/scripts/service-token-keys.test.sh"
# terraform-live-backend's retry when Valkey's zone was full, against a fake aws and terraform.
run "valkey-capacity.sh tests (scripts)" \
    bash "$ROOT/scripts/valkey-capacity.test.sh"
run "smoke.sh tests (scripts)" \
    bash "$ROOT/scripts/smoke.test.sh"
run "drift.sh tests (scripts)" \
    bash "$ROOT/scripts/drift.test.sh"
# The frontend deploy's S3 sync, invalidation and asset pruning (CI-07), against a fake aws CLI.
run "frontend-publish.sh tests (scripts)" \
    bash "$ROOT/scripts/frontend-publish.test.sh"
# The frontend releases kept for rollback-live-frontend (CI-07): save, prune, restore.
run "frontend releases tests (scripts)" \
    bash "$ROOT/scripts/frontend-release.test.sh"
# The reusable workflows' input checks (SEC-07): environment, action, regions.
run "workflow-inputs.sh tests (scripts)" \
    bash "$ROOT/scripts/workflow-inputs.test.sh"
# The scheduler's GitHub dispatcher (SCH-01), standard library only: no AWS or GitHub.
run "scheduler dispatcher tests (infra-live-scheduler)" \
    "$VENV_BIN/python" "$ROOT/infra-live-scheduler/lambda/test_dispatcher.py"
# The service names listed in those workflows' `service` input descriptions
# must match services.tf (they're the help text people pick names from).
run "service lists match services.tf (scripts)" \
    bash "$ROOT/scripts/check-service-lists.sh"
# Every tracked shell script, this one included, as CI checks them: a new one needs no list.
SHELLCHECK=""
if require_tool shellcheck SHELLCHECK "brew install shellcheck"; then
  run "shellcheck (every shell script)" \
      bash -c "cd '$ROOT' && git ls-files -z '*.sh' | xargs -0 '$SHELLCHECK' -x"
fi
# Every workflow, as CI checks them (each run: script goes through shellcheck too).
ACTIONLINT=""
if require_tool actionlint ACTIONLINT "brew install actionlint"; then
  run "actionlint (every workflow)" \
      bash -c "cd '$ROOT' && '$ACTIONLINT'"
fi

# shared/routing.json → generated backend/common/regions_data.py, backend/auth/countries_data.py
# and the frontends' countries.ts / locationHint.ts. Fails if a generated copy is stale.
run "routing data in sync (shared/routing.json)" \
    node "$ROOT/scripts/sync-routing.mjs" --check

run "gateway config in sync (shared/service-routes.json)" \
    node "$ROOT/scripts/sync-gateway.mjs" --check
}

group_security() {
# ── security ──────────────────────────────────────────────────────────────────
echo -e "\n${BOLD}════ SECURITY ════${RESET}"

# ---- always-run: tools available from the bootstrapped venv / npm ----------------
run "bandit" \
    bash -c "cd '$BACKEND' && '$BANDIT' -r tools/ common/ $SERVICE_DIRS -ll -q"

# Each service's pins, as its image installs them.
run "pip-audit (services)" \
    bash "$ROOT/scripts/audit-backend-services.sh" "$PIP_AUDIT" "$VENV_BIN/python"
# PYSEC-2025-183 is disputed with no fix (see requirements-dev.txt).

# Ignored (no fixed release exists): GHSA-vfj7-8cjw-p6xm — braces <=3.0.3 stack-exhaustion
# DoS on crafted brace patterns. Reached only via build tooling (tailwindcss, spectral-cli),
# never in the shipped bundle. Remove once braces publishes a fix.
# Also GHSA-fc5q-39xc-vjpf — picomatch <=4.0.7 ReDoS, no fixed release; only via build
# tooling (tailwindcss, vite, vitest, spectral-cli, lint-staged). Remove once one ships.
run "npm audit" \
    bash -c "cd '$FRONTEND' && npm audit --json 2>/dev/null | python3 -c \"
import json,sys
IGNORED={'GHSA-qwww-vcr4-c8h2','GHSA-mh99-v99m-4gvg','GHSA-vfj7-8cjw-p6xm','GHSA-fc5q-39xc-vjpf'}
d=json.load(sys.stdin)
def is_ignored(v, all_vulns):
    for x in v.get('via',[]):
        if isinstance(x,dict):
            url=x.get('url','')
            if not any(i in url for i in IGNORED): return False
        elif isinstance(x,str):
            dep=all_vulns.get(x,{})
            if not is_ignored(dep, all_vulns): return False
    return True
vulns=d.get('vulnerabilities',{})
bad=[k for k,v in vulns.items() if v['severity'] in ('high','critical') and not is_ignored(v,vulns)]
sys.exit(1 if bad else 0)
\""

# yarn v1 --json outputs NDJSON; parse it to filter known-acceptable advisories before
# checking severity. Fail only on unignored high (bit 3) or critical (bit 4) findings.
# Ignored: 1124334 (GHSA-mh99-v99m-4gvg) — brace-expansion DoS; only in dev tooling
# (eslint, jest), never shipped to the production bundle.
# Ignored (no fixed release exists; remove once one ships):
#   1240992 (GHSA-vfj7-8cjw-p6xm) — braces <=3.0.3 DoS; only via build/test tooling
#     (tailwindcss, @react-native-community/cli, jest), not in the APK/IPA bundle.
#   1240912 (GHSA-86w9-cpqp-85rv) — node-forge <=1.4.0 RSA signature verification;
#     only via @expo/cli (dev CLI), not bundled into the app.
#   1247710 (GHSA-fc5q-39xc-vjpf) — picomatch <=4.0.7 ReDoS; only via build/test
#     tooling (@expo/cli, metro, jest, tailwindcss), not in the APK/IPA bundle.
# Ignored (fix needs a major upgrade the dev tools don't support yet):
#   1243066 (GHSA-mrhx-c7xc-m3w5) — zod <4.6.6 DoS; only via @expo/cli (zod 3) and
#     eslint-plugin-react-hooks, not in the APK/IPA. Remove once both use zod >=4.6.6.
# image-size's GHSA-5p2g-fcmc-qvqq/GHSA-w3rx-r6r6-pgpr (formerly flagged as advisory
# IDs 1138808/1138809, now 1239765/1239766) is fixed by forcing image-size to ^2.0.4
# via frontend-app/package.json's resolutions/overrides — no ignore needed any more.
run "yarn audit (frontend-app)" \
    bash -c "cd '$FRONTEND_APP' && yarn audit --json 2>/dev/null | python3 -c \"
import json,sys
IGNORED_IDS={1124334,1240992,1240912,1243066,1247710}
high=0
for line in sys.stdin:
    line=line.strip()
    if not line: continue
    try: obj=json.loads(line)
    except: continue
    if obj.get('type')!='auditAdvisory': continue
    adv=obj['data']['advisory']
    if adv.get('id') in IGNORED_IDS: continue
    if adv.get('severity') in ('high','critical'): high+=1
sys.exit(1 if high else 0)
\""

# retire-jsrepo.json is downloaded by the bootstrap above (refreshed every 7 days).
# --jsrepo avoids retire.js making its own network request on every invocation.
run "retire.js (browser library CVE scan)" \
    bash -c "'$FRONTEND/node_modules/.bin/retire' --path '$FRONTEND' --exitwith 1 --jsrepo '$FRONTEND/retire-jsrepo.json'"

run "retire.js (frontend-app library CVE scan)" \
    bash -c "'$FRONTEND/node_modules/.bin/retire' --path '$FRONTEND_APP' --exitwith 1 --jsrepo '$FRONTEND/retire-jsrepo.json'"

# ---- mandatory: external tools — check.sh fails if any are absent ----------------
# semgrep and checkov are installed into .venv-security via requirements-security.txt above.
# The tools below must be installed on the host; see install hints on failure.
# Docker must also be running — it is required for the trivy image scan.
GITLEAKS=""; HADOLINT=""; TRIVY=""; DOCKER=""

if require_tool gitleaks GITLEAKS "brew install gitleaks"; then
  run "gitleaks (secret detection)" \
      bash -c "cd '$ROOT' && '$GITLEAKS' detect --source . --redact --config '$ROOT/.gitleaks.toml'"
fi

run "semgrep (SAST)" \
    bash -c "'$SEMGREP' --config p/security-audit --error '$BACKEND/tools/' '$BACKEND/common/' $SERVICE_PATHS '$ROOT/frontend/src/' '$ROOT/frontend-app/src/'"

if require_tool hadolint HADOLINT "brew install hadolint"; then
  run "hadolint (backend Dockerfile)" \
      bash -c "'$HADOLINT' '$BACKEND/Dockerfile'"
  run "hadolint (frontend Dockerfile)" \
      bash -c "'$HADOLINT' '$FRONTEND/Dockerfile'"
fi

run "checkov (Terraform IaC)" \
    bash -c "cd '$ROOT' && '$CHECKOV' -d . \
      --skip-path node_modules --skip-path '\.terraform' --skip-path '\.venv' \
      --framework terraform --quiet --compact --skip-download"

run "zizmor (GitHub Actions security)" \
    bash -c "cd '$ROOT' && '$ZIZMOR' --offline --no-progress .github/"

if require_tool trivy TRIVY "brew install aquasecurity/trivy/trivy"; then
  run "trivy (backend CVE scan)" \
      bash -c "'$TRIVY' fs --exit-code 1 --severity HIGH,CRITICAL --scanners vuln '$BACKEND/'"
  run "trivy (frontend CVE scan)" \
      bash -c "'$TRIVY' fs --exit-code 1 --severity HIGH,CRITICAL --scanners vuln '$FRONTEND/'"

  run "trivy (backend license scan)" \
      bash -c "'$TRIVY' fs --exit-code 1 --severity HIGH,CRITICAL --scanners license '$BACKEND/'"
  run "trivy (frontend license scan)" \
      bash -c "'$TRIVY' fs --exit-code 1 --severity HIGH,CRITICAL --scanners license '$FRONTEND/'"

  run "trivy (frontend SBOM)" \
      bash -c "'$TRIVY' fs --format cyclonedx --output '$ROOT/sbom-frontend.cyclonedx.json' '$FRONTEND/' \
        && echo 'Frontend SBOM → sbom-frontend.cyclonedx.json'"

  # --ignorefile: dev-tooling CVEs with no fix or no forceable one (brace-expansion,
  # braces, node-forge, picomatch, zod via @expo/cli), none in the APK or IPA; frontend-app/.trivyignore
  # has the rationale, and the yarn audit IGNORED_IDS list above the same exceptions.
  run "trivy (frontend-app CVE scan)" \
      bash -c "'$TRIVY' fs --exit-code 1 --severity HIGH,CRITICAL --scanners vuln \
        --ignorefile '$FRONTEND_APP/.trivyignore' '$FRONTEND_APP/'"

  run "trivy (frontend-app license scan)" \
      bash -c "'$TRIVY' fs --exit-code 1 --severity HIGH,CRITICAL --scanners license '$FRONTEND_APP/'"

  run "trivy (frontend-app SBOM)" \
      bash -c "'$TRIVY' fs --format cyclonedx --output '$ROOT/sbom-frontend-app.cyclonedx.json' '$FRONTEND_APP/' \
        && echo 'frontend-app SBOM → sbom-frontend-app.cyclonedx.json'"

  run "trivy config (infra-live-backend)" \
      bash -c "'$TRIVY' config '$ROOT/infra-live-backend/terraform' --exit-code 1 --severity HIGH,CRITICAL"
  run "trivy config (infra-live-edge)" \
      bash -c "'$TRIVY' config '$ROOT/infra-live-edge/terraform' --exit-code 1 --severity HIGH,CRITICAL"
  run "trivy config (infra-live-frontend)" \
      bash -c "'$TRIVY' config '$ROOT/infra-live-frontend/terraform' --exit-code 1 --severity HIGH,CRITICAL"
  run "trivy config (infra-live-scheduler)" \
      bash -c "'$TRIVY' config '$ROOT/infra-live-scheduler/terraform' --exit-code 1 --severity HIGH,CRITICAL"
  run "trivy config (modules)" \
      bash -c "'$TRIVY' config '$ROOT/modules' --exit-code 1 --severity HIGH,CRITICAL"

fi
}

group_images() {
echo -e "\n${BOLD}════ IMAGES ════${RESET}"
# Its own Trivy cache when run beside the security group: two Trivy processes on one cache
# wait on its lock and time out. The first run fills it (the vulnerability database).
[ "$PARALLEL" = 1 ] && export TRIVY_CACHE_DIR="${TRIVY_IMAGES_CACHE_DIR:-$HOME/.cache/trivy-check-images}"
TRIVY=""; DOCKER=""
if require_tool trivy TRIVY "brew install aquasecurity/trivy/trivy" \
  && require_tool docker DOCKER "https://docs.docker.com/get-docker/"; then
  DOCKLE=""
  require_tool dockle DOCKLE "brew install goodwithtech/r/dockle" || true

  # Each service's image, as it ships: built once and shared by the trivy image scan, its
  # SBOM (sbom-backend-<service>.cyclonedx.json) and dockle, then removed. GIT_SHA is only
  # the image's metadata. The base image is pinned by digest (CI-03), so the
  # scan sees exactly what a deploy builds; new Debian fixes come as a Dependabot digest bump.
  scan_service_image() {
    local svc="$1" image="superpower-$1:check-scan"
    echo "Building the $svc image for scan..."
    "$DOCKER" build --build-arg SERVICE="$svc" --build-arg GIT_SHA="local-scan" \
      -t "$image" -f "$BACKEND/Dockerfile" "$ROOT" || return 1
    local status=0
    "$TRIVY" image --exit-code 1 --severity HIGH,CRITICAL --scanners vuln --ignore-unfixed "$image" \
      || status=1
    "$TRIVY" image --format cyclonedx --output "$ROOT/sbom-backend-$svc.cyclonedx.json" "$image" \
      && echo "$svc SBOM → sbom-backend-$svc.cyclonedx.json" || status=1
    if [ -n "$DOCKLE" ]; then
      "$DOCKLE" -af settings.py --ignore DKL-DI-0005 "$image" || status=1
    fi
    "$DOCKER" rmi "$image" >/dev/null 2>&1 || true
    return "$status"
  }
  for svc in ${SERVICES[@]+"${SERVICES[@]}"}; do
    run "image scan ($svc: trivy, SBOM, dockle)" scan_service_image "$svc"
  done
fi
}

group_api() {
# ── dast & api spec ───────────────────────────────────────────────────────────
# spectral: each service's spec, exported from its app without a running server.
# nuclei:   only in CI (below); it would need the compose stack's gateway on :8088.
echo -e "\n${BOLD}════ DAST & API SPEC ════${RESET}"

# spectral is a local devDependency in frontend/ — available after npm install (bootstrap),
# no global install required.
SPECTRAL="$FRONTEND/node_modules/.bin/spectral"

# Each HTTP service's committed spec (backend/openapi/<service>.json) is tracked in git. CI
# regenerates it and fails if the committed copy differs; this fails the same way when your
# copy is stale, after writing the fresh one so you can review and commit it. Then it's linted.
service_spec_up_to_date() {
  local svc="$1" spec="$ROOT/backend/openapi/$1.json" fresh
  fresh="$(mktemp)"
  "$VENV_BIN/python" "$ROOT/backend/tools/export-openapi.py" --service "$svc" > "$fresh" \
    || { rm -f "$fresh"; echo "Failed to export the $svc spec"; return 1; }
  if [[ -f "$spec" ]] && cmp -s "$fresh" "$spec"; then
    rm -f "$fresh"
  else
    mkdir -p "$(dirname "$spec")"
    cat "$fresh" > "$spec" && rm -f "$fresh"
    echo "backend/openapi/$svc.json was out of date — regenerated it. Review and commit."
    return 1
  fi
}
for svc in ${SERVICES[@]+"${SERVICES[@]}"}; do
  if [[ -f "$BACKEND/$svc/app/main.py" ]]; then
    run "backend/openapi/$svc.json up to date" service_spec_up_to_date "$svc"
    run "spectral ($svc)" \
        "$SPECTRAL" lint "$ROOT/backend/openapi/$svc.json" --ruleset "$ROOT/.spectral.yaml" --fail-severity error
  fi
done

# nuclei (DAST) is disabled locally per company security-team guidance (active
# scanning tool, not permitted on company laptops). CI (check.yml) is unaffected
# and still runs it.
# if require_tool nuclei NUCLEI "brew install nuclei"; then
#   nuclei_dast() {
#     if ! curl -sf http://localhost:8088/gateway/health > /dev/null 2>&1; then
#       echo "The gateway isn't running at http://localhost:8088 — start the stack first:"
#       echo "  docker compose up -d --build"
#       return 1
#     fi
#     "$NUCLEI" -u http://localhost:8088 \
#       -t http/misconfiguration,http/exposures,http/technologies \
#       -severity medium,high,critical \
#       -silent -no-color
#   }
#   run "nuclei (DAST)" nuclei_dast
# fi
}

group_terraform() {
# ── terraform ─────────────────────────────────────────────────────────────────
echo -e "\n${BOLD}════ TERRAFORM ════${RESET}"

TERRAFORM=""; TFLINT=""

if require_tool terraform TERRAFORM "brew install terraform"; then
  run "terraform fmt check" \
      bash -c "cd '$ROOT' && '$TERRAFORM' fmt -check -recursive"
  # Every stack and module type-checks (CI-15): a misspelled argument or attribute fails
  # here rather than at plan time in an environment.
  for d in "$ROOT"/infra-live-*/terraform/ "$ROOT"/modules/*/; do
    name="${d#"$ROOT/"}"
    run "terraform validate (${name%/})" \
        bash -c "cd '$d' && '$TERRAFORM' init -backend=false -input=false >/dev/null && '$TERRAFORM' validate -no-color"
  done
  # Mock AWS provider — no credentials, nothing created (TF-01).
  for d in "$ROOT"/modules/*/ "$ROOT/infra-live-backend/terraform/" "$ROOT/infra-live-edge/terraform/" "$ROOT/infra-live-frontend/terraform/" "$ROOT/infra-live-scheduler/terraform/"; do
    name="${d#"$ROOT/"}"
    run "terraform test (${name%/})" \
        bash -c "cd '$d' && '$TERRAFORM' init -backend=false -input=false >/dev/null && '$TERRAFORM' test"
  done
  # Every stack with each environment's own tfvars (tests/envs), so a tfvars change that
  # breaks one environment fails here, not at its next apply.
  for d in "$ROOT"/infra-live-*/terraform/; do
    name="${d#"$ROOT/"}"
    for env in dev sbx stg prod; do
      # The scheduler has no prod (SEC-03): prod is never scheduled.
      [ "$env" = prod ] && [ "$name" = infra-live-scheduler/terraform/ ] && continue
      run "terraform test (${name%/}, $env)" \
          bash -c "cd '$d' && '$TERRAFORM' init -backend=false -input=false >/dev/null && '$TERRAFORM' test -test-directory=tests/envs -filter=tests/envs/$env.tftest.hcl -var-file=tfvars/$env.tfvars"
    done
  done
fi

if require_tool tflint TFLINT "brew install terraform-linters/tap/tflint"; then
  # One config for every run (.tflint.hcl: the AWS ruleset, CI-15). --init installs its
  # plugin into ~/.tflint.d the first time (about 17 MB from GitHub); later runs find it.
  TFLINT_CONFIG="$ROOT/.tflint.hcl"
  run "tflint plugins (.tflint.hcl)" \
      bash -c "'$TFLINT' --init --config='$TFLINT_CONFIG'"
  run "tflint (infra-live-backend)" \
      bash -c "'$TFLINT' --chdir='$ROOT/infra-live-backend/terraform' --config='$TFLINT_CONFIG'"
  run "tflint (infra-live-edge)" \
      bash -c "'$TFLINT' --chdir='$ROOT/infra-live-edge/terraform' --config='$TFLINT_CONFIG'"
  run "tflint (infra-live-frontend)" \
      bash -c "'$TFLINT' --chdir='$ROOT/infra-live-frontend/terraform' --config='$TFLINT_CONFIG'"
  run "tflint (infra-live-scheduler)" \
      bash -c "'$TFLINT' --chdir='$ROOT/infra-live-scheduler/terraform' --config='$TFLINT_CONFIG'"
  for m in "$ROOT"/modules/*/; do
    name="${m#"$ROOT/"}"
    run "tflint (${name%/})" bash -c "'$TFLINT' --chdir='$m' --config='$TFLINT_CONFIG'"
  done
fi
}

group_e2e() {
# ── end to end on the local stack (build plan 6.1, 6.2) ───────────────────────
# Off by default: they need the compose stack in test mode and Moto up
# (`docker compose --env-file .env --env-file .env.test up -d`; scripts/e2e refuses a stack on
# Atlas or a real bucket, docs/getting-started.md), make LLM calls with the keys in .env
# (about 20 a run), and stop and start the stack's workers. They add about 3-5 minutes to the
# other checks' 9-10 (13-15 in all, warm caches), plus 1-2 minutes each way to switch the stack
# into test mode and back.
# check.yml's e2e job runs them in CI. Gate 6 runs them:
#   RUN_E2E=1 MONGODB_TEST_URI="mongodb://localhost:27017/?directConnection=true" REDIS_URL=redis://localhost:6379 ./check.sh
echo -e "\n${BOLD}════ END TO END (local stack) ════${RESET}"
run "e2e: every endpoint (scripts/e2e)" \
    "$VENV_BIN/python" "$ROOT/scripts/e2e/full-journey.py"
run "e2e: account deletion (scripts/e2e)" \
    "$VENV_BIN/python" "$ROOT/scripts/e2e/account-deletion.py"
run "e2e: failure and convergence (scripts/e2e)" \
    "$VENV_BIN/python" "$ROOT/scripts/e2e/convergence.py"
}

# ── run the groups ────────────────────────────────────────────────────────────
run_group() { "group_${1//-/_}"; }

if ! selected e2e; then
  echo -e "\n${CYAN}End-to-end runs skipped: ./check.sh e2e (or RUN_E2E=1) runs them against the local stack.${RESET}"
fi

if [ "$PARALLEL" = 1 ] && [ ${#SELECTED[@]} -gt 1 ]; then
  # Each group in a subshell of its own, its output in .check-logs/<group>.log and its
  # results in <group>.passed / .failed, read back for the summary below.
  LOGDIR="$ROOT/.check-logs"
  rm -rf "$LOGDIR" && mkdir -p "$LOGDIR"
  echo -e "\n${BOLD}════ ${#SELECTED[@]} GROUPS IN PARALLEL ════${RESET} (logs: .check-logs/<group>.log)"
  PIDS=(); STARTED=$SECONDS
  for g in "${SELECTED[@]}"; do
    (
      PASSED=(); FAILED=()
      run_group "$g"
      printf '%s\n' "${PASSED[@]+"${PASSED[@]}"}" > "$LOGDIR/$g.passed"
      printf '%s\n' "${FAILED[@]+"${FAILED[@]}"}" > "$LOGDIR/$g.failed"
    ) > "$LOGDIR/$g.log" 2>&1 &
    PIDS+=($!)
    echo -e "  ${CYAN}started${RESET} $g"
  done
  # Ctrl-C stops every group and everything it started, however deep (npm → node →
  # Playwright → Chromium): children first, so none is left running on its own.
  stop_tree() {
    local child
    for child in $(pgrep -P "$1" 2>/dev/null); do stop_tree "$child"; done
    kill -TERM "$1" 2>/dev/null
  }
  stop_groups() {
    local pid
    for pid in "${PIDS[@]}"; do stop_tree "$pid"; done
    echo -e "\n${RED}Stopped.${RESET}"
    exit 130
  }
  trap stop_groups INT TERM

  # Report each group as it finishes (bash 3.2 has no `wait -n`, so poll).
  FINISHED=()
  for _ in "${SELECTED[@]}"; do FINISHED+=(0); done
  left=${#SELECTED[@]}
  while [ "$left" -gt 0 ]; do
    for i in "${!SELECTED[@]}"; do
      [ "${FINISHED[$i]}" = 1 ] && continue
      kill -0 "${PIDS[$i]}" 2>/dev/null && continue
      wait "${PIDS[$i]}" 2>/dev/null
      FINISHED[i]=1; left=$((left - 1))
      g="${SELECTED[$i]}"
      took="$(( (SECONDS - STARTED) / 60 ))m$(printf '%02d' $(( (SECONDS - STARTED) % 60 )))s"
      if [ ! -f "$LOGDIR/$g.failed" ]; then
        echo -e "  ${RED}✗ $g stopped before it finished${RESET} (+$took) — .check-logs/$g.log"
        FAILED+=("$g (stopped: see .check-logs/$g.log)")
        continue
      fi
      npass=0; nfail=0; fails=()
      while IFS= read -r line; do [ -n "$line" ] && { PASSED+=("$line"); npass=$((npass + 1)); }; done < "$LOGDIR/$g.passed"
      while IFS= read -r line; do [ -n "$line" ] && { FAILED+=("$line"); fails+=("$line"); nfail=$((nfail + 1)); }; done < "$LOGDIR/$g.failed"
      if [ "$nfail" -eq 0 ]; then
        echo -e "  ${GREEN}✓ $g${RESET} — $npass passed (+$took)"
      else
        echo -e "  ${RED}✗ $g${RESET} — $nfail failed: ${fails[*]} (+$took) — .check-logs/$g.log"
      fi
    done
    [ "$left" -gt 0 ] && sleep 2
  done
  trap - INT TERM
else
  for g in "${SELECTED[@]}"; do run_group "$g"; done
fi

# ── summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}════ SUMMARY ════${RESET}"
echo -e "${GREEN}Passed (${#PASSED[@]}):${RESET} ${PASSED[*]:-none}"
if [ ${#FAILED[@]} -gt 0 ]; then
  echo -e "${RED}Failed (${#FAILED[@]}):${RESET} ${FAILED[*]}"
  echo ""
  exit 1
else
  echo -e "${GREEN}All checks passed.${RESET}"
fi
