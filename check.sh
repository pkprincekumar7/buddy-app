#!/usr/bin/env bash
# Runs every check that CI runs, locally.
# Usage: ./check.sh
# Each check is independent — all run even if earlier ones fail.
# Exits non-zero if any check failed.

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

# ── bootstrap ─────────────────────────────────────────────────────────────────
# Bootstrap failures exit immediately — these are hard prerequisites, not checks.

# Backend: create the venv on first run, then always sync packages so that
# requirements.txt changes and tool-version bumps are picked up automatically.
# pip install is fast (no-ops on already-correct versions).
if [ ! -d "$BACKEND/.venv" ]; then
  echo -e "${CYAN}Creating backend/.venv...${RESET}"
  python3 -m venv "$BACKEND/.venv" \
    || { echo -e "${RED}Failed to create backend/.venv — is python3 installed?${RESET}"; exit 1; }
fi
echo -e "${CYAN}Syncing backend/.venv...${RESET}"
"$BACKEND/.venv/bin/pip" install -q \
  -r "$BACKEND/requirements.txt" \
  -r "$BACKEND/requirements-lint.txt" \
  -r "$BACKEND/requirements-security.txt" \
  -r "$BACKEND/requirements-test.txt" \
  || { echo -e "${RED}pip install failed — check your network or requirements.txt${RESET}"; exit 1; }

# Frontend: npm install is fast when node_modules already exists (it checks
# versions and exits quickly), so run it unconditionally — package.json changes
# are always reflected without a manual step.
# --quiet suppresses progress bars but still shows warnings and errors.
echo -e "${CYAN}Syncing frontend/node_modules...${RESET}"
(cd "$FRONTEND" && npm install --quiet) \
  || { echo -e "${RED}npm install failed — check your network or package.json${RESET}"; exit 1; }

echo -e "${CYAN}Syncing frontend-app/node_modules...${RESET}"
(cd "$FRONTEND_APP" && yarn install --frozen-lockfile --quiet) \
  || { echo -e "${RED}yarn install failed — check your network or package.json${RESET}"; exit 1; }

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
BANDIT="$(_tool bandit)"
PIP_AUDIT="$(_tool pip-audit)"
SEMGREP="$(_tool semgrep)"
CHECKOV="$(_tool checkov)"
PYTEST="$(_tool pytest)"

# ── backend ───────────────────────────────────────────────────────────────────
echo -e "\n${BOLD}════ BACKEND ════${RESET}"

run "ruff check" \
    bash -c "cd '$BACKEND' && '$RUFF' check ."

run "ruff format (check)" \
    bash -c "cd '$BACKEND' && '$RUFF' format --check ."

run "mypy" \
    bash -c "cd '$BACKEND' && '$MYPY' app/ tools/"

# ── frontend ──────────────────────────────────────────────────────────────────
echo -e "\n${BOLD}════ FRONTEND ════${RESET}"

run "eslint" \
    bash -c "cd '$FRONTEND' && npm run lint"

run "prettier (check)" \
    bash -c "cd '$FRONTEND' && node_modules/.bin/prettier --check 'src/**/*.{ts,tsx,css}'"

run "typecheck" \
    bash -c "cd '$FRONTEND' && npm run typecheck"

run "build" \
    bash -c "cd '$FRONTEND' && npm run build"

bundle_size_check() {
  local bundle
  bundle=$(ls "$FRONTEND/dist/assets/index-"*.js 2>/dev/null | head -1)
  if [ -z "$bundle" ]; then echo "No bundle found in dist/assets/"; return 1; fi
  local size limit=$((1400 * 1024))  # 1.4 MB
  size=$(wc -c < "$bundle")
  echo "Bundle: $(basename "$bundle") — ${size} bytes (limit ${limit})"
  if [ "$size" -gt "$limit" ]; then
    echo "Main bundle exceeds 1.4 MB limit"
    return 1
  fi
}
run "bundle size (≤ 1.4 MB)" bundle_size_check

# ── frontend-app ─────────────────────────────────────────────────────────────
echo -e "\n${BOLD}════ FRONTEND-APP ════${RESET}"

