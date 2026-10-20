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
echo -e "${CYAN}Syncing backend/.venv...${RESET}"
"$BACKEND/.venv/bin/pip" install -q \
  -r "$BACKEND/requirements.txt" \
  -r "$BACKEND/requirements-lint.txt" \
  -r "$BACKEND/requirements-security.txt" \
  -r "$BACKEND/requirements-test.txt" \
  || { echo -e "${RED}pip install failed — check your network or requirements.txt${RESET}"; exit 1; }

# Frontend: npm ci, as CI does — installs exactly what package-lock.json says and
# never rewrites it (npm install can, so local checks could run against different
# packages than CI). Slower: it deletes and reinstalls node_modules every run.
# --quiet suppresses progress bars but still shows warnings and errors.
echo -e "${CYAN}Installing frontend/node_modules (npm ci)...${RESET}"
(cd "$FRONTEND" && npm ci --quiet) \
  || { echo -e "${RED}npm ci failed — check your network, or run npm install if package-lock.json is out of sync with package.json${RESET}"; exit 1; }

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
  local size limit=1468006  # 1.4 MB = 1.4 * 1024 * 1024 — same as check.yml
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

run "prettier (check) (frontend-app)" \
    bash -c "cd '$FRONTEND_APP' && node_modules/.bin/prettier --check 'src/**/*.{ts,tsx}'"

run "typecheck (frontend-app)" \
    bash -c "cd '$FRONTEND_APP' && node_modules/.bin/tsc --noEmit"

run "jest (frontend-app)" \
    bash -c "cd '$FRONTEND_APP' && CI=true yarn test --ci"

# ── tests ─────────────────────────────────────────────────────────────────────
# Settings load from backend/.env (needs JWT_PRIVATE_KEY, as for the dev server); no
# test connects to MONGODB_URI. Same command and coverage gate as CI. The real
# Mongo/Redis integration tests skip unless you point them at throwaway servers —
# never a real cluster — e.g. (docker run -d -p 27017:27017 mongo:7, same for redis):
#   MONGODB_TEST_URI=mongodb://localhost:27017 REDIS_URL=redis://localhost:6379 ./check.sh
echo -e "\n${BOLD}════ TESTS ════${RESET}"

run "pytest + coverage (backend)" \
    bash -c "cd '$BACKEND' && '$PYTEST' --cov=app --cov-branch --cov-report=term-missing --cov-fail-under=99 -q"

# Validates the hand-built mutant lists against the current source (seconds).
# This never runs mutation testing itself — that's manual (docs/mutation-testing.md).
run "mutant lists valid (tools/mutate_handlers.py --check)" \
    bash -c "cd '$BACKEND' && '$VENV_BIN/python' tools/mutate_handlers.py --check"

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
# The service names listed in those workflows' `service` input descriptions
# must match services.tf (they're the help text people pick names from).
run "service lists match services.tf (scripts)" \
    bash "$ROOT/scripts/check-service-lists.sh"
if command -v shellcheck >/dev/null 2>&1; then
  run "shellcheck (scripts/ecs-services.sh)" \
      shellcheck -x "$ROOT/scripts/ecs-services.sh" "$ROOT/scripts/ecs-services.test.sh" "$ROOT/scripts/check-service-lists.sh"
fi

# shared/routing.json → generated backend/app/routing_data.py and the frontends'
# countries.ts / locationHint.ts. Fails if a generated copy is stale.
run "routing data in sync (shared/routing.json)" \
    node "$ROOT/scripts/sync-routing.mjs" --check

# ── security ──────────────────────────────────────────────────────────────────
echo -e "\n${BOLD}════ SECURITY ════${RESET}"

# ---- always-run: tools available from the bootstrapped venv / npm ----------------
run "bandit" \
    bash -c "cd '$BACKEND' && '$BANDIT' -r app/ tools/ -ll -q"

run "pip-audit" \
    bash -c "cd '$BACKEND' && '$PIP_AUDIT' -r requirements.txt --skip-editable \
      --ignore-vuln PYSEC-2025-183"
# PYSEC-2025-183 is disputed with no fix (see requirements.txt). PyJWT and semgrep share
# the venv, so a PyJWT bump may need a semgrep bump too (semgrep pins pyjwt[crypto]).

# Ignored (no fixed release exists): GHSA-vfj7-8cjw-p6xm — braces <=3.0.3 stack-exhaustion
# DoS on crafted brace patterns. Reached only via build tooling (tailwindcss, spectral-cli),
# never in the shipped bundle. Remove once braces publishes a fix.
run "npm audit" \
    bash -c "cd '$FRONTEND' && npm audit --json 2>/dev/null | python3 -c \"
import json,sys
IGNORED={'GHSA-qwww-vcr4-c8h2','GHSA-mh99-v99m-4gvg','GHSA-vfj7-8cjw-p6xm'}
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
# image-size's GHSA-5p2g-fcmc-qvqq/GHSA-w3rx-r6r6-pgpr (formerly flagged as advisory
# IDs 1138808/1138809, now 1239765/1239766) is fixed by forcing image-size to ^2.0.4
# via frontend-app/package.json's resolutions/overrides — no ignore needed any more.
run "yarn audit (frontend-app)" \
    bash -c "cd '$FRONTEND_APP' && yarn audit --json 2>/dev/null | python3 -c \"
