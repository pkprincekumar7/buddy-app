# Live Infrastructure — Current State

This guide covers the three Terraform modules and six GitHub Actions workflows (five component workflows plus one orchestrating workflow) that provision and deploy the **current** infrastructure for buddy360. For planned improvements, see [README_LIVE_PROPOSED.md](README_LIVE_PROPOSED.md).

---

## Architecture Overview

```
                              Users (global)
                                    │
                          ┌─────────▼──────────┐
                          │     Route 53        │
                          │      (DNS)          │
                          └─────────┬──────────┘
                                    │ HTTPS
                          ┌─────────▼──────────┐
                          │     CloudFront      │
                          │  + WAF WebACL       │
                          │  (us-east-1/global) │
                          └──────┬─────────┬───┘
                       /api/*    │         │   /*
                  ┌──────────────┘         └──────────────────────┐
                  │                                                 │
                  ▼                                                 ▼
        ┌───────────────────┐               ┌─────────────────────────┐
        │  ALB              │               │  S3 — frontend assets   │
        │  (ap-south-1)     │               │  (us-east-1)            │
        │  single CF origin │               │  OAC — no public access │
        └─────────┬─────────┘               └─────────────────────────┘
                  │ HTTPS/443
                  ▼

── Backend VPC layout (ap-south-1, Mumbai) ──

╔══════════════════╗
║   ap-south-1     ║
║  (Mumbai)        ║
╠══════════════════╣
║ VPC              ║
║  [public subnet] ║
║  ALB (HTTPS/443) ║
║  ECS Fargate     ║
║  (public IP/IGW) ║
║  [private subnet]║
║  Redis (in-VPC)  ║
╚══════════════════╝
         │ outbound via Internet Gateway
         ├──▶ ECR (ap-south-1)
         ├──▶ Secrets Manager (ap-south-1)
         │
         │ TLS
         ▼
┌────────────────────────────────────────────────────────┐
│           MongoDB Atlas — M0 Free Tier                 │
│              (single region · TLS)                     │
└────────────────────────────────────────────────────────┘
```

**TLS chain:**
```
Browser ──HTTPS──▶ CloudFront ──HTTPS──▶ ALB (443) ──HTTP/8000──▶ ECS task (public subnet · assign_public_ip=true) ──TLS──▶ MongoDB Atlas (M0)
         (us-east-1 ACM cert)  (ap-south-1 ACM cert)  within VPC    outbound via Internet Gateway
                                                       (TLS terminates at ALB; container receives plain HTTP within VPC)
```

**Region roles:**

| Layer | Region | Notes |
|---|---|---|
| CloudFront + WAF | `us-east-1` (global) | One distribution per environment; serves all users globally |
| S3 frontend assets | `us-east-1` | One bucket per environment; accessed via CloudFront OAC only |
| Backend infra | `ap-south-1` | Only active backend region; enforced by `variables.tf` validation |
| SSM Parameter Store | `us-east-1` (control plane) | All modules read/write SSM in `us-east-1`; SSM provider aliases are used regardless of where resources are deployed |

---

## Module Structure

| Module | Directory | Workflow | Manages |
|---|---|---|---|
| Backend | `infra-live-backend/` | `terraform-live-backend.yml` | VPC, security groups, ALB, ECS Fargate, ECR, ElastiCache Redis, Secrets Manager, CloudWatch Logs, IAM roles, internal DNS, SSM writes |
| Edge | `infra-live-edge/` | `terraform-live-edge.yml` | CloudFront, WAF, public DNS, OAC; publish CF details to SSM |
| Frontend | `infra-live-frontend/` | `terraform-live-frontend.yml` | S3 bucket policy (CloudFront OAC access only) |
| Backend deploy | — | `deploy-live-backend.yml` | Build + push Docker image; rolling ECS update |
| Frontend deploy | — | `deploy-live-frontend.yml` | Build React app; sync to S3; CloudFront invalidation |
| **Full stack** | — | **`terraform-live-all.yml`** | **Orchestrates the five component workflows in sequence (single trigger)** |

---

## SSM Parameter Store — Cross-Module Communication

All modules communicate via SSM Parameter Store in **`us-east-1`**. SSM provider aliases ensure all writes land there.

### Parameter map

