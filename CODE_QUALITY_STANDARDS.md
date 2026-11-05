# Code Quality, Security, Testing and Performance Standards

Stack: Python 3.13 / FastAPI backend services (MongoDB Atlas + Valkey), React + TypeScript web frontend
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
| Backend lint / format / types | `ruff check`, `ruff format --check`, `mypy tools/ common/` and `mypy <service>/` per service (non-strict), import-linter service boundaries | `check.yml` → `backend-lint`, `backend-service` |
| Backend tests | pytest, **99% line + branch coverage gate** on `common` and on each service, real Mongo/Valkey integration tests in CI | `check.yml` → `backend-test`, `backend-service` |
| Frontend lint / types / build | ESLint, Prettier check, `tsc`, build, bundle-size budget (≤ 1.4 MB) | `check.yml` → `frontend-lint` |
| React Native app | ESLint, Prettier check, `tsc`, Jest unit tests | `check.yml` → `frontend-app-lint` |
| Lambda@Edge | unit tests + `shared/routing.json` and `shared/service-routes.json` sync checks | `check.yml` → `lambda-edge-test` |
| Terraform | `terraform fmt -check`, tflint (default rules) on all 4 stacks and each shared module, `terraform test` (mock provider) | `check.yml` → `terraform-lint` |
| SAST | Bandit, Semgrep (`p/security-audit`), CodeQL | `check.yml` |
| Secrets | Gitleaks (full history, `.gitleaks.toml`) | `check.yml` → `security-scan` |
| Dependencies | pip-audit, npm audit, yarn audit, Retire.js, Trivy (deps + licenses), Dependency Review | `check.yml` |
| IaC security | Checkov + `trivy config` on all 4 modules | `check.yml` → `security-scan` |
| Containers | Hadolint (both Dockerfiles), Trivy image scan, Dockle and an SBOM for every service image | `check.yml` → `security-scan` |
| DAST / API contract | committed `backend/openapi/<service>.json` drift check per service, Spectral lint, Nuclei against the compose stack's gateway | `check.yml` → `backend-service`, `dast` |
| Pre-commit | Husky: lint-staged (`frontend/src`) + ruff; `pre-commit` framework: file hygiene + ruff | `frontend/.husky/`, `.pre-commit-config.yaml` |
| Auth | RS256 JWT (`kid`; only auth holds the private key, the other services verify with `JWT_PUBLIC_KEYS`), refresh tokens rotated within a `family_id` (reuse revokes the family), token revocation, Valkey-backed rate limits, signed service-to-service calls | `backend/auth/app/` (`tokens.py`, `sessions.py`), `backend/common/authz.py`, `backend/common/limiter.py`, `backend/common/internal_client.py` |
| Transport | CloudFront `redirect-to-https`, HTTPS-only origin, ALB HTTPS-only (443), HSTS 2 years + `includeSubDomains` + `preload` | `infra-live-edge`, `infra-live-backend` |
| Deploy safety | ECS circuit breaker with automatic rollback; deploy waits for steady state | `ecs.tf`, `deploy-live-backend.yml` |

### Open gaps (priority order)

