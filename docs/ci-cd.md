# CI/CD

## GitHub Actions workflows

Thirteen workflows live under [`.github/workflows/`](../.github/workflows/). Deployment and infrastructure workflows authenticate to AWS via **OIDC** — no long-lived access keys are stored anywhere in GitHub.

| Workflow | Trigger | Purpose |
|---|---|---|
| `check.yml` | Push / PR to `main`; Manual (`workflow_dispatch`) | Code quality gate — lint, format, types, build, bundle size, tests + coverage, Terraform lint, secret detection, Dockerfile lint, SAST, IaC security, CVE scan, license compliance, Docker image scan, SBOM, OpenAPI lint, DAST, dependency review (PRs), CodeQL |
| `terraform-live-all.yml` | Manual / called | Full-stack orchestrator — provisions or tears down all infra, then optionally deploys |
| `terraform-live-scheduler.yml` | Manual | Provisions per-environment AWS EventBridge Scheduler resources; `environment` input selects dev/sbx/stg/prod; `schedule_enabled` input enables or disables the schedules; `target_aws_regions` input selects the full region set the daily schedules apply/destroy. EventBridge invokes a Lambda function (the "GitHub dispatcher"), which reads a GitHub PAT from Secrets Manager and calls `terraform-live-all.yml`'s `workflow_dispatch` REST endpoint directly — EventBridge itself never talks to the GitHub API. PAT sourced from `GIT_ACTIONS_PAT` environment secret |
| `terraform-live-backend.yml` | Manual / called | VPC, ECS, ALB, Valkey, ECR, Cloud Map, SNS/SQS, Secrets Manager — applied once per region (`aws_region` input: `ap-south-1` / `eu-west-1` / `us-east-1`). On an apply it fills each service's secret the first time (`scripts/fill-service-secrets.sh`) |
| `terraform-live-frontend.yml` | Manual / called | S3 bucket policy for frontend assets (always `us-east-1`) |
| `terraform-live-edge.yml` | Manual / called | CloudFront distribution, WAF, Lambda@Edge JWT validator, DNS (always `us-east-1`); `backend_regions` input selects which regions' uploads buckets get CloudFront origins and which regions the JWT validator can route to; `bootstrap_region` input (default `auto` = first of `backend_regions`) picks the region that serves login, Google sign-in and health — consumes a pre-existing ACM cert ARN, does not create one |
| `deploy-live-backend.yml` | Manual / called | Builds one image per selected service (`--build-arg SERVICE=<service>`; a worker runs its service's), in parallel, pushes each to that service's ECR repository in every selected region, and rolls out the selected runtimes (`service`: `all` or a comma-separated list such as `users,users-worker`) in parallel; a failed one doesn't stop the others, and the run fails naming it. The collector runs a pinned public image, so `all` skips it. `build_from` (optional) builds every image from one service's code, for placeholder images (`hello`, build plan 2.7). A service added in `infra-live-backend/terraform/services.tf` needs no workflow logic change, only its runtimes added to the help text of the `service` input (CI checks it matches). |
| `deploy-live-frontend.yml` | Manual / called | Builds frontend, uploads to S3, invalidates CloudFront |
| `promote-live-backend.yml` | Manual | Promotes a verified backend image from one environment to the next (`dev↔sbx`, `dev→stg`, `sbx→stg`, `stg→prod`) without a rebuild — for the selected services (`service`: `all` or a comma-separated list), all in parallel. An export job (source environment's `ROLE_ARN`) pulls the image each one runs live in the source environment, then the promote job (target's `ROLE_ARN`) pushes each into its service's repository in the target under the same tag and updates each target ECS service. The collector isn't promoted. Works across AWS accounts (e.g. stg and prod in different accounts) |
| `promote-live-frontend.yml` | Manual | Promotes the frontend to the next environment (`dev→stg` or `stg→prod`) — reads the deployed git SHA from SSM and rebuilds with the target environment's variables (VITE_API_URL is baked into the bundle at build time, so a full rebuild is required) |
| `build-android-apk.yml` | Manual | Builds a React Native (Expo) Android APK for the selected environment (`dev`, `stg`, `prod`) |
| `build-ios-ipa.yml` | Manual | Builds a React Native (Expo) iOS IPA for the selected environment |
| `restart-live-backend.yml` | Manual | Force-restarts ECS tasks without a new build (picks up secret rotations, env changes). `service`: `all` or a comma-separated list, resolved from the `ecs_services` SSM list; services restart in parallel. |

## Code quality workflow (check.yml)

[`check.yml`](../.github/workflows/check.yml) runs on pushes and pull requests targeting `main`, and can also be triggered manually via `workflow_dispatch` from the GitHub Actions UI. It has ten jobs. `backend-lint`, `frontend-lint`, `frontend-app-lint`, `lambda-edge-test`, and `terraform-lint` start in parallel immediately; `backend-test` starts once `backend-lint` passes; `security-scan`, `dast`, and `codeql` all start once `backend-lint`, `frontend-lint`, and `frontend-app-lint` pass; `dependency-review` runs only on pull requests and starts independently of the other jobs. A concurrency guard cancels any in-progress run for the same branch when a new push arrives, avoiding redundant CI minutes. A workflow-level `permissions: contents: read` baseline is set; individual jobs declare their own elevated permissions only when needed (`codeql` needs `security-events: write`; `dependency-review` needs `pull-requests: write`).

### `backend-lint` (Python 3.13)

The install step runs `pip install -r requirements.txt -r requirements-lint.txt`, picking up `ruff` and `mypy` versions from `backend/requirements-lint.txt` — the single source of truth shared with `check.sh`. All app packages are present when mypy runs — giving it full type resolution rather than treating third-party imports as `Any`. The pip cache key covers both files so a change to either invalidates the cache.

| Step | Tool | What it checks |
|---|---|---|
| `ruff check` | ruff 0.11.2 | Linting — unused imports, bugbear, naming, isort, … |
| `ruff format --check` | ruff 0.11.2 | Formatting (black-compatible, line-length 100) — fails if any file is unformatted |
| `mypy` | mypy 1.15.0 | Static type checking of `app/` and `tools/` against real package stubs (Python 3.13, `check_untyped_defs`) |
| Mutant lists valid | `tools/mutate_handlers.py --check` | Every hand-built mutant still matches the current source exactly once and compiles (seconds). Never runs mutation testing itself — that is manual, see [mutation-testing.md](mutation-testing.md) |

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
| Jest (unit tests) | Jest (via `yarn test --ci`) | The `frontend-app` unit tests (`__tests__/`, `src/__tests__/`) |

### `terraform-lint`

| Step | Tool | What it checks |
|---|---|---|
| `terraform fmt -check -recursive` | Terraform 1.16.4 | Formatting across all four infra directories (`infra-live-backend/`, `infra-live-edge/`, `infra-live-frontend/`, `infra-live-scheduler/`) — fails if any `.tf` file is unformatted |
| `tflint (infra-live-backend)` | tflint 0.62.1 | Deprecated syntax, unused variables, wrong argument types and best-practice violations in backend infra |
| `tflint (infra-live-edge)` | tflint 0.62.1 | Same for edge infra (CloudFront / WAF / DNS) |
| `tflint (infra-live-frontend)` | tflint 0.62.1 | Same for frontend infra (S3 bucket policy) |
| `tflint (infra-live-scheduler)` | tflint 0.62.1 | Same for scheduler infra (EventBridge Scheduler) |

### `lambda-edge-test` (Node.js 22)

Renders `infra-live-edge/functions/jwt-validator-lambda.js.tpl` through a real `terraform apply` in a temp directory (not a hand-rolled reimplementation of HCL's `templatefile()` syntax), so the test exercises exactly what gets deployed to Lambda@Edge.

| Step | Tool | What it checks |
|---|---|---|
| `node --test jwt-validator-lambda.test.js` | Node's built-in test runner | JWT validation, location-based routing (cookie/header/Bearer-token priority, mobile vs web), 401/503 fail-closed behavior, `cn`/`ru` exclusion — 14 test cases |

### `backend-test` (Python 3.13, needs: backend-lint)

Runs after `backend-lint` passes. Spins up MongoDB and Redis as Docker service containers so the FastAPI app can connect to real dependencies — identical to the dev environment. A fresh RSA key pair is generated on the fly with `openssl genrsa 2048` and written to `$GITHUB_ENV` so the job never fails due to a missing secret configuration.

| Step | Tool | What it checks |
|---|---|---|
| `pytest --cov=app --cov-branch --cov-report=term-missing --cov-fail-under=99` | pytest 8.3.4 + pytest-cov 6.0.0 | All tests under `backend/tests/`, with line + branch coverage gated at 99% (currently ~99.96%). `MONGODB_TEST_URI` and `REDIS_URL` point the real-Mongo/Redis integration tests at the service containers, and `REQUIRE_LIVE_SERVICES=1` makes a skipped one fail the job instead of passing silently |

Coverage reports are printed to the job log with `--cov-report=term-missing` so uncovered lines are visible without downloading an artifact.

### `dast` (needs: backend-lint + frontend-lint + frontend-app-lint)

Runs dynamic application security testing against a live backend instance. Like `backend-test`, it spins up MongoDB and Redis service containers and starts FastAPI with `uvicorn` in the background, then polls `GET /health` for up to 60 seconds before running any scan. All scan steps carry `continue-on-error: true`; a final gate step collects outcomes and fails the job after all tools complete.

| Step | Tool | What it checks |
|---|---|---|
| openapi.json up to date | `backend/tools/export-openapi.py` + `git diff` | Regenerates the spec from the code and fails if the committed `openapi.json` differs — i.e. someone changed an endpoint without regenerating and committing it |
| Spectral (OpenAPI lint) | spectral-cli 6.16.0 (devDependency in `frontend/package.json`) | Lints the exported `openapi.json` against `.spectral.yaml` — every operation must declare a security scheme, have a unique `operationId`, and be tagged |
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
| Trivy config (infra-live-scheduler) | trivy (CLI) | `infra-live-scheduler/terraform/` — same |
| Docker build (image scan) | docker | Builds `superpower-backend` image once; shared by the three image-level checks below |
| Trivy (backend image) | trivy-action 0.36.0 | Built `superpower-backend` Docker image — OS-level HIGH/CRITICAL CVEs in the Debian base layer packages (unfixed only) |
| Trivy (backend image SBOM) | trivy-action 0.36.0 | Built `superpower-backend` image — generates `sbom-backend.cyclonedx.json` in CycloneDX format, uploaded as a 90-day workflow artifact |
| Dockle | dockle (installed from release tarball) | Built image — CIS Docker Benchmark: root user check, secrets baked into layers, missing `HEALTHCHECK`, unnecessary `setuid`/`setgid` bits |

### `codeql`

Runs two matrix jobs in parallel after `backend-lint`, `frontend-lint`, and `frontend-app-lint` pass. Results are uploaded to the GitHub Security tab and are visible under **Security → Code scanning**. `fail-fast: false` ensures both languages complete independently — a failure in one does not abort the other.

| Matrix | Language | What it checks |
|---|---|---|
| `python` | Python 3.13 | `backend/app/` — dataflow and taint analysis, injection flaws, insecure API usage (`security-extended` query suite) |
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
5. Attach the `AdministratorAccess` managed policy (or a scoped policy covering ECS, ECR, ELB, VPC, CloudFront, WAF, S3, Route 53, ACM, Secrets Manager, SSM, IAM, GuardDuty, CloudTrail, EventBridge Scheduler, and Lambda).
6. Name the role and copy the **Role ARN** — this becomes the `ROLE_ARN` environment variable.

## Required GitHub environment variables and secrets

Configure both under **Settings → Environments → `<env>`**, one set per environment: `dev`, `sbx`, `stg`, `prod`.
- **Variables** (`vars.*`): everything that isn't a credential, such as names, IDs, ARNs, model names and public keys. They're readable in the UI and show unmasked in logs, so a run is easy to check.
- **Secrets** (`secrets.*`): credentials only. They're write-only and masked in logs.

Both are scoped to the environment the same way, so each job sees its own environment's values. In promote, the export job sees the source environment and the promote job the target. A missing value fails the run up front; the error tags each missing variable with `(variable)`.

Environments in the same AWS account (dev, sbx and stg share one; prod has its own) must each point at their **own** S3 buckets (`ASSETS_BUCKET_NAME`, `SPA_BUCKET_NAME`, and their `UPLOADS_BUCKET_NAMES` entries). The edge and frontend stacks replace each bucket's whole policy with one that trusts only that environment's CloudFront distribution, so a shared bucket breaks the other environment with 403s. For the same reason `GLOBAL_LOGGING_BUCKET_NAME` must be a different bucket from the `us-east-1` entry of `REGIONAL_LOGGING_BUCKET_NAMES`.

### Variables — per-region values (TF-01)

Each is a single-line JSON map keyed by AWS region, with an entry for every region the environment uses (`backend_regions`). Adding a region means adding one key to each map; no workflow changes. A missing or empty entry fails the run before Terraform, naming the variable and region.

| Variable | Value | Used by |
|---|---|---|
| `ACM_CERTIFICATE_ARNS` | `{"ap-south-1": "arn:aws:acm:ap-south-1:…", "us-east-1": "arn:aws:acm:us-east-1:…"}`: one ACM cert per region for that region's backend ALB. The **`us-east-1` entry is always required**, because it's also CloudFront's viewer certificate (CloudFront needs its cert in `us-east-1`), so it must cover the public domain too. | `terraform-live-backend` (that region's entry), `terraform-live-edge` (`us-east-1`) |
| `UPLOADS_BUCKET_NAMES` | `{"ap-south-1": "<uploads bucket>", …}`: the pre-existing, private uploads bucket per region | `terraform-live-backend` (CORS, lifecycle, IAM), `terraform-live-edge` (CSP `connect-src`) |
| `REGIONAL_LOGGING_BUCKET_NAMES` | `{"ap-south-1": "<logging bucket>", …}`: pre-existing bucket per region for CloudTrail and/or ALB access logs. An entry is **required for every region**, even where `enable_cloudtrail` / `enable_alb_access_logs` are off. | `terraform-live-backend` |

They replace the old per-region secrets `ACM_CERTIFICATE_ARN_<REGION>`, `UPLOADS_BUCKET_NAME_<REGION>` and `REGIONAL_LOGGING_BUCKET_NAME_<REGION>`.

### Variables — infrastructure (Terraform + deploy workflows)

| Variable | Value |
|---|---|
| `ROLE_ARN` | ARN of the IAM OIDC role. Not a credential: the role's trust policy decides who can assume it. It does show the AWS account ID in logs. |
| `APP_NAME` | App identifier used as resource-name and SSM parameter prefix, e.g. `superpower` |
| `STATE_BUCKET` | S3 bucket name for Terraform remote state |
| `ASSETS_BUCKET_NAME` | Pre-existing S3 bucket name (in `us-east-1`) used to store static assets under `app-assets/` and to hold any backend-generated files. Used by `terraform-live-backend` (ECS env var `ASSETS_BUCKET_NAME`), `terraform-live-edge` (CloudFront origin + bucket policy) and the mobile builds. |
| `DOMAIN_NAME` | Root domain, e.g. `example.com` |
| `SUBDOMAIN` | Frontend subdomain prefix, e.g. `app`. The backend/internal subdomain (`{subdomain}-internal`) is derived from this at workflow runtime; there is no separate value for it. |
| `HOSTED_ZONE_ID` | Route 53 hosted zone ID for this environment's `DOMAIN_NAME`. The zone must be in the **same AWS account** as this environment's `ROLE_ARN` (both the public CloudFront record and the internal ALB records are written into it), so prod's zone lives in the prod account. A subdomain zone needs NS delegation from its parent zone. |
| `SPA_BUCKET_NAME` | Pre-existing S3 bucket name for the compiled frontend assets — used by `terraform-live-edge` to configure the CloudFront origin pointing to the frontend S3 bucket. |
| `GLOBAL_LOGGING_BUCKET_NAME` | Pre-existing S3 bucket in `us-east-1` for the edge module's CloudTrail trail and/or WAF Firehose logs (`terraform-live-edge` only; required on prod, and whenever `enable_cloudtrail` or `enable_waf_logging` is true) |
| `JWT_PUBLIC_KEYS` | JSON map of kid → RSA public key PEM — public keys only, by design. Embedded in the Lambda@Edge JWT validator by `terraform-live-edge`, and passed to every backend service by `terraform-live-backend` (every service but auth verifies with these keys only). **Required**: `terraform-live-backend` fails before apply unless its `JWT_KEY_ID` entry is the public half of `JWT_PRIVATE_KEY`. See [docs/jwt-keys.md](jwt-keys.md). |
| `JWT_KEY_ID` | The `kid` auth signs with. Optional: defaults to `key-v1` when unset. Change it only during a key rotation (see [docs/jwt-keys.md](jwt-keys.md)). |
| `OPS_EMAIL` | Operator (preferably team/distribution-list) email for the CloudWatch alarm SNS subscription. Required only when `enable_ops_email = true` (prod by default) — Terraform's own validation enforces this, the workflow does not. Shows in logs, so keep it a team address. |

### Variables — application config (injected into ECS task environment by `terraform-live-backend.yml`)

| Variable | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | OAuth 2.0 Web client ID (leave empty to disable Google Sign-In). Public by nature: the browser sees it. Also used by the mobile builds. |
| `OPENAI_MODEL` | Required, e.g. `gpt-5.4-mini` |
| `ANTHROPIC_MODEL` | Required, e.g. `claude-sonnet-4-6` |
| `GEMINI_MODEL` | Required, e.g. `gemini-3-flash` |

### Variables — frontend build (baked into the bundle by `deploy-live-frontend.yml` / `promote-live-frontend.yml`)

| Variable | Value |
|---|---|
| `VITE_GOOGLE_CLIENT_ID` | Same value as `GOOGLE_CLIENT_ID`. Anything baked into the bundle is public. |

`VITE_API_URL` is **not** configured: it's computed in the workflow from `SUBDOMAIN` and `DOMAIN_NAME` and injected into the build environment at runtime.

### Secrets — credentials only

| Secret | Value |
|---|---|
| `JWT_PRIVATE_KEY` | RSA private key PEM (single-line, `\n` escaped) — see [docs/jwt-keys.md](jwt-keys.md) for generation instructions. Reaches only the auth service. |
| `MONGODB_URIS` | JSON object, service → that service's own connection string (one Atlas database user per service, read/write on its own database only), e.g. `{"auth": "mongodb+srv://<auth-user>:<pass>@<cluster>.mongodb.net/", "users": "…"}`. Needs every service with a database (all but platform); `terraform-live-backend` refuses to fill any secret if one is missing. |
| `EMAIL_HMAC_PEPPER` | Auth's pepper for the email lookup hash: a long random string, e.g. `openssl rand -hex 32`. The same in every region of the environment; reaches only the auth service. Back it up: losing it makes every email lookup unmatchable, and changing it needs the versioned rotation in [auth-users-split.md](auth-users-split.md) 6.5. |
| `OPENAI_API_KEY` | OpenAI key — at least one of `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/`GEMINI_API_KEY` is required (the generating services refuse to start without one); an unset one stays `REPLACE_ME` in their secrets |
| `ANTHROPIC_API_KEY` | Anthropic key (see `OPENAI_API_KEY`) |
| `GEMINI_API_KEY` | Google Gemini key (see `OPENAI_API_KEY`) |
| `ORIGIN_VERIFY_SECRET` | Shared secret CloudFront attaches as the `X-Origin-Verify` header on every request to the backend ALB; the ALB listener rules reject anything without a matching header, so a request that reaches the ALB via CloudFront's shared IP range but bypassed this app's own distribution (and therefore its Lambda@Edge JWT check) gets a fixed 403. **Must be identical** between `terraform-live-backend` and `terraform-live-edge` — both read it from this same secret. |
| `ORIGIN_VERIFY_SECRET_NEXT` | **Optional — set only during a rotation.** While set, every ALB accepts it as well as `ORIGIN_VERIFY_SECRET`, and CloudFront sends it instead. See [infra-operations.md](infra-operations.md#rotating-the-origin-verify-secret). |
| `GIT_ACTIONS_PAT` | GitHub Personal Access Token used by the scheduler's Lambda dispatcher to call the `workflow_dispatch` REST endpoint; requires classic token with `repo` + `workflow` scopes (or fine-grained Actions: Read and Write). Used by `terraform-live-scheduler.yml`. |

### Secrets — mobile build (`build-ios-ipa.yml`)

| Secret | Value |
|---|---|
| `IOS_CLIENT_ID` | OAuth 2.0 iOS client ID for Google Sign-In in the Expo app |
| `IOS_CERTIFICATE_P12_BASE64` | Base64-encoded `.p12` code-signing certificate |
| `IOS_CERTIFICATE_PASSWORD` | Password for the `.p12` certificate |
| `IOS_PROVISIONING_PROFILE_BASE64` | Base64-encoded mobile provisioning profile |
| `IOS_APPLE_TEAM_ID` | Apple Developer Team ID used for code signing |

`build-android-apk.yml` needs no Android-specific values beyond ones already listed above (`SUBDOMAIN`, `DOMAIN_NAME`, `GOOGLE_CLIENT_ID`, `ROLE_ARN`, `ASSETS_BUCKET_NAME` — all variables).

### Moving an existing environment from secrets to variables

1. Add every value in the variable tables above as an environment **variable**, with the same name and value as the old secret.
2. Merge the workflow change.
3. Once each workflow has run successfully in that environment, delete the old secrets of the same names. A secret and a variable with the same name don't conflict, because workflows read only `vars.*` for these.

At least one LLM API key must be set to enable LLM features.
