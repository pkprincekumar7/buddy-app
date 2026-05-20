#!/usr/bin/env bash
# Runs every check that CI runs, locally.
# Usage: ./check.sh
# Each check is independent — all run even if earlier ones fail.
# Exits non-zero if any check failed.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"

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
  ruff==0.11.2 mypy==1.15.0 bandit==1.9.4 pip-audit==2.9.0 \
  || { echo -e "${RED}pip install failed — check your network or requirements.txt${RESET}"; exit 1; }

# Frontend: npm install is fast when node_modules already exists (it checks
# versions and exits quickly), so run it unconditionally — package.json changes
# are always reflected without a manual step.
# --quiet suppresses progress bars but still shows warnings and errors.
echo -e "${CYAN}Syncing frontend/node_modules...${RESET}"
(cd "$FRONTEND" && npm install --quiet) \
  || { echo -e "${RED}npm install failed — check your network or package.json${RESET}"; exit 1; }

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

# ── backend ───────────────────────────────────────────────────────────────────
echo -e "\n${BOLD}════ BACKEND ════${RESET}"

run "ruff check" \
    bash -c "cd '$BACKEND' && '$RUFF' check ."

run "ruff format (check)" \
    bash -c "cd '$BACKEND' && '$RUFF' format --check ."

run "mypy" \
    bash -c "cd '$BACKEND' && '$MYPY' app/"

run "bandit" \
    bash -c "cd '$BACKEND' && '$BANDIT' -r app/ -ll -q"

run "pip-audit" \
    bash -c "cd '$BACKEND' && '$PIP_AUDIT' -r requirements.txt --skip-editable --ignore-vuln PYSEC-2025-183"

# ── frontend ──────────────────────────────────────────────────────────────────
echo -e "\n${BOLD}════ FRONTEND ════${RESET}"

run "eslint" \
    bash -c "cd '$FRONTEND' && npm run lint"

run "prettier (check)" \
    bash -c "cd '$FRONTEND' && npx prettier --check 'src/**/*.{js,jsx,css}'"

run "typecheck" \
    bash -c "cd '$FRONTEND' && npm run typecheck"

run "npm audit" \
    bash -c "cd '$FRONTEND' && npm audit --audit-level=high"

run "build" \
    bash -c "cd '$FRONTEND' && npm run build"

bundle_size_check() {
  local bundle
  bundle=$(ls "$FRONTEND/dist/assets/index-"*.js 2>/dev/null | head -1)
  if [ -z "$bundle" ]; then echo "No bundle found in dist/assets/"; return 1; fi
  local size limit=1468006
  size=$(wc -c < "$bundle")
  echo "Bundle: $(basename "$bundle") — ${size} bytes (limit ${limit})"
  if [ "$size" -gt "$limit" ]; then
    echo "Main bundle exceeds 1.4 MB limit"
    return 1
  fi
}
run "bundle size (≤ 1.4 MB)" bundle_size_check

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