```
Written by infra-live-backend:
  /{APP_NAME}/{env}/backend/ap-south-1/alb_internal_fqdn      — ALB FQDN (CloudFront /api/* origin)
  /{APP_NAME}/{env}/backend/ap-south-1/ecr_repository_url     — ECR push/pull URL
  /{APP_NAME}/{env}/backend/ap-south-1/ecs_cluster_name       — ECS cluster name
  /{APP_NAME}/{env}/backend/ap-south-1/ecs_service_name       — ECS service name

Written by infra-live-edge:
  /{APP_NAME}/{env}/edge/cloudfront_distribution_id           — CF dist ID (cache invalidation)
  /{APP_NAME}/{env}/edge/cloudfront_arn                       — CF ARN (S3 bucket policy)
  /{APP_NAME}/{env}/edge/s3_bucket_name                       — frontend bucket (deploy workflow)
  /{APP_NAME}/{env}/edge/app_url                              — public HTTPS URL
```

### Read dependencies

All paths below omit the `/{APP_NAME}/{env}` prefix. Full example: `/buddy360/dev/backend/ap-south-1/alb_internal_fqdn`.

```
infra-live-edge      reads: /backend/ap-south-1/alb_internal_fqdn
infra-live-frontend  reads: /edge/cloudfront_arn
deploy-live-backend  reads: /backend/ap-south-1/ecr_repository_url
                            /backend/ap-south-1/ecs_cluster_name
                            /backend/ap-south-1/ecs_service_name
deploy-live-frontend reads: /edge/s3_bucket_name
                            /edge/cloudfront_distribution_id
```

---

## Prerequisites

### AWS — must exist before first apply

| Resource | Convention | Region | Notes |
|---|---|---|---|
| S3 state bucket | any name | `us-east-1` | Holds all Terraform state; set as `STATE_BUCKET` secret |
| Frontend assets bucket | `person-frontend-{env}-bucket` | `us-east-1` | One per environment; name set in each module's tfvars |
| Backend app bucket | `person-backend-{env}-app-bucket` | `us-east-1` | One per environment; name set in backend tfvars |
| IAM role (OIDC) | any name | global | Trusted by GitHub Actions; ARN set as `ROLE_ARN` secret |
| ACM certificate | covers public subdomain | `us-east-1` | For CloudFront; set as `ACM_CERTIFICATE_ARN_US_EAST_1` |
| ACM certificate | covers internal subdomain | `ap-south-1` | For ALB HTTPS; set as `ACM_CERTIFICATE_ARN_AP_SOUTH_1` |
| Route 53 hosted zone | — | global | For your domain; ID set as `HOSTED_ZONE_ID` |

### GitHub Actions secrets

Environment secrets are configured in **GitHub → Settings → Environments** (one set per environment: `dev`, `stg`, `prod`). Repository secrets (`APP_NAME`, `STATE_BUCKET`) are set at the repository level under **GitHub → Settings → Secrets and variables → Actions**.

#### Repository secrets (shared across all environments)

| Secret | Description |
|---|---|
| `APP_NAME` | Application name used in resource naming and SSM paths (e.g. `buddy360`) |
| `STATE_BUCKET` | S3 bucket name holding all Terraform state files (`us-east-1`) |

#### Environment secrets (set per environment: dev / stg / prod)

