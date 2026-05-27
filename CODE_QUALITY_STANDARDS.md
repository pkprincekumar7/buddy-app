# Code Quality, Security, Testing and Performance Standards

Stack: Python/FastAPI backend (MongoDB Atlas + Redis), React + TypeScript frontend (Vite), Terraform infrastructure (AWS), GitHub Actions CI/CD.

Items listed here are **not yet implemented**. Everything already running in production has been removed from this file.

---

## Table of Contents

1. [Enforcement Gaps](#1-enforcement-gaps)
2. [GitHub Repository Configuration](#2-github-repository-configuration)
3. [Code Review Standards](#3-code-review-standards)
4. [Backend — Python / FastAPI](#4-backend-python-fastapi)
5. [Frontend — React + TypeScript](#5-frontend-react-typescript)
6. [Infrastructure — Terraform](#6-infrastructure-terraform)
7. [Container Security](#7-container-security)
8. [Testing](#8-testing)
9. [API Quality](#9-api-quality)
10. [Performance](#10-performance)
11. [Security — Cross-Cutting](#11-security-cross-cutting)
12. [Documentation Standards](#12-documentation-standards)
13. [Dependency Management](#13-dependency-management)
14. [Observability and Error Monitoring](#14-observability-and-error-monitoring)
15. [CI/CD Pipeline Gaps](#15-cicd-pipeline-gaps)
16. [Exception and Suppression Process](#16-exception-and-suppression-process)

---

## 1. Enforcement Gaps

The following mandatory checks are listed as blocking in the standards but are **not yet enforced**:

| Gap | Current state | Required state |
|---|---|---|
| Coverage gate | `--cov-fail-under=0` (disabled) | Per-layer minimums (see Section 8) |
| mypy strict mode | `strict = false` | `strict = true` |
| CODEOWNERS auto-reviewer | File missing | `.github/CODEOWNERS` required |
| Branch protection rules | Not configured | 1 review, CI required, no force-push to main |
| infracost cost diff | Not in CI | Required on infra-live-* PRs |
| k6 load tests | Not configured | Staging post-merge (advisory) |
| Lighthouse / Core Web Vitals | Not configured | CI advisory check |
| Schemathesis API fuzz | Not in CI | main + staging runs |
| Gitleaks pre-commit | CI only | Also in Husky pre-commit hook |
| Terraform fmt pre-commit | CI only | Also in Husky pre-commit hook |

---

## 2. GitHub Repository Configuration

### CODEOWNERS

Create `.github/CODEOWNERS`:

```
# Auth is security-sensitive
/backend/app/routers/auth.py          @prince-els

# Infrastructure changes require infra owner review
/infra-live-backend/                  @prince-els
/infra-live-frontend/                 @prince-els
/infra-live-edge/                     @prince-els

# CI/CD pipeline changes
/.github/workflows/                   @prince-els
```

### Branch protection rules

Configure on GitHub → Settings → Branches for `main`:
- Require 1 approved review before merging
- Dismiss stale reviews on new pushes
- Require status checks to pass (backend-lint, frontend-lint, security-scan, terraform-lint)
- No force-push to main or staging
- No deletions of main or staging

### Dependabot

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

### Git workflow conventions

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
- Feature/fix/refactor/chore → main: squash merge
- Hotfix → main: merge commit
- Release → main: merge commit

Keep PRs under **400 lines** of non-generated code.

**Hotfix path:** On `hotfix/*` branches, Schemathesis, k6, and Lighthouse CI are skipped. All mandatory security checks still run.

### Release tagging

Releases follow [Semantic Versioning](https://semver.org/). Tags created on `main` after release branch merges:
```
git tag -a v1.4.2 -m "Release v1.4.2"
```
`CHANGELOG.md` updated on every release via `release-please` GitHub Action (see Section 12).

---

## 3. Code Review Standards

Approval requirements:
- Minimum 1 approved review before merge (requires CODEOWNERS configured — see Section 2)
- PR author cannot approve their own PR
- Stale reviews dismissed on new pushes
- Reviews completed within 1 business day

Open as **Draft** when work is in progress; convert to "Ready for review" when complete.

**Reviewer checklist:**

**Correctness**
- [ ] Logic matches intent in the PR description
- [ ] Edge cases handled (empty inputs, null values, async errors)
- [ ] No silent failure paths
- [ ] Async errors properly awaited and caught

**Security**
- [ ] No hardcoded secrets, tokens, or credentials
- [ ] User input validated at all system boundaries (Pydantic models on every route)
- [ ] MongoDB queries use dict literals — no raw string interpolation
- [ ] `Depends(get_current_user)` present on all new protected routes
- [ ] New auth-related code reviewed against [OWASP Top 10](https://owasp.org/www-project-top-ten/)

**Testing**
- [ ] New logic has corresponding unit or integration tests
- [ ] At least one failure/edge case tested, not just the happy path
- [ ] Integration tests use a real MongoDB instance (not mocked)

**API contracts**
- [ ] Response shape changes are backwards-compatible, or documented as a breaking change
- [ ] New endpoints have FastAPI docstrings (flows into OpenAPI spec)
- [ ] Error responses use RFC 7807 Problem Details format (see Section 9)

**Infrastructure**
- [ ] Terraform changes include `terraform plan` output in PR description
- [ ] No new public-facing AWS resources without explicit justification
- [ ] infracost diff reviewed for unexpected cost increases

Reviewers should NOT block on: style issues that Ruff/Prettier enforce, or subjective naming preferences without real ambiguity.

---

## 4. Backend — Python / FastAPI

### Package manager — migrate to uv

Currently using `pip` + `requirements.txt`. Migrate to `uv`:

```bash
# Install uv
curl -LsSf https://astral.sh/uv/install.sh | sh

# Migrate from requirements.txt
uv add $(cat requirements.txt | grep -v "^#" | grep -v "^$" | tr '\n' ' ')
uv add --dev $(cat requirements-lint.txt | grep -v "^#" | grep -v "^$" | tr '\n' ' ')
```

`uv.lock` replaces all `requirements*.txt` files and is committed to version control. `pyproject.toml` becomes the single source of truth.

CI commands change from:
```bash
pip install -r requirements.txt -r requirements-lint.txt
```
to:
```bash
uv sync
uv run pytest
```

### Python version pin

Create `backend/.python-version`:
```
3.12
```
`uv` reads this file automatically. CI uses it via `uv python install`.

### Ruff — add security and annotation rules

Current `pyproject.toml` is missing two rule groups. Add "S" and "ANN" to the select list:

```toml
[tool.ruff.lint]
select = [
    "E", "W", "F", "I", "B", "UP", "C4", "RET", "SIM", "N",
    "S",    # flake8-security — bandit-equivalent security checks (SQL injection, shell injection, etc.)
    "ANN",  # flake8-annotations — requires type annotations on public functions
]

[tool.ruff.lint.per-file-ignores]
"tests/**" = ["S101", "ANN"]   # assert and missing annotations are fine in tests
```

Also add `[tool.bandit]` config section (currently missing):
```toml
[tool.bandit]
skips = ["B101"]  # assert acceptable in tests
```

### mypy — enable strict mode

Currently `strict = false`. Change:

```toml
[tool.mypy]
python_version = "3.12"
strict = true
ignore_missing_imports = true
exclude = ["tests/"]
```

`strict = true` enables: `disallow_untyped_defs`, `disallow_any_generics`, `warn_return_any`, `no_implicit_optional`, and others. Every public function must have complete type annotations. Fix all resulting errors before enabling — do not use `# type: ignore` to suppress.

### pip-audit config in pyproject.toml

Move the `--ignore-vuln` CI flags into `pyproject.toml` so they are version-controlled:

```toml
[tool.pip-audit]
ignore-vulns = [
  # "PYSEC-2025-183",  # example: add CVE ID + reason + review date
]
```

Remove the inline `--ignore-vuln PYSEC-2025-183` from the CI command. `pip-audit` reads `pyproject.toml` automatically.

### Structured logging — structlog

Currently using Python's standard `logging` module. Replace with `structlog` for machine-parseable JSON output (CloudWatch, Datadog, ELK).

Install:
```bash
uv add structlog
```

Usage:
```python
import structlog

logger = structlog.get_logger()

# Correct — structured fields
logger.info("user.created", user_id=str(user.id), email=user.email)
logger.error("db.query_failed", collection="users", error=str(e))

# Wrong — unstructured string (current pattern to remove)
logger.info(f"User {user.id} created")
```

Configure structlog in `app/main.py` at startup to output JSON in production and pretty-printed in development:

```python
import structlog, logging

structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer() if settings.app_env == "prod"
        else structlog.dev.ConsoleRenderer(),
    ],
    wrapper_class=structlog.stdlib.BoundLogger,
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
)
logging.basicConfig(level=logging.INFO)
```

Bind `request_id` to structlog context in `request_id_middleware` so every log event within a request automatically includes the correlation ID:

```python
import structlog.contextvars

async def request_id_middleware(request, call_next):
    request_id = ...  # existing logic
    structlog.contextvars.clear_contextvars()
    structlog.contextvars.bind_contextvars(request_id=request_id)
    response = await call_next(request)
    response.headers["X-Request-Id"] = request_id
    return response
```

Required log fields on every event: `timestamp`, `level`, `event`, `request_id` (on request-scoped events).

Log levels: `DEBUG` (local only), `INFO` (normal events), `WARNING` (recoverable issues), `ERROR` (failures needing attention), `CRITICAL` (service-level failures).

### Health check — add readiness endpoint

Currently only `/health` (liveness) exists. Add `/health/ready`:

```python
from app.database import get_database
from app.llm_rate_limiter import get_redis_client

@app.get("/health/ready", tags=["system"])
async def readiness(request: Request):
    """Readiness probe — returns 200 only when DB and Redis are reachable."""
    db = request.app.state.db
    await db.command("ping")

    r = get_redis_client()
    if r is not None:
        r.ping()

    return {"status": "ok"}
```

ECS/ALB readiness checks should point to `/health/ready`; liveness checks to `/health`.

### JWT expiry — tighten defaults

Current defaults in `settings.py`:
- `jwt_access_expire_minutes = 30` → change to `15`
- `jwt_refresh_expire_hours = 24` → change to `168` (7 days)

Refresh tokens must be single-use: rotate on every refresh call. The existing auth router must be verified to invalidate the old refresh token on use (store token IDs in Redis or a `used_tokens` collection).

```python
jwt_access_expire_minutes: int = Field(default=15, ...)
jwt_refresh_expire_hours: int = Field(default=168, ...)  # 7 days
```

### MongoDB-specific standards

These rules apply to all Motor async database access and must be enforced in code review:

- **No raw string interpolation in queries.** Use dict literals only:
  ```python
  # Correct
  await collection.find_one({"user_id": user_id})
  # Wrong
  await collection.find_one({"user_id": f"{user_id}"})
  ```
- All queries must have a supporting index. New queries without a declared index require a code review note.
- No synchronous Motor calls inside async routes — every DB call must be `await`ed.
- `init_indexes()` is the only place to create indexes, never inline in route handlers.
- All `find()` calls must include `.limit()` or be explicitly reviewed.

---

## 5. Frontend — React + TypeScript

### Prettier — add trailingComma

Add to `.prettierrc`:
```json
{
  "plugins": ["prettier-plugin-tailwindcss"],
  "tailwindConfig": "./tailwind.config.ts",
  "singleQuote": true,
  "semi": true,
  "printWidth": 100,
  "trailingComma": "all"
}
```

`"trailingComma": "all"` is the Prettier 3 default and required for consistent diffs.

### Accessibility — eslint-plugin-jsx-a11y

**Target: WCAG 2.1 Level AA**

Install:
```bash
npm install -D eslint-plugin-jsx-a11y
```

Add to `eslint.config.ts`:
```ts
import jsxA11y from 'eslint-plugin-jsx-a11y';

// Inside the main config object:
plugins: {
  ...existing plugins,
  'jsx-a11y': jsxA11y,
},
rules: {
  ...existing rules,
  ...jsxA11y.configs.recommended.rules,
},
```

Fix all reported violations before enabling — do not suppress with `eslint-disable`. Lighthouse accessibility score target: ≥ 90 (advisory).

### Snyk — frontend dependency scanning

Snyk runs weekly on `main` for deeper transitive dependency analysis beyond `npm audit`:

```yaml
# Add to .github/workflows/lint.yml (weekly schedule or main push)
- name: Snyk (frontend)
  uses: snyk/actions/node@...
  with:
    args: --severity-threshold=high
  env:
    SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
```

---

## 6. Infrastructure — Terraform

### terraform validate — add to CI

`terraform validate` is not in CI. Add after `terraform fmt` check in the `terraform-lint` job:

```yaml
- name: Terraform validate (infra-live-backend)
  run: |
    terraform -chdir=infra-live-backend/terraform init -backend=false
    terraform -chdir=infra-live-backend/terraform validate

- name: Terraform validate (infra-live-edge)
  run: |
    terraform -chdir=infra-live-edge/terraform init -backend=false
    terraform -chdir=infra-live-edge/terraform validate

- name: Terraform validate (infra-live-frontend)
  run: |
    terraform -chdir=infra-live-frontend/terraform init -backend=false
    terraform -chdir=infra-live-frontend/terraform validate
```

### tflint configuration file

Create `.tflint.hcl` at each infra module root:

```hcl
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

### infracost — add to CI

Add to the `terraform-lint` job, conditional on infra-live-* file changes:

```yaml
- name: infracost diff
  if: contains(github.event.pull_request.changed_files, 'infra-live')
  run: infracost diff --path . --format json --out-file /tmp/infracost.json
```

Cost diffs are advisory — do not block merge, but cost changes > $50/month must be acknowledged in the PR description.

### Terraform state

- Remote state must be in S3 with DynamoDB locking.
- `.terraform.lock.hcl` committed to version control, updated when provider versions change.
- `terraform plan` output must be included in the PR description for infrastructure-affecting changes.

---

## 7. Container Security

### Base image digest pinning

Current Dockerfiles use mutable tags (`FROM python:3.12-slim`, `FROM node:22-alpine`). Pin by digest:

```dockerfile
# Get the digest:
# docker pull python:3.12-slim && docker inspect python:3.12-slim --format='{{index .RepoDigests 0}}'

# Correct — pinned by digest
FROM python:3.12-slim@sha256:<digest>

# Wrong — tag is mutable
FROM python:3.12-slim
```

Update pinned digests as part of the monthly dependency update cycle. This is a supply chain attack vector — tags can be moved by a compromised upstream registry.

---

## 8. Testing

No tests currently exist in the backend. No frontend test setup exists. This entire section is pending implementation.

### Backend — Pytest

**Tools: pytest + pytest-asyncio + pytest-cov + coverage.py**

Add to `requirements-test.txt` (or `uv add --dev`):
```
pytest
pytest-cov
pytest-asyncio
httpx
hypothesis
```

Configure `pyproject.toml`:
```toml
[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
markers = [
    "unit: pure unit tests",
    "integration: requires running test database",
]

[tool.coverage.run]
source = ["app"]
omit = ["app/main.py", "tests/*"]

[tool.coverage.report]
fail_under = 80
show_missing = true
```

Update CI `pytest` command:
```bash
# Change from --cov-fail-under=0 to:
pytest --cov=app --cov-report=term-missing --cov-fail-under=80 -q
```

**Coverage thresholds by layer:**

| Layer | Minimum |
|---|---|
| `routers/auth.py` | 90% |
| `routers/llm.py` | 85% |
| All other routers | 80% |
| Service layer | 85% |
| Database access | 80% |
| Utilities | 70% |

**Test structure:**
- `tests/unit/` — pure logic, no DB or HTTP calls, mock external dependencies
- `tests/integration/` — use the real MongoDB test instance (CI spins one up), test route → DB round-trips

**Do not mock the database in integration tests.** Mocked DB tests mask real migration and schema failures.

**Property-based testing — Hypothesis:**

Use for functions that process user input, data transformations, or parsing logic:

```python
from hypothesis import given, strategies as st

@given(st.text(min_size=1, max_size=255))
def test_sanitize_name_never_raises(name: str) -> None:
    result = sanitize_name(name)
    assert isinstance(result, str)
```

### Frontend — Vitest

Install:
```bash
npm install -D vitest @vitest/coverage-v8 @testing-library/react @testing-library/user-event jsdom msw
```

Create `frontend/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': resolve(import.meta.dirname, './src') },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      thresholds: { lines: 70, functions: 70, branches: 65 },
    },
  },
});
```

Add `"test": "vitest"` and `"test:coverage": "vitest run --coverage"` to `package.json` scripts.

**MSW (Mock Service Worker):**

MSW intercepts at the network level — tests exercise the same fetch code as production. Do not mock `fetch` directly.

```ts
// src/mocks/handlers.ts
import { http, HttpResponse } from 'msw';

export const handlers = [
  http.get('/api/v1/children', () =>
    HttpResponse.json([{ id: '1', name: 'Test Child' }])
  ),
];
```

```ts
// vitest.setup.ts
import { setupServer } from 'msw/node';
import { handlers } from './src/mocks/handlers';

const server = setupServer(...handlers);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

### End-to-End — Playwright

Install:
```bash
npm install -D @playwright/test
npx playwright install
```

Cover:
- Onboarding flow (`Onboarding → LifePathway → GoalsDashboard`)
- Auth flows (login, registration, session expiry)

E2E tests run in CI on `main` and `staging` only — not on every feature PR.

---

## 9. API Quality

### Error response format — RFC 7807

All error responses must follow [RFC 7807 Problem Details](https://datatracker.ietf.org/doc/html/rfc7807). Currently not implemented — FastAPI returns raw `{"detail": "..."}` shapes.

Implement globally in `app/main.py`:

```python
from pydantic import BaseModel
from fastapi.responses import JSONResponse
from typing import Optional

class ProblemDetail(BaseModel):
    type: str       # URI identifying the error type
    title: str      # Short summary
    status: int     # HTTP status code
    detail: str     # Human-readable explanation for this occurrence
    instance: Optional[str] = None

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content=ProblemDetail(
            type=f"https://buddy360.com/errors/{exc.status_code}",
            title=exc.detail if isinstance(exc.detail, str) else "HTTP Error",
            status=exc.status_code,
            detail=exc.detail if isinstance(exc.detail, str) else str(exc.detail),
        ).model_dump(),
    )
```

Do not invent custom error shapes. RFC 7807 is what API clients and monitoring tools expect.

### Schemathesis — API fuzz testing

FastAPI auto-generates an OpenAPI spec. Schemathesis fuzz-tests all endpoints automatically. Currently the DAST job uses Spectral + Nuclei but not Schemathesis.

Add to the `dast` CI job:

```yaml
- name: Schemathesis (API fuzz)
  id: schemathesis
  continue-on-error: true
  run: |
    pip install schemathesis
    schemathesis run http://localhost:8000/openapi.json --checks all --max-examples 50
```

Add `schemathesis` to the fail-gate at the end of the DAST job.

### Breaking change policy

A **breaking change** is any of:
- Removing or renaming a field in a response body
- Changing the type of a field
- Removing an endpoint
- Changing a required request parameter name

Breaking changes require:
1. `BREAKING CHANGE:` footer in the commit message
2. API version bump (`/api/v1` → `/api/v2`) if it affects a public client contract
3. Deprecation notice in the PR description with a migration guide

### CORS

CORS is already correctly configured — explicit origins only, no wildcard. Do not change.

---

## 10. Performance

### Service-level objectives (SLOs)

Define and instrument these targets once Prometheus is configured (see Section 14):

| Metric | Target |
|---|---|
| Uptime | 99.9% (≤ 8.7h downtime/year) |
| API p95 latency | < 500ms |
| API p99 latency | < 1000ms |
| Error rate | < 0.1% (5xx responses) |
| Redis cache hit rate | > 80% |

Alerts fire when any SLO is breached for > 5 consecutive minutes.

### Backend load testing — k6

Create `k6/thresholds.js`:
```js
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  vus: 50,
  duration: '2m',
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  const res = http.get(`${__ENV.BASE_URL}/health/ready`);
  check(res, { 'status 200': (r) => r.status === 200 });
}
```

Run on staging after every deploy to `main`. Results advisory on PRs.

### Frontend — Core Web Vitals

Track the three Core Web Vitals via Lighthouse CI:

| Metric | Good |
|---|---|
| LCP (Largest Contentful Paint) | < 2.5s |
| INP (Interaction to Next Paint) | < 200ms |
| CLS (Cumulative Layout Shift) | < 0.1 |

Add `lhci` to CI against staging. Score drops > 10 points on any metric trigger a mandatory review comment (advisory).

---

## 11. Security — Cross-Cutting

### OWASP Top 10 — mitigation table

| Risk | Mitigation |
|---|---|
| A01 Broken Access Control | `Depends(get_current_user)` on all protected routes |
| A02 Cryptographic Failures | JWT HS256 + strong secret; TLS at CloudFront/ALB |
| A03 Injection | MongoDB dict queries; Pydantic at all boundaries |
| A04 Insecure Design | RFC 7807 format (pending); no stack traces in prod responses |
| A05 Security Misconfiguration | Checkov + tflint on all Terraform; no wildcard CORS |
| A06 Vulnerable Components | pip-audit + npm audit + Trivy on every PR |
| A07 Auth Failures | JWT expiry + refresh rotation; rate limiting via slowapi + Redis |
| A09 Logging Failures | structlog (pending); Sentry (pending); no secrets in logs |

### GitHub Actions — pin all actions to commit SHA

Currently all actions use version tags (`@v6.0.2`, `@v4.0.1`). Tags are mutable and are a supply chain attack vector. Pin every action to a full commit SHA:

```yaml
# Correct — pinned to SHA
- uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683  # v4.2.2
- uses: actions/setup-python@0b93645e9fea7318ecaed2b359559ac225c90a2b  # v5.3.0
- uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020  # v4.4.0

# Wrong — tag is mutable (current state)
- uses: actions/checkout@v6.0.2
```

Use [pinact](https://github.com/suzuki-shunsuke/pinact) to automate SHA pinning:
```bash
pinact run
```

Dependabot (Section 2) will keep pinned SHAs up to date automatically.

### Gitleaks configuration

Create `.gitleaks.toml`:
```toml
[allowlist]
paths = [".env.example"]
```

`.env.example` is allowlisted (placeholder values only). `.env` must never be committed and is in `.gitignore`.

Any secrets finding immediately blocks merge. If a real secret is committed: **rotate the secret immediately**, then use `git filter-repo` or GitHub push protection to remediate history.

### Pre-commit hooks — add gitleaks and terraform fmt

Current Husky pre-commit handles frontend (ESLint + Prettier) and backend (ruff). Add two more checks to `frontend/.husky/pre-commit`:

```sh
# ── Gitleaks secrets scan ────────────────────────────────────────────────────
if command -v gitleaks >/dev/null 2>&1; then
  gitleaks protect --staged --redact || exit 1
else
  echo "WARNING: gitleaks not installed — skipping pre-commit secrets scan"
  echo "Install: https://github.com/gitleaks/gitleaks#installing"
fi

# ── Terraform fmt on staged .tf files ────────────────────────────────────────
STAGED_TF=$(git diff --cached --name-only --diff-filter=ACMR | grep "\.tf$" || true)
if [ -n "$STAGED_TF" ]; then
  echo "$STAGED_TF" | xargs -I{} terraform fmt "$ROOT/{}" || exit 1
  echo "$STAGED_TF" | xargs -I{} git add "$ROOT/{}"
fi
```

### HTTPS enforcement

- All traffic enters via CloudFront, which enforces HTTPS and redirects HTTP → HTTPS
- ALB listener: HTTPS only (HTTP redirects to HTTPS)
- HSTS header at CloudFront: `Strict-Transport-Security: max-age=31536000; includeSubDomains`

---

## 12. Documentation Standards

### FastAPI route docstrings

Every route handler must have a one-line summary (flows into OpenAPI spec):

```python
@router.post("/children", response_model=ChildResponse)
async def create_child(payload: ChildCreate, user=Depends(get_current_user)):
    """Create a new child profile linked to the authenticated user."""
```

For non-obvious behaviour, use the `description` parameter on the decorator rather than a long docstring.

### Type annotations

All public functions in service layer, routers, and database modules must have complete type annotations — enforced by `mypy strict = true` and Ruff ANN rules (both pending — see Section 4).

### Inline comments

Only add a comment when the **why** is non-obvious: a hidden constraint, a library workaround, or a surprising invariant. Do not comment what the code does.

### README completeness

Every directory with runnable code must have a `README.md`:
- How to run locally
- Required environment variables (reference to `.env.example`)
- How to run tests

### CHANGELOG

Create `CHANGELOG.md` at the repo root. Format follows [Keep a Changelog](https://keepachangelog.com/). Entries generated from Conventional Commits via [`release-please`](https://github.com/googleapis/release-please):

```yaml
# .github/workflows/release-please.yml
on:
  push:
    branches: [main]
jobs:
  release-please:
    runs-on: ubuntu-latest
    steps:
      - uses: googleapis/release-please-action@...
        with:
          release-type: node
```

### Architecture Decision Records (ADRs)

Significant architectural decisions are recorded in `docs/adr/`. Use the [MADR template](https://adr.github.io/madr/). ADRs are write-once — supersede by adding a new one.

Create `docs/adr/` and add an initial ADR for any major decision already made (auth strategy, MongoDB multi-region, etc.).

---

## 13. Dependency Management

### Update cadence

| Type | Cadence |
|---|---|
| Security patches (any CVE) | CRITICAL: 24h, HIGH: 3 business days, MEDIUM/LOW: next cycle |
| Minor/patch bumps | Weekly via Dependabot (Section 2) |
| Major version bumps | Quarterly, manual review + smoke test on staging |

### Major version upgrade policy

1. Dedicated `chore(deps):` PR — not bundled with feature work
2. Full test suite passing
3. Manual smoke test on staging before merging to main
4. `CHANGELOG.md` entry

### License compliance

New dependencies must use an OSI-approved license compatible with the project license. AGPL and SSPL dependencies are not permitted.

Check with:
```bash
# Python
pip install pip-licenses
pip-licenses --format=table

# Node
npx license-checker --summary
```

Run as part of major dependency reviews. Trivy license scanning (already in CI) catches most cases automatically.

---

## 14. Observability and Error Monitoring

### Sentry — error monitoring

Nothing is currently configured. Install in both backend and frontend.

**Backend:**
```bash
uv add sentry-sdk[fastapi,asyncio]
```

In `app/main.py`:
```python
import sentry_sdk

sentry_sdk.init(
    dsn=settings.sentry_dsn,  # add to Settings
    traces_sample_rate=0.1,   # 10% in production
    send_default_pii=False,
    environment=settings.app_env,
)
```

Add `sentry_dsn: str = Field(default="", ...)` to `Settings`.

**Frontend:**
```bash
npm install @sentry/react
```

In `src/main.tsx`:
```ts
import * as Sentry from '@sentry/react';

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  tracesSampleRate: 0.1,
  environment: import.meta.env.MODE,
});
```

Add `VITE_SENTRY_DSN` to `vite-env.d.ts` and `src/lib/env.ts`.

In CI: `sentry-cli releases` to tag each deploy + upload frontend source maps.

### Metrics and tracing — OpenTelemetry + Prometheus + Grafana

Install:
```bash
uv add opentelemetry-sdk opentelemetry-instrumentation-fastapi \
       opentelemetry-instrumentation-motor opentelemetry-exporter-prometheus \
       prometheus-fastapi-instrumentator
```

Minimum required Prometheus metrics:

| Metric | Type | Labels |
|---|---|---|
| `http_request_duration_seconds` | Histogram | method, path, status_code |
| `http_requests_total` | Counter | method, path, status_code |
| `db_query_duration_seconds` | Histogram | collection, operation |
| `redis_hit_total` / `redis_miss_total` | Counter | key_prefix |

Expose `/metrics` endpoint (Prometheus scrape target). Grafana dashboards: request latency (p50/p95/p99), error rates by endpoint, DB query duration, Redis hit rate, ECS CPU/memory.

### Alert thresholds

Once Prometheus + Grafana are configured, set alerts for:
- Error rate (5xx) > 1% for > 5 minutes
- p99 latency > 2s for > 5 minutes
- ECS task health check failing for > 2 consecutive checks
- Any CRITICAL Sentry issue with > 10 occurrences in 1 hour

---

## 15. CI/CD Pipeline Gaps

### GitHub Actions SHA pinning

All actions currently use version tags. See Section 11 for the required SHA pinning and `pinact` tooling.

### Missing CI checks

Add to the pipeline once tools are configured:

**On merge to main (currently not running):**
- pytest (integration) against test MongoDB — currently pytest runs but `--cov-fail-under=0` (gate disabled, fix per Section 8)
- Playwright E2E against staging (Section 8)
- k6 load test against staging (Section 10)
- Lighthouse CI / Core Web Vitals against staging (Section 10)
- Schemathesis API fuzz test against staging (Section 9)
- Sentry release + source map upload (Section 14)

### Post-deploy smoke tests

After every deploy to staging or production, run a smoke test job:

```bash
curl -f https://api.staging.example.com/health/ready
curl -f https://api.staging.example.com/health
```

A deploy is not considered successful until smoke tests pass.

### Deployment strategy

ECS must use rolling update with minimum healthy percent 100%, maximum 200%. Rollback triggered automatically if the new task fails its health check within 5 minutes. Verify this is configured in Terraform.

### CI caching

```yaml
# Python (after uv migration)
- uses: actions/cache@<sha>  # v4
  with:
    path: ~/.cache/uv
    key: ${{ runner.os }}-uv-${{ hashFiles('uv.lock') }}

# Node (already configured — keep)
- uses: actions/cache@<sha>  # v4
  with:
    path: ~/.npm
    key: ${{ runner.os }}-npm-${{ hashFiles('package-lock.json') }}
```

---

## 16. Exception and Suppression Process

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

**Trivy — create `.trivyignore`:**
```
# GHSA-xxxx-xxxx-xxxx: not exploitable because X. Review: 2026-08-01
GHSA-xxxx-xxxx-xxxx
```

Note: `.trivyignore` does not yet exist in this repo. Create it when the first justified suppression is needed.

**pip-audit — add to `pyproject.toml`** (see Section 4):
```toml
[tool.pip-audit]
ignore-vulns = [
  # "GHSA-xxxx-xxxx-xxxx",  # not exploitable because X. Review: 2026-08-01
]
```

### Approval requirements

- Any suppression on a HIGH or CRITICAL finding requires a **second reviewer** to explicitly approve the suppression in the PR review
- Suppressions must include: **why** the finding is a false positive or acceptable risk + a **review date**
- Suppressions without justification + review date are rejected in code review
- `.trivyignore` and `pyproject.toml` pip-audit entries audited quarterly to remove stale suppressions
