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

[`check.sh`](../check.sh) is a convenience script at the repo root that runs every check the CI pipeline runs, **locally**, in a single command. Several checks run once per backend service (the services are found from the tree by `backend/tools/services.py`), so the number of checks grows with the services. The script fails at the summary if any required tool is missing or any check fails, even if earlier checks passed. The backend, frontend, frontend-app and test checks run automatically after bootstrap (venv, npm, yarn) — no extra installation needed. The jwt-validator-lambda test also runs with no install, but only *fully* exercises anything if `terraform` happens to be on `PATH` — otherwise it self-skips with a message instead of failing (see footnote ⁵). Most security, image and Terraform checks require host tools to be pre-installed (except `semgrep` and `checkov`, which are venv-installed) — see **Required host tools** below. Nuclei (DAST) is written into the script but currently commented out — see the note after the table. **CodeQL, dependency-review, and nuclei run only in GitHub Actions CI** — nuclei needs the running compose stack and is disabled locally per company security-team policy (active scanning not permitted on company laptops); CodeQL and dependency-review require GitHub's own infrastructure. None of the three are part of `check.sh`. A colour-coded summary is printed at the end.

```bash
./check.sh
```

**Groups.** The checks are in groups, so you can run only the ones you need, or several at once:

```bash
./check.sh --list                                   # the groups and what each runs
./check.sh terraform scripts                        # only those groups, one after another
./check.sh --parallel                               # every group at once
./check.sh --parallel backend-lint backend-test frontend
./check.sh e2e                                      # the end-to-end journeys (or RUN_E2E=1 ./check.sh)
```

| Group | Runs |
|---|---|
| `backend-lint` | ruff, ruff format, mypy (tools, common, each service), the service tree check, import-linter, common's installs |
| `frontend` | API clients in sync, eslint, prettier, typecheck, build, bundle size, vitest |
| `app` | frontend-app's eslint, prettier, typecheck and jest |
| `backend-test` | pytest with the coverage gates for common, tools and each service (the compose `mongo` and `valkey`) |
| `playwright` | the web app's browser tests and their coverage floor |
| `scripts` | the edge functions' tests, every `scripts/*.test.sh`, the scheduler dispatcher, the service lists, shellcheck, actionlint, the routing and gateway sync checks |
| `security` | bandit, pip-audit, npm and yarn audit, retire.js, gitleaks, semgrep, hadolint, checkov, zizmor, trivy fs/config and the frontends' SBOMs |
| `images` | each service image built, then trivy, its SBOM and dockle (Docker) |
| `api` | each service's OpenAPI spec up to date, spectral |
| `terraform` | fmt, validate, terraform test (and per environment), tflint |
| `e2e` | the end-to-end journeys (only when named, or with `RUN_E2E=1`) |