| Secret | Used by | Description |
|---|---|---|
| `ROLE_ARN` | All workflows | IAM role ARN assumed via OIDC |
| `DOMAIN_NAME` | `terraform-live-backend`, `terraform-live-edge` | Root domain (e.g. `learning-dev.com`) |
| `SUBDOMAIN` | `terraform-live-edge` | Public subdomain prefix (e.g. `buddy`) |
| `SUBDOMAIN_INTERNAL` | `terraform-live-backend` | Internal ALB subdomain prefix (e.g. `buddy-internal-ap`) |
| `HOSTED_ZONE_ID` | `terraform-live-backend`, `terraform-live-edge` | Route 53 hosted zone ID |
| `ACM_CERTIFICATE_ARN_AP_SOUTH_1` | `terraform-live-backend` | ACM cert in `ap-south-1` covering the internal ALB subdomain |
| `ACM_CERTIFICATE_ARN_US_EAST_1` | `terraform-live-edge` | ACM cert in `us-east-1` for CloudFront (must be in `us-east-1`) |
| `VITE_API_URL` | `deploy-live-frontend` | Frontend env var: API base URL |
| `VITE_GOOGLE_CLIENT_ID` | `deploy-live-frontend` | Frontend env var: Google OAuth client ID |
| `JWT_SECRET` | `terraform-live-backend` | Injected into Secrets Manager (required) |
| `GOOGLE_CLIENT_ID` | `terraform-live-backend` | Injected into Secrets Manager (required) |
| `OPENAI_API_KEY` | `terraform-live-backend` | Injected into Secrets Manager (required) |
| `ANTHROPIC_API_KEY` | `terraform-live-backend` | Injected into Secrets Manager (optional — falls back to `REPLACE_ME` if not set) |
| `GEMINI_API_KEY` | `terraform-live-backend` | Injected into Secrets Manager (optional — falls back to `REPLACE_ME` if not set) |
| `OPENAI_MODEL` | `terraform-live-backend` | OpenAI model identifier passed as ECS env var (required; all envs default to `gpt-5.4-mini` in tfvars) |
| `ANTHROPIC_MODEL` | `terraform-live-backend` | Anthropic model identifier passed as ECS env var (optional — falls back to `claude-sonnet-4-6` in tfvars) |
| `GEMINI_MODEL` | `terraform-live-backend` | Gemini model identifier passed as ECS env var (optional — falls back to `gemini-1.5-pro` in tfvars) |
| `CORS_ORIGINS` | `terraform-live-backend` | Passed as `CORS_ORIGINS` env var to the ECS container (not a secret) |
| `COOKIE_DOMAIN` | `terraform-live-backend` | Passed as `COOKIE_DOMAIN` env var to the ECS container (not a secret) |
| `MONGODB_URI` | `terraform-live-backend` | MongoDB Atlas connection string; injected into Secrets Manager (required) |

---

## DNS and URL

### Public URLs (CloudFront — one per environment)

| Environment | URL |
|---|---|
| dev | `https://buddy-dev.learning-dev.com` |
| stg | `https://buddy-stg.learning-dev.com` |
| prod | `https://buddy.learning-dev.com` |

### Internal ALB FQDN (ap-south-1)

| Environment | ap-south-1 |
|---|---|
| dev | `buddy-internal-ap-dev.learning-dev.com` |
| stg | `buddy-internal-ap-stg.learning-dev.com` |
| prod | `buddy-internal-ap.learning-dev.com` |

---

## Infrastructure Creation (Apply) Order

Run workflows via **GitHub → Actions → workflow name → Run workflow**.

> **Shortcut:** `terraform-live-all` runs all five steps in a single trigger. Use individual workflows when you need to re-run or troubleshoot a specific step.

```
Step 1  terraform-live-backend  action=apply  aws_region=ap-south-1
        → VPC / ECS / ALB / Redis live
        → internal DNS record + SSM written
        → backend API not yet public — edge deployment needed next

Step 2  terraform-live-edge     action=apply  backend_region=ap-south-1
        → CloudFront + WAF + public DNS live
        → backend API accessible via Postman immediately ✓

Step 3  terraform-live-frontend action=apply
        → S3 bucket policy applied

Step 4  deploy-live-backend     aws_region=ap-south-1
        → Docker image pushed, ECS updated

Step 5  deploy-live-frontend
        → React build synced to S3, CloudFront cache invalidated
        → full app live ✓
```

### What each step creates

**Step 1 — infra-live-backend**

ECS tasks run in public subnets with `assign_public_ip = true`; outbound traffic (ECR pulls, MongoDB Atlas, LLM APIs) exits via Internet Gateway using the task's public IP. ElastiCache runs in private subnets with no internet access needed.

