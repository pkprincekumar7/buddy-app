# CI/CD

## GitHub Actions workflows

Twelve workflows live under [`.github/workflows/`](../.github/workflows/). Deployment and infrastructure workflows authenticate to AWS via **OIDC** — no long-lived access keys are stored anywhere in GitHub.

| Workflow | Trigger | Purpose |
|---|---|---|
| `check.yml` | Push / PR to `main`; Manual (`workflow_dispatch`) | Code quality gate — lint, format, types, build, bundle size, tests + coverage, Terraform lint, secret detection, Dockerfile lint, SAST, IaC security, CVE scan, license compliance, Docker image scan, SBOM, OpenAPI lint, DAST, dependency review (PRs), CodeQL |
| `terraform-live-all.yml` | Manual | Full-stack orchestrator — provisions or tears down all infra, then optionally deploys |
| `terraform-live-backend.yml` | Manual / called | VPC, ECS, ALB, Redis, ECR, Secrets Manager |
| `terraform-live-frontend.yml` | Manual / called | S3 bucket for frontend assets |
| `terraform-live-edge.yml` | Manual / called | CloudFront distribution + ACM cert (always `us-east-1`) |
| `deploy-live-backend.yml` | Manual / called | Builds Docker image, pushes to ECR, updates ECS service |
| `deploy-live-frontend.yml` | Manual / called | Builds frontend, uploads to S3, invalidates CloudFront |
| `promote-live-backend.yml` | Manual | Promotes a verified backend image from one environment to the next (`dev→stg` or `stg→prod`) without a rebuild — re-tags the ECR image and updates the ECS service in the target environment |
| `promote-live-frontend.yml` | Manual | Promotes the frontend to the next environment (`dev→stg` or `stg→prod`) — reads the deployed git SHA from SSM and rebuilds with the target environment's variables (VITE_API_URL is baked into the bundle at build time, so a full rebuild is required) |
| `build-android-apk.yml` | Manual | Builds a React Native (Expo) Android APK for the selected environment (`dev`, `stg`, `prod`) |
| `build-ios-ipa.yml` | Manual | Builds a React Native (Expo) iOS IPA for the selected environment |
| `restart-live-backend.yml` | Manual | Force-restarts ECS tasks without a new build (picks up secret rotations, env changes) |

## Code quality workflow (check.yml)

[`check.yml`](../.github/workflows/check.yml) runs on pushes and pull requests targeting `main`, and can also be triggered manually via `workflow_dispatch` from the GitHub Actions UI. It has nine jobs. `backend-lint`, `frontend-lint`, `frontend-app-lint`, and `terraform-lint` start in parallel immediately; `backend-test` starts once `backend-lint` passes; `security-scan`, `dast`, and `codeql` all start once `backend-lint`, `frontend-lint`, and `frontend-app-lint` pass; `dependency-review` runs only on pull requests and starts independently of the other jobs. A concurrency guard cancels any in-progress run for the same branch when a new push arrives, avoiding redundant CI minutes. A workflow-level `permissions: contents: read` baseline is set; individual jobs declare their own elevated permissions only when needed (`codeql` needs `security-events: write`; `dependency-review` needs `pull-requests: write`).

### `backend-lint` (Python 3.12)

The install step runs `pip install -r requirements.txt -r requirements-lint.txt`, picking up `ruff` and `mypy` versions from `backend/requirements-lint.txt` — the single source of truth shared with `check.sh`. All app packages are present when mypy runs — giving it full type resolution rather than treating third-party imports as `Any`. The pip cache key covers both files so a change to either invalidates the cache.

| Step | Tool | What it checks |
|---|---|---|
| `ruff check` | ruff 0.11.2 | Linting — unused imports, bugbear, naming, isort, … |
| `ruff format --check` | ruff 0.11.2 | Formatting (black-compatible, line-length 100) — fails if any file is unformatted |
| `mypy` | mypy 1.15.0 | Static type checking of `app/` against real package stubs (Python 3.12, `check_untyped_defs`) |

### `frontend-lint` (Node.js 22)

| Step | Tool | What it checks |
|---|---|---|
| `eslint` | ESLint (via `npm run lint`) | React/hooks rules, unused imports, security (`eslint-plugin-security`) — covers `src/**` excl. `components/ui/` |
| `prettier --check` | Prettier (devDependency) | JS/JSX/CSS formatting across `src/**` — fails if any file is unformatted or has unsorted Tailwind classes (`prettier-plugin-tailwindcss`) |
| `typecheck` | tsc (via `npm run typecheck`) | JSDoc type checking (`checkJs`) across `src/**` excl. `components/ui/` |
| `build` | Vite (via `npm run build`) | Production build — catches import errors and missing assets |
| bundle size | bash + `wc` | Ensures the main JS bundle stays ≤ 1.4 MB (current: ~1.08 MB) |