import json,sys
IGNORED_IDS={1124334,1240992,1240912}
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
      bash -c "cd '$ROOT' && '$GITLEAKS' detect --source . --redact --config '$ROOT/.gitleaks.toml'"
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
      -d '$ROOT/infra-live-scheduler/terraform' \
      -d '$ROOT/modules' \
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

  # --ignorefile: image-size (CVE-2025-71329, CVE-2025-71330) has no upstream fix yet;
  # see frontend-app/.trivyignore for the rationale (same exception as the yarn audit
  # IGNORED_IDS list above).
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

  if require_tool docker DOCKER "https://docs.docker.com/get-docker/"; then
    DOCKLE=""; _SCAN_IMAGE="superpower-backend:check-scan"; _IMAGE_OK=0

    # Build the image once — shared by trivy image scan, SBOM generation, and dockle.
    # GIT_SHA is the Dockerfile's apt-layer cache-bust key (CI passes the commit SHA).
    # A per-day value re-runs `apt-get upgrade` at least daily, so the scan sees newly
    # published Debian security patches instead of a stale cached layer.
    build_image_for_scan() {
      echo "Building backend Docker image for scan..."
      docker build --build-arg GIT_SHA="local-scan-$(date +%Y%m%d)" \
        -t "$_SCAN_IMAGE" -f "$BACKEND/Dockerfile" "$ROOT" && _IMAGE_OK=1
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

# openapi.json is tracked in git — the committed reference copy of the API spec. CI
# regenerates it and fails if the committed copy differs; this fails the same way
# when your copy is stale, after writing the fresh one so you can review and commit it.
openapi_up_to_date() {
  local spec="$ROOT/openapi.json" fresh
  fresh="$(mktemp)"
  "$VENV_BIN/python" "$ROOT/backend/tools/export-openapi.py" > "$fresh" \
    || { rm -f "$fresh"; echo "Failed to export OpenAPI spec — check backend imports and env vars"; return 1; }
  if cmp -s "$fresh" "$spec"; then
    rm -f "$fresh"
  else
    # cat, not mv: mktemp's file is owner-only (0600); writing the contents into the
    # existing file keeps openapi.json's own permissions.
    cat "$fresh" > "$spec" && rm -f "$fresh"
    echo "openapi.json was out of date — regenerated it. Review (git diff openapi.json) and commit."
    return 1
  fi
}
run "openapi.json up to date" openapi_up_to_date

spectral_api_lint() {
  "$SPECTRAL" lint "$ROOT/openapi.json" --ruleset "$ROOT/.spectral.yaml" --fail-severity error
}
run "spectral (OpenAPI lint)" spectral_api_lint

# nuclei (DAST) is disabled locally per company security-team guidance (active
# scanning tool, not permitted on company laptops). CI (check.yml) is unaffected
# and still runs it.
# if require_tool nuclei NUCLEI "brew install nuclei"; then
#   nuclei_dast() {
#     if ! curl -sf http://localhost:8000/health > /dev/null 2>&1; then
#       echo "Backend not running at http://localhost:8000 — start it first:"
#       echo "  cd backend && source .venv/bin/activate && uvicorn app.main:app"
#       return 1
#     fi
#     "$NUCLEI" -u http://localhost:8000 \
#       -t http/misconfiguration,http/exposures,http/technologies \
#       -severity medium,high,critical \
#       -silent -no-color
#   }
#   run "nuclei (DAST)" nuclei_dast
# fi

# ── terraform ─────────────────────────────────────────────────────────────────
echo -e "\n${BOLD}════ TERRAFORM ════${RESET}"

TERRAFORM=""; TFLINT=""

if require_tool terraform TERRAFORM "brew install terraform"; then
  run "terraform fmt check" \
      bash -c "cd '$ROOT' && '$TERRAFORM' fmt -check -recursive"
  # Mock AWS provider — no credentials, nothing created (TF-01).
  for d in "$ROOT"/modules/*/ "$ROOT/infra-live-backend/terraform/"; do
    name="${d#"$ROOT/"}"
    run "terraform test (${name%/})" \
        bash -c "cd '$d' && '$TERRAFORM' init -backend=false -input=false >/dev/null && '$TERRAFORM' test"
  done
fi

if require_tool tflint TFLINT "brew install terraform-linters/tap/tflint"; then
  run "tflint (infra-live-backend)" \
      bash -c "'$TFLINT' --chdir='$ROOT/infra-live-backend/terraform'"
  run "tflint (infra-live-edge)" \
      bash -c "'$TFLINT' --chdir='$ROOT/infra-live-edge/terraform'"
  run "tflint (infra-live-frontend)" \
      bash -c "'$TFLINT' --chdir='$ROOT/infra-live-frontend/terraform'"
  run "tflint (infra-live-scheduler)" \
      bash -c "'$TFLINT' --chdir='$ROOT/infra-live-scheduler/terraform'"
  for m in "$ROOT"/modules/*/; do
    name="${m#"$ROOT/"}"
    run "tflint (${name%/})" bash -c "'$TFLINT' --chdir='$m'"
  done
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