- **VPC**: 2 public subnets + 2 private subnets across 2 AZs in `ap-south-1`; Internet Gateway + public route table; private route table (no default route — ElastiCache has no internet access needed)
- **Security groups**: ALB SG accepts HTTPS (443) from CloudFront managed prefix list only (`com.amazonaws.global.cloudfront.origin-facing`); ECS task SG accepts port 8000 from ALB SG only; both SGs allow unrestricted egress
- **ALB** (HTTPS/443): CloudFront-only ingress via managed prefix list; TLS policy `ELBSecurityPolicy-TLS13-1-2-2021-06` (TLS 1.3 preferred, 1.2 minimum); ACM cert in `ap-south-1` covers internal ALB subdomain; target group health-checks on `GET /health` (HTTP 200, 30 s interval, 5 s timeout, 2 healthy / 3 unhealthy thresholds)
- **ECS Fargate**: cluster with Container Insights enabled; task definition runs on `awsvpc` network mode; health check `python -c "urllib.request.urlopen('http://127.0.0.1:8000/health')"` (30 s interval, 60 s start period); deployment circuit breaker enabled with automatic rollback; `ignore_changes = [task_definition, desired_count]` — Terraform does not manage image updates after initial apply; ⚠ `desired_count` is also ignored, so manually scaling the service to 0 (e.g. to save cost) will **not** be restored by a subsequent `terraform apply` — use `aws ecs update-service --cluster <cluster> --service <service> --desired-count <N>` to scale back up
- **ECS Exec**: enabled in `dev` and `stg` (scoped `ssmmessages:*` permissions on task role); disabled in `prod`
- **ECR**: private repository in `ap-south-1`; `scan_on_push = true`; AES256 encryption at rest; lifecycle policy — keep last 10 tagged images, expire untagged after 1 day
- **ElastiCache Redis 7.1**: single-node (`num_cache_clusters = 1`), no automatic failover, no Multi-AZ; at-rest encryption (AES256); in-transit TLS required (`transit_encryption_mode = "required"`); no auth token — connections are VPC-internal only so TLS alone is sufficient (acceptable for ephemeral rate-limit counters; revisit if persistent or sensitive data is ever cached); used for LLM rate-limit counters only (ephemeral, no persistence needed)
- **CloudWatch Logs**: log group `/ecs/{APP_NAME}/backend/{env}`, 30-day retention; Container Insights metrics also collected
- **Secrets Manager**: one JSON secret holding `JWT_SECRET`, `GOOGLE_CLIENT_ID`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `MONGODB_URI`; `recovery_window_in_days = 0` (hard-deleted immediately on destroy — ⚠ irreversible, ensure secrets are backed up before running `terraform destroy`); Terraform writes `REPLACE_ME` placeholder values on resource creation; the workflow auto-populates real values from GitHub secrets on the **first** apply only (when placeholders are detected) — subsequent applies skip the update, preserving any manually rotated values; `ignore_changes = [secret_string]` prevents Terraform itself from overwriting values
- **Backend S3 bucket** (pre-existing, `us-east-1`): ECS task role has `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket` on this bucket; passed to the container as `S3_BUCKET_NAME` env var; separate from the frontend assets bucket
- **IAM**: execution role — `AmazonECSTaskExecutionRolePolicy` + inline `secretsmanager:GetSecretValue`; task role — inline S3 policy on backend bucket + scoped `ssmmessages:*` for ECS Exec
- **Route 53 A record**: `{SUBDOMAIN_INTERNAL}-{env}.{DOMAIN_NAME}` → ALB (prod omits the `-{env}` suffix)
- Writes `alb_internal_fqdn`, `ecr_repository_url`, `ecs_cluster_name`, `ecs_service_name` to SSM under `/{APP_NAME}/{env}/backend/ap-south-1/`

**Step 2 — infra-live-edge**
- **WAF WebACL** (`us-east-1`, `scope = CLOUDFRONT`): 4 rules evaluated in priority order — Core Rule Set (OWASP Top 10, priority 10), Known Bad Inputs (priority 20), Amazon IP Reputation List (priority 30), rate limit 1 000 req / 5 min per IP — block action (priority 40); CloudWatch metrics + sampled requests enabled on all rules
- **CloudFront Origin Access Control (OAC)**: SigV4 signing (`always`) for S3 origin; S3 bucket policy in `infra-live-frontend` uses the distribution ARN written to SSM here to restrict access to this specific distribution only
- **CloudFront distribution**: IPv6 enabled; `default_root_object = index.html`; minimum TLS 1.2 (`TLSv1.2_2021`); ACM cert in `us-east-1` required
  - *S3 origin (default behaviour)*: cache policy `CachingOptimized`; CORS S3 origin request policy; **security response headers policy** applied (HSTS, CSP, X-Frame-Options etc.); GET/HEAD/OPTIONS only; compress enabled
  - */api/\* origin (ordered behaviour)*: single ALB origin pointing to `ap-south-1` ALB; cache policy `CachingDisabled`; `AllViewerExceptHostHeader` origin request policy; all HTTP methods; compress disabled
  - *SPA fallback*: CloudFront 403 and 404 responses mapped to `index.html` with HTTP 200 and `error_caching_min_ttl = 0` — supports React client-side routing