### `frontend-app-lint` (Node.js 22)

| Step | Tool | What it checks |
|---|---|---|
| `eslint` | ESLint (via `yarn lint`) | React Native/hooks rules, unused imports, security — covers `frontend-app/src/**` |
| `prettier --check` | Prettier (devDependency) | TS/TSX formatting across `src/**/*.{ts,tsx}` — fails if any file is unformatted |
| `typecheck` | tsc (`--noEmit`) | TypeScript type checking across `frontend-app/src/**` |

### `terraform-lint`

| Step | Tool | What it checks |
|---|---|---|
| `terraform fmt -check -recursive` | Terraform 1.13.0 | Formatting across all three infra directories (`infra-live-backend/`, `infra-live-edge/`, `infra-live-frontend/`) — fails if any `.tf` file is unformatted |
| `tflint (infra-live-backend)` | tflint 0.62.1 | Deprecated syntax, unused variables, wrong argument types and best-practice violations in backend infra |
| `tflint (infra-live-edge)` | tflint 0.62.1 | Same for edge infra (CloudFront / WAF / DNS) |
| `tflint (infra-live-frontend)` | tflint 0.62.1 | Same for frontend infra (S3 bucket policy) |

### `backend-test` (Python 3.12, needs: backend-lint)

Runs after `backend-lint` passes. Spins up MongoDB and Redis as Docker service containers so the FastAPI app can connect to real dependencies — identical to the dev environment. A fresh RSA key pair is generated on the fly with `openssl genrsa 2048` and written to `$GITHUB_ENV` so the job never fails due to a missing secret configuration.

| Step | Tool | What it checks |
|---|---|---|
| `pytest --cov=app --cov-report=term-missing --cov-fail-under=0` | pytest 8.3.4 + pytest-cov 6.0.0 | All tests under `backend/tests/` — coverage is reported on every run; gate is set to 0 until a baseline test suite exists (raise `--cov-fail-under` incrementally as tests are added) |

Coverage reports are printed to the job log with `--cov-report=term-missing` so uncovered lines are visible without downloading an artifact.

### `dast` (needs: backend-lint + frontend-lint + frontend-app-lint)

Runs dynamic application security testing against a live backend instance. Like `backend-test`, it spins up MongoDB and Redis service containers and starts FastAPI with `uvicorn` in the background, then polls `GET /health` for up to 60 seconds before running any scan. All scan steps carry `continue-on-error: true`; a final gate step collects outcomes and fails the job after all tools complete.

| Step | Tool | What it checks |
|---|---|---|
| Spectral (OpenAPI lint) | spectral-cli 6.16.0 (devDependency in `frontend/package.json`) | Fetches the live OpenAPI spec from the running backend (`GET /openapi.json`), then lints against `.spectral.yaml` — every operation must declare a security scheme, have a unique `operationId`, and be tagged |
| Nuclei (DAST) | nuclei v3.3.9 | Probes `http://localhost:8000` with `http/misconfiguration`, `http/exposures`, and `http/technologies` templates at medium/high/critical severity — detects missing security headers, exposed debug endpoints, dangerous HTTP methods |

### `security-scan`

All steps run without cloud credentials. The checkout uses `fetch-depth: 0` so gitleaks can scan the full commit history, not just the current working tree. Gitleaks is installed from the upstream release tarball with SHA-256 checksum verification before extraction. Every security-check step carries `continue-on-error: true` so all tools complete even if an earlier one fails; a final gate step (`if: always()`) collects the outcome of every step and fails the job — printing the full list of which checks failed — only after all tools have run. The final group builds the backend Docker image to scan OS-level CVEs inside the Debian base layer. Steps are grouped by the runtime they require.

