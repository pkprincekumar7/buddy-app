# Code Quality, Security, Testing and Performance Standards

Stack: Python 3.13 / FastAPI backend (MongoDB Atlas + Redis), React + TypeScript web frontend
(Vite), React Native app (`frontend-app/`), Terraform infrastructure (AWS, multi-region), GitHub
Actions CI/CD.

This document is a **code-quality analysis**: what the repo enforces today, and the verified
gaps against the target standard, each with how to close it. Status was checked against the code
on **2026-10-16** — re-verify before acting on an item, and update the status when one is closed.

Status legend: ✅ in place · ⚠️ partial · ❌ missing

---

## Table of Contents

1. [Status Summary](#1-status-summary)
2. [GitHub Repository Configuration](#2-github-repository-configuration)
3. [Code Review Standards](#3-code-review-standards)
4. [Backend — Python / FastAPI](#4-backend--python--fastapi)
5. [Frontend — React + TypeScript](#5-frontend--react--typescript)
6. [Infrastructure — Terraform](#6-infrastructure--terraform)
7. [Container Security](#7-container-security)
8. [Testing](#8-testing)
9. [API Quality](#9-api-quality)
10. [Performance](#10-performance)
11. [Security — Cross-Cutting](#11-security--cross-cutting)
12. [Documentation Standards](#12-documentation-standards)
13. [Dependency Management](#13-dependency-management)
14. [Observability and Error Monitoring](#14-observability-and-error-monitoring)
15. [CI/CD Pipeline](#15-cicd-pipeline)
16. [Exception and Suppression Process](#16-exception-and-suppression-process)

---

## 1. Status Summary

### Already enforced

| Area | What runs today | Where |
|---|---|---|
| Backend lint / format / types | `ruff check`, `ruff format --check`, `mypy app` (non-strict) | `check.yml` → `backend-lint` |
| Backend tests | pytest, **99% line + branch coverage gate**, real Mongo/Redis integration tests in CI | `check.yml` → `backend-test` |
| Mutation testing | mutmut + hand-built handler mutants (manual only, list validated in CI) | `docs/mutation-testing.md` |
| Frontend lint / types / build | ESLint, Prettier check, `tsc`, build, bundle-size budget (≤ 1.4 MB) | `check.yml` → `frontend-lint` |
| React Native app | ESLint, Prettier check, `tsc`, Jest unit tests | `check.yml` → `frontend-app-lint` |
| Lambda@Edge | unit tests + `shared/routing.json` sync check | `check.yml` → `lambda-edge-test` |
| Terraform | `terraform fmt -check`, tflint (default rules) on all 4 modules | `check.yml` → `terraform-lint` |
| SAST | Bandit, Semgrep (`p/security-audit`), CodeQL | `check.yml` |
| Secrets | Gitleaks (full history, `.gitleaks.toml`) | `check.yml` → `security-scan` |
| Dependencies | pip-audit, npm audit, yarn audit, Retire.js, Trivy (deps + licenses), Dependency Review | `check.yml` |
| IaC security | Checkov + `trivy config` on all 4 modules | `check.yml` → `security-scan` |
| Containers | Hadolint (both Dockerfiles), Trivy image scan, Dockle, SBOMs | `check.yml` → `security-scan` |
| DAST / API contract | committed `openapi.json` drift check, Spectral lint, Nuclei | `check.yml` → `dast` |
| Pre-commit | Husky: lint-staged (`frontend/src`) + ruff; `pre-commit` framework: file hygiene + ruff | `frontend/.husky/`, `.pre-commit-config.yaml` |
| Auth | RS256 JWT, single-use refresh tokens (session `jti` rotated on every refresh), token revocation, slowapi + Redis rate limits | `backend/app/routers/auth.py` |
| Transport | CloudFront `redirect-to-https`, HTTPS-only origin, ALB HTTPS-only (443), HSTS 2 years + `includeSubDomains` + `preload` | `infra-live-edge`, `infra-live-backend` |
| Deploy safety | ECS circuit breaker with automatic rollback; deploy waits for steady state | `ecs.tf`, `deploy-live-backend.yml` |

### Open gaps (priority order)

| # | Gap | Current state | Target | Section |
|---|---|---|---|---|
| 1 | Terraform provider lock files | No `.terraform.lock.hcl` committed in any module | Committed per module | [6](#6-infrastructure--terraform) |
| 2 | GitHub Actions pinned by SHA | All actions use mutable tags | Full commit SHA + version comment | [11](#11-security--cross-cutting) |
| 3 | Dependabot | `.github/dependabot.yml` missing | Weekly/monthly updates for every ecosystem | [2](#2-github-repository-configuration) |
| 4 | Frontend (web) tests | No test runner, no tests | Vitest + Testing Library + MSW | [8](#8-testing) |
| 5 | mypy strict | `strict = false` — **207 errors in 22 files** under `--strict` | `strict = true` | [4](#4-backend--python--fastapi) |
| 6 | Ruff `S` + `ANN` rules | Not selected — **58 findings** in `app/` | Selected, findings fixed | [4](#4-backend--python--fastapi) |
| 7 | `terraform validate` on PRs | Only runs inside the `terraform-live-*` deploy workflows (not scheduler); not in `check.yml` | All 4 modules in `terraform-lint` | [6](#6-infrastructure--terraform) |
| 8 | tflint config | No `.tflint.hcl` → AWS ruleset not enabled | `.tflint.hcl` per module | [6](#6-infrastructure--terraform) |
| 9 | Readiness endpoint | Only `/health` (liveness) and `/api/health` (build info) | `/health/ready` checking Mongo + Redis | [4](#4-backend--python--fastapi) |
| 10 | Post-deploy smoke test | Deploy checks ECS steady state only | HTTP smoke test after each deploy | [15](#15-cicd-pipeline) |
| 11 | Error monitoring | No Sentry / OpenTelemetry | Sentry (backend + frontends) | [14](#14-observability-and-error-monitoring) |
| 12 | Base image digests | `python:3.13-slim`, `node:22-alpine`, `nginx:1.27-alpine` by tag | Pinned by digest | [7](#7-container-security) |
| 13 | CODEOWNERS | `.github/CODEOWNERS` missing | Present | [2](#2-github-repository-configuration) |
| 14 | Branch protection | Not verifiable from the repo | 1 review, CI required, no force-push | [2](#2-github-repository-configuration) |
| 15 | Pre-commit secrets + Terraform fmt | Gitleaks and `terraform fmt` run in CI only | Also on commit | [11](#11-security--cross-cutting) |
| 16 | Accessibility lint | No `eslint-plugin-jsx-a11y` (web or app) | Recommended rules on | [5](#5-frontend--react--typescript) |
| 17 | Structured logging | stdlib `logging` with `event key=value` messages; `request_id` not attached to log records | JSON logs with `request_id` | [4](#4-backend--python--fastapi) |
| 18 | Conventional Commits / CHANGELOG | Commit messages are free-form (`Updated code.`); no `CHANGELOG.md` | Conventional Commits + release-please | [2](#2-github-repository-configuration), [12](#12-documentation-standards) |
| 19 | READMEs | Missing in `backend/`, `infra-live-*/` (4), `scripts/` | One per runnable directory | [12](#12-documentation-standards) |
| 20 | ADRs | No `docs/adr/` | MADR records for major decisions | [12](#12-documentation-standards) |
| 21 | RFC 7807 errors | FastAPI `{"detail": ...}` shape | Problem Details (breaking change) | [9](#9-api-quality) |
| 22 | Schemathesis / k6 / Lighthouse / Playwright | None configured | Advisory runs against staging | [8](#8-testing), [9](#9-api-quality), [10](#10-performance) |
| 23 | Prettier `trailingComma` | Not set in `frontend/.prettierrc` | `"all"` | [5](#5-frontend--react--typescript) |

---

## 2. GitHub Repository Configuration

### CODEOWNERS ❌

Create `.github/CODEOWNERS`:

```
# Auth is security-sensitive
/backend/app/routers/auth.py          @prince-els
/backend/app/auth_utils.py            @prince-els
/infra-live-edge/functions/           @prince-els

# Infrastructure changes require infra owner review
/infra-live-backend/                  @prince-els
/infra-live-frontend/                 @prince-els
/infra-live-edge/                     @prince-els
/infra-live-scheduler/                @prince-els

# CI/CD pipeline changes
/.github/workflows/                   @prince-els
```

### Branch protection rules ⚠️ (GitHub setting — not verifiable from the repo)

Configure on GitHub → Settings → Branches (or a ruleset) for `main`:
- Require 1 approved review before merging
- Dismiss stale reviews on new pushes
- Require status checks: `backend-lint`, `backend-test`, `frontend-lint`, `frontend-app-lint`,
  `lambda-edge-test`, `terraform-lint`, `security-scan`, `dast`, `codeql`, `dependency-review`
- No force-push, no deletion

### Dependabot ❌

Create `.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: pip
    directory: /backend
    schedule:
      interval: weekly
    open-pull-requests-limit: 5

  - package-ecosystem: npm
    directory: /frontend
    schedule:
      interval: weekly
    open-pull-requests-limit: 5

  - package-ecosystem: npm          # yarn.lock is handled by the npm ecosystem
    directory: /frontend-app
    schedule:
      interval: weekly
    open-pull-requests-limit: 5

  - package-ecosystem: terraform
    directories:
      - /infra-live-backend/terraform
      - /infra-live-frontend/terraform
      - /infra-live-edge/terraform
      - /infra-live-scheduler/terraform
    schedule:
      interval: monthly

  - package-ecosystem: docker
    directories:
      - /backend
      - /frontend
    schedule:
      interval: monthly

  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: monthly
```

### Git workflow conventions ⚠️

Branches currently follow `feature/...`. Commit messages do **not** follow a convention (recent
history is `Updated code.`), which blocks automated changelogs (Section 12).

**Branch naming:**

| Prefix | Purpose |
|---|---|
| `feature/<short-description>` | New features |
| `fix/<short-description>` | Bug fixes |
| `refactor/<short-description>` | Code restructuring, no behaviour change |
| `chore/<short-description>` | Maintenance, dependency updates, config |
| `hotfix/<short-description>` | Urgent production fixes |
| `docs/<short-description>` | Documentation only |
| `release/<version>` | Release preparation |

**Commit message format** — [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short summary>

[optional body]

[optional footer: BREAKING CHANGE, closes #issue]
```

Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `ci`, `revert`

**Merge strategy:**
- Feature/fix/refactor/chore → main: squash merge (the squash title must be a Conventional Commit)
- Hotfix → main: merge commit
- Release → main: merge commit

Keep PRs under **400 lines** of non-generated code (generated: `openapi.json`,
`backend/app/routing_data.py`, the frontends' `countries.ts` / `locationHint.ts`, lock files).

### Release tagging ❌

Releases follow [Semantic Versioning](https://semver.org/). Tags created on `main`:
```
git tag -a v1.4.2 -m "Release v1.4.2"
```
Automate with `release-please` once Conventional Commits are in use (Section 12).

---

## 3. Code Review Standards

Approval requirements (depend on branch protection + CODEOWNERS — Section 2):
- Minimum 1 approved review before merge
- PR author cannot approve their own PR
- Stale reviews dismissed on new pushes
- Reviews completed within 1 business day

Open as **Draft** when work is in progress; convert to "Ready for review" when complete.

The project-specific checklists live in `backend/CLAUDE.md`, `frontend/CLAUDE.md` and
`frontend-app/CLAUDE.md`; `/standards-review` audits code against them. The list below is the
cross-cutting reviewer checklist.

**Correctness**
- [ ] Logic matches intent in the PR description
- [ ] Edge cases handled (empty inputs, null values, async errors)
- [ ] No silent failure paths
- [ ] Async errors properly awaited and caught

**Security**
- [ ] No hardcoded secrets, tokens, or credentials
- [ ] User input validated at all system boundaries (Pydantic models on every route)
- [ ] MongoDB queries use dict literals — no raw string interpolation
- [ ] Every query is scoped by `location` (multi-region data residency) as well as `user_id`
- [ ] Auth dependency present on all new protected routes
- [ ] New auth-related code reviewed against [OWASP Top 10](https://owasp.org/www-project-top-ten/)

**Testing**
- [ ] New logic has tests; the 99% coverage gate still passes
- [ ] At least one failure/edge case tested, not just the happy path
- [ ] DB-touching behaviour also covered by a `live_service` test (real MongoDB, not mocked)

**API contracts**
- [ ] Response shape changes are backwards-compatible, or documented as a breaking change
- [ ] Committed `openapi.json` regenerated (CI fails on drift)
- [ ] New endpoints have a `description=` on the route decorator (flows into the OpenAPI spec)
- [ ] Web change ported to `frontend-app/` where applicable (`frontend-app/CLAUDE.md`)

**Infrastructure**
- [ ] Terraform changes include `terraform plan` output in the PR description
- [ ] No new public-facing AWS resources without explicit justification
- [ ] Region data changed only in `shared/routing.json` + `node scripts/sync-routing.mjs`

Reviewers should NOT block on: style issues that Ruff/Prettier enforce, or subjective naming
preferences without real ambiguity.

---

## 4. Backend — Python / FastAPI

### Package manager ✅

`requirements*.txt` (runtime, lint, test, security, mutation) are the single source of truth,
installed with pip in CI, `check.sh`, the Dockerfile and the Husky hook. The orphaned `uv.lock`
was removed. If you later move to uv, add a `[project]` table + `[dependency-groups]`, `uv lock`,
switch every install site in one change, then delete the requirements files.

### Python version pin ⚠️

3.13 is pinned in the Dockerfile and each `setup-python` step, but there is no
`backend/.python-version`. Add one (`3.13`) so local venvs, `uv` and `setup-python`
(`python-version-file: backend/.python-version`) all read the same value.

### Ruff — add security and annotation rules ❌

`select` currently has `E, W, F, I, B, UP, C4, RET, SIM, N`. Enabling `S` and `ANN` on `app/`
today reports **58 findings** — 46 × `ANN201` (missing return type on public functions),
4 × `ANN401` (`Any`), 4 × `S101` (`assert`), 2 × `ANN001`, 1 × `ANN202`, 1 × `S311`
(non-crypto `random`).

```toml
[tool.ruff.lint]
select = [
    "E", "W", "F", "I", "B", "UP", "C4", "RET", "SIM", "N",
    "S",    # flake8-bandit — security checks
    "ANN",  # flake8-annotations — type annotations on public functions
]

[tool.ruff.lint.per-file-ignores]
"tests/**" = ["S101", "ANN"]   # assert and missing annotations are fine in tests
```

Bandit already runs in CI (`bandit -r backend/app/ backend/tools/ -ll`) and does not scan
`tests/`, so no `[tool.bandit]` skip config is needed.

### mypy — enable strict mode ❌

Current config: `strict = false`, `disallow_untyped_defs = false`, `warn_return_any = false`,
`check_untyped_defs = true`. Running `mypy app --strict` today reports **207 errors in 22 files**.

Target:

```toml
[tool.mypy]
python_version = "3.13"
strict = true
ignore_missing_imports = true
warn_unused_ignores = true
```

Fix incrementally — enable `disallow_untyped_defs` first (it overlaps with Ruff `ANN`), then
`warn_return_any`, then full `strict`. Do not use `# type: ignore` to get there.

### pip-audit ignores ⚠️

The ignore for `PYSEC-2025-183` is duplicated inline in `check.yml` and `check.sh`. pip-audit has
no config-file option for ignores, so keep both copies in sync, and record the reason and a review
date in a comment next to each (Section 16).

### Structured logging ⚠️

Current state: stdlib `logging`, already using an event-style message convention
(`log.warning("auth.refresh.failed reason=jti_not_found sub=%s", uid)`). `request_id_middleware`
generates or propagates `X-Request-Id`, but the ID is not attached to log records, so you can't
correlate log lines for a single request in CloudWatch.

Target: JSON logs in deployed environments, with `request_id` on every request-scoped event.
Either:
- **structlog** — `structlog.configure(...)` with `JSONRenderer()` when `app_env != "dev"`, and
  `structlog.contextvars.bind_contextvars(request_id=...)` in `request_id_middleware`; or
- **stdlib only** — a `contextvars.ContextVar` set in the middleware, plus a `logging.Filter` that
  copies it onto each record, plus a JSON formatter.

Required fields on every event: `timestamp`, `level`, `event`, `request_id` (request-scoped).
Never log tokens, passwords, or full emails.

Log levels: `DEBUG` (local only), `INFO` (normal events), `WARNING` (recoverable issues), `ERROR`
(failures needing attention), `CRITICAL` (service-level failures).

### Health check — add readiness endpoint ❌

Current state: `/health` (liveness, unthrottled) and `/api/health` (build metadata,
rate-limited at 30/min). Neither checks dependencies.

Add `/health/ready`: ping MongoDB (`db.command("ping")`) and Redis, if one is configured. Return
200 only when both respond, or 503 otherwise. Add the path to `_HEALTH_PATHS` so it gets the same
middleware treatment. Point the ALB target-group health check at it, keep `/health` for liveness,
and use it for the post-deploy smoke test (Section 15).

### JWT ✅ / ⚠️

Already in place: RS256 signing, single-use refresh tokens (each refresh inserts a new session
`jti` and deletes the old one), `tokens_revoked_at` revocation honoured on refresh, and
location-scoped sessions.

Remaining (optional): defaults are `jwt_access_expire_minutes = 30` and
`jwt_refresh_expire_hours = 24`. Consider a 15-minute access token. Lengthening the refresh window
is a product decision, since it trades re-login frequency against session lifetime.

### MongoDB-specific standards ✅

The current code follows these; enforce them in review:

- **No raw string interpolation in queries.** Use dict literals only.
- Every query is scoped by `location` (multi-region data residency).
- Every query has a supporting index. `init_indexes()` in `app/database.py` is the only place
  indexes are created, never inline in route handlers.
- Every DB call is `await`ed — no synchronous Motor calls in async routes.
- List queries are bounded: `.to_list(limit)` (current pattern), or `.limit()`.

---

## 5. Frontend — React + TypeScript

### Prettier — set trailingComma ❌

`frontend/.prettierrc` currently has `plugins`, `tailwindConfig`, `singleQuote`, `semi`,
`printWidth`. Add `"trailingComma": "all"` (the Prettier 3 default — making it explicit prevents
churn if the default changes). `frontend-app/.prettierrc.js` already sets it.

### Accessibility — eslint-plugin-jsx-a11y ❌

**Target: WCAG 2.1 Level AA.** Not installed in `frontend/` or `frontend-app/`.

Web (`frontend/eslint.config.ts`):
```bash
npm install -D eslint-plugin-jsx-a11y
```
```ts
import jsxA11y from 'eslint-plugin-jsx-a11y';

// In the config array:
jsxA11y.flatConfigs.recommended,
```

React Native (`frontend-app/`): `eslint-plugin-react-native-a11y`.

Fix all reported violations before enabling — do not suppress with `eslint-disable`. Lighthouse
accessibility score target: ≥ 90 (advisory).

### Dependency scanning ✅

npm audit, yarn audit, Retire.js, Trivy, CodeQL and Dependency Review already run on every PR.
Snyk would be redundant — only add it if you need its reachability analysis.

---

## 6. Infrastructure — Terraform

Modules: `infra-live-backend`, `infra-live-edge`, `infra-live-frontend`, `infra-live-scheduler`
(each under `terraform/`).

### terraform validate — add to PR CI ⚠️

`terraform validate` runs only inside `terraform-live-backend/edge/frontend.yml` (at deploy time,
never for the scheduler). It should fail the PR instead. Add it to `check.yml` → `terraform-lint`:

```yaml
- name: Terraform validate (all modules)
  run: |
    for m in infra-live-backend infra-live-edge infra-live-frontend infra-live-scheduler; do
      terraform -chdir=$m/terraform init -backend=false -input=false
      terraform -chdir=$m/terraform validate
    done
```

### tflint configuration file ❌

tflint runs on all 4 modules, but with no `.tflint.hcl`, so only the core Terraform rules apply —
the AWS ruleset (invalid instance types, deprecated arguments, etc.) is off. Create
`.tflint.hcl` in each `infra-live-*/terraform/` (or one at the root, passed with `--config`):

```hcl
plugin "terraform" {
  enabled = true
  preset  = "recommended"
}

plugin "aws" {
  enabled = true
  version = "<latest from github.com/terraform-linters/tflint-ruleset-aws/releases>"
  source  = "github.com/terraform-linters/tflint-ruleset-aws"
}
```

Add `tflint --init` before the tflint steps in CI. tflint errors block merge; warnings are advisory.

### infracost ❌ (optional)

Advisory cost diff on PRs that touch `infra-live-*`. Cost changes > $50/month must be acknowledged
in the PR description. See `docs/aws-cost-estimate.md` for the current baseline.

### Terraform state and provider locks ⚠️

- ✅ Remote state in S3 with native S3 locking (`use_lockfile = true`) — DynamoDB is not needed.
- ✅ State key per environment, and per region for the backend.
- ❌ **No `.terraform.lock.hcl` is committed in any module**, so every `init` can resolve different
  provider builds. Run `terraform init` in each module, then
  `terraform providers lock -platform=linux_amd64 -platform=darwin_arm64`, and commit the lock
  files. Update them deliberately when provider versions change.
- `terraform plan` output goes in the PR description for infrastructure-affecting changes.

---

## 7. Container Security

Already in place ✅: Hadolint on both Dockerfiles, Trivy image scan, Dockle (CIS benchmark), and
CycloneDX SBOMs.

### Base image digest pinning ❌

Current images are mutable tags: `python:3.13-slim` (backend), `node:22-alpine` + `nginx:1.27-alpine`
(frontend). Pin by digest and keep the tag as a comment:

```dockerfile
# docker buildx imagetools inspect python:3.13-slim  → copy the index digest
FROM python:3.13-slim@sha256:<digest>
```

Dependabot's `docker` ecosystem (Section 2) keeps pinned digests current. Tags can be moved
upstream, so this is a supply-chain risk.

---

## 8. Testing

### Backend — Pytest ✅

- 29 test modules in `backend/tests/` (flat layout); tooling: pytest, pytest-cov, httpx.
- CI and `check.sh` enforce **99% line + branch coverage** of `app/`:
  `pytest --cov=app --cov-branch --cov-report=term-missing --cov-fail-under=99 -q`
- `live_service` marker: tests against a real MongoDB/Redis. They're skipped locally without one,
  but **fail** the run in CI (`REQUIRE_LIVE_SERVICES=1`). Never point `MONGODB_TEST_URI` at a real
  cluster.
- Mutation testing (mutmut + `tools/mutate_handlers.py`) is manual-only — see
  `docs/mutation-testing.md`.

Rules:
- **Do not mock the database for DB behaviour** — cover it with a `live_service` test.
  Mocked DB tests hide real query and index failures.
- Optional: add **Hypothesis** for input-parsing and validation functions (e.g. Pydantic schema
  validators):

```python
from hypothesis import given, strategies as st

@given(st.text(min_size=1, max_size=255))
def test_name_validator_never_raises_unexpectedly(name: str) -> None:
    ...
```

### React Native app — Jest ⚠️

Jest with React Native Testing Library runs in CI. Only 7 test files exist (routing, theme,
class names, portal, and so on) and there's no coverage threshold. Add screen-level tests for the
critical flows, and a `--coverage` threshold once a baseline exists.

### Frontend (web) — Vitest ❌

No test runner or tests exist in `frontend/`.

```bash
npm install -D vitest @vitest/coverage-v8 @testing-library/react @testing-library/user-event jsdom msw
```

`frontend/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': resolve(import.meta.dirname, './src') } },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    coverage: { provider: 'v8', thresholds: { lines: 70, functions: 70, branches: 65 } },
  },
});
```

Add `"test": "vitest"` and `"test:coverage": "vitest run --coverage"` scripts, plus a CI step in
`frontend-lint`. Use **MSW** to intercept at the network level — don't mock `fetch` directly.

### End-to-End — Playwright ❌

Cover the onboarding flow (`Onboarding → LifePathway → GrowthAreas`) and auth (login,
registration, Google sign-in callback, session expiry/refresh). Run on `main` against staging only,
not on every PR.

---

## 9. API Quality

### Error response format — RFC 7807 ❌

Current state: custom handlers in `app/main.py` for `RequestValidationError` (422),
`HTTPException` and unhandled exceptions. They keep FastAPI's `{"detail": ...}` shape, and no
stack traces leak.

Target: [RFC 7807 Problem Details](https://datatracker.ietf.org/doc/html/rfc7807)
(`type`, `title`, `status`, `detail`, `instance`; media type `application/problem+json`).
**This is a breaking change** — both `frontend/` and `frontend-app/` read `detail`. Ship it with
the client changes in the same release, or keep `detail` as a compatible field during a deprecation
window.

### Schemathesis — API fuzz testing ❌

The `dast` job already boots the backend, checks the committed `openapi.json` for drift, and runs
Spectral and Nuclei. Add Schemathesis to the same job and to its fail-gate:

```yaml
- name: Schemathesis (API fuzz)
  id: schemathesis
  continue-on-error: true
  run: |
    pip install schemathesis
    schemathesis run http://localhost:8000/openapi.json --checks all --max-examples 50
```

### Breaking change policy

A **breaking change** is any of:
- Removing or renaming a field in a response body
- Changing the type of a field
- Removing an endpoint
- Changing a required request parameter name

Breaking changes require:
1. `BREAKING CHANGE:` footer in the commit message
2. API version bump (`/api/v1` → `/api/v2`) if it affects a public client contract
3. Both clients (`frontend/`, `frontend-app/`) updated in the same release
4. Deprecation notice in the PR description with a migration guide

### CORS ✅

Explicit origins from `settings.cors_origins` (comma-separated), no wildcard. Do not change.

---

## 10. Performance

### Service-level objectives (SLOs)

Define and instrument these once metrics exist (Section 14):

| Metric | Target |
|---|---|
| Uptime | 99.9% (≤ 8.7h downtime/year) |
| API p95 latency (non-LLM routes) | < 500ms |
| API p99 latency (non-LLM routes) | < 1000ms |
| Error rate | < 0.1% (5xx responses) |

LLM-backed routes (`/api/v1/llm/*`, background jobs) are bound by the upstream provider's latency.
Track them separately rather than against the API targets.

Alerts fire when any SLO is breached for > 5 consecutive minutes.

### Backend load testing — k6 ❌

Create `k6/thresholds.js` with `p(95)<500`, `p(99)<1000`, `http_req_failed rate<0.01`. Target
`/health/ready` and a representative authenticated read route. Run against staging after deploys
to `main` (advisory). Never load-test the LLM routes against real providers.

### Frontend performance

Already in place ✅: a bundle-size budget in CI (main JS ≤ 1.4 MB).

Missing ❌: Lighthouse CI against staging for Core Web Vitals — LCP < 2.5s, INP < 200ms,
CLS < 0.1. A score drop of > 10 points triggers a review comment (advisory).

---

## 11. Security — Cross-Cutting

### OWASP Top 10 — mitigation table

| Risk | Mitigation | Status |
|---|---|---|
| A01 Broken Access Control | Auth dependency on protected routes; queries scoped by `user_id` + `location` | ✅ |
| A02 Cryptographic Failures | RS256 JWT (keys in Secrets Manager); TLS at CloudFront/ALB; HSTS preload | ✅ |
| A03 Injection | MongoDB dict queries; Pydantic at all boundaries; Semgrep + Bandit + CodeQL | ✅ |
| A04 Insecure Design | No stack traces in responses; RFC 7807 pending | ⚠️ |
| A05 Security Misconfiguration | Checkov + `trivy config` + tflint on all Terraform; no wildcard CORS; Hadolint/Dockle | ✅ |
| A06 Vulnerable Components | pip-audit, npm/yarn audit, Retire.js, Trivy, Dependency Review; Dependabot pending | ⚠️ |
| A07 Auth Failures | Short-lived access JWT; single-use rotating refresh tokens; revocation; slowapi + Redis rate limits | ✅ |
| A08 Integrity Failures | SBOMs generated; action SHA pinning and image digest pinning pending | ⚠️ |
| A09 Logging Failures | Event-style logs, no secrets logged; request correlation + Sentry pending | ⚠️ |

### GitHub Actions — pin all actions to commit SHA ❌

Every `uses:` is a mutable tag today (e.g. `actions/checkout@v6.0.2`,
`aws-actions/configure-aws-credentials@v6.1.1`, `aquasecurity/trivy-action@v0.36.0`,
`actions/cache@v5`, `github/codeql-action/*@v3`). Pin each one to a full SHA, keeping the version as
a comment:

```yaml
- uses: actions/checkout@<40-char-sha>  # v6.0.2
```

Automate with [pinact](https://github.com/suzuki-shunsuke/pinact) (`pinact run`). Dependabot's
`github-actions` ecosystem then keeps the SHAs current. Pinning matters most for third-party
actions that receive AWS credentials or secrets (`configure-aws-credentials`, `trivy-action`).

### Gitleaks configuration ✅

`.gitleaks.toml` extends the default ruleset and has a narrow allowlist: `frontend-app/ios/Podfile.lock`
(library names that trigger the generic-key rule) and the PEM-placeholder shape in
`docs/jwt-keys-alternate.md`. Keep allowlist entries narrow, each with a comment explaining why.

If a real secret is ever committed: **rotate it immediately**, then remediate history with
`git filter-repo` and enable GitHub push protection.

### Pre-commit hooks — add gitleaks and terraform fmt ⚠️

Two hook systems run today:
- **Husky** (`frontend/.husky/pre-commit`): lint-staged for `frontend/src/` and ruff for `backend/`.
  `frontend-app/` is not covered.
- **pre-commit framework** (`.pre-commit-config.yaml`): file hygiene (trailing whitespace, YAML/JSON
  checks, large files > 500 KB, LF endings) and ruff.

Add secrets scanning and `terraform fmt` to `.pre-commit-config.yaml`:

```yaml
  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.30.1          # match the CI version
    hooks:
      - id: gitleaks

  - repo: https://github.com/antonbabenko/pre-commit-terraform
    rev: <latest tag>
    hooks:
      - id: terraform_fmt
```

Also extend lint-staged (or add a Husky block) to run ESLint/Prettier on staged `frontend-app/`
files.

### HTTPS enforcement ✅

- CloudFront: `viewer_protocol_policy = "redirect-to-https"`; the origin connection is `https-only`
- ALB: a single HTTPS listener on 443 (no HTTP listener)
- HSTS response header at CloudFront: `max-age=63072000; includeSubDomains; preload`

---

## 12. Documentation Standards

### FastAPI route descriptions ✅

The convention is the `description=` argument on the route decorator (flows into the OpenAPI spec),
and all routes currently have one. Keep it for every new route; reserve docstrings for
non-obvious internals.

### Type annotations ⚠️

All public functions in services, routers and database modules must be fully annotated. This will
be enforced once Ruff `ANN` and `mypy --strict` are on (Section 4) — 46 public functions currently
lack a return type.

### Inline comments

Only add a comment when the **why** is non-obvious: a hidden constraint, a library workaround, or a
surprising invariant. Do not comment what the code does.

### README completeness ⚠️

Present: root, `frontend/`, `frontend-app/`, `shared/`, plus guides in `docs/` (`getting-started`,
`ci-cd`, `tests`, `code-quality`, `api`, infra architecture).

Missing: `backend/`, `infra-live-backend/`, `infra-live-edge/`, `infra-live-frontend/`,
`infra-live-scheduler/`, `scripts/`. Each should cover how to run locally, required environment
variables (pointing to `.env.example`), and how to test or plan. Linking to the relevant `docs/`
page is enough when the detail already lives there.

### CHANGELOG ❌

Create `CHANGELOG.md` ([Keep a Changelog](https://keepachangelog.com/) format), generated by
[`release-please`](https://github.com/googleapis/release-please). This only works once commits
follow Conventional Commits (Section 2).

### Architecture Decision Records (ADRs) ❌

Create `docs/adr/` using the [MADR template](https://adr.github.io/madr/). ADRs are write-once —
supersede one by adding a new record. Initial records to backfill: RS256 JWT with rotating refresh
sessions, MongoDB Atlas global clusters with `location` routing, multi-region ECS behind one
CloudFront distribution, the Lambda@Edge JWT validator, and building the image once and pushing it
to every region's ECR.

---

## 13. Dependency Management

### Update cadence

| Type | Cadence |
|---|---|
| Security patches (any CVE) | CRITICAL: 24h, HIGH: 3 business days, MEDIUM/LOW: next cycle |
| Minor/patch bumps | Weekly via Dependabot (Section 2 — pending) |
| Major version bumps | Quarterly, manual review + smoke test on staging |

Transitive CVE floor pins (e.g. `starlette`, `urllib3` in `backend/requirements.txt`) must carry a
comment with the advisory IDs. Remove them once the direct dependency's own floor covers the fix.

### Major version upgrade policy

1. Dedicated `chore(deps):` PR — not bundled with feature work
2. Full test suite passing (including `live_service` tests)
3. Manual smoke test on staging before merging to main
4. `CHANGELOG.md` entry

### License compliance ✅

New dependencies must use an OSI-approved license compatible with the project license. AGPL and
SSPL dependencies are not permitted. Trivy license scans run on every PR for backend, frontend
and frontend-app. For a manual review:

```bash
pip-licenses --format=table          # Python
npx license-checker --summary        # Node
```

---

## 14. Observability and Error Monitoring

Nothing beyond application logs (CloudWatch via ECS) is configured today. ❌

### Sentry — error monitoring

**Backend:** `sentry-sdk[fastapi]` initialised in `app/main.py` with `send_default_pii=False`,
`environment=settings.app_env` and `traces_sample_rate=0.1`. Add `sentry_dsn` to `Settings` and to
Secrets Manager.

**Web frontend:** `@sentry/react` initialised in `src/main.tsx` with `VITE_SENTRY_DSN`. Upload
source maps in `deploy-live-frontend.yml`.

**React Native app:** `@sentry/react-native`. Upload source maps in the APK/IPA build workflows.

Tag each deploy as a Sentry release (`sentry-cli releases`), using the same `<date>-<sha>` image
tag as the backend deploy.

### Metrics and tracing — OpenTelemetry

Start with CloudWatch-native metrics (ALB latency/5xx, ECS CPU/memory) and add CloudWatch alarms
for them. Add OpenTelemetry (`opentelemetry-instrumentation-fastapi`, `-pymongo`) exporting to
CloudWatch/X-Ray only when request-level tracing is needed.

### Alert thresholds

- 5xx rate > 1% for > 5 minutes
- p99 latency (non-LLM routes) > 2s for > 5 minutes
- ECS target health check failing for > 2 consecutive checks
- Any CRITICAL Sentry issue with > 10 occurrences in 1 hour

---

## 15. CI/CD Pipeline

### Current pipeline ✅

`check.yml` runs on every PR to `main`, on every push to `main`, and on manual dispatch. Jobs:
`backend-lint`, `backend-test`, `frontend-lint`, `frontend-app-lint`, `lambda-edge-test`,
`terraform-lint`, `security-scan`, `dast`, `codeql`, `dependency-review`. pip, npm and yarn
caching is configured through the `setup-*` actions.

Deployment is manual (`workflow_dispatch`):
- `terraform-live-*` — plan, apply, plan-destroy or destroy, per environment and region set.
- `deploy-live-backend` — builds the image once, pushes it to every selected region's ECR, then
  rolls ECS out in each region in parallel.
- `promote-live-*` — promotes between environments along fixed paths.
- `restart-live-backend` — restarts ECS services.

Deploy, promote and restart share a lock per environment + service.

### SHA pinning ❌

See Section 11.

### Post-deploy smoke tests ❌

`deploy-live-backend` and `promote-live-backend` wait for ECS steady state, but never call the
service over HTTP. Add a final step that hits the public endpoint through CloudFront:

```bash
curl -fsS --retry 5 --retry-delay 5 "https://<api-host>/health/ready"
curl -fsS "https://<api-host>/api/health" | jq -e --arg sha "$GIT_SHA" '.commit == $sha'
```

The second call confirms the new build is actually being served. A deploy is not successful until
both pass.

### Deployment strategy ✅

ECS rolling update with the deployment circuit breaker (`rollback = true`) and a 90s health-check
grace period. The minimum healthy / maximum percentages use the AWS defaults (100% / 200%), so
capacity never drops during a deploy. Set them explicitly in `ecs.tf` if you want them visible in
code.

### Missing CI checks ❌

On merge to `main`, against staging (advisory): Playwright E2E (Section 8), k6 (Section 10),
Lighthouse CI (Section 10), Schemathesis (Section 9), Sentry release + source maps (Section 14).

---

## 16. Exception and Suppression Process

### How to suppress

Every suppression needs **why** the finding is a false positive or an accepted risk, plus a
**review date**.

**Ruff:**
```python
value = random.choice(options)  # noqa: S311 -- UI shuffle, not security-sensitive. Review: 2027-01-01
```

**Bandit:**
```python
subprocess.run(cmd)  # nosec B603 -- cmd is a hardcoded list, no user input. Review: 2027-01-01
```

**mypy:**
```python
app.add_exception_handler(...)  # type: ignore[arg-type]  # <reason>
```

**ESLint:**
```tsx
// eslint-disable-next-line react-hooks/exhaustive-deps -- stable ref, intentionally omitted
```

**Checkov:**
```hcl
#checkov:skip=CKV_AWS_18:Access logging not required for internal-only bucket
```

**Trivy — `.trivyignore`** ⚠️ exists, with a justification for each entry (e.g.
GHSA-qwww-vcr4-c8h2 RSC mode unused, build-tooling-only DoS CVEs). The entries
are **missing review dates** — add one to each:
```
# GHSA-xxxx-xxxx-xxxx: not exploitable because X. Review: 2027-01-01
GHSA-xxxx-xxxx-xxxx
```

**pip-audit** — `--ignore-vuln <ID>` in both `check.yml` and `check.sh` (see Section 4), with the
reason and review date in a comment next to each.

### Approval requirements

- Any suppression of a HIGH or CRITICAL finding needs a **second reviewer** to approve the
  suppression explicitly in the PR review
- Suppressions without a justification and review date are rejected in code review
- `.trivyignore`, `.gitleaks.toml` allowlists and pip-audit ignores are audited quarterly to
  remove stale entries