run "eslint (frontend-app)" \
    bash -c "cd '$FRONTEND_APP' && yarn lint"

run "typecheck (frontend-app)" \
    bash -c "cd '$FRONTEND_APP' && node_modules/.bin/tsc --noEmit"

# ── tests ─────────────────────────────────────────────────────────────────────
# Requires MONGODB_URI and JWT_SECRET in backend/.env (same env used by the dev server).
echo -e "\n${BOLD}════ TESTS ════${RESET}"

run "pytest + coverage (backend)" \
    bash -c "cd '$BACKEND' && '$PYTEST' --cov=app --cov-report=term-missing --cov-fail-under=0 -q; rc=\$?; [ \$rc -eq 5 ] && { echo 'No tests collected yet — pass until baseline suite is written'; exit 0; } || exit \$rc"

# ── security ──────────────────────────────────────────────────────────────────
echo -e "\n${BOLD}════ SECURITY ════${RESET}"

# ---- always-run: tools available from the bootstrapped venv / npm ----------------
run "bandit" \
    bash -c "cd '$BACKEND' && '$BANDIT' -r app/ tools/ -ll -q"

run "pip-audit" \
    bash -c "cd '$BACKEND' && '$PIP_AUDIT' -r requirements.txt --skip-editable --ignore-vuln PYSEC-2025-183"

run "npm audit" \
    bash -c "cd '$FRONTEND' && npm audit --audit-level=high"

run "yarn audit (frontend-app)" \
    bash -c "cd '$FRONTEND_APP' && yarn audit --level high"

# retire-jsrepo.json is downloaded by the bootstrap above (refreshed every 7 days).
# --jsrepo avoids retire.js making its own network request on every invocation.
run "retire.js (browser library CVE scan)" \
    bash -c "'$FRONTEND/node_modules/.bin/retire' --path '$FRONTEND' --exitwith 1 --jsrepo '$FRONTEND/retire-jsrepo.json'"

run "retire.js (frontend-app library CVE scan)" \
    bash -c "'$FRONTEND/node_modules/.bin/retire' --path '$FRONTEND_APP' --exitwith 1 --jsrepo '$FRONTEND/retire-jsrepo.json'"

# ---- mandatory: external tools — check.sh fails if any are absent ----------------
# semgrep and checkov are installed into .venv via requirements-security.txt above.
# The tools below must be installed on the host; see install hints on failure.
# Docker must also be running — it is required for the trivy image scan.
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

GITLEAKS=""; HADOLINT=""; TRIVY=""; DOCKER=""

if require_tool gitleaks GITLEAKS "brew install gitleaks"; then
  run "gitleaks (secret detection)" \
      bash -c "cd '$ROOT' && '$GITLEAKS' detect --config '$ROOT/.gitleaks.toml'"
fi

run "semgrep (SAST)" \
    bash -c "'$SEMGREP' --config p/security-audit --error '$BACKEND/app/' '$BACKEND/tools/' '$ROOT/frontend/src/' '$ROOT/frontend-app/src/'"

if require_tool hadolint HADOLINT "brew install hadolint"; then
  run "hadolint (backend Dockerfile)" \
      bash -c "'$HADOLINT' '$BACKEND/Dockerfile'"
  run "hadolint (frontend Dockerfile)" \
      bash -c "'$HADOLINT' '$FRONTEND/Dockerfile'"
fi