| Step | Tool | What it checks |
|---|---|---|
| Gitleaks | gitleaks v8.30.1 (CLI) | Full git history — accidentally committed secrets, API keys, private keys, tokens |
| Hadolint | hadolint-action 3.3.0 | `backend/Dockerfile` — Dockerfile best practices: running as root, `latest` tag, insecure instructions |
| Bandit | bandit 1.9.4 | `backend/app/` — Python SAST: hard-coded secrets, injection, insecure API calls (medium+ severity) |
| Semgrep | semgrep 1.167.0 (`p/security-audit`) | `backend/app/`, `backend/tools/`, `frontend/src/`, `frontend-app/src/` — advanced Python and JavaScript/React SAST patterns |
| pip-audit | pip-audit 2.9.0 | `backend/requirements.txt` — dependency CVE scan (PyPA/OSV DB); PYSEC-2025-183 and PYSEC-2026-175/177/178/179 suppressed (PyJWT CVEs with no available fix version at time of writing) |
| Checkov | checkov 3.2.529 | `infra-live-*/terraform/` — Terraform IaC misconfigurations (open S3 buckets, missing encryption, overly permissive IAM) |
| npm audit | npm | `frontend/` — npm dependency CVE scan (high/critical only) |
| Retire.js | retire (devDependency) | `frontend/` — browser library CVEs not always caught by npm audit |
| Trivy (backend fs) | trivy-action 0.36.0 | `backend/` — HIGH/CRITICAL CVEs in Python packages using the Trivy advisory DB (complements pip-audit) |
| Trivy (frontend fs) | trivy-action 0.36.0 | `frontend/` — HIGH/CRITICAL CVEs in npm packages using the Trivy advisory DB (complements npm audit) |
| Trivy (backend license) | trivy-action 0.36.0 | `backend/` — HIGH/CRITICAL license violations (GPL, AGPL, LGPL) in Python packages |
| Trivy (frontend license) | trivy-action 0.36.0 | `frontend/` — HIGH/CRITICAL license violations in npm packages |
| Trivy (frontend SBOM) | trivy-action 0.36.0 | `frontend/` — generates `sbom-frontend.cyclonedx.json` in CycloneDX format, uploaded as a 90-day workflow artifact |
| Trivy config (infra-live-backend) | trivy (CLI) | `infra-live-backend/terraform/` — IaC security misconfigurations using Trivy's built-in Terraform rule set (tfsec successor); complements Checkov with a second rule database; `trivy config` accepts one directory at a time |
| Trivy config (infra-live-edge) | trivy (CLI) | `infra-live-edge/terraform/` — same |
| Trivy config (infra-live-frontend) | trivy (CLI) | `infra-live-frontend/terraform/` — same |
| Docker build (image scan) | docker | Builds `buddy-backend` image once; shared by the three image-level checks below |
| Trivy (backend image) | trivy-action 0.36.0 | Built `buddy-backend` Docker image — OS-level HIGH/CRITICAL CVEs in the Debian base layer packages (unfixed only) |
| Trivy (backend image SBOM) | trivy-action 0.36.0 | Built `buddy-backend` image — generates `sbom-backend.cyclonedx.json` in CycloneDX format, uploaded as a 90-day workflow artifact |
| Dockle | dockle (installed from release tarball) | Built image — CIS Docker Benchmark: root user check, secrets baked into layers, missing `HEALTHCHECK`, unnecessary `setuid`/`setgid` bits |

### `codeql`

Runs two matrix jobs in parallel after `backend-lint`, `frontend-lint`, and `frontend-app-lint` pass. Results are uploaded to the GitHub Security tab and are visible under **Security → Code scanning**. `fail-fast: false` ensures both languages complete independently — a failure in one does not abort the other.

| Matrix | Language | What it checks |
|---|---|---|
| `python` | Python 3.12 | `backend/app/` — dataflow and taint analysis, injection flaws, insecure API usage (`security-extended` query suite) |
| `javascript-typescript` | JavaScript/JSX | `frontend/src/` — XSS, prototype pollution, unsafe regex, DOM-based vulnerabilities (`security-extended` query suite) |

CodeQL requires `security-events: write` permission (set at the job level) to upload SARIF results. It cannot be run locally — it runs only in GitHub Actions CI.

### `dependency-review`

Runs only on pull requests (`if: github.event_name == 'pull_request'`). Uses the GitHub-native `dependency-review-action@v4` to detect any newly introduced dependency with a known HIGH or CRITICAL vulnerability, comparing the PR's lockfile changes against GitHub's vulnerability database. Posts a summary comment on the PR. It runs independently of other jobs and does not block push pipelines.

| Step | Tool | What it checks |
|---|---|---|
| Dependency Review | dependency-review-action v4 | Newly added or changed dependencies in `package-lock.json` / `requirements.txt` that have HIGH/CRITICAL CVEs — blocks merge if any are found |

## One-time AWS setup: GitHub OIDC identity provider

Done once per AWS account.

### Step 1 — Add GitHub as an OIDC provider in IAM