| # | Gap | Current state | Target | Section |
|---|---|---|---|---|
| 1 | Frontend (web) tests | No test runner, no tests | Vitest + Testing Library + MSW | [8](#8-testing) |
| 2 | mypy strict | `strict = false` — **440 errors** on `tools/ common/` and **524** across the nine services under `--strict` | `strict = true` | [4](#4-backend--python--fastapi) |
| 3 | Ruff `S` + `ANN` rules | Not selected — **123 findings** outside the tests | Selected, findings fixed | [4](#4-backend--python--fastapi) |
| 4 | `terraform validate` on PRs | Only runs inside the `terraform-live-*` deploy workflows (not scheduler); not in `check.yml` | All 4 modules in `terraform-lint` | [6](#6-infrastructure--terraform) |
| 5 | tflint config | No `.tflint.hcl` → AWS ruleset not enabled | `.tflint.hcl` per module | [6](#6-infrastructure--terraform) |
| 6 | Readiness endpoint | Only each service's `/health` (liveness) and shared's `/api/health` (build info) | `/health/ready` checking Mongo + Valkey | [4](#4-backend--python--fastapi) |
| 7 | Post-deploy smoke test | Deploy checks ECS steady state only | HTTP smoke test after each deploy | [15](#15-cicd-pipeline) |
| 8 | Error monitoring | OpenTelemetry tracing in the backend; no Sentry | Sentry (backend + frontends) | [14](#14-observability-and-error-monitoring) |
| 9 | Base image digests | ✅ Every image pinned as `tag@sha256:…` (Dockerfiles, docker-compose, CI, the collector) | Pinned by digest | [7](#7-container-security) |
| 10 | CODEOWNERS | `.github/CODEOWNERS` missing | Present | [2](#2-github-repository-configuration) |
| 11 | Branch protection | Not verifiable from the repo | 1 review, CI required, no force-push | [2](#2-github-repository-configuration) |
| 12 | Pre-commit secrets + Terraform fmt | Gitleaks and `terraform fmt` run in CI only | Also on commit | [11](#11-security--cross-cutting) |
| 13 | Accessibility lint | No `eslint-plugin-jsx-a11y` (web or app) | Recommended rules on | [5](#5-frontend--react--typescript) |
| 14 | Conventional Commits / CHANGELOG | Commit messages are free-form (`Updated code.`); no `CHANGELOG.md` | Conventional Commits + release-please | [2](#2-github-repository-configuration), [12](#12-documentation-standards) |
| 15 | READMEs | Missing in `infra-live-*/` (4), `scripts/` and the services (`backend/common/` has one) | One per runnable directory | [12](#12-documentation-standards) |
| 16 | ADRs | No `docs/adr/` | MADR records for major decisions | [12](#12-documentation-standards) |
| 17 | RFC 7807 errors | FastAPI `{"detail": ...}` shape | Problem Details (breaking change) | [9](#9-api-quality) |
| 18 | Schemathesis / k6 / Lighthouse / Playwright | None configured | Advisory runs against staging | [8](#8-testing), [9](#9-api-quality), [10](#10-performance) |
| 19 | Prettier `trailingComma` | Not set in `frontend/.prettierrc` | `"all"` | [5](#5-frontend--react--typescript) |

---

## 2. GitHub Repository Configuration

### CODEOWNERS ❌

Create `.github/CODEOWNERS`:

```
# Auth is security-sensitive
/backend/auth/                        @prince-els
/backend/common/authz.py              @prince-els
/backend/common/internal_client.py    @prince-els
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

### Dependabot ✅

`.github/dependabot.yml` opens one grouped pull request per ecosystem:
- **Weekly:** GitHub Actions (their SHA pins and version comments), pip (every backend requirements file in a single PR, since `requirements-dev.txt` must stay their exact union), npm for `frontend/` and `frontend-app/`, and the Dockerfiles' base images.
- **Monthly:** the Terraform providers, for every stack and module.

`buddy-common` is ignored: it's built from `backend/common`, never fetched from PyPI.

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

Keep PRs under **400 lines** of non-generated code (generated: `backend/openapi/*.json`, the
apps' `src/api/generated/`, `backend/common/regions_data.py`, `backend/auth/countries_data.py`,
the frontends' `countries.ts` / `locationHint.ts`, `local/gateway/nginx.conf`, lock files).

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
- [ ] The service's `backend/openapi/<service>.json` and the apps' generated clients regenerated (CI fails on drift)
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

Each service's `requirements.txt` (its runtime pins) plus `backend/requirements-dev.txt` (their
union, kept exact by `tools/tests/test_dev_requirements.py`), `requirements-lint.txt`,
`requirements-test.txt` and `requirements-security.txt` are the single source of truth, installed
with pip in CI, `check.sh` and the Dockerfile. The orphaned `uv.lock`
was removed. If you later move to uv, add a `[project]` table + `[dependency-groups]`, `uv lock`,
switch every install site in one change, then delete the requirements files.

### Python version pin ⚠️

3.13 is pinned in the Dockerfile and each `setup-python` step, but there is no
`backend/.python-version`. Add one (`3.13`) so local venvs, `uv` and `setup-python`
(`python-version-file: backend/.python-version`) all read the same value.

### Ruff — add security and annotation rules ❌

`select` currently has `E, W, F, I, B, UP, C4, RET, SIM, N`. Enabling `S` and `ANN` on
`backend/` outside the tests today reports **123 findings** — 117 × `ANN401` (`Any`),
4 × `S101` (`assert`), 1 × `S104` (bind to all interfaces), 1 × `S603` (subprocess).

```toml
[tool.ruff.lint]
select = [
    "E", "W", "F", "I", "B", "UP", "C4", "RET", "SIM", "N",
    "S",    # flake8-bandit — security checks
    "ANN",  # flake8-annotations — type annotations on public functions
]

[tool.ruff.lint.per-file-ignores]
"**/tests/**" = ["S101", "ANN"]   # assert and missing annotations are fine in tests
```

Bandit already runs in CI on `backend/tools/`, `backend/common/` and each service directory
(`bandit -r backend/tools/ backend/common/ <services> -ll -q`, the service list from
`tools/services.py --paths backend/`).

### mypy — enable strict mode ❌

Current config: `strict = false`, `disallow_untyped_defs = false`, `warn_return_any = false`,
`check_untyped_defs = true`. Under `--strict`, `mypy tools/ common/` today reports **440 errors in
24 files**, and the nine services (each checked on its own, as CI does) **524 errors in 53 files**.

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

The ignore for `PYSEC-2025-183` lives in one place, `scripts/audit-backend-services.sh`, which both
`check.yml` and `check.sh` run. pip-audit has no config-file option for ignores; record the reason
and a review date in a comment next to it (Section 16).

### Structured logging ✅

`common/logging.py` writes one JSON object per line (`time`, `level`, `logger`, `message`,
`service`, and when known `trace_id`, `span_id`, `request_id`). `RequestIdMiddleware` takes
`X-Request-Id` from the gateway (or makes one) and returns it. Personal-data keys passed in
`extra={...}` are dropped and email-like strings in messages are masked. Never log tokens,
passwords, or full emails.

Log levels: `DEBUG` (local only), `INFO` (normal events), `WARNING` (recoverable issues), `ERROR`
(failures needing attention), `CRITICAL` (service-level failures).

### Health check — add readiness endpoint ❌

Current state: each service's `/health` (liveness, unthrottled, on its public port) and shared's
`/api/health` (build metadata, rate-limited at 30/min per IP). Neither checks dependencies.

Add `/health/ready` to each service with a database: ping MongoDB (`db.command("ping")`) and
Valkey, if one is configured. Return 200 only when both respond, or 503 otherwise. Point the ALB
target-group health check at it, keep `/health` for liveness, and use it for the post-deploy smoke
test (Section 15).

### JWT ✅ / ⚠️

Already in place: RS256 signing with a `kid` (only auth holds `JWT_PRIVATE_KEY`; every other
service verifies with `JWT_PUBLIC_KEYS`), refresh tokens rotated within a `family_id` (a rotated
token reused after the 30 s grace revokes the whole family), `tokens_revoked_at` revocation via the
account's authz entry, and location-scoped sessions (`backend/auth/app/sessions.py`, `tokens.py`).

Remaining (optional): defaults are `jwt_access_expire_minutes = 30` and
`jwt_refresh_expire_hours = 24`. Consider a 15-minute access token. Lengthening the refresh window
is a product decision, since it trades re-login frequency against session lifetime.

### MongoDB-specific standards ✅

The current code follows these; enforce them in review:

- **No raw string interpolation in queries.** Use dict literals only.
- Every query is scoped by `location` (multi-region data residency).
- Every query has a supporting index. Each service creates its collections, validators and
  indexes in `ensure_collections()` in its `app/store.py` (one database per service), never inline
  in route handlers.
- Every DB call is `await`ed — PyMongo's async client (`AsyncMongoClient`), no synchronous calls in
  async routes.
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

### Base image digest pinning ✅

Every image is pinned as `tag@sha256:<index digest>`: `python:3.13.18-slim-trixie` (backend,
both stages, with no `apt-get upgrade`), `node:22.23.4-alpine3.24` and `nginx:1.31.6-alpine`
(frontend), docker-compose's `mongo`, `valkey`, `moto` and gateway `nginx`, CI's `mongo` and
`valkey`, and the ECS collector image (`otel_collector_image`). To read a digest:

```bash
docker buildx imagetools inspect python:3.13.18-slim-trixie   # the "Digest:" line
```

Dependabot's `docker` and `docker-compose` ecosystems (Section 2) bump tag and digest together,
including a new digest of the same tag when the base gets security fixes. CI's copies and the
collector move by hand with the compose PR. Tags can be moved upstream; a digest can't.

---

## 8. Testing

### Backend — Pytest ✅

- Tests live with their code: `backend/common/tests/`, `backend/tools/tests/` and each service's
  `backend/<service>/tests/`; tooling: pytest, pytest-cov, httpx, Moto (`mock_aws`).
- CI and `check.sh` enforce **99% line + branch coverage** of `common` and of each service:
  `pytest common/tests tools/tests --cov=common --cov-branch --cov-fail-under=99 -q` and
  `pytest <service>/tests --cov=<service> --cov-branch --cov-fail-under=99 -q`. In CI each service
  runs installed alone (`scripts/install-backend-service.sh`).
- `live_service` marker: tests against a real MongoDB/Valkey. They're skipped locally without one,
  but **fail** the run in CI (`REQUIRE_LIVE_SERVICES=1`). Never point `MONGODB_TEST_URI` at a real
  cluster.
- End-to-end runs against the local compose stack: `scripts/e2e/full-journey.py`,
  `account-deletion.py`, `convergence.py` (`RUN_E2E=1 ./check.sh`).

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

Current state: FastAPI's own handlers in every service — `{"detail": ...}` for `HTTPException`
and validation errors (422), with a machine-readable `detail.code` on the errors the apps tell
apart; an unhandled exception is a bare 500, and no stack traces leak.

Target: [RFC 7807 Problem Details](https://datatracker.ietf.org/doc/html/rfc7807)
(`type`, `title`, `status`, `detail`, `instance`; media type `application/problem+json`).
**This is a breaking change** — both `frontend/` and `frontend-app/` read `detail`. Ship it with
the client changes in the same release, or keep `detail` as a compatible field during a deprecation
window.

### Schemathesis — API fuzz testing ❌

The `dast` job already starts the compose stack behind its gateway and runs Spectral on
`backend/openapi/*.json` and Nuclei against `http://localhost:8088`; the `backend-service` jobs
check each spec for drift. The services don't serve their specs (`openapi_url=None`), so point
Schemathesis at the committed files and the gateway. Add it to the same job and to its fail-gate:

```yaml
- name: Schemathesis (API fuzz)
  id: schemathesis
  continue-on-error: true
  run: |
    pip install schemathesis
    for spec in backend/openapi/*.json; do
      schemathesis run "$spec" --base-url http://localhost:8088 --checks all --max-examples 50
    done
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

The services send no CORS headers. CloudFront's response headers policy
(`infra-live-edge/terraform/response_headers.tf`) is the only source: one explicit origin
(`https://<fqdn>`), credentials allowed, no wildcard. Locally the apps call the API on their own
origin through a proxy. Do not add CORS middleware to the services.

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
| A06 Vulnerable Components | pip-audit, npm/yarn audit, Retire.js, Trivy, Dependency Review, Dependabot | ✅ |
| A07 Auth Failures | Short-lived access JWT; refresh tokens rotated within a family (reuse revokes it); revocation; Valkey-backed rate limits; login throttling | ✅ |
| A08 Integrity Failures | SBOMs generated; actions pinned by commit SHA; downloaded binaries checksum-verified; image digest pinning pending | ⚠️ |
| A09 Logging Failures | JSON logs with `request_id` and trace ids, personal data dropped; Sentry pending | ⚠️ |

### GitHub Actions — pinned to commit SHAs ✅

Every `uses:` in `.github/workflows/` names a full commit SHA, with the version as a comment:

```yaml
- uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
```

Dependabot's `github-actions` ecosystem keeps the SHAs and comments current. To check, this prints nothing:

```bash
grep -nE 'uses: [^.][^@ ]*@' .github/workflows/*.yml | grep -vE '@[0-9a-f]{40}([[:space:]]|$)'
```

Every binary `check.yml` downloads (gitleaks, Dockle, Nuclei) is checked against a pinned SHA-256 before it runs: bump a version and its digest together. The Android build's Gradle wrapper pins `distributionSha256Sum` too.

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

Transitive CVE floor pins (e.g. `starlette`, `urllib3` in the services' `requirements.txt`, with
the reasons in `backend/requirements-dev.txt`) must carry a comment with the advisory IDs. Remove
them once the direct dependency's own floor covers the fix.

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

In place: JSON logs to CloudWatch (`common/logging.py`), OpenTelemetry tracing in every service
and worker (`common/telemetry.py`) exported to a shared collector per environment and region
that tail-samples into X-Ray (`infra-live-backend/terraform/otel_collector.tf`), custom CloudWatch
metrics for scaling and alarms (`common/metrics.py`), and CloudWatch alarms
(`infra-live-backend/terraform/cloudwatch.tf`: ALB 5xx and healthy hosts, pending/stuck jobs,
stale outboxes, Valkey connections, stuck deletions). No error monitoring (Sentry). ⚠️

### Sentry — error monitoring ❌

**Backend:** `sentry-sdk[fastapi]` initialised once for every service, next to
`setup_observability(...)` in `common/serve.py` (and in each worker), with `send_default_pii=False`,
`environment=APP_ENV` and `traces_sample_rate=0.1`. Add a `sentry_dsn` setting to
`common/settings_base.py` and to each service's secret.

**Web frontend:** `@sentry/react` initialised in `src/main.tsx` with `VITE_SENTRY_DSN`. Upload
source maps in `deploy-live-frontend.yml`.

**React Native app:** `@sentry/react-native`. Upload source maps in the APK/IPA build workflows.

Tag each deploy as a Sentry release (`sentry-cli releases`), using the same `<date>-<sha>` image
tag as the backend deploy.

### Metrics and tracing — OpenTelemetry ✅

Tracing uses the FastAPI, PyMongo, httpx, botocore and redis instrumentations, W3C `traceparent`
between services, and links (not parent spans) from event producers to consumers. Keep custom
metrics to the ones an alarm or a scaling policy needs.

### Alert thresholds

- 5xx rate > 1% for > 5 minutes
- p99 latency (non-LLM routes) > 2s for > 5 minutes
- ECS target health check failing for > 2 consecutive checks
- Any CRITICAL Sentry issue with > 10 occurrences in 1 hour

---

## 15. CI/CD Pipeline

### Current pipeline ✅

`check.yml` runs on every PR to `main`, on every push to `main`, and on manual dispatch. Jobs:
`backend-lint`, `backend-test`, `backend-service-list`, `backend-service` (one per service, found
from the tree), `backend-services` (the stable gate), `frontend-lint`, `frontend-app-lint`,
`lambda-edge-test`, `terraform-lint`, `security-scan`, `dast`, `codeql`, `dependency-review`. pip, npm and yarn
caching is configured through the `setup-*` actions.

Deployment is manual (`workflow_dispatch`):
- `terraform-live-*` — plan, apply, plan-destroy or destroy, per environment and region set.
- `deploy-live-backend` — builds one image per selected service (`--build-arg SERVICE=<service>`;
  a worker runs its service's image), pushes each to that service's ECR repository in every
  selected region, then rolls the selected runtimes out in each region in parallel.
- `promote-live-*` — promotes between environments along fixed paths.
- `restart-live-backend` — restarts ECS services.

Deploy, promote and restart share one lock per environment.

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