run "checkov (Terraform IaC)" \
    bash -c "'$CHECKOV' \
      -d '$ROOT/infra-live-backend/terraform' \
      -d '$ROOT/infra-live-edge/terraform' \
      -d '$ROOT/infra-live-frontend/terraform' \
      --framework terraform --quiet --compact --skip-download"

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

  run "trivy (frontend-app CVE scan)" \
      bash -c "'$TRIVY' fs --exit-code 1 --severity HIGH,CRITICAL --scanners vuln '$FRONTEND_APP/'"

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

  if require_tool docker DOCKER "https://docs.docker.com/get-docker/"; then
    DOCKLE=""; _SCAN_IMAGE="buddy-backend:check-scan"; _IMAGE_OK=0

    # Build the image once — shared by trivy image scan, SBOM generation, and dockle.
    build_image_for_scan() {
      echo "Building backend Docker image for scan..."
      docker build -t "$_SCAN_IMAGE" -f "$BACKEND/Dockerfile" "$ROOT" && _IMAGE_OK=1
    }
    run "docker build (image scan)" build_image_for_scan

    if [ "$_IMAGE_OK" -eq 1 ]; then
      run "trivy (backend image scan)" \
          bash -c "'$TRIVY' image --exit-code 1 --severity HIGH,CRITICAL \
            --scanners vuln --ignore-unfixed '$_SCAN_IMAGE'"

      run "trivy (backend image SBOM)" \
          bash -c "'$TRIVY' image --format cyclonedx \
            --output '$ROOT/sbom-backend.cyclonedx.json' '$_SCAN_IMAGE' \
            && echo 'Backend SBOM → sbom-backend.cyclonedx.json'"

      if require_tool dockle DOCKLE "brew install goodwithtech/r/dockle"; then
        run "dockle (CIS Docker Benchmark)" \
            bash -c "'$DOCKLE' \
              -af settings.py \
              --ignore DKL-DI-0005 \
              '$_SCAN_IMAGE'"
      fi

      docker rmi "$_SCAN_IMAGE" >/dev/null 2>&1 || true
    fi
  fi
fi

# ── dast & api spec ───────────────────────────────────────────────────────────
# spectral: exports the OpenAPI spec from the FastAPI app without a running server.
# nuclei:   requires the backend to be running at http://localhost:8000.
#           Start it first: cd backend && source .venv/bin/activate && uvicorn app.main:app
echo -e "\n${BOLD}════ DAST & API SPEC ════${RESET}"

# spectral is a local devDependency in frontend/ — available after npm install (bootstrap),
# no global install required.
SPECTRAL="$FRONTEND/node_modules/.bin/spectral"
NUCLEI=""

spectral_api_lint() {
  local spec="$ROOT/openapi.json"
  "$VENV_BIN/python" "$ROOT/backend/tools/export-openapi.py" > "$spec" \
    || { echo "Failed to export OpenAPI spec — check backend imports and env vars"; return 1; }
  "$SPECTRAL" lint "$spec" --ruleset "$ROOT/.spectral.yaml" --fail-severity error
  local rc=$?
  rm -f "$spec"
  return $rc
}
run "spectral (OpenAPI lint)" spectral_api_lint

if require_tool nuclei NUCLEI "brew install nuclei"; then
  nuclei_dast() {
    if ! curl -sf http://localhost:8000/health > /dev/null 2>&1; then
      echo "Backend not running at http://localhost:8000 — start it first:"
      echo "  cd backend && source .venv/bin/activate && uvicorn app.main:app"
      return 1
    fi
    "$NUCLEI" -u http://localhost:8000 \
      -t http/misconfiguration,http/exposures,http/technologies \
      -severity medium,high,critical \
      -silent -no-color
  }
  run "nuclei (DAST)" nuclei_dast
fi

# ── terraform ─────────────────────────────────────────────────────────────────
echo -e "\n${BOLD}════ TERRAFORM ════${RESET}"

TERRAFORM=""; TFLINT=""

if require_tool terraform TERRAFORM "brew install terraform"; then
  run "terraform fmt check" \
      bash -c "cd '$ROOT' && '$TERRAFORM' fmt -check -recursive"
fi

if require_tool tflint TFLINT "brew install terraform-linters/tap/tflint"; then
  run "tflint (infra-live-backend)" \
      bash -c "'$TFLINT' --chdir='$ROOT/infra-live-backend/terraform'"
  run "tflint (infra-live-edge)" \
      bash -c "'$TFLINT' --chdir='$ROOT/infra-live-edge/terraform'"
  run "tflint (infra-live-frontend)" \
      bash -c "'$TFLINT' --chdir='$ROOT/infra-live-frontend/terraform'"
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
