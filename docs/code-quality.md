# Code Quality

## Git hooks

Two separate, independent hook systems run automatically on `git commit` — one for
Python, one for JavaScript/TypeScript. There is no single unified "pre-commit" step that
covers everything, despite both firing on the same git event.

### Backend (Python) — the `pre-commit` framework

[`.pre-commit-config.yaml`](../.pre-commit-config.yaml) configures the
[pre-commit](https://pre-commit.com/) framework to run `ruff` / `ruff-format` on
`backend/`, plus a handful of general file-hygiene hooks across the whole repo.

**One-time setup** (run once per clone, from the repo root):

```bash
pip install pre-commit
pre-commit install
```

After `pre-commit install`, these hooks run automatically on every `git commit`. `ruff` applies `--fix` and `ruff-format` reformats in place; if either modifies a file, the commit is aborted — re-stage the fixed files (`git add .`) and commit again. On the second attempt nothing changes and the commit succeeds.

To run all hooks manually against every file:

```bash
pre-commit run --all-files
```

**What each hook does:**

| Hook | Scope | What it checks |
|---|---|---|
| `ruff` | `backend/` | Python linting — unused imports, bugbear, pyupgrade, isort, naming |
| `ruff-format` | `backend/` | Python formatting — black-compatible, line-length 100 |
| `trailing-whitespace` | all files | Trailing whitespace |
| `end-of-file-fixer` | all files | Missing/extra trailing newline |
| `check-yaml` | all files | YAML syntax validity |
| `check-json` | all files | JSON syntax validity |
| `check-merge-conflict` | all files | Leftover `<<<<<<<` / `=======` / `>>>>>>>` markers |
| `check-added-large-files` | all files | Blocks new files over 500 KB |
| `mixed-line-ending` | all files | Normalizes to LF line endings |

### Frontend — Husky + lint-staged (a separate system, not `pre-commit`)

ESLint and Prettier for `frontend/` run through a completely different mechanism:
[Husky](https://typicode.github.io/husky/) installs a native git `pre-commit` hook
(`frontend/.husky/pre-commit`) that invokes
[lint-staged](https://github.com/lint-staged/lint-staged) to run tools only against
staged files. This is Node-based tooling — despite firing on the same git event with the
same name, it is unrelated to the Python `pre-commit` framework above.

**Setup:** running `npm install` inside `frontend/` installs the hook automatically (via
the `prepare` script in `package.json`) — no separate command needed.

**What runs** (from `frontend/package.json`'s `lint-staged` config):

| Files | Tools |
|---|---|
| `src/**/*.{ts,tsx}` | `eslint --fix --max-warnings 0`, then `prettier --write` |
| `src/**/*.css` | `prettier --write` (Tailwind classes auto-sorted via `prettier-plugin-tailwindcss`) |

`--max-warnings 0` means any ESLint warning, not just an error, blocks the commit. Both tools run from `frontend/node_modules/.bin/`, so `npm install` must have been run inside `frontend/` at least once beforehand. `frontend/eslint.config.ts` excludes `src/components/ui/**` from linting — those files are untouched by either tool.

## Local checks (check.sh)

[`check.sh`](../check.sh) is a convenience script at the repo root that runs every check the CI pipeline runs, **locally**, in a single command. **46 checks run when you execute it** — the script fails at the summary if any required tool is missing or any check fails, even if earlier checks passed. Checks 1–12 run automatically after bootstrap (venv, npm, yarn) — no extra installation needed. Check 13 also runs with no install, but only *fully* exercises anything if `terraform` happens to be on `PATH` — otherwise it self-skips with a message instead of failing (see footnote ⁵). Checks 14–46 mostly require host tools to be pre-installed (except `semgrep` and `checkov`, which are venv-installed) — see **Required host tools** below. Nuclei (DAST) is written into the script but currently commented out — see the note after the table. **CodeQL, dependency-review, and nuclei run only in GitHub Actions CI** — nuclei needs a running backend and is disabled locally per company security-team policy (active scanning not permitted on company laptops); CodeQL and dependency-review require GitHub's own infrastructure. None of the three are part of `check.sh`. A colour-coded summary is printed at the end.

```bash
./check.sh
```

No manual setup required for backend, frontend, or frontend-app checks. On every run the script automatically:
- Creates `backend/.venv` if it does not exist, then syncs all Python packages from `requirements.txt`, `requirements-lint.txt` (ruff, mypy), `requirements-security.txt` (bandit, semgrep, pip-audit, checkov), and `requirements-test.txt` (pytest, pytest-cov). `pip install` is a no-op when versions are already correct, so this is fast on subsequent runs. These files are the single source of truth for tool versions — both `check.sh` and CI read from them.
- Runs `npm install` in `frontend/`. This is fast when `node_modules` already exists and ensures any `package.json` change is always reflected.
- Runs `yarn install --frozen-lockfile` in `frontend-app/`. Fast on subsequent runs when `node_modules` already exists.
- Downloads/refreshes the retire.js vulnerability database to `frontend/retire-jsrepo.json` if it is absent or older than 7 days. The file is gitignored so it stays current without committing a static snapshot. If the network is unavailable and a previous copy exists, the existing file is reused with a warning.

The script looks for each tool in `backend/.venv/bin/` first, then falls back to `PATH`.

**Required host tools:** `check.sh` fails if any of these are absent — install all of them before running the script. `semgrep` and `checkov` are installed automatically into the venv via `requirements-security.txt` and do not need a separate step. `terraform` is also used by the jwt-validator-lambda test (check 13) — that one specific check self-skips with a message instead of failing if `terraform` is missing, but every other check listed below is a hard failure.

```bash
brew install gitleaks
brew install hadolint
brew install aquasecurity/trivy/trivy
brew install goodwithtech/r/dockle
brew install terraform
brew install terraform-linters/tap/tflint
# Trivy image scan also requires Docker to be installed AND running:
# https://docs.docker.com/get-docker/
# nuclei is NOT listed here — the DAST check is disabled locally (commented out in
# check.sh) per company security-team policy; it still runs in CI. See the note below
# the checks table.
# spectral is NOT listed here — it is a devDependency in frontend/package.json and is
# installed automatically by the npm install bootstrap step. No manual install needed.
```

**Checks run:**

| # | Check | Tool | Scope |
|---|---|---|---|
| 1 | `ruff check` | ruff 0.11.2 | `backend/` — linting (unused imports, bugbear, naming, …) |
| 2 | `ruff format` | ruff 0.11.2 | `backend/` — formatting (black-compatible, line-length 100) |
| 3 | `mypy` | mypy 1.15.0 | `backend/app/` + `backend/tools/` — static type checking (Python 3.12) |
| 4 | `eslint` | ESLint (via npm) | `frontend/src/**` (excl. `components/ui/`) — React/hooks rules, unused imports, security |
| 5 | `prettier` | Prettier (devDependency) | `frontend/src/**` — JS/JSX/CSS formatting; Tailwind classes auto-sorted (`prettier-plugin-tailwindcss`) |
| 6 | `typecheck` | tsc (via npm) | `frontend/src/**` — plain TypeScript type checking, two separate `tsc --noEmit` runs against `tsconfig.app.json` and `tsconfig.node.json` (no `checkJs`/JSDoc involved — this is a TS-only codebase) |
| 7 | `build` | Vite (via npm) | `frontend/` — production build |
| 8 | bundle size | bash + `wc` | `frontend/dist/` — main JS bundle must be ≤ 1.4 MB |
| 9 | `eslint (frontend-app)` | ESLint (via yarn) | `frontend-app/src/**` — React Native/hooks rules, unused imports, security |
| 10 | `prettier (check) (frontend-app)` | Prettier (devDependency) | `frontend-app/src/**/*.{ts,tsx}` — TS/TSX formatting |
| 11 | `typecheck (frontend-app)` | tsc (via yarn) | `frontend-app/src/**` — TypeScript type checking (`--noEmit`) |
| 12 | pytest + coverage | pytest + pytest-cov | `backend/` — unit and integration tests; coverage is reported but not yet gated (raise `--cov-fail-under` as the test suite grows) |
| 13 ⁵ | jwt-validator-lambda unit tests | Node's built-in test runner + `terraform` | `infra-live-edge/functions/jwt-validator-lambda.test.js` — 14 test cases; renders the real `.tpl` through `terraform apply` rather than reimplementing HCL's `templatefile()`, so it exercises exactly what gets deployed. Self-skips with a message (not a failure) if `terraform` isn't on `PATH`. |
| 14 | `bandit` | bandit 1.9.4 | `backend/app/` — Python SAST: hard-coded secrets, injection, insecure calls (medium+ severity) |
| 15 | `pip-audit` | pip-audit 2.9.0 | `backend/requirements.txt` — dependency CVE scan; PYSEC-2025-183 and PYSEC-2026-175/177/178/179 suppressed (PyJWT CVEs with no available fix version at time of writing) |
| 16 | `npm audit` | npm | `frontend/` — npm dependency CVE scan (high/critical only) |
| 17 | `yarn audit (frontend-app)` | yarn | `frontend-app/` — yarn dependency CVE scan (high/critical only) |
| 18 | retire.js | retire (devDependency) | `frontend/` — browser library CVEs not always caught by npm audit |
| 19 | retire.js (frontend-app) | retire (devDependency) | `frontend-app/` — same scan using the same retire.js database |
| 20 ² | gitleaks | gitleaks | Entire repo git history — accidentally committed secrets, API keys, tokens |
| 21 | semgrep (SAST) | semgrep 1.167.0 | `backend/app/`, `backend/tools/`, `frontend/src/`, `frontend-app/src/` — Python and JavaScript/React SAST (`p/security-audit` ruleset); venv-installed |
| 22 ² | hadolint (backend Dockerfile) | hadolint | `backend/Dockerfile` — Dockerfile best practices and security misconfigurations |
| 23 ² | hadolint (frontend Dockerfile) | hadolint | `frontend/Dockerfile` — same |
| 24 | checkov (Terraform IaC) | checkov 3.2.529 | `infra-live-*/terraform/` (backend, edge, frontend, scheduler) — Terraform IaC misconfigurations (open S3 buckets, missing encryption, overly permissive IAM); venv-installed |
| 25 ³ | trivy (backend CVE scan) | trivy | `backend/` — HIGH/CRITICAL CVEs in Python packages (complements pip-audit with a second CVE database) |
| 26 ³ | trivy (frontend CVE scan) | trivy | `frontend/` — HIGH/CRITICAL CVEs in npm packages |
| 27 ³ | trivy (backend license scan) | trivy | `backend/` — HIGH/CRITICAL license violations (GPL, AGPL, LGPL) in Python packages |
| 28 ³ | trivy (frontend license scan) | trivy | `frontend/` — HIGH/CRITICAL license violations in npm packages |
| 29 ³ | trivy (frontend SBOM) | trivy | `frontend/` — generates `sbom-frontend.cyclonedx.json` in CycloneDX format |
| 30 ³ | trivy (frontend-app CVE scan) | trivy | `frontend-app/` — HIGH/CRITICAL CVEs in yarn packages |
| 31 ³ | trivy (frontend-app license scan) | trivy | `frontend-app/` — HIGH/CRITICAL license violations in yarn packages |
| 32 ³ | trivy (frontend-app SBOM) | trivy | `frontend-app/` — generates `sbom-frontend-app.cyclonedx.json` in CycloneDX format |
| 33 ³ | trivy config (infra-live-backend) | trivy | `infra-live-backend/terraform/` — IaC security misconfigurations using Trivy's built-in Terraform rule set (tfsec successor) |
| 34 ³ | trivy config (infra-live-edge) | trivy | `infra-live-edge/terraform/` — same |
| 35 ³ | trivy config (infra-live-frontend) | trivy | `infra-live-frontend/terraform/` — same |
| 36 ³ | trivy config (infra-live-scheduler) | trivy | `infra-live-scheduler/terraform/` — same |
| 37 ³ | docker build (image scan) | docker | Builds `buddy-backend` image locally — prerequisite for the three image-level checks below |
| 38 ³ | trivy (backend image scan) | trivy + docker | Built `buddy-backend` image — OS-level HIGH/CRITICAL CVEs in the Debian base layer (unfixed only) |
| 39 ³ | trivy (backend image SBOM) | trivy + docker | Built image — generates `sbom-backend.cyclonedx.json` in CycloneDX format |
| 40 ³ | dockle (CIS Docker Benchmark) | dockle + docker | Built image — CIS Docker Benchmark: root user, secrets baked into layers, missing `HEALTHCHECK`, hardening rules |
| 41 ⁴ | spectral (OpenAPI lint) | spectral (via `frontend/node_modules/.bin/`) | Exports the FastAPI OpenAPI spec via `backend/tools/export-openapi.py` (no running server needed) and lints it against `.spectral.yaml` — security schemes, operationId, tags |
| 42 ¹ | terraform fmt check | terraform | All `infra-live-*/terraform/` dirs — formatting check (`-check -recursive`) |
| 43 ¹ | tflint (infra-live-backend) | tflint | `infra-live-backend/terraform/` — deprecated syntax, wrong types, best-practice violations |
| 44 ¹ | tflint (infra-live-edge) | tflint | `infra-live-edge/terraform/` — same |
| 45 ¹ | tflint (infra-live-frontend) | tflint | `infra-live-frontend/terraform/` — same |
| 46 ¹ | tflint (infra-live-scheduler) | tflint | `infra-live-scheduler/terraform/` — same |

¹ Required — `check.sh` fails with an install hint if `terraform` / `tflint` is not found in `PATH`.
² Required — `check.sh` fails with an install hint if the respective tool (`gitleaks` or `hadolint`) is not found in `PATH`.
³ Required — `check.sh` fails with an install hint if `trivy` or `docker` is not found in `PATH`. Docker must be installed **and running** for the image scan.
⁴ No manual install — `@stoplight/spectral-cli` is a `devDependency` in `frontend/package.json`. It is installed automatically during the `npm install` bootstrap step and invoked directly from `frontend/node_modules/.bin/spectral`.
⁵ Soft dependency, not a hard failure — self-skips with a clear message (not added to the failed list) if `terraform` isn't on `PATH`, rather than failing the whole run.

**Note — nuclei (DAST):** written into `check.sh` (targeting `http://localhost:8000` — misconfiguration, exposure, and technology probes at medium/high/critical severity) but the entire block is currently **commented out**, disabled locally per company security-team guidance (active scanning tools aren't permitted on company laptops). It is not one of the 46 checks above and does not run when you execute `./check.sh`, regardless of whether `nuclei` is installed. `check.yml` (CI) is unaffected and still runs it there.

**Note:** CodeQL (dataflow/taint analysis for Python and JavaScript) and dependency-review (PR lockfile CVE diffing) run only in GitHub Actions CI — they require GitHub's infrastructure and, like nuclei above, are not included in `check.sh`.

The exit code is non-zero if any check fails, making it safe to call from other scripts or a pre-push hook.

## Backend tooling (pyproject.toml)

[`backend/pyproject.toml`](../backend/pyproject.toml) centralises ruff and mypy configuration so the same settings are used everywhere each tool runs. Ruff's settings apply in all three places: the `pre-commit` hooks, `check.sh`, and CI. Mypy has no `pre-commit` hook at all (only `ruff`/`ruff-format` are configured in `.pre-commit-config.yaml`) — its settings only apply in `check.sh` and CI.

### ruff

| Setting | Value | Notes |
|---|---|---|
| `target-version` | `py312` | Enables Python 3.12 syntax modernisations via pyupgrade |
| `line-length` | `100` | Enforced by `ruff format`; `E501` is disabled in `ruff check` to avoid duplicate warnings |
| `quote-style` | `double` | Double-quoted strings (Black-compatible) |
| `indent-style` | `space` | Space indentation |
| `line-ending` | `lf` | Unix line endings enforced on all platforms |
| `known-first-party` | `["app"]` | isort treats `app` as a first-party import so it is grouped separately from third-party packages |

Rule sets enabled:

| Code | Plugin | What it checks |
|---|---|---|
| `E`, `W` | pycodestyle | Basic style errors and warnings |
| `F` | pyflakes | Undefined names, unused imports |
| `I` | isort | Import ordering |
| `B` | flake8-bugbear | Common bugs and opinionated style |
| `UP` | pyupgrade | Syntax modernisation for Python 3.12 |
| `C4` | flake8-comprehensions | Simplify list/dict/set comprehensions |
| `RET` | flake8-return | Remove unnecessary `else` after `return` |
| `SIM` | flake8-simplify | General simplification suggestions |
| `N` | pep8-naming | Class, function, and variable naming conventions |

Ignored rules and rationale:

| Rule | Reason ignored |
|---|---|
| `E501` | Line length is already enforced by `ruff format`; redundant in `ruff check` |
| `N818` | FastAPI's `HTTPException` ends in `Exception`, not `Error` — kept intentionally |
| `SIM108` | Ternary expressions are used deliberately; forced rewrites reduce readability here |
| `B008` | FastAPI's `Depends(...)` pattern calls functions in default arguments by design |

### mypy

| Setting | Value | Notes |
|---|---|---|
| `python_version` | `3.12` | Matches the runtime Python version |
| `ignore_missing_imports` | `true` | Avoids errors for third-party packages without bundled stubs |
| `check_untyped_defs` | `true` | Type-checks function bodies even when they have no annotations |
| `warn_unused_ignores` | `true` | Flags stale `# type: ignore` comments so they don't accumulate |
| `warn_return_any` | `false` | Suppresses warnings when functions return `Any` — intentional, as MongoDB and LLM responses are dynamically typed |
| `strict` | `false` | Full strict mode is off; `disallow_untyped_defs` is disabled to allow incremental type-annotation adoption |