- **CloudFront price class**: `PriceClass_100` (US/EU edge locations) for `dev` and `stg`; `PriceClass_200` (US/EU/Asia/ME/Africa) for `prod`; set via `cloudfront_price_class` in tfvars
- **Route 53 A record**: `{SUBDOMAIN}-{env}.{DOMAIN_NAME}` → CloudFront (prod omits the `-{env}` suffix)
- Writes `cloudfront_distribution_id`, `cloudfront_arn`, `app_url`, `s3_bucket_name` to SSM under `/{APP_NAME}/{env}/edge/`

**Step 3 — infra-live-frontend**
- S3 bucket policy: grants CloudFront OAC (`cloudfront.amazonaws.com`) `s3:GetObject` scoped to the specific distribution ARN read from SSM; direct public access remains blocked
- Precondition guard: apply fails fast if `frontend_bucket_name` in tfvars does not match the value written to SSM by `infra-live-edge` — prevents silently applying the wrong bucket policy

---

## ECS Task Definition — What Each Workflow Changes

### During `terraform apply` (`terraform-live-backend`)

Terraform manages `aws_ecs_task_definition` as a normal resource with no `ignore_changes`. A **new task definition revision is registered** whenever any of the following change in tfvars or GitHub environment secrets:

| Category | Fields |
|---|---|
| Compute | CPU, memory |
| Plain env vars | `MONGODB_DB_NAME`, `OPENAI_MODEL`, `ANTHROPIC_MODEL`, `GEMINI_MODEL`, `COOKIE_SECURE`, `COOKIE_SAMESITE`, `BEHIND_PROXY`, `APP_ENV`, `REDIS_URL`, `LLM_TIMEOUT_SECONDS`, `LLM_HOURLY_LIMIT`, `DEFAULT_REGION`, `S3_BUCKET_NAME`, `CORS_ORIGINS`, `COOKIE_DOMAIN` |
| Secrets references | ARN pointers to Secrets Manager for `MONGODB_URI`, `JWT_SECRET`, `GOOGLE_CLIENT_ID`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` (pointers only — not the secret values themselves) |
| Infrastructure | Log group, health check command/intervals, execution role ARN, task role ARN, network mode |
| Image | Terraform always sets `:latest`; the deploy workflow overwrites this with `:<git-sha>` before activating any revision — so `:latest` never runs in practice after the first deploy |

> ⚠ The ECS **service** has `ignore_changes = [task_definition]`, so Terraform never updates the service to point to the new revision. The new revision is registered in AWS but sits idle until the next `deploy-live-backend` run.

### During `deploy-live-backend`

The deploy workflow fetches the **latest active revision** of the task definition family (so if `terraform apply` just registered a new revision with updated env vars, the deploy picks it up automatically). It then:

1. Strips all AWS-managed read-only fields from the current revision
2. **Patches only the `image` field** for the `backend` container — from whatever it currently is to `<ecr_url>:<git-sha>`
3. Registers this as a new revision
4. Updates the ECS service to that revision and performs a rolling deployment

All other fields — env vars, secrets references, CPU, memory, log config, health check, roles — are carried over from the revision it read and are not touched.

### Combined effect

| What changed | How to apply it |
|---|---|
| Application code | Run `deploy-live-backend` |
| Env var / model / config (tfvars or GitHub secrets) | Run `terraform apply`, then `deploy-live-backend` (apply registers the new revision; deploy activates it) |
| CPU / memory | Run `terraform apply`, then `deploy-live-backend` |
| Secret values (API keys, DB URI) | Update via `aws secretsmanager put-secret-value`; restart tasks (run `deploy-live-backend` or force-deploy) |

---

## Application Deployment

### Backend deploy — `deploy-live-backend`

1. Reads `ecr_repository_url`, `ecs_cluster_name`, `ecs_service_name` from SSM under `/{APP_NAME}/{env}/backend/ap-south-1/`
2. Builds Docker image tagged `:<git-sha>` and `:latest`; pushes to ECR
3. Registers a new task definition revision with the image pinned to `:<git-sha>`; updates the ECS service to that revision
4. Waits up to 15 minutes for service to reach steady state; ECS circuit breaker rolls back automatically on failure

### Frontend deploy — `deploy-live-frontend`

1. Reads `s3_bucket_name`, `cloudfront_distribution_id` from SSM under `/{APP_NAME}/{env}/edge/`
2. Builds React app with `VITE_API_URL` and `VITE_GOOGLE_CLIENT_ID`
3. Syncs hashed assets (`/assets/*`) with 1-year immutable cache
4. Syncs root files (`index.html`, etc.) with `no-cache` headers
5. Invalidates CloudFront cache (`/*`) and waits for completion

---

## Infrastructure Destruction (Destroy) Order

Destroy in **strict reverse**. Each module's SSM reads remain valid because the producing module is destroyed after the consuming module.

```
Step 1  terraform-live-frontend action=destroy  → S3 bucket policy removed
Step 2  terraform-live-edge     action=destroy  → CloudFront/WAF/DNS removed
                                                  /edge/* SSM params deleted
Step 3  terraform-live-backend  action=destroy  aws_region=ap-south-1
                                                → VPC/ECS/ALB/Redis removed
                                                  /backend/ap-south-1/* SSM params deleted
```

---

## Secrets Manager — App Secrets

Backend app secrets are auto-populated from GitHub environment secrets on the **first** `terraform-live-backend action=apply` only — when the secret still contains `REPLACE_ME` placeholder values written by Terraform on resource creation. Subsequent applies check the current secret value and skip the update if all required keys already contain real values, so manually rotated secrets are never overwritten by automation.

`recovery_window_in_days = 0` means the secret is **hard-deleted immediately** on `terraform destroy` — no 30-day window — allowing clean re-applies without naming conflicts. ⚠ This deletion is irreversible — ensure all secret values are backed up before running destroy.

The required keys (`JWT_SECRET`, `GOOGLE_CLIENT_ID`, `OPENAI_API_KEY`, `MONGODB_URI`) are validated before apply. The optional LLM keys (`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`) fall back to `REPLACE_ME` if not set — the app will start but those providers will be unavailable.

> **Note:** `CORS_ORIGINS` and `COOKIE_DOMAIN` are plain environment variables injected into the ECS task definition — they are **not** stored in Secrets Manager. To change them, update the `CORS_ORIGINS` / `COOKIE_DOMAIN` GitHub environment secrets and re-run `terraform-live-backend action=apply`.

To rotate or update a secret value (the only way after initial setup):

```bash
aws secretsmanager put-secret-value \
  --secret-id "{APP_NAME}/{env}/backend-secrets" \
  --region ap-south-1 \
  --secret-string '{
    "JWT_SECRET":         "...",
    "GOOGLE_CLIENT_ID":   "...",
    "OPENAI_API_KEY":     "sk-...",
    "ANTHROPIC_API_KEY":  "sk-ant-...",
    "GEMINI_API_KEY":     "AIza...",
    "MONGODB_URI":        "mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/"
  }'
```

Changes take effect on the next ECS task restart (run `deploy-live-backend` or trigger a force deployment).

---

## Terraform State Paths

All state files are stored in `STATE_BUCKET` (`us-east-1`):

```
terraform-state-files/{APP_NAME}/{env}/backend/ap-south-1/terraform.tfstate
terraform-state-files/{APP_NAME}/{env}/edge/us-east-1/terraform.tfstate
terraform-state-files/{APP_NAME}/{env}/frontend/us-east-1/terraform.tfstate
```

State locking uses native S3 locking (`use_lockfile = true`, Terraform 1.10+) — no DynamoDB table required.

---

## Active Region

| Region | Code | Role |
|---|---|---|
| Asia Pacific (Mumbai) | `ap-south-1` | Backend infra (VPC, ECS, ALB, Redis, ECR, Secrets Manager) |
| US East (N. Virginia) | `us-east-1` | Global infra (CloudFront, WAF, S3 frontend, SSM control plane, state bucket) |

---

## Cost Estimation

All estimates are in **USD/month**, based on **730 hours/month** (continuous 24/7 operation) and **`us-east-1` pricing** (cheapest baseline). `ap-south-1` costs approximately **10–15 % more** for compute and cache. MongoDB Atlas M0 (free tier) is used across all environments — no Atlas cost. GitHub Actions minutes are excluded.

### Resource configuration per environment

| Resource | Dev | Stg | Prod |
|---|---|---|---|
| ECS task CPU | 0.5 vCPU | 0.5 vCPU | 1 vCPU |
| ECS task memory | 1 GB | 1 GB | 2 GB |
| ECS desired count | 1 task | 1 task | 2 tasks |
| ElastiCache node | `cache.t3.small` | `cache.t3.small` | `cache.t3.medium` |
| LLM hourly limit | 50 req/h | 100 req/h | 200 req/h |
| LLM timeout | 60 s | 60 s | 90 s |
| ECS Exec enabled | yes | yes | no |
| MongoDB Atlas cluster | M0 free tier | M0 free tier | M0 free tier |

### Monthly cost breakdown — backend stack (ap-south-1)

| Service | Dev | Stg | Prod |
|---|---|---|---|
| **ECS Fargate** | $9 | $18 | $72 |
| **Application Load Balancer** | $7 | $8 | $12 |
| **ElastiCache Redis** (single node) | $12 | $25 | $50 |
| **ECR** (~1–2 GB image storage) | $1 | $1 | $1 |
| **Secrets Manager** (1 secret) | $1 | $1 | $1 |
| **CloudWatch Logs** (30-day retention) | $1 | $2 | $5 |
| **CloudWatch Container Insights metrics** | ~$1 | ~$2 | ~$4 |
| **Backend subtotal** | **~$32** | **~$57** | **~$145** |

> ECS Fargate rates: $0.04048/vCPU/hour · $0.004445/GB/hour (us-east-1 baseline; ap-south-1 ~10–15 % higher).
> ElastiCache rates: t3.micro $0.017/h · t3.small $0.034/h · t3.medium $0.068/h.
> ALB: $0.008/hour fixed + LCU charges (estimated at ~1–3 LCU for dev/stg, ~5 LCU for prod).
> Container Insights: `containerInsights = "enabled"` generates custom CloudWatch metrics at $0.30/metric/month after the first 10 free. Estimated ~5 metrics for dev/stg · ~12 for prod.

### Monthly cost breakdown — global stack (us-east-1, once per environment)

Traffic assumptions: dev ~500 K req/month · stg ~2 M req/month · prod ~20 M req/month.

| Service | Dev | Stg | Prod |
|---|---|---|---|
| **CloudFront** (requests + data transfer) | $1 | $3 | $24 |
| **WAF WebACL** (3 managed rule groups + 1 rate rule) | $9 | $10 | $21 |
| **S3** (storage + requests, pre-existing buckets) | $1 | $1 | $2 |
| **Route 53** (DNS queries, proportional share) | $1 | $1 | $1 |
| **SSM Parameter Store** (Standard tier, free) | $0 | $0 | $0 |
| **Global subtotal** | **~$12** | **~$15** | **~$48** |

> WAF: $5/month WebACL + $1/month per rule + $0.60/million requests.
> CloudFront: $0.0085/10 K HTTPS requests + $0.085/GB data transfer out (first 10 TB).

> MongoDB Atlas M0 is free — no monthly cost for any environment.

### Environment totals

| Environment | Backend | Global | **Monthly total** | **Annual total** |
|---|---|---|---|---|
| **Dev** | ~$32 | ~$12 | **~$44 / month** | **~$528 / year** |
| **Stg** | ~$57 | ~$15 | **~$72 / month** | **~$864 / year** |
| **Prod** | ~$145 | ~$48 | **~$193 / month** | **~$2 316 / year** |

### Cost optimisation tips

| Action | Saving | Applicable to |
|---|---|---|
| Stop dev/stg ECS service outside business hours (`desired_count = 0`) | up to 65 % of ECS cost | dev, stg |
| Use `cache.t3.micro` for stg instead of t3.small | ~$13/month | stg |
| Enable CloudFront caching for `/api/*` responses where safe | reduces ALB LCU + ECS load | all |
| Use CloudFront Price Class 100 (US/EU only) instead of PriceClass_200 | ~10–15 % of CF cost | prod (dev/stg already use PriceClass_100; set `cloudfront_price_class` in prod.tfvars) |
| Reduce CloudWatch log retention from 30 to 7 days in dev | ~$0.50/month | dev |