In the [AWS IAM console](https://console.aws.amazon.com/iam/) go to **Identity providers → Add provider**:

| Field | Value |
|---|---|
| Provider type | OpenID Connect |
| Provider URL | `https://token.actions.githubusercontent.com` |
| Audience | `sts.amazonaws.com` |

Click **Get thumbprint**, then **Add provider**.

### Step 2 — Create the IAM role

Go to **IAM → Roles → Create role**:

1. Trusted entity type: **Web identity**
2. Identity provider: `token.actions.githubusercontent.com`
3. Audience: `sts.amazonaws.com`
4. Scope to your repository:
   - Condition key: `token.actions.githubusercontent.com:sub`
   - Operator: `StringLike`
   - Value: `repo:YOUR_GITHUB_ORG/buddy-app:*` (or `repo:...:environment:dev` per env)
5. Attach the `AdministratorAccess` managed policy (or a scoped policy covering ECS, ECR, ELB, VPC, CloudFront, S3, Route 53, ACM, Secrets Manager, SSM, IAM).
6. Name the role and copy the **Role ARN** — this becomes the `ROLE_ARN` secret.

## Required GitHub secrets

Configure under **Settings → Environments → `<env>` → Secrets** (one set per environment: `dev`, `stg`, `prod`).

### Infrastructure secrets (Terraform + deploy workflows)

| Secret | Value |
|---|---|
| `ROLE_ARN` | ARN of the IAM OIDC role |
| `APP_NAME` | App identifier used as SSM parameter prefix, e.g. `buddy360` |
| `STATE_BUCKET` | S3 bucket name for Terraform remote state |
| `ASSETS_BUCKET_NAME` | Pre-existing S3 bucket name (in `us-east-1`) used to store static assets under `app-assets/` and to hold any backend-generated files. Used by `terraform-live-backend` (ECS env var injection) and `terraform-live-edge` (CloudFront origin + bucket policy). |
| `DOMAIN_NAME` | Root domain, e.g. `example.com` |
| `SUBDOMAIN` | Frontend subdomain prefix, e.g. `app` |
| `SUBDOMAIN_INTERNAL` | Backend/internal subdomain prefix, e.g. `api` |
| `HOSTED_ZONE_ID` | Route 53 hosted zone ID |
| `ACM_CERTIFICATE_ARN_AP_SOUTH_1` | ACM cert ARN for `ap-south-1` (covers backend ALB) |
| `ACM_CERTIFICATE_ARN_US_EAST_1` | ACM cert ARN for `us-east-1` (covers CloudFront) |
| `SPA_BUCKET_NAME` | Pre-existing S3 bucket name for the compiled frontend assets — used by `terraform-live-edge` to configure the CloudFront origin pointing to the frontend S3 bucket. |
| `JWT_PUBLIC_KEYS` | JSON map of kid → RSA public key PEM — embedded in the CloudFront Function by `terraform-live-edge`. See [docs/jwt-keys.md](jwt-keys.md). |

### Application secrets (injected into ECS task environment by `terraform-live-backend.yml`)

| Secret | Value |
|---|---|
| `JWT_PRIVATE_KEY` | RSA private key PEM (single-line, `\n` escaped) — see [docs/jwt-keys.md](jwt-keys.md) for generation instructions |
| `JWT_KEY_ID` | Key ID label matching the `kid` header in signed tokens, e.g. `key-v1` |
| `GOOGLE_CLIENT_ID` | OAuth 2.0 Web client ID (leave empty to disable Google Sign-In) |
| `MONGODB_URI` | `mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/` |
| `OPENAI_API_KEY` | OpenAI key (optional) |
| `OPENAI_MODEL` | e.g. `gpt-5.4-mini` (default) |
| `ANTHROPIC_API_KEY` | Anthropic key (optional) |
| `ANTHROPIC_MODEL` | e.g. `claude-sonnet-4-6` (default) |
| `GEMINI_API_KEY` | Google Gemini key (optional) |
| `GEMINI_MODEL` | e.g. `gemini-3-flash` (default) |
| `ASSETS_BUCKET_NAME` | S3 bucket name injected into the ECS task environment; available to the backend for any S3 operations (e.g. future direct uploads). Also declared as an infrastructure secret above — a single GitHub secret drives both Terraform and the ECS environment. |

### Frontend build secrets (baked into the bundle by `deploy-live-frontend.yml`)

| Secret | Value |
|---|---|
| `VITE_GOOGLE_CLIENT_ID` | Same value as `GOOGLE_CLIENT_ID` |

`VITE_API_URL` is **not** a GitHub secret — it is computed dynamically in the workflow from `SUBDOMAIN` and `DOMAIN_NAME` and injected into the build environment at runtime.

At least one LLM API key must be set to enable LLM features.
