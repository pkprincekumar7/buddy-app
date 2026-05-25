# Code Quality, Security, Testing and Performance Standards

Stack: Python/FastAPI backend (MongoDB Atlas + Redis), React + Tailwind frontend (Vite), Terraform infrastructure (AWS), GitHub Actions CI/CD.

---

## Table of Contents

1. [Enforcement Model](#1-enforcement-model)
2. [Git Workflow](#2-git-workflow)
3. [Code Review Standards](#3-code-review-standards)
4. [Backend — Python / FastAPI](#4-backend-python-fastapi)
5. [Frontend — React + Tailwind](#5-frontend-react-tailwind)
6. [Infrastructure — Terraform](#6-infrastructure-terraform)
7. [Container Security](#7-container-security)
8. [Testing](#8-testing)
9. [API Quality](#9-api-quality)
10. [Performance](#10-performance)
11. [Security — Cross-Cutting](#11-security-cross-cutting)
12. [Documentation Standards](#12-documentation-standards)
13. [Dependency Management](#13-dependency-management)
14. [Observability and Error Monitoring](#14-observability-and-error-monitoring)
15. [CI/CD Pipeline](#15-cicd-pipeline)
16. [Exception and Suppression Process](#16-exception-and-suppression-process)
17. [Authoritative Tool Stack](#17-authoritative-tool-stack)

---

## 1. Enforcement Model

This section defines what is mandatory (blocks merge) versus advisory (warning only), and where each check runs.

### Mandatory (blocks merge)

| Check | Where it runs |
|---|---|
| Ruff lint + format | Pre-commit + CI |
| mypy type check | CI |
| pytest (unit + integration) with coverage gate | CI |
| Bandit HIGH/MEDIUM findings | CI |
| pip-audit (any CVE) | CI |
| ESLint (errors only) | Pre-commit + CI |
| Prettier format check | Pre-commit + CI |
| npm audit (HIGH/CRITICAL) | CI |
| terraform fmt + validate | CI |
| tflint (errors) | CI |
| Checkov HIGH/CRITICAL findings | CI |
| hadolint (Dockerfile linting) | CI |
| Trivy CRITICAL/HIGH (container) | CI |
| Gitleaks secrets scan | Pre-commit + CI |
| CODEOWNERS auto-reviewer assignment | GitHub branch rules |
| Branch protection: 1 approved review required | GitHub branch rules |
| Branch protection: CI must pass before merge | GitHub branch rules |
| Branch protection: no force-push to main/staging | GitHub branch rules |

### Advisory (warning, does not block merge)

| Check | Where it runs |
|---|---|
| Bandit LOW findings | CI |
| npm audit (MODERATE) | CI |
| Checkov MEDIUM/LOW findings | CI |
| Trivy MEDIUM findings | CI |
| tflint (warnings) | CI |
| Lighthouse / Core Web Vitals | CI |
| Schemathesis API fuzz tests | CI |
| k6 load test thresholds | CI (staging only) |
| infracost cost diff | CI (infra PRs only) |

### Hotfix path

On branches named `hotfix/*`, the following checks are skipped to allow fast turnaround:
- Schemathesis fuzz tests
- k6 load tests
- Lighthouse CI

All mandatory security and unit test checks still run on hotfix branches.

---

## 2. Git Workflow

### Branch naming

| Prefix | Purpose |
|---|---|
| `feature/<short-description>` | New features |
| `fix/<short-description>` | Bug fixes |
| `refactor/<short-description>` | Code restructuring with no behaviour change |
| `chore/<short-description>` | Maintenance, dependency updates, config |
| `hotfix/<short-description>` | Urgent production fixes |
| `docs/<short-description>` | Documentation only |
| `release/<version>` | Release preparation (version bumps, changelog) |

### Commit message format

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short summary>

[optional body]

[optional footer: BREAKING CHANGE, closes #issue]
```

**Types:** `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `ci`, `revert`

**Examples:**
```
feat(auth): add JWT refresh token rotation
fix(children): handle missing profile image gracefully
chore(deps): bump fastapi to 0.115.0
revert: feat(llm): streaming responses (caused ECS OOM)
```

Breaking changes must include `BREAKING CHANGE:` in the footer or a `!` after the type:
```
feat(api)!: rename /users endpoint to /accounts
```

### Release tagging

Releases follow [Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`). Tags are created on `main` after a release branch merges:

```
git tag -a v1.4.2 -m "Release v1.4.2"
```

`CHANGELOG.md` is updated on every release branch using [Conventional Changelog](https://github.com/conventional-changelog/conventional-changelog) (automatable via `release-please` GitHub Action).

### Merge strategy

- **Feature/fix/refactor/chore → main**: squash merge (keeps main history clean)
- **Hotfix → main**: merge commit (preserves hotfix context)
- **Release → main**: merge commit

### PR size guideline

Keep PRs under **400 lines of non-generated code** (excluding lock files and generated OpenAPI specs). Large PRs must be broken into a stacked PR series linked to a tracking issue.

### CODEOWNERS

A `.github/CODEOWNERS` file defines automatic reviewer assignment based on the files changed. This is how the "1 approved review" enforcement in Section 1 gains real meaning — GitHub will require approval from the right owner, not just any team member.

```
# .github/CODEOWNERS

# Auth is security-sensitive — requires explicit owner approval
/backend/app/routers/auth.py          @prince-els

# Infrastructure changes require infra owner review
/infra-live-backend/                  @prince-els
/infra-live-frontend/                 @prince-els
/infra-live-edge/                     @prince-els

# CI/CD pipeline changes
/.github/workflows/                   @prince-els
```

Update this file as the team grows.

---

## 3. Code Review Standards

### Approval requirements

- Minimum **1 approved review** before merge.
- CODEOWNERS auto-assigns the correct reviewer based on files changed.
- The PR author cannot approve their own PR.
- Stale reviews are dismissed on new pushes (enforced via branch protection).
- Reviews should be completed within **1 business day** of being requested.

### Draft PRs

Open a PR as a **Draft** when work is in progress and you want early feedback or CI to run, but the code is not ready for review. Convert to "Ready for review" only when the PR is complete.

### Reviewer checklist

Reviewers are expected to check the following (not just read the diff):

**Correctness**
- [ ] Logic matches the intent described in the PR description
- [ ] Edge cases are handled (empty inputs, null values, async errors)
- [ ] No silent failure paths (errors are surfaced, not swallowed)
- [ ] Async errors are properly awaited and caught

**Security**
- [ ] No hardcoded secrets, tokens, or credentials
- [ ] User input is validated at system boundaries (Pydantic models on every route)
- [ ] MongoDB queries use dict literals — no raw string interpolation
- [ ] Auth checks (`Depends(get_current_user)`) are present on all new protected routes
- [ ] New auth-related code has been reviewed against [OWASP Top 10](https://owasp.org/www-project-top-ten/)

**Testing**
- [ ] New logic has corresponding unit or integration tests
- [ ] At least one failure/edge case is tested, not just the happy path
- [ ] Integration tests use a real MongoDB instance (not mocked)

**API contracts**
- [ ] Response shape changes are backwards-compatible, or documented as a breaking change
- [ ] New endpoints have FastAPI docstrings (flows into OpenAPI spec)
- [ ] Error responses use RFC 7807 Problem Details format (see Section 9)

**Infrastructure**
- [ ] Terraform changes include a `terraform plan` output in the PR description
- [ ] No new public-facing AWS resources without explicit justification
- [ ] infracost diff reviewed for unexpected cost increases

### What reviewers should NOT block on

- Style issues that Ruff/Prettier already enforce — CI handles this
- Subjective naming preferences unless it causes genuine ambiguity

---

## 4. Backend — Python / FastAPI

### Package manager

**Tool: uv**

`uv` is the package manager for this project. It replaces `pip`, `pip-tools`, and `virtualenv`. It is 10–100× faster than pip and is maintained by Astral (the same team as Ruff).

```bash
# Install dependencies
uv sync

# Add a dependency
uv add fastapi

# Add a dev dependency
uv add --dev pytest

# Run a command in the project environment
uv run pytest
```

`uv.lock` is committed to version control. `requirements.txt` is not used. `pyproject.toml` is the single source of truth for all dependencies.

### Python version

Pin the Python version in `.python-version`:

```
3.11
```

`uv` reads this file automatically. CI uses the same file via `uv python install`.

### Formatting

**Tool: Ruff format**

Ruff's formatter is Black-compatible and replaces Black entirely. No separate Black installation is needed.

```toml
# pyproject.toml
[tool.ruff]
line-length = 88
target-version = "py311"
```

### Linting and import sorting

**Tool: Ruff lint**

Ruff replaces flake8, isort, pyupgrade, and many pylint rules.

```toml
# pyproject.toml
[tool.ruff.lint]
select = ["E", "F", "I", "UP", "B", "S", "ANN"]
# ANN101 and ANN102 (self/cls annotations) were removed in Ruff 0.2 — do not add them here

[tool.ruff.lint.per-file-ignores]
"tests/**" = ["S101", "ANN"]
```

Ruff detects: unused imports, bad patterns, complexity issues, security anti-patterns (S rules), and missing annotations (ANN rules).

### Type checking

**Tool: mypy**

```toml
# pyproject.toml
[tool.mypy]
python_version = "3.11"
strict = true
ignore_missing_imports = true
exclude = ["tests/"]
```

Required on:
- All Pydantic request/response models
- Service layer functions
- Repository/database access functions
- All async route handlers

### Security scanning

**Tools: Bandit + Semgrep**

Bandit config lives in `pyproject.toml` (the `.bandit` file format is legacy):

```toml
# pyproject.toml
[tool.bandit]
skips = ["B101"]  # assert — acceptable in tests, already excluded by per-file-ignores
```

CI failure threshold:
- Bandit `HIGH` or `MEDIUM` severity → blocks merge
- Bandit `LOW` → advisory only

Semgrep runs in CI on every PR against FastAPI/MongoDB-specific rule sets. HIGH findings block merge.

### Dependency vulnerability scanning

**Tool: pip-audit**

Ignore known false positives via `pyproject.toml` (not a `.pip-audit-ignore` file — that does not exist):

```toml
# pyproject.toml
[tool.pip-audit]
ignore-vulns = [
  # "GHSA-xxxx-xxxx-xxxx",  # example: add CVE ID + reason as a comment
]
```

Any unfixed CVE finding blocks merge. Security patches must be applied within:
- CRITICAL: 24 hours
- HIGH: 3 business days
- MEDIUM/LOW: next scheduled dependency update cycle

### MongoDB-specific standards

These rules apply to all Motor async database access:

- **No raw string interpolation in queries.** Use dict literals:
  ```python
  # Correct
  await collection.find_one({"user_id": user_id})

  # Wrong — never do this
  await collection.find_one({"user_id": f"{user_id}"})
  ```
- **All queries must have a supporting index.** New queries without a declared index require a code review note explaining why.
- **No synchronous Motor calls inside async routes.** Every DB call must be `await`ed.
- **`init_indexes()` is the only place to create indexes** — never create them inline in route handlers or services.
- **Avoid unbounded queries.** All `find()` calls must include a `.limit()` or be explicitly reviewed.

### Structured logging

**Tool: structlog**

All backend logging uses `structlog` for structured JSON output, not Python's default `logging.info("string")`. Log output must be machine-parseable (CloudWatch, Datadog, ELK).

```python
import structlog

logger = structlog.get_logger()

# Correct — structured fields
logger.info("user.created", user_id=str(user.id), email=user.email)
logger.error("db.query_failed", collection="users", error=str(e))

# Wrong — unstructured string
logger.info(f"User {user.id} created")
```

Required log fields on every log event: `timestamp` (added by structlog), `level`, `event`. Request-scoped events must also include `request_id` (see Section 9 — Correlation IDs).

Log levels:
- `DEBUG`: local development only, never in production
- `INFO`: normal application events (user actions, successful operations)
- `WARNING`: unexpected but recoverable conditions
- `ERROR`: failures that need attention (caught exceptions, failed DB calls)
- `CRITICAL`: service-level failures (startup failures, unrecoverable state)

### Health check endpoints

Every FastAPI app must expose three endpoints:

```python
@router.get("/health/live", tags=["health"])
async def liveness():
    """Process is alive and running."""
    return {"status": "ok"}

@router.get("/health/ready", tags=["health"])
async def readiness(db=Depends(get_database)):
    """Service is ready to accept traffic (DB + Redis reachable)."""
    await db.command("ping")
    return {"status": "ok"}
```

- `/health/live` — used by ECS for liveness checks (is the container alive?)
- `/health/ready` — used by ECS/ALB for readiness checks (is the container ready to serve traffic?)

These endpoints must not require authentication.

### Settings management

**Tool: pydantic-settings**

All configuration is loaded via a `pydantic-settings` model, not raw `os.environ` calls:

```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    mongodb_uri: str
    redis_url: str
    jwt_secret: str
    environment: str = "development"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}

settings = Settings()
```

This gives type-safe, validated config with automatic `.env` file support.

---

## 5. Frontend — React + Tailwind

### TypeScript

**TypeScript is the standard.** New files must be `.ts` or `.tsx`. Existing `.js` source files must be migrated — aim to eliminate all `.js` source files (excluding config files like `vite.config.ts`, `tailwind.config.ts`) within the current development cycle.

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noImplicitAny": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true
  }
}
```

### Formatting

**Tool: Prettier 3**

```json
// .prettierrc
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

`trailingComma: "all"` is the Prettier 3 default. Using `"es5"` is the legacy value.

### Linting

**Tool: ESLint v9 (flat config)**

ESLint v9 uses a flat config file (`eslint.config.js`), not the legacy `.eslintrc` format:

```js
// eslint.config.js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      ...jsxA11y.configs.recommended.rules,
    },
  },
);
```

Required packages:
- `@eslint/js`
- `typescript-eslint`
- `eslint-plugin-react`
- `eslint-plugin-react-hooks`
- `eslint-plugin-jsx-a11y`

ESLint **errors** block merge. ESLint **warnings** are advisory.

### Frontend API mocking

**Tool: MSW (Mock Service Worker)**

MSW is the standard for mocking HTTP calls in Vitest tests and during local development. It intercepts at the network level — tests exercise the same fetch/axios code as production.

```ts
// src/mocks/handlers.ts
import { http, HttpResponse } from 'msw';

export const handlers = [
  http.get('/api/v1/children', () => {
    return HttpResponse.json([{ id: '1', name: 'Test Child' }]);
  }),
];
```

```ts
// src/mocks/server.ts
import { setupServer } from 'msw/node';
import { handlers } from './handlers';

export const server = setupServer(...handlers);
```

```ts
// vitest.setup.ts
import { server } from './src/mocks/server';
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

Do not mock `fetch`, `axios`, or modules directly — use MSW handlers instead.

### Frontend security

**Tools: npm audit + Snyk**

- `npm audit --audit-level=high` runs in CI and blocks on HIGH/CRITICAL
- MODERATE findings are advisory
- Snyk runs weekly on the `main` branch for deeper transitive dependency analysis

### Accessibility

**Target: WCAG 2.1 Level AA**

- `eslint-plugin-jsx-a11y` is included in the ESLint config above — violations at error level block merge
- Lighthouse accessibility score tracked as a metric (target ≥ 90, advisory)

### Bundle size

**Tool: `vite-bundle-analyzer` (or `rollup-plugin-visualizer`)**

Run locally before any PR that adds a significant new dependency:

```bash
npx vite-bundle-analyzer
```

No hard limit is enforced in CI, but bundle size regressions > 10% on the main chunk should be called out in code review.

---

## 6. Infrastructure — Terraform

### Formatting

**Tool: terraform fmt**

All `.tf` files must pass `terraform fmt -check -recursive`. Enforced in CI and pre-commit.

### Validation

**Tool: terraform validate**

Runs after `terraform init -backend=false`. Catches syntax and configuration errors before Checkov or tflint.

### Provider-specific linting

**Tool: tflint**

tflint validates against AWS provider rules — deprecated resource types, invalid instance types, missing required tags, and AWS-specific best practices that Checkov does not cover.

```hcl
# .tflint.hcl
plugin "aws" {
  enabled = true
  version = "0.32.0"
  source  = "github.com/terraform-linters/tflint-ruleset-aws"
}

rule "terraform_required_version" {
  enabled = true
}

rule "terraform_required_providers" {
  enabled = true
}
```

tflint errors block merge; warnings are advisory.

### Security scanning

**Tool: Checkov**

```yaml
# .checkov.yaml
soft-fail-on:
  - MEDIUM
  - LOW
hard-fail-on:
  - HIGH
  - CRITICAL
```

Key rules enforced:
- No public S3 buckets
- All S3 buckets have encryption enabled
- Security groups do not expose `0.0.0.0/0` on sensitive ports
- IAM roles follow least privilege
- ALB access logs enabled
- ElastiCache in-transit and at-rest encryption enabled
- CloudTrail enabled in all regions

### Cost estimation

**Tool: infracost**

infracost runs on infrastructure PRs and posts a cost diff comment showing the estimated monthly cost change. This prevents accidental expensive resource additions going unnoticed.

```yaml
# Runs in CI on infra-live-* PRs
- name: infracost diff
  run: infracost diff --path . --format json --out-file /tmp/infracost.json
```

Cost diffs are advisory — they do not block merge but must be acknowledged in the PR description for any change > $50/month.

### Terraform state and lock file

- Remote state is stored in S3 with DynamoDB locking.
- `.terraform.lock.hcl` is committed to version control and must be updated when provider versions change.
- `terraform plan` output must be included in the PR description for any infrastructure-affecting change.

---

## 7. Container Security

### Dockerfile linting

**Tool: hadolint**

hadolint validates Dockerfile best practices — missing `HEALTHCHECK`, unpinned base images, `apt-get` without `--no-install-recommends`, running as root, etc.

```bash
hadolint Dockerfile
```

Runs in CI on every PR where `Dockerfile` or backend source changes. Errors block merge.

### Base image pinning

Docker base images must be pinned by **digest**, not just tag. Tags are mutable and are a supply chain attack vector:

```dockerfile
# Correct — pinned by digest
FROM python:3.11-slim@sha256:b15f8e8cad6476d02c44ea0e67c63dd3c1af3c88e4e3a3ae0b2d8c5f5e2f3b9a

# Wrong — tag is mutable
FROM python:3.11-slim
```

Update the pinned digest as part of the monthly dependency update cycle. Use `docker pull python:3.11-slim && docker inspect` to get the current digest.

### Vulnerability scanning

**Tool: Trivy**

Two separate scans run in CI to correctly implement the blocking vs advisory split:

```bash
# Blocking: fails CI on CRITICAL or HIGH
trivy image \
  --severity CRITICAL,HIGH \
  --exit-code 1 \
  --ignore-unfixed \
  --vuln-type os,library \
  myimage:tag

# Advisory: reports MEDIUM but does not fail CI
trivy image \
  --severity MEDIUM \
  --exit-code 0 \
  --ignore-unfixed \
  --vuln-type os,library \
  myimage:tag
```

`--ignore-unfixed` skips findings with no available fix (avoids blocking on unactionable results).

### SBOM generation

A Software Bill of Materials is generated and stored as a CI artifact on every build to `main`:

```bash
trivy image --format cyclonedx --output sbom.json myimage:tag
```

The SBOM is uploaded as a GitHub Actions artifact and attached to each GitHub Release. This satisfies enterprise and regulatory requirements for software supply chain transparency.

---

## 8. Testing

### Backend — Pytest

**Tools: pytest + pytest-asyncio + pytest-cov + coverage.py**

#### Coverage thresholds

| Layer | Minimum coverage |
|---|---|
| Auth routes (`routers/auth.py`) | 90% |
| LLM routes (`routers/llm.py`) | 85% |
| All other routers | 80% |
| Service layer | 85% |
| Database access functions | 80% |
| Utilities | 70% |

The global gate enforces the floor; per-file targets are code review responsibilities:

```toml
# pyproject.toml
[tool.coverage.run]
source = ["app"]
omit = ["app/main.py", "tests/*"]

[tool.coverage.report]
fail_under = 80
show_missing = true
```

#### Test categories

- **Unit tests** (`tests/unit/`): pure logic, no DB or HTTP calls, mock external dependencies
- **Integration tests** (`tests/integration/`): use a real MongoDB test instance (not mocked), test route → DB round-trips
- **Do not mock the database in integration tests.** Mocked DB tests have historically masked real migration and schema failures.

```toml
# pyproject.toml
[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
markers = [
    "unit: pure unit tests",
    "integration: requires running test database",
]
```

#### Property-based testing

**Tool: Hypothesis**

Use Hypothesis for testing functions that process user input, data transformations, or parsing logic. Property-based tests catch edge cases that example-based tests miss:

```python
from hypothesis import given, strategies as st

@given(st.text(min_size=1, max_size=255))
def test_sanitize_name_never_raises(name: str) -> None:
    result = sanitize_name(name)
    assert isinstance(result, str)
```

Use Hypothesis on any function that transforms or validates user-supplied data.

### Frontend — Vitest

**Tool: Vitest** (native to Vite, faster than Jest for this project)

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 65,
      },
    },
  },
});
```

`vitest.setup.ts` sets up MSW (see Section 5 — Frontend API mocking).

### End-to-End — Playwright

**Tool: Playwright**

Covers:
- Onboarding flow (`Onboarding → LifePathway → GoalsDashboard`)
- Auth flows (login, registration, session expiry)
- API integration paths

E2E tests run in CI on `main` and `staging` branches only — not on every feature PR. They run against the staging environment, not localhost.

Visual regression: use `expect(page).toHaveScreenshot()` for critical UI components to catch unintentional visual changes.

---

## 9. API Quality

### Error response format

**Standard: RFC 7807 — Problem Details for HTTP APIs**

All error responses must follow the RFC 7807 structure. FastAPI supports this natively:

```python
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional

class ProblemDetail(BaseModel):
    type: str        # URI identifying the error type
    title: str       # Short human-readable summary
    status: int      # HTTP status code
    detail: str      # Human-readable explanation for this occurrence
    instance: Optional[str] = None  # URI identifying this specific occurrence

@app.exception_handler(404)
async def not_found_handler(request, exc):
    return JSONResponse(
        status_code=404,
        content=ProblemDetail(
            type="https://example.com/errors/not-found",
            title="Resource Not Found",
            status=404,
            detail=str(exc),
        ).model_dump(),
    )
```

Do not invent custom error shapes. RFC 7807 is what API clients and monitoring tools expect.

### Correlation IDs

Every inbound request must receive a `X-Request-ID` header (generated if not provided by the client). This ID is attached to all log events, Sentry errors, and outbound service calls for the duration of the request:

```python
import uuid
from starlette.middleware.base import BaseHTTPMiddleware

class RequestIDMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
        with structlog.contextvars.bind_contextvars(request_id=request_id):
            response = await call_next(request)
            response.headers["X-Request-ID"] = request_id
            return response
```

### OpenAPI contract testing

**Tool: Schemathesis**

FastAPI auto-generates an OpenAPI spec. Schemathesis fuzz-tests all endpoints against this spec automatically.

```bash
schemathesis run http://localhost:8000/openapi.json --checks all --max-examples 50
```

Runs in CI on `main` and `staging`. Does not run on feature PRs (advisory only on hotfix path).

### Breaking change policy

A **breaking change** is any of the following:
- Removing or renaming a field in a response body
- Changing the type of a field
- Removing an endpoint
- Changing a required request parameter to a different name

Breaking changes require:
1. A `BREAKING CHANGE:` footer in the commit message
2. A version bump in the API path (`/api/v1` → `/api/v2`) if the change affects a public client contract
3. A deprecation notice in the PR description with a migration guide

Non-breaking additions (new optional fields, new endpoints) do not require a version bump.

### CORS

CORS origins are configured explicitly — never use `allow_origins=["*"]` in any environment:

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,  # list from pydantic-settings
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
)
```

---

## 10. Performance

### Service-level objectives (SLOs)

| Metric | Target | Measurement |
|---|---|---|
| Uptime | 99.9% (≤ 8.7h downtime/year) | CloudWatch / Grafana |
| API p95 latency | < 500ms | Prometheus histogram |
| API p99 latency | < 1000ms | Prometheus histogram |
| Error rate | < 0.1% (5xx responses) | Prometheus counter |
| Redis cache hit rate | > 80% | Redis INFO stats |

Alerts fire when any SLO is breached for > 5 consecutive minutes.

### Backend load testing

**Tool: k6**

```js
// k6/thresholds.js
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  vus: 50,           // 50 concurrent virtual users
  duration: '2m',
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  const res = http.get(`${__ENV.BASE_URL}/api/v1/health/ready`);
  check(res, { 'status 200': (r) => r.status === 200 });
}
```

Runs on staging after every deploy to `main`. Results are advisory on PRs.

### Frontend performance — Core Web Vitals

**Standard: Google Core Web Vitals**

Track the three Core Web Vitals, not a generic Lighthouse "Performance" score:

| Metric | Good | Needs improvement |
|---|---|---|
| LCP (Largest Contentful Paint) | < 2.5s | < 4.0s |
| INP (Interaction to Next Paint) | < 200ms | < 500ms |
| CLS (Cumulative Layout Shift) | < 0.1 | < 0.25 |

Lighthouse CI reports these values per build. Score drops of > 10 points on any metric trigger a mandatory review comment (advisory, does not block merge). Real-user Core Web Vitals are tracked via Sentry Performance.

### Database performance

- Use MongoDB Atlas Performance Advisor to identify slow queries (> 100ms) monthly
- All Prometheus histograms include a `db_query_duration_seconds` metric instrumented by OpenTelemetry
- Queries that consistently exceed 100ms must be reviewed for missing indexes or query restructuring

---

## 11. Security — Cross-Cutting

### OWASP Top 10

All security-sensitive code reviews must be evaluated against the [OWASP Top 10](https://owasp.org/www-project-top-ten/). The most relevant risks for this stack:

| Risk | How we mitigate |
|---|---|
| A01 Broken Access Control | `Depends(get_current_user)` on all protected routes; reviewer checklist item |
| A02 Cryptographic Failures | JWT with RS256 or HS256 + strong secret; TLS enforced at CloudFront/ALB |
| A03 Injection | MongoDB dict queries (no string interpolation); Pydantic validation at all boundaries |
| A04 Insecure Design | RFC 7807 error format; no stack traces in production error responses |
| A05 Security Misconfiguration | Checkov + tflint on all Terraform; no wildcard CORS |
| A06 Vulnerable Components | pip-audit + npm audit + Trivy on every PR |
| A07 Auth Failures | JWT expiry + refresh rotation; rate limiting via slowapi + Redis |
| A09 Logging Failures | structlog structured logging; Sentry error capture; no secrets in logs |

### JWT security standards

- Algorithm: **HS256** minimum; **RS256** preferred for multi-service setups
- Access token expiry: **15 minutes**
- Refresh token expiry: **7 days**, single-use (rotate on every refresh)
- JWT secret loaded from `pydantic-settings` (never hardcoded)
- No sensitive user data in the JWT payload (only `user_id`, `exp`, `iat`)

### Secrets detection

**Tool: Gitleaks**

Runs in pre-commit and CI. Detects AWS keys, API tokens, JWTs, and passwords accidentally committed to Git.

```toml
# .gitleaks.toml
[allowlist]
paths = [".env.example"]
```

`.env.example` is allowlisted (placeholder values only). `.env` must never be committed and is in `.gitignore`.

Any secrets finding immediately blocks merge. If a real secret is accidentally committed, treat it as a security incident: **rotate the secret immediately**, then remediate the commit history (`git filter-repo` or GitHub's push protection).

### HTTPS enforcement

- All traffic enters via CloudFront, which enforces HTTPS and redirects HTTP → HTTPS
- ALB listener accepts HTTPS only (HTTP listener redirects to HTTPS)
- HSTS header set at CloudFront level: `Strict-Transport-Security: max-age=31536000; includeSubDomains`

### GitHub Actions supply chain security

All GitHub Actions must be pinned to a full commit SHA, not a mutable tag. Tags can be moved by a compromised upstream repo:

```yaml
# Correct — pinned to SHA
- uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683  # v4.2.2
- uses: actions/setup-python@0b93645e9fea7318ecaed2b359559ac225c90a2b  # v5.3.0

# Wrong — tag is mutable
- uses: actions/checkout@v4
```

Use [pinact](https://github.com/suzuki-shunsuke/pinact) or [Dependabot](https://docs.github.com/en/code-security/dependabot) to keep pinned SHAs up to date.

### Pre-commit hooks

**Tool: pre-commit**

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.8.0
    hooks:
      - id: ruff            # lint
      - id: ruff-format     # format (replaces Black)

  - repo: https://github.com/pre-commit/mirrors-prettier
    rev: v3.1.0
    hooks:
      - id: prettier
        types_or: [javascript, jsx, ts, tsx, css, json]

  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.21.0
    hooks:
      - id: gitleaks

  - repo: https://github.com/antonbabenko/pre-commit-terraform
    rev: v1.96.0
    hooks:
      - id: terraform_fmt
```

Install: `pre-commit install`

Note: Black is **not** in the pre-commit config. Ruff's formatter (`ruff-format`) is Black-compatible and replaces it entirely. Running both is redundant.

---

## 12. Documentation Standards

### FastAPI route docstrings

All route handlers must have a one-line summary (flows directly into the OpenAPI spec):

```python
@router.post("/children", response_model=ChildResponse)
async def create_child(payload: ChildCreate, user=Depends(get_current_user)):
    """Create a new child profile linked to the authenticated user."""
    ...
```

If the route behaviour is non-obvious, add a `description` parameter to the decorator rather than a long docstring.

### Type annotations

All public functions in the service layer, routers, and database modules must have complete type annotations (enforced by mypy strict mode). Private functions (prefixed `_`) do not require annotations unless they are complex.

### Inline comments

Only add a comment when the **why** is non-obvious: a hidden constraint, a workaround for a specific library bug, or an invariant that would surprise a reader. Do not comment what the code does — well-named identifiers do that.

### README

Every subdirectory with runnable code (`backend/`, `frontend/`, `infra-live-*/`) must have a `README.md` covering:
- How to run it locally
- Required environment variables (with reference to `.env.example`)
- How to run the tests

### CHANGELOG

`CHANGELOG.md` at the repo root is updated on every release. Format follows [Keep a Changelog](https://keepachangelog.com/). Entries are generated from Conventional Commits via `release-please` or `conventional-changelog-cli`.

### Architecture Decision Records (ADRs)

Significant architectural decisions (new external service, auth strategy change, database schema decisions) are recorded as ADRs in `docs/adr/`. Use the [MADR template](https://adr.github.io/madr/). ADRs are write-once — amend by adding a new ADR that supersedes the old one.

---

## 13. Dependency Management

### Update cadence

| Type | Cadence |
|---|---|
| Security patches (any CVE) | Within 24–72h depending on severity (see Section 4) |
| Minor/patch bumps | Weekly, via automated Dependabot PR |
| Major version bumps | Quarterly, manual review required |

### Dependabot configuration

```yaml
# .github/dependabot.yml
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

  - package-ecosystem: terraform
    directory: /infra-live-backend
    schedule:
      interval: monthly

  - package-ecosystem: terraform
    directory: /infra-live-frontend
    schedule:
      interval: monthly

  - package-ecosystem: terraform
    directory: /infra-live-edge
    schedule:
      interval: monthly

  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: monthly
```

All three infra directories are monitored. GitHub Actions ecosystem updates include SHA re-pins.

### Major version upgrade policy

Major version upgrades require:
1. A dedicated `chore(deps):` PR — not bundled with feature work
2. Full test suite passing
3. Manual smoke test on staging before merging to main
4. A `CHANGELOG.md` entry

### License compliance

All new dependencies must use an OSI-approved license compatible with the project's license. AGPL and SSPL dependencies are not permitted. Check license compatibility with `pip-licenses` (Python) or `license-checker` (Node) as part of major dependency reviews.

---

## 14. Observability and Error Monitoring

### Error monitoring

**Tool: Sentry**

- Backend: `sentry-sdk[fastapi,asyncio]` installed and initialised in `app/main.py`
- Frontend: `@sentry/react` installed and wrapping the root component
- Releases tagged in Sentry on each deploy via CI (`sentry-cli releases`)
- Performance traces sampled at 10% in production
- PII scrubbing enabled (`send_default_pii = False`)
- Source maps uploaded to Sentry on each frontend deploy

### Metrics and tracing

**Tools: OpenTelemetry + Prometheus + Grafana**

- OpenTelemetry SDK auto-instruments FastAPI routes, MongoDB queries (via `opentelemetry-instrumentation-motor`), and Redis calls
- Prometheus scrapes from `/metrics`
- Grafana dashboards cover: request latency (p50/p95/p99), error rates by endpoint, DB query duration, Redis hit rate, ECS CPU/memory

Minimum required metrics:

| Metric | Type | Labels |
|---|---|---|
| `http_request_duration_seconds` | Histogram | method, path, status_code |
| `http_requests_total` | Counter | method, path, status_code |
| `db_query_duration_seconds` | Histogram | collection, operation |
| `redis_hit_total` / `redis_miss_total` | Counter | key_prefix |

### Alert thresholds

Alerts fire (PagerDuty / email) when:
- Error rate (5xx) > 1% for > 5 minutes
- p99 latency > 2s for > 5 minutes
- ECS task health check failing for > 2 consecutive checks
- Any CRITICAL Sentry issue with > 10 occurrences in 1 hour

### Code quality dashboard (optional, for team scale)

**Tool: SonarQube**

When the team grows to the point where centralised visibility is needed:
- Technical debt tracking over time
- Security hotspot detection
- Coverage reporting across backend and frontend in one view

---

## 15. CI/CD Pipeline

### GitHub Actions security

All actions pinned to SHA (not tag). See Section 11 — GitHub Actions supply chain security.

### Pipeline order

```
On every PR:
  Backend (jobs run in parallel where independent)
    1. ruff lint + format check
    2. mypy type check
    3. pytest (unit) with coverage gate
    4. bandit + semgrep security scan
    5. pip-audit dependency scan
    6. gitleaks secrets scan

  Frontend (parallel with Backend)
    1. prettier format check
    2. eslint (flat config)
    3. tsc --noEmit
    4. vitest with coverage gate
    5. npm audit

  Infrastructure (only if infra-live-* files changed)
    1. terraform fmt check
    2. terraform validate
    3. tflint
    4. checkov scan
    5. infracost diff (posted as PR comment)

  Container (only if Dockerfile or backend source changed)
    1. hadolint (Dockerfile lint)
    2. docker build
    3. trivy scan (CRITICAL/HIGH blocking + MEDIUM advisory)
    4. SBOM generation (stored as artifact)

On merge to main:
  All of the above, plus:
    - pytest (integration) against test MongoDB instance
    - playwright E2E tests against staging
    - k6 load test against staging (50 VUs, 2 min)
    - lighthouse CI / Core Web Vitals against staging
    - schemathesis API fuzz test against staging
    - sentry release + sourcemap upload

On hotfix/* branches:
  All mandatory checks above, skipping:
    - schemathesis
    - k6
    - lighthouse
```

### Caching

CI pipelines must cache dependencies to keep run times under 5 minutes for the PR pipeline:

```yaml
# Python — uv cache
- uses: actions/cache@1bd1e32a3bdc45362d1e726936510720a7c6158d  # v4
  with:
    path: ~/.cache/uv
    key: ${{ runner.os }}-uv-${{ hashFiles('uv.lock') }}

# Node
- uses: actions/cache@1bd1e32a3bdc45362d1e726936510720a7c6158d  # v4
  with:
    path: ~/.npm
    key: ${{ runner.os }}-npm-${{ hashFiles('package-lock.json') }}

# Docker layers
- uses: docker/setup-buildx-action@b5ca514318bd6ebfe23a5b29e4f8c9e9e4c0b89d  # v3
  with:
    driver-opts: image=moby/buildkit:latest
```

### Environment-specific behavior

| Check | PR | Main merge | Staging deploy | Production deploy |
|---|---|---|---|---|
| Unit tests | yes | yes | yes | yes |
| Integration tests | no | yes | yes | yes |
| E2E (Playwright) | no | yes | yes | no (staging only) |
| Load tests (k6) | no | yes (staging) | yes | no |
| Container scan (Trivy) | yes | yes | yes | yes |
| Schemathesis | no | yes | yes | no |
| SBOM generation | no | yes | yes | yes |

### Post-deploy smoke tests

After every deploy to staging or production, a smoke test job runs basic health checks:

```bash
curl -f https://api.staging.example.com/health/ready
curl -f https://api.staging.example.com/api/v1/health/live
```

A deploy is not considered successful until smoke tests pass.

### Deployment strategy

ECS uses a **rolling update** strategy with a minimum healthy percent of 100% and maximum percent of 200%. This ensures zero downtime during deploys. Rollback is triggered automatically if the new task fails its health check within 5 minutes.

---

## 16. Exception and Suppression Process

When a mandatory check produces a false positive or an acceptable known risk, suppressions are allowed under these conditions:

### How to suppress

**Ruff:**
```python
result = eval(user_input)  # noqa: S307 -- sandboxed eval, input sanitized upstream
```

**Bandit:**
```python
subprocess.run(cmd)  # nosec B603 -- cmd is a hardcoded list, no user input
```

**ESLint:**
```tsx
// eslint-disable-next-line react-hooks/exhaustive-deps -- stable ref, intentionally omitted
```

**Checkov:**
```hcl
#checkov:skip=CKV_AWS_18:Access logging not required for internal-only bucket
```

**Trivy — add to `.trivyignore` with review date:**
```
# GHSA-xxxx-xxxx-xxxx: not exploitable because X. Review: 2025-08-01
GHSA-xxxx-xxxx-xxxx
```

**pip-audit — add to `pyproject.toml`:**
```toml
[tool.pip-audit]
ignore-vulns = [
  # "GHSA-xxxx-xxxx-xxxx",  # not exploitable because X. Review: 2025-08-01
]
```

Note: `pip-audit` does **not** support a `.pip-audit-ignore` file. The `pyproject.toml` entry above is the correct mechanism.

### Approval requirements

- Any suppression on a HIGH or CRITICAL finding requires a **second reviewer to explicitly approve** the suppression in the PR review.
- Suppressions must include a comment explaining **why** the finding is a false positive or acceptable risk, and a **review date**.
- Suppressions without a justification comment and review date are rejected in code review.
- `.trivyignore` and `pyproject.toml` pip-audit ignore entries are audited quarterly to remove stale suppressions.

---

## 17. Authoritative Tool Stack

This is the single source of truth for tooling decisions.

### Backend

| Purpose | Tool |
|---|---|
| Package manager | uv |
| Formatting + linting + import sorting | Ruff (replaces Black entirely) |
| Type checking | mypy (strict) |
| Unit + integration testing | pytest + pytest-asyncio + pytest-cov |
| Property-based testing | Hypothesis |
| Coverage | coverage.py |
| Security scanning | Bandit + Semgrep |
| Dependency vulnerability scanning | pip-audit |
| Logging | structlog (structured JSON) |
| Settings management | pydantic-settings |

### Frontend

| Purpose | Tool |
|---|---|
| Language | TypeScript (strict) |
| Formatting | Prettier 3 |
| Linting | ESLint v9 (flat config: react, react-hooks, typescript, jsx-a11y) |
| Unit testing | Vitest |
| API mocking | MSW (Mock Service Worker) |
| E2E testing | Playwright |
| Dependency vulnerability scanning | npm audit + Snyk |
| Performance | Core Web Vitals via Lighthouse CI |

### Infrastructure

| Purpose | Tool |
|---|---|
| Formatting | terraform fmt |
| Validation | terraform validate |
| Provider-specific linting | tflint |
| Security scanning | Checkov |
| Cost estimation | infracost |

### Container

| Purpose | Tool |
|---|---|
| Dockerfile linting | hadolint |
| Vulnerability scanning | Trivy |
| SBOM generation | Trivy (CycloneDX format) |

### Security (cross-cutting)

| Purpose | Tool |
|---|---|
| Secrets detection | Gitleaks |
| Advanced pattern scanning | Semgrep |
| Pre-commit enforcement | pre-commit |

### CI/CD and Observability

| Purpose | Tool |
|---|---|
| Pipeline | GitHub Actions (all actions pinned to SHA) |
| API fuzz testing | Schemathesis |
| Load testing | k6 |
| Error monitoring | Sentry |
| Metrics + tracing | OpenTelemetry + Prometheus + Grafana |
| Release notes | release-please / conventional-changelog |