- **The bootstrap runs once, first, and only for the groups chosen:** the backend venv always (it's quick and lists the services); the semgrep venv, the retire.js database and the yarn install only for `security` (and `app` for yarn); `npm ci` only for `frontend`, `playwright`, `security` or `api`. So `./check.sh terraform scripts` never reinstalls `node_modules`.
- **`--parallel`** starts every chosen group at once, each in its own process, with its output in `.check-logs/<group>.log` (gitignored, replaced each run). It reports each group as it finishes (✓ with its count, or ✗ with the checks that failed and its log), then the usual summary of every check; it exits non-zero if any check failed. Ctrl-C stops every group.
- **What the groups share:** nothing they write (Playwright alone writes `frontend/coverage`, `images` alone builds images; in parallel `images` uses its own Trivy cache, `~/.cache/trivy-check-images` or `$TRIVY_IMAGES_CACHE_DIR`, since two Trivy processes on one cache wait on its lock). They do share the CPU, memory and Docker: `playwright`, `images` and `terraform` are the heavy ones, so run those together only on a machine with room.
- `npm ci` replaces `frontend/node_modules`, so don't run `frontend`, `playwright`, `security` or `api` while a dev server from `frontend/` is running.

No manual setup required for backend, frontend, or frontend-app checks. On every run the script automatically:
- Creates `backend/.venv` if it does not exist, then syncs all Python packages from `requirements-dev.txt` (the union of every service's runtime pins), `requirements-lint.txt` (ruff, mypy, import-linter), `requirements-security.txt` (bandit, pip-audit, checkov, zizmor) and `requirements-test.txt` (pytest, pytest-cov, Moto, OpenTelemetry). `pip install` is a no-op when versions are already correct, so this is fast on subsequent runs. These files are the single source of truth for tool versions — both `check.sh` and CI read from them.
- Creates `backend/.venv-semgrep` for semgrep alone, at the version in `requirements-security.txt`. semgrep pins OpenTelemetry `~=1.37`, while the services and tests pin 1.45.1 (a security fix), so the two can't share a venv. CI already installs the security tools in a job of their own.
- Runs `npm ci` in `frontend/`, as CI does: it installs exactly what `package-lock.json` says and never rewrites it (slower, since it reinstalls `node_modules` every run).
- Runs `yarn install --frozen-lockfile` in `frontend-app/`. Fast on subsequent runs when `node_modules` already exists.
- Downloads/refreshes the retire.js vulnerability database to `frontend/retire-jsrepo.json` if it is absent or older than 7 days. The file is gitignored so it stays current without committing a static snapshot. If the network is unavailable and a previous copy exists, the existing file is reused with a warning.

The script looks for each tool in `backend/.venv/bin/` first, then falls back to `PATH`.

The real Mongo/Valkey tests skip unless they have throwaway servers — never a real cluster — and without them the coverage gates fail. When `MONGODB_TEST_URI` or `REDIS_URL` is unset and its compose container (`mongo`, `valkey`) is running (`docker compose up -d mongo valkey`), `check.sh` uses that container, on the port compose published (`MONGO_PORT` / `VALKEY_PORT` in `.env`); if either is still missing, it says the live tests will skip. To use other servers, set both:

```bash
MONGODB_TEST_URI="mongodb://localhost:27017/?directConnection=true" REDIS_URL=redis://localhost:6379 ./check.sh
```

The end-to-end scripts (`scripts/e2e/full-journey.py`, `account-deletion.py`, `convergence.py`) are off by default; `RUN_E2E=1` runs them against the running local stack (they make real LLM calls with the keys in `.env`).

**Required host tools:** `check.sh` fails if any of these are absent — install all of them before running the script. `semgrep` (into `backend/.venv-semgrep`), and `checkov` and `zizmor` (into `backend/.venv`), are installed automatically from `requirements-security.txt` and do not need a separate step. `terraform` is also used by the jwt-validator-lambda test — that one specific check self-skips with a message instead of failing if `terraform` is missing, but every other check listed below is a hard failure. `shellcheck` is optional: the ShellCheck step is skipped when it isn't installed, and `dockle` is optional inside the image scan.

```bash
brew install gitleaks
brew install hadolint
brew install aquasecurity/trivy/trivy
brew install goodwithtech/r/dockle
brew install terraform
brew install terraform-linters/tap/tflint
brew install shellcheck   # optional
brew install actionlint
# The image scans also require Docker to be installed AND running:
# https://docs.docker.com/get-docker/
# nuclei is NOT listed here — the DAST check is disabled locally (commented out in
# check.sh) per company security-team policy; it still runs in CI. See the note below
# the checks table.
# spectral is NOT listed here — it is a devDependency in frontend/package.json and is
# installed automatically by the npm ci bootstrap step. No manual install needed.
```

**Checks run** (in order; "per service" means one check for each service under `backend/`):

| Check | Tool | Scope |
|---|---|---|
| `ruff check` | ruff 0.11.2 | `backend/` — linting (unused imports, bugbear, naming, …) |
| `ruff format` | ruff 0.11.2 | `backend/` — formatting (black-compatible, line-length 100) |
| `mypy` | mypy 1.15.0 | `backend/tools/` + `backend/common/` — static type checking (Python 3.13) |
| service tree valid | `tools/services.py --check` | Every `backend/` directory with a `requirements.txt` is a well-formed service; no orphaned spec in `backend/openapi/` |
| `mypy (<service>)` | mypy 1.15.0 | Per service — `backend/<service>/` |
| import-linter (service boundaries) | `tools/import_contracts.py` | `common` never imports service code; services never import each other |
| common installs (core and extras) | pip | `backend/common` installs on its own and then with `[generation,uploads]` into a throwaway venv, and `pip check` passes after each |
| API clients in sync | `scripts/sync-api-clients.mjs --check` | Both apps' generated API files match `backend/openapi/*.json` |
| `eslint` | ESLint (via npm) | `frontend/src/**` (excl. `components/ui/`) — React/hooks rules, unused imports, security |
| `prettier` | Prettier (devDependency) | `frontend/src/**` — TS/TSX/CSS formatting; Tailwind classes auto-sorted (`prettier-plugin-tailwindcss`) |
| `typecheck` | tsc (via npm) | `frontend/src/**` — plain TypeScript type checking, two separate `tsc --noEmit` runs against `tsconfig.app.json` and `tsconfig.node.json` (no `checkJs`/JSDoc involved — this is a TS-only codebase) |
| `build` | Vite (via npm) | `frontend/` — production build |
| bundle size | bash + `wc` | `frontend/dist/` — main JS bundle must be ≤ 1.4 MB |
| `eslint (frontend-app)` | ESLint (via yarn) | `frontend-app/src/**` — React Native/hooks rules, unused imports, security |
| `prettier (check) (frontend-app)` | Prettier (devDependency) | `frontend-app/src/**/*.{ts,tsx}` — TS/TSX formatting |
| `typecheck (frontend-app)` | tsc | `frontend-app/src/**` — TypeScript type checking (`--noEmit`) |
| `jest (frontend-app)` | Jest (via yarn) | `frontend-app` unit tests |
| pytest + coverage (common, tools) | pytest + pytest-cov | `backend/common/tests` + `backend/tools/tests`; `common`'s line + branch coverage gated at 99% |
| pytest + coverage (`<service>`) | pytest + pytest-cov | Per service — `backend/<service>/tests`, line + branch coverage gated at 99% |
| jwt-validator-lambda unit tests ⁵ | Node's built-in test runner + `terraform` | `infra-live-edge/functions/jwt-validator-lambda.test.js` — renders the real `.tpl` through `terraform apply` rather than reimplementing HCL's `templatefile()`, so it exercises exactly what gets deployed |
| spa-rewrite unit tests | Node's built-in test runner | `infra-live-edge/functions/spa-rewrite.test.js` |
| `ecs-services.sh` / `fill-service-secrets.sh` tests | bash, fake `aws` CLI | The deploy / restart / promote helpers and terraform-live-backend's first-apply secret fill |
| service lists match services.tf | `scripts/check-service-lists.sh` | The workflows' `service` input help text matches `services.tf` |
| shellcheck (optional) | shellcheck | Every tracked shell script (`git ls-files '*.sh'`), `check.sh` included |
| actionlint | actionlint | Every workflow under `.github/workflows/`, each `run:` script through shellcheck |
| routing data in sync | `scripts/sync-routing.mjs --check` | The generated copies of `shared/routing.json` (`backend/common/regions_data.py`, `backend/auth/countries_data.py`, the frontends' `countries.ts` / `locationHint.ts`) |
| gateway config in sync | `scripts/sync-gateway.mjs --check` | `local/gateway/nginx.conf` matches `shared/service-routes.json` |
| `bandit` | bandit 1.9.4 | `backend/tools/`, `backend/common/` and each service — Python SAST: hard-coded secrets, injection, insecure calls (medium+ severity) |
| `pip-audit (services)` | pip-audit 2.9.0 | Each service's `requirements.txt` (`scripts/audit-backend-services.sh`, the `buddy-common` line left out) — dependency CVE scan; PYSEC-2025-183 suppressed (disputed, no fix) |
| `npm audit` | npm | `frontend/` — npm dependency CVE scan (high/critical only) |
| `yarn audit (frontend-app)` | yarn | `frontend-app/` — yarn dependency CVE scan (high/critical only) |
| retire.js | retire (devDependency) | `frontend/` — browser library CVEs not always caught by npm audit |
| retire.js (frontend-app) | retire (devDependency) | `frontend-app/` — same scan using the same retire.js database |
| gitleaks ² | gitleaks | Entire repo git history — accidentally committed secrets, API keys, tokens |
| semgrep (SAST) | semgrep 1.179.0 | `backend/tools/`, `backend/common/`, each backend service, `frontend/src/`, `frontend-app/src/` — Python and JavaScript/React SAST (`p/security-audit` ruleset); installed in its own venv, `backend/.venv-semgrep` |
| hadolint (backend Dockerfile) ² | hadolint | `backend/Dockerfile` — Dockerfile best practices and security misconfigurations |
| hadolint (frontend Dockerfile) ² | hadolint | `frontend/Dockerfile` — same |
| zizmor (GitHub Actions security) | zizmor 1.32.0 | `.github/` (workflows and `dependabot.yml`), offline — injection, token permissions, persisted credentials, unpinned actions, Dependabot cooldown; venv-installed |
| checkov (Terraform IaC) | checkov 3.2.529 | `infra-live-*/terraform/` (backend, edge, frontend, scheduler) and `modules/` — Terraform IaC misconfigurations (open S3 buckets, missing encryption, overly permissive IAM); venv-installed |
| trivy (backend / frontend CVE scan) ³ | trivy | `backend/`, `frontend/` — HIGH/CRITICAL CVEs in Python and npm packages (complements pip-audit / npm audit with a second CVE database) |
| trivy (backend / frontend license scan) ³ | trivy | `backend/`, `frontend/` — HIGH/CRITICAL license violations (GPL, AGPL, LGPL) |
| trivy (frontend SBOM) ³ | trivy | `frontend/` — generates `sbom-frontend.cyclonedx.json` in CycloneDX format |
| trivy (frontend-app CVE / license scan, SBOM) ³ | trivy | `frontend-app/` — the same three, SBOM `sbom-frontend-app.cyclonedx.json` |
| trivy config (infra-live-backend, -edge, -frontend, -scheduler, modules) ³ | trivy | Each Terraform directory — IaC security misconfigurations using Trivy's built-in Terraform rule set (tfsec successor) |
| image scan (`<service>`: trivy, SBOM, dockle) ³ | docker + trivy + dockle | Per service — builds `superpower-<service>:check-scan` from `backend/Dockerfile` (`--build-arg SERVICE=<service>`), scans it for OS-level HIGH/CRITICAL CVEs (fixed ones only), writes `sbom-backend-<service>.cyclonedx.json`, runs the CIS Docker Benchmark (dockle, if installed), then removes the image |
| `backend/openapi/<service>.json` up to date ⁴ | `tools/export-openapi.py --service` | Per HTTP service — exports the spec from the app (no running server needed); if the committed copy differs, writes the fresh one and fails so you can review and commit it |
| spectral (`<service>`) ⁴ | spectral (via `frontend/node_modules/.bin/`) | Per HTTP service — lints `backend/openapi/<service>.json` against `.spectral.yaml` (errors fail: security schemes, unique `operationId`) |
| terraform fmt check ¹ | terraform | Whole repo — formatting check (`-check -recursive`) |
| terraform validate ¹ | terraform | Every `infra-live-*/terraform/` and `modules/*/` (`init -backend=false`): misspelled arguments, wrong types, missing references |
| terraform test ¹ | terraform | Each `modules/*/` and `infra-live-backend/terraform/`, and every `infra-live-*/terraform/` once per environment with that environment's tfvars (`tests/envs`), against mock providers |
| tflint ¹ | tflint | `infra-live-backend`, `infra-live-edge`, `infra-live-frontend`, `infra-live-scheduler` and each `modules/*/` — deprecated syntax, wrong types, best-practice violations, and the AWS ruleset's checks (config: `.tflint.hcl`; `check.sh` runs `tflint --init` first, which downloads the plugin once, about 17 MB) |

¹ Required — `check.sh` fails with an install hint if `terraform` / `tflint` is not found in `PATH`.
² Required — `check.sh` fails with an install hint if the respective tool (`gitleaks` or `hadolint`) is not found in `PATH`.
³ Required — `check.sh` fails with an install hint if `trivy` or `docker` is not found in `PATH`. Docker must be installed **and running** for the image scans.
⁴ No manual install — `@stoplight/spectral-cli` is a `devDependency` in `frontend/package.json`. It is installed automatically during the `npm ci` bootstrap step and invoked directly from `frontend/node_modules/.bin/spectral`.
⁵ Soft dependency, not a hard failure — self-skips with a clear message (not added to the failed list) if `terraform` isn't on `PATH`, rather than failing the whole run.

**Note — nuclei (DAST):** written into `check.sh` (targeting the compose stack's gateway at `http://localhost:8088` — misconfiguration, exposure, and technology probes at medium/high/critical severity) but the entire block is currently **commented out**, disabled locally per company security-team guidance (active scanning tools aren't permitted on company laptops). It is not one of the checks above and does not run when you execute `./check.sh`, regardless of whether `nuclei` is installed. `check.yml` (CI) is unaffected and still runs it there.

**Note:** CodeQL (dataflow/taint analysis for Python and JavaScript) and dependency-review (PR lockfile CVE diffing) run only in GitHub Actions CI — they require GitHub's infrastructure and, like nuclei above, are not included in `check.sh`.

The exit code is non-zero if any check fails, making it safe to call from other scripts or a pre-push hook.

## Backend tooling (pyproject.toml)

[`backend/pyproject.toml`](../backend/pyproject.toml) centralises ruff and mypy configuration so the same settings are used everywhere each tool runs. Ruff's settings apply in all three places: the `pre-commit` hooks, `check.sh`, and CI. Mypy has no `pre-commit` hook at all (only `ruff`/`ruff-format` are configured in `.pre-commit-config.yaml`) — its settings only apply in `check.sh` and CI.

### ruff

| Setting | Value | Notes |
|---|---|---|
| `target-version` | `py313` | Enables Python 3.13 syntax modernisations via pyupgrade |
| `line-length` | `100` | Enforced by `ruff format`; `E501` is disabled in `ruff check` to avoid duplicate warnings |
| `quote-style` | `double` | Double-quoted strings (Black-compatible) |
| `indent-style` | `space` | Space indentation |
| `line-ending` | `lf` | Unix line endings enforced on all platforms |
| `known-first-party` | `["common"]` | isort treats `common` (the shared package) as a first-party import so it is grouped separately from third-party packages |

Rule sets enabled:

| Code | Plugin | What it checks |
|---|---|---|
| `E`, `W` | pycodestyle | Basic style errors and warnings |
| `F` | pyflakes | Undefined names, unused imports |
| `I` | isort | Import ordering |
| `B` | flake8-bugbear | Common bugs and opinionated style |
| `UP` | pyupgrade | Syntax modernisation for Python 3.13 |
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
| `python_version` | `3.13` | Matches the runtime Python version |
| `ignore_missing_imports` | `true` | Avoids errors for third-party packages without bundled stubs |
| `check_untyped_defs` | `true` | Type-checks function bodies even when they have no annotations |
| `warn_unused_ignores` | `true` | Flags stale `# type: ignore` comments so they don't accumulate |
| `warn_return_any` | `false` | Suppresses warnings when functions return `Any` — intentional, as MongoDB and LLM responses are dynamically typed |
| `strict` | `false` | Full strict mode is off; `disallow_untyped_defs` is disabled to allow incremental type-annotation adoption |
