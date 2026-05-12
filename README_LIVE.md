# Live Infrastructure — Deployment Guide

This guide covers the three Terraform modules and five GitHub Actions workflows that provision and deploy the production-grade infrastructure for buddy360.

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
        │  CloudFront Fn    │               │  S3 — frontend assets   │
        │  JWT auth at edge │               │  (us-east-1)            │
        │  (viewer request) │               │  OAC — no public access │
        │  (proposed)       │               └─────────────────────────┘
        └─────────┬─────────┘
                  │ 401 on invalid token · passes valid requests to
                  ▼
        ┌───────────────────┐
        │   Lambda@Edge     │
        │  origin routing   │
        │   (viewer geo)    │
        │   (proposed)      │
        └─────────┬─────────┘
                  │ HTTPS/443 to
                  │ nearest region's ALB
                  ▼

── CURRENT backend VPC layout (ap-south-1 active; eu-west-1 / us-east-1 planned) ──

╔══════════════════╦══════════════════╦══════════════════╗
║   ap-south-1     ║   eu-west-1      ║   us-east-1      ║
║  (Mumbai) ACTIVE ║  (Ireland)planned║  (N.Virginia)    ║
║                  ║                  ║  planned         ║
╠══════════════════╬══════════════════╬══════════════════╣
║ VPC              ║ VPC              ║ VPC              ║
║  [public subnet] ║  [public subnet] ║  [public subnet] ║
║  ALB (HTTPS/443) ║  ALB (HTTPS/443) ║  ALB (HTTPS/443) ║
║  ECS Fargate     ║  ECS Fargate     ║  ECS Fargate     ║
║  (public IP/IGW) ║  (public IP/IGW) ║  (public IP/IGW) ║
║  [private subnet]║  [private subnet]║  [private subnet]║
║  Redis (in-VPC)  ║  Redis (in-VPC)  ║  Redis (in-VPC)  ║
║  ECR             ║  ECR             ║  ECR             ║
║  Secrets Manager ║  Secrets Manager ║  Secrets Manager ║
╚══════════════════╩══════════════════╩══════════════════╝

── PROPOSED backend VPC layout (after NAT Gateway + private-subnet ECS) ──

╔══════════════════╦══════════════════╦══════════════════╗
║   ap-south-1     ║   eu-west-1      ║   us-east-1      ║
║  (Mumbai)        ║  (Ireland)       ║  (N. Virginia)   ║
╠══════════════════╬══════════════════╬══════════════════╣
║ VPC              ║ VPC              ║ VPC              ║
║  [public subnet] ║  [public subnet] ║  [public subnet] ║
║  ALB (HTTPS/443) ║  ALB (HTTPS/443) ║  ALB (HTTPS/443) ║
║  NAT Gateway     ║  NAT Gateway     ║  NAT Gateway     ║
║  [private subnet]║  [private subnet]║  [private subnet]║
║  ECS Fargate     ║  ECS Fargate     ║  ECS Fargate     ║
║  Redis (in-VPC)  ║  Redis (in-VPC)  ║  Redis (in-VPC)  ║
║  ECR             ║  ECR             ║  ECR             ║
║  Secrets Manager ║  Secrets Manager ║  Secrets Manager ║
╚══════════════════╩══════════════════╩══════════════════╝
         │                  │                  │
         │ TLS              │ TLS              │ TLS
         ▼                  ▼                  ▼
┌────────────────────────────────────────────────────────┐
│             MongoDB Atlas — Global Cluster             │
│          (sharded by `location` field · TLS)           │
├──────────────────┬──────────────────┬──────────────────┤
│   Zone: APAC     │    Zone: EU      │  Zone: Americas  │
│  (ap-south-1)    │  (eu-west-1)     │  (us-east-1)     │
│  location=APAC   │  location=EU     │  location=AMER   │
├──────────────────┴──────────────────┴──────────────────┤
│         cross-zone replication (Atlas managed)         │
└────────────────────────────────────────────────────────┘
```

**TLS chain — current:**
```
Browser ──HTTPS──▶ CloudFront ──HTTPS──▶ ALB (443) ──HTTP/8000──▶ ECS task (public subnet · assign_public_ip=true)
         (us-east-1 ACM cert)  (region ACM cert)       within VPC    outbound via Internet Gateway
```

**TLS chain — proposed (with CF Function + NAT Gateway):**
```
Browser ──HTTPS──▶ CloudFront ──[CF Fn: JWT auth]──▶ [L@E: geo-route] ──HTTPS──▶ ALB (443) ──HTTP/8000──▶ ECS task
         (us-east-1 ACM cert)   viewer request         origin request    (region ACM cert)      (private subnet · NAT egress)
                                (proposed)             (proposed)
```

**Region roles:**

| Layer | Region | Notes |
|---|---|---|
| CloudFront + WAF | `us-east-1` (global) | One distribution per environment; serves all regions |
| Lambda@Edge | `us-east-1` (deployed; runs at all CF edge nodes) | Proposed: geo-based origin routing on every `/api/*` request; selects nearest backend region's ALB via `CloudFront-Viewer-Country` header |
| CloudFront Function | `us-east-1` (deployed; runs at all CF edge nodes) | Proposed: JWT validation (HS256) on every `/api/*` viewer request; reads signing key from CloudFront KeyValueStore (KVS); returns `401` immediately for missing or invalid tokens before the request reaches Lambda@Edge or any backend ALB |
| S3 frontend assets | `us-east-1` | One bucket per environment; accessed via CloudFront OAC |
| Backend infra | `ap-south-1` (active) · `eu-west-1` / `us-east-1` (planned) | Only `ap-south-1` is currently active; `variables.tf` validation enforces this. Multi-region requires removing/relaxing that validation and provisioning ACM certs per the expansion checklist |
| SSM Parameter Store | `us-east-1` (control plane) | All modules read/write SSM here regardless of backend region |

---

## Module Structure

| Module | Directory | Workflow | Manages |
|---|---|---|---|
| Backend | `infra-live-backend/` | `terraform-live-backend.yml` | VPC, security groups, ALB, ECS Fargate, ECR, ElastiCache Redis, Secrets Manager, CloudWatch Logs, IAM roles, internal DNS, SSM writes |
| Edge | `infra-live-edge/` | `terraform-live-edge.yml` | CloudFront, WAF, public DNS, OAC; Lambda@Edge origin routing (proposed); CloudFront Function + KeyValueStore for JWT auth at edge (proposed); publish CF details to SSM |
| Frontend | `infra-live-frontend/` | `terraform-live-frontend.yml` | S3 bucket policy (CloudFront OAC access only) |
| Backend deploy | — | `deploy-live-backend.yml` | Build + push Docker image; rolling ECS update |
| Frontend deploy | — | `deploy-live-frontend.yml` | Build React app; sync to S3; CloudFront invalidation |
| **Full stack** | — | **`terraform-live-all.yml`** | **Orchestrates all five workflows in sequence (single trigger)** |

---

## SSM Parameter Store — Cross-Module Communication

All modules communicate via SSM Parameter Store hosted in **`us-east-1`** (the control-plane region). This is fixed regardless of which region the backend is deployed to — SSM provider aliases ensure all writes land in `us-east-1`.

### Parameter map

```
Written by infra-live-backend (per region):
  /{APP_NAME}/{env}/backend/{region}/alb_internal_fqdn      — ALB FQDN (CloudFront /api/* origin)
  /{APP_NAME}/{env}/backend/{region}/ecr_repository_url     — ECR push/pull URL
  /{APP_NAME}/{env}/backend/{region}/ecs_cluster_name       — ECS cluster name
  /{APP_NAME}/{env}/backend/{region}/ecs_service_name       — ECS service name

Written by infra-live-edge:
  /{APP_NAME}/{env}/edge/cloudfront_distribution_id         — CF dist ID (cache invalidation)
  /{APP_NAME}/{env}/edge/cloudfront_arn                     — CF ARN (S3 bucket policy)
  /{APP_NAME}/{env}/edge/s3_bucket_name                     — frontend bucket (deploy workflow)
  /{APP_NAME}/{env}/edge/app_url                            — public HTTPS URL
```

### Read dependencies

```
infra-live-edge      reads: /backend/{region}/alb_internal_fqdn  (single backend_region; Lambda@Edge proposed will read all deployed regions)
infra-live-frontend  reads: /edge/cloudfront_arn
deploy-live-backend  reads: /backend/{region}/ecr_repository_url
                            /backend/{region}/ecs_cluster_name
                            /backend/{region}/ecs_service_name
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
| Backend app bucket | `person-backend-{env}-app-bucket` | `us-east-1` | One per environment; shared across backend regions; name set in backend tfvars |
| IAM role (OIDC) | any name | global | Trusted by GitHub Actions; ARN set as `ROLE_ARN` secret |
| ACM certificate | covers public subdomain | `us-east-1` | For CloudFront; set as `ACM_CERTIFICATE_ARN_US_EAST_1` |
| ACM certificate | covers internal subdomain | `ap-south-1` | For ALB HTTPS; set as `ACM_CERTIFICATE_ARN_AP_SOUTH_1` |
| ACM certificate | covers internal subdomain | `eu-west-1` | For ALB HTTPS when deploying EU backend region; set as `ACM_CERTIFICATE_ARN_EU_WEST_1` |
| ACM certificate | covers internal subdomain | `us-east-1` | For ALB HTTPS when deploying US backend region; can reuse the CloudFront wildcard cert if it covers the internal subdomain |
| Route 53 hosted zone | — | global | For your domain; ID set as `HOSTED_ZONE_ID` |

### GitHub Actions secrets

Configure in **GitHub → Settings → Environments** (one set per environment: `dev`, `stg`, `prod`).

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
| `ACM_CERTIFICATE_ARN_EU_WEST_1` | `terraform-live-backend` | ACM cert in `eu-west-1` covering the internal ALB subdomain (required when deploying EU backend region) |
| `ACM_CERTIFICATE_ARN_US_EAST_1` | `terraform-live-edge`, `terraform-live-backend` | ACM cert in `us-east-1` for CloudFront (must be in `us-east-1`); can be reused for the US backend ALB if it covers the internal subdomain |
| `VITE_API_URL` | `deploy-live-frontend` | Frontend env var: API base URL |
| `VITE_GOOGLE_CLIENT_ID` | `deploy-live-frontend` | Frontend env var: Google OAuth client ID |
| `JWT_SECRET` | `terraform-live-backend` | Injected into Secrets Manager |
| `GOOGLE_CLIENT_ID` | `terraform-live-backend` | Injected into Secrets Manager |
| `OPENAI_API_KEY` | `terraform-live-backend` | Injected into Secrets Manager (required) |
| `ANTHROPIC_API_KEY` | `terraform-live-backend` | Injected into Secrets Manager (optional — falls back to `REPLACE_ME` if not set) |
| `GEMINI_API_KEY` | `terraform-live-backend` | Injected into Secrets Manager (optional — falls back to `REPLACE_ME` if not set) |
| `OPENAI_MODEL` | `terraform-live-backend` | OpenAI model identifier passed as ECS env var (required; all envs default to `gpt-5.4-mini` in tfvars) |
| `ANTHROPIC_MODEL` | `terraform-live-backend` | Anthropic model identifier passed as ECS env var (optional — falls back to tfvars default) |
| `GEMINI_MODEL` | `terraform-live-backend` | Gemini model identifier passed as ECS env var (optional — falls back to tfvars default) |
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

### Internal ALB FQDNs (one per environment per region)

| Environment | ap-south-1 | eu-west-1 | us-east-1 |
|---|---|---|---|
| dev | `buddy-internal-ap-dev.learning-dev.com` | `buddy-internal-eu-dev.learning-dev.com` | `buddy-internal-us-dev.learning-dev.com` |
| stg | `buddy-internal-ap-stg.learning-dev.com` | `buddy-internal-eu-stg.learning-dev.com` | `buddy-internal-us-stg.learning-dev.com` |
| prod | `buddy-internal-ap.learning-dev.com` | `buddy-internal-eu.learning-dev.com` | `buddy-internal-us.learning-dev.com` |

> `SUBDOMAIN_INTERNAL` is a per-environment GitHub secret that must be updated to the region-appropriate prefix **before each regional backend deployment run** (e.g. `buddy-internal-ap` for ap-south-1, `buddy-internal-eu` for eu-west-1, `buddy-internal-us` for us-east-1). Update this secret and then run `terraform-live-backend` for each new region.

---

## Infrastructure Creation (Apply) Order

Run workflows via **GitHub → Actions → workflow name → Run workflow**.

> **Shortcut:** `terraform-live-all` runs all five steps in a single trigger. Use individual workflows when you need to re-run or troubleshoot a specific step.

```
Step 1  terraform-live-backend  action=apply  aws_region={backend-region}
        → VPC / ECS / ALB / Redis live in chosen region
        → internal DNS record + SSM written
        → backend API reachable once edge is deployed ✓

Step 2  terraform-live-edge     action=apply  backend_region={backend-region}
        → CloudFront + WAF + public DNS live (single ALB origin = backend_region)
        → backend API accessible via Postman immediately ✓
        (Lambda@Edge multi-region routing and CloudFront Function JWT auth are proposed — not deployed yet)

Step 3  terraform-live-frontend action=apply
        → S3 bucket policy applied

Step 4  deploy-live-backend     aws_region={backend-region}
        → Docker image pushed, ECS updated

Step 5  deploy-live-frontend
        → React build synced to S3, CloudFront cache invalidated
        → full app live ✓
```

### Multi-region backend deployment

Deploy steps 1 and 4 independently per region. Steps 2, 3, and 5 are global (run once). To add a second region after initial deploy:

**Prerequisites for the new region:**
- ACM certificate created in the target region (e.g. `eu-west-1`) and ARN stored as `ACM_CERTIFICATE_ARN_EU_WEST_1`
- `SUBDOMAIN_INTERNAL` secret updated to the region-appropriate prefix (e.g. `buddy-internal-eu`) before running the backend workflow
- `terraform-live-backend.yml` workflow updated to include the new region in the `aws_region` choice list

```
1. terraform-live-backend → apply  (aws_region=eu-west-1)
   — writes /backend/eu-west-1/* to SSM

2. deploy-live-backend     → run    (aws_region=eu-west-1)
   — pushes image and updates ECS in the new region
```

**Updating routing after adding a region:**
- *With Lambda@Edge routing (proposed)*: re-apply `terraform-live-edge` — the Lambda@Edge function is redeployed with the new region's ALB FQDN added to the routing table.
- *Without Lambda@Edge*: re-apply `terraform-live-edge` (backend_region=eu-west-1) to switch the single CloudFront `/api/*` origin to the new region's ALB.

### What each step creates

**Step 1 — infra-live-backend**

*VPC layout — current:* public subnets (ALB + ECS tasks, `assign_public_ip = true`) + private subnets (ElastiCache only); ECS tasks reach ECR, MongoDB Atlas, and LLM APIs directly via Internet Gateway using their public IPs. *Proposed change:* move ECS to private subnets and add NAT Gateway in public subnets (see NAT Gateway and S3 Gateway Endpoint bullets below).

- **VPC**: 2 public subnets + 2 private subnets across 2 AZs; Internet Gateway + public route table; private route table (no default route — ElastiCache has no internet access needed)
- **Security groups**: ALB SG accepts HTTPS (443) from CloudFront managed prefix list only (`com.amazonaws.global.cloudfront.origin-facing`); ECS task SG accepts port 8000 from ALB SG only; both SGs allow unrestricted egress
- **ALB** (HTTPS/443): CloudFront-only ingress via managed prefix list; TLS policy `ELBSecurityPolicy-TLS13-1-2-2021-06` (TLS 1.3 preferred, 1.2 minimum); ACM cert per region covers internal ALB subdomain; target group health-checks on `GET /health` (HTTP 200, 30 s interval, 5 s timeout, 2 healthy / 3 unhealthy thresholds)
- **ECS Fargate**: cluster with Container Insights enabled; task definition runs on `awsvpc` network mode; health check `python -c "urllib.request.urlopen('http://127.0.0.1:8000/health')"` (30 s interval, 60 s start period); deployment circuit breaker enabled with automatic rollback; `ignore_changes = [task_definition, desired_count]` — Terraform does not manage image updates after initial apply
- **ECS Exec**: enabled in `dev` and `stg` (scoped `ssmmessages:*` permissions on task role); disabled in `prod`
- **ECR**: private repository; `scan_on_push = true`; AES256 encryption at rest; lifecycle policy — keep last 10 tagged images, expire untagged after 1 day
- **NAT Gateway (proposed)**: one per public subnet / AZ; provides outbound internet access for ECS tasks in private subnets (ECR image pulls, MongoDB Atlas, external LLM APIs, Secrets Manager); `dev`/`stg` use 1 NAT GW (single-AZ); `prod` uses 2 NAT GWs (one per AZ for HA)
  > ⚠ **Breaking change on adoption:** ECS tasks currently reach MongoDB Atlas using their public IP addresses (assigned via `assign_public_ip = true`). Moving ECS to private subnets changes the outbound IP to the NAT Gateway's Elastic IP. **Update MongoDB Atlas IP Access List to the NAT GW EIP(s) before cut-over** — failing to do so will cause all database connections to be refused immediately after the change. `dev`/`stg` single-AZ NAT GW is a single point of failure; if the NAT GW becomes unavailable, ECS tasks lose all outbound access (MongoDB, LLM APIs, ECR pulls).
- **S3 Gateway Endpoint (proposed)**: free VPC endpoint (`aws_vpc_endpoint`, type `Gateway`) attached to the private route table; routes all S3 traffic — including ECR layer downloads, which are stored in S3 — directly over the AWS backbone without traversing the NAT Gateway; eliminates NAT data-processing charges for S3 traffic; no hourly cost
- **ElastiCache Redis 7.1**: single-node (`num_cache_clusters = 1`), no automatic failover, no Multi-AZ; at-rest encryption (AES256); in-transit TLS required (`transit_encryption_mode = "required"`); no auth token — connections are VPC-internal only so TLS alone is sufficient; used for LLM rate-limit counters only (ephemeral, no persistence needed)
- **CloudWatch Logs**: log group `/ecs/{app}/backend/{env}`, 30-day retention; Container Insights metrics also collected
- **Secrets Manager**: one JSON secret per region/env holding `JWT_SECRET`, `GOOGLE_CLIENT_ID`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `MONGODB_URI`; `recovery_window_in_days = 0` (hard-deleted immediately on destroy); placeholder values written at apply time, populated via CLI before first deploy; `ignore_changes = [secret_string]` prevents Terraform from overwriting CLI-updated values
- **Backend S3 bucket** (pre-existing, `us-east-1`): ECS task role has `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket` on this bucket; passed to the container as `S3_BUCKET_NAME` env var for runtime app use; separate from the frontend assets bucket
- **IAM**: execution role — `AmazonECSTaskExecutionRolePolicy` + inline `secretsmanager:GetSecretValue`; task role — inline S3 policy on backend bucket + scoped `ssmmessages:*` for ECS Exec
- **Route 53 A record**: `{SUBDOMAIN_INTERNAL}-{env}.{DOMAIN_NAME}` → ALB (prod omits the `-{env}` suffix)
- **DNS pattern**: prod = `buddy-internal.learning-dev.com`; non-prod = `buddy-internal-{env}.learning-dev.com`
- Writes `alb_internal_fqdn`, `ecr_repository_url`, `ecs_cluster_name`, `ecs_service_name` to SSM under `/{APP}/{env}/backend/{region}/` — ALB FQDN is read by `infra-live-edge` to set the CloudFront `/api/*` origin

**Step 2 — infra-live-edge**
- **WAF WebACL** (`us-east-1`, `scope = CLOUDFRONT`): 4 rules evaluated in priority order — Core Rule Set (OWASP Top 10, priority 10), Known Bad Inputs (priority 20), Amazon IP Reputation List (priority 30), rate limit 1 000 req / 5 min per IP — block action (priority 40); CloudWatch metrics + sampled requests enabled on all rules
- **CloudFront Origin Access Control (OAC)**: SigV4 signing (`always`) for S3 origin; S3 bucket policy in `infra-live-frontend` uses the distribution ARN written to SSM here to restrict access to this specific distribution only
- **CloudFront distribution**: IPv6 enabled; `default_root_object = index.html`; minimum TLS 1.2 (`TLSv1.2_2021`); ACM cert in `us-east-1` required
  - *S3 origin (default behaviour)*: cache policy `CachingOptimized`; CORS S3 origin request policy; **security response headers policy** applied (HSTS, CSP, X-Frame-Options etc.); GET/HEAD/OPTIONS only; compress enabled
  - */api/\* origin (ordered behaviour)*: single ALB origin for the region specified by `backend_region` variable (currently `ap-south-1` only); cache policy `CachingDisabled`; `AllViewerExceptHostHeader` origin request policy; all HTTP methods; compress disabled
  - *SPA fallback*: CloudFront 403 and 404 responses mapped to `index.html` with HTTP 200 and `error_caching_min_ttl = 0` — supports React client-side routing
- **CloudFront price class**: `PriceClass_100` (US/EU edge locations) for `dev` and `stg`; `PriceClass_200` (US/EU/Asia/ME/Africa) for `prod`; set via `cloudfront_price_class` in tfvars
- **Route 53 A record**: `{SUBDOMAIN}-{env}.{DOMAIN_NAME}` → CloudFront (prod omits the `-{env}` suffix)
- **Lambda@Edge function (proposed)**: Origin Request handler deployed to `us-east-1`; reads each deployed region's ALB FQDN from SSM at apply time and bakes a geo-routing table keyed by `CloudFront-Viewer-Country` header; cannot access VPC or SSM at request time
  > ⚠ **No health-based failover:** the routing table is static — if a regional ALB becomes unhealthy or unreachable, Lambda@Edge continues routing traffic to it until a new deploy bakes an updated table. To mitigate, add a fallback entry to the routing table so unknown or failed-region countries fall through to the primary (`ap-south-1`) ALB. **Cold starts** occur after ~15 min of idle at a given edge PoP and add 200–500 ms latency on the first request; document this in your latency SLAs and consider a synthetic warm-up ping if P99 is business-critical.
- **CloudFront Function (proposed)**: Viewer Request handler attached to the `/api/*` behaviour; validates JWT (HS256) against the signing key stored in CloudFront KeyValueStore (KVS); returns `401` immediately for missing or invalid tokens, eliminating unauthenticated load on Lambda@Edge, ALB, and ECS; adds ≤ 1 ms latency; KVS key rotation requires a single `aws cloudfront-keyvaluestore put-key` call with no distribution re-deploy
  > ⚠ **Three requirements before enabling in production:**
  > 1. **Validate the `exp` claim** — signature-only validation accepts expired tokens indefinitely; the function must reject any token where `exp < current_unix_time`.
  > 2. **Dual-key rotation strategy** — CloudFront edge nodes cache the KVS value independently; writing a new key instantly breaks tokens signed with the old key at edge nodes that haven't refreshed yet. Store both `key_current` and `key_previous` in KVS and accept tokens valid under either; retire `key_previous` after a safe propagation window (~60 s).
  > 3. **Exempt public endpoints** — `/api/health`, `/api/auth/login`, and `/api/auth/register` must bypass JWT validation (path-prefix check before signature verification); blocking them causes health-check failures and prevents unauthenticated users from logging in.
- **CloudFront KeyValueStore (proposed)**: holds the JWT signing key read by the CloudFront Function at request time; flat $0.50/month; first 10 M reads/month are free
- Writes `cloudfront_distribution_id`, `cloudfront_arn`, `app_url`, `s3_bucket_name` to SSM under `/{APP}/{env}/edge/`

**Step 3 — infra-live-frontend**
- S3 bucket policy: grants CloudFront OAC (`cloudfront.amazonaws.com`) `s3:GetObject` scoped to the specific distribution ARN read from SSM; direct public access remains blocked
- Precondition guard: apply fails fast if `frontend_bucket_name` in tfvars does not match the value written to SSM by `infra-live-edge` — prevents silently applying the wrong bucket policy

---

## Infrastructure Destruction (Destroy) Order

Destroy in **strict reverse**. Each module's SSM reads remain valid because the producing module is destroyed after the consuming module.

```
Step 1  terraform-live-frontend action=destroy  → S3 bucket policy removed
Step 2  terraform-live-edge     action=destroy  → CloudFront/WAF/DNS removed
                                                  /edge/* SSM params deleted
Step 3  terraform-live-backend  action=destroy  aws_region={region}
                                                → VPC/ECS/ALB/Redis removed
                                                  /backend/{region}/* SSM params deleted
```

Repeat step 3 for each deployed backend region before destroying edge.

---

## Application Deployment

### Backend deploy — `deploy-live-backend`

1. Reads `ecr_repository_url`, `ecs_cluster_name`, `ecs_service_name` from SSM under `/{APP}/{env}/backend/{region}/`
2. Builds Docker image tagged `:<git-sha>` and `:latest`; pushes to ECR
3. Registers a new task definition revision with the image pinned to `:<git-sha>`; updates the ECS service to that revision
4. Waits up to 15 minutes for service to reach steady state; ECS circuit breaker rolls back automatically on failure

### Frontend deploy — `deploy-live-frontend`

1. Reads `s3_bucket_name`, `cloudfront_distribution_id` from SSM under `/{APP}/{env}/edge/`
2. Builds React app with `VITE_API_URL` and `VITE_GOOGLE_CLIENT_ID`
3. Syncs hashed assets (`/assets/*`) with 1-year immutable cache
4. Syncs root files (`index.html`, etc.) with `no-cache` headers
5. Invalidates CloudFront cache (`/*`) and waits for completion

---

## Secrets Manager — App Secrets

Backend app secrets are populated from GitHub environment secrets on every `terraform-live-backend action=apply`. `recovery_window_in_days = 0` means the secret is **hard-deleted immediately** on `terraform destroy` — no 30-day window — allowing clean re-applies without naming conflicts.

The required keys (`JWT_SECRET`, `GOOGLE_CLIENT_ID`, `OPENAI_API_KEY`, `MONGODB_URI`) are validated before apply. The optional LLM keys (`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`) fall back to `REPLACE_ME` if not set — the app will start but those providers will be unavailable.

> **Note:** `CORS_ORIGINS` and `COOKIE_DOMAIN` are plain environment variables injected into the ECS task definition — they are **not** stored in Secrets Manager. To change them, update the `CORS_ORIGINS` / `COOKIE_DOMAIN` GitHub environment secrets and re-run `terraform-live-backend action=apply`.

To update a secret without a full Terraform re-apply:

```bash
aws secretsmanager put-secret-value \
  --secret-id "buddy360/{env}/backend-secrets" \
  --region {backend-region} \
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
terraform-state-files/{APP_NAME}/{env}/backend/{region}/terraform.tfstate
terraform-state-files/{APP_NAME}/{env}/edge/{region}/terraform.tfstate
terraform-state-files/{APP_NAME}/{env}/frontend/{region}/terraform.tfstate
```

Each backend region has its own state file. Edge and frontend state files use `us-east-1` as the region component.

State locking uses native S3 locking (`use_lockfile = true`, Terraform 1.10+) — no DynamoDB table required.

---

## Supported Regions

| Region | Code | Status | Primary use |
|---|---|---|---|
| Asia Pacific (Mumbai) | `ap-south-1` | **Active** | Default backend region; only region currently enforced by `variables.tf` validation |
| Europe (Ireland) | `eu-west-1` | Planned | EU backend region; requires ACM cert + validation relaxation before deploying |
| US East (N. Virginia) | `us-east-1` | Planned (global infra active) | Planned as US backend region; already hosts CloudFront, WAF, S3 frontend, ACM cert for CloudFront |

---

## Cost Estimation

All estimates are in **USD/month**, based on **730 hours/month** (continuous 24/7 operation) and **`us-east-1` pricing** (cheapest baseline). `ap-south-1` and `eu-west-1` cost approximately **10–15 % more** for compute and cache. MongoDB Atlas is included for `stg` and `prod`; `dev` uses a single-region shared/free-tier cluster and is excluded. GitHub Actions minutes are excluded.

### Resource configuration per environment

| Resource | Dev | Stg | Prod |
|---|---|---|---|
| ECS task CPU | 0.25 vCPU | 0.5 vCPU | 1 vCPU |
| ECS task memory | 512 MB | 1 GB | 2 GB |
| ECS desired count | 1 task | 1 task | 2 tasks |
| ElastiCache node | `cache.t3.micro` | `cache.t3.small` | `cache.t3.medium` |
| LLM hourly limit | 50 req/h | 100 req/h | 200 req/h |
| LLM timeout | 60 s | 60 s | 90 s |
| ECS Exec enabled | yes | yes | no |
| NAT Gateway (proposed) | 1 (single-AZ) | 1 (single-AZ) | 2 (multi-AZ HA) |
| S3 Gateway Endpoint (proposed) | 1 per VPC (free) | 1 per VPC (free) | 1 per VPC (free) |
| CloudFront Function (proposed) | JWT auth on `/api/*` | JWT auth on `/api/*` | JWT auth on `/api/*` |
| MongoDB Atlas cluster | excluded (dev) | M30 Global (3 zones) | M40 Global (3 zones) |

### Monthly cost breakdown — backend stack (per region)

These resources are created once per backend region. Each additional region deployed adds the same cost again.

| Service | Dev | Stg | Prod |
|---|---|---|---|
| **ECS Fargate** | $9 | $18 | $72 |
| **Application Load Balancer** | $7 | $8 | $12 |
| **ElastiCache Redis** (single node) | $12 | $25 | $50 |
| **NAT Gateway — hourly** (proposed) | $33 | $33 | $66 |
| **NAT Gateway — data processing** (proposed) | $1 | $1 | $4 |
| **ECR** (~1–2 GB image storage) | $1 | $1 | $1 |
| **Secrets Manager** (1 secret) | $1 | $1 | $1 |
| **CloudWatch Logs** (30-day retention) | $1 | $2 | $5 |
| **CloudWatch Container Insights metrics** | ~$1 | ~$2 | ~$4 |
| **Backend subtotal — current** | **~$32** | **~$57** | **~$145** |
| **Backend subtotal — proposed** | **~$66** | **~$91** | **~$215** |

> ECS Fargate rates used: $0.04048/vCPU/hour · $0.004445/GB/hour (us-east-1).
> ElastiCache rates: t3.micro $0.017/h · t3.small $0.034/h · t3.medium $0.068/h.
> ALB: $0.008/hour fixed + LCU charges (estimated at ~1–3 LCU for dev/stg, ~5 LCU for prod).
> NAT Gateway: $0.045/hour × 730 h = $32.85/AZ per month + $0.045/GB data processed. Dev/Stg: 1 AZ ($33/month). Prod: 2 AZs for HA ($66/month). Data estimates: dev ~10 GB · stg ~25 GB · prod ~100 GB (ECR image pulls on deploy + MongoDB Atlas + LLM API egress). S3 Gateway Endpoint (free) eliminates NAT charges for S3 traffic.
> Container Insights: ECS cluster has `containerInsights = "enabled"`; generates custom CloudWatch metrics (CPU, memory, network per task/service/cluster) at $0.30/metric/month after the first 10 free. Estimated ~5 custom metrics for dev/stg (1 task) · ~12 for prod (2 tasks). Actual cost scales with task count and metric volume.

### Monthly cost breakdown — global stack (once per environment)

CloudFront, WAF, S3, and Route 53 are provisioned once per environment regardless of how many backend regions are deployed.

Traffic assumptions: dev ~500 K req/month · stg ~2 M req/month · prod ~20 M req/month.

| Service | Dev | Stg | Prod |
|---|---|---|---|
| **CloudFront** (requests + data transfer) | $1 | $3 | $24 |
| **WAF WebACL** (3 managed rule groups + 1 rate rule) | $9 | $10 | $21 |
| **S3** (storage + requests, pre-existing buckets) | $1 | $1 | $2 |
| **Route 53** (DNS queries, proportional share) | $1 | $1 | $1 |
| **SSM Parameter Store** (Standard tier, free) | $0 | $0 | $0 |
| **Lambda@Edge** (Origin Request, ~req/month) | $0 | $0 | ~$4 |
| **CloudFront Function — invocations** (proposed) | $0 | $0 | ~$1 |
| **CloudFront KeyValueStore — flat fee** (proposed) | $1 | $1 | $1 |
| **Global subtotal — current** | **~$12** | **~$15** | **~$52** |
| **Global subtotal — proposed** | **~$13** | **~$16** | **~$54** |

> WAF: $5/month WebACL + $1/month per rule + $0.60/million requests.
> CloudFront: $0.0085/10 K HTTPS requests + $0.085/GB data transfer out (first 10 TB).
> CloudFront Function: $0.10/million invocations (Viewer Request tier); assumes ~60 % of total requests hit `/api/*`. Dev ~300 K · Stg ~1.2 M · Prod ~12 M invocations/month.
> CloudFront KeyValueStore (KVS): $0.50/month base + first 10 M reads/month free; holds the JWT signing key read by the CF Function; key rotation via AWS CLI with no distribution re-deploy.

### Monthly cost breakdown — MongoDB Atlas Global Cluster (stg + prod only)

Atlas is provisioned and billed directly through MongoDB, not via Terraform or AWS. The global cluster spans all three zones (APAC · EU · Americas) as a single Atlas project. `dev` is excluded — use a free-tier `M0` or shared `M10` single-region cluster for local / CI testing.

Global Clusters require **M30 minimum** (dedicated tier). Each zone is an independent 3-node replica set; the table below is per zone and per total cluster.

| Item | Stg (M30) | Prod (M40) |
|---|---|---|
| **Compute — APAC zone** (`ap-south-1`, 3-node replica set) | ~$210 | ~$420 |
| **Compute — EU zone** (`eu-west-1`, 3-node replica set) | ~$205 | ~$410 |
| **Compute — Americas zone** (`us-east-1`, 3-node replica set) | ~$195 | ~$390 |
| **Storage** (~10 GB stg · ~50 GB prod, $0.10/GB/month) | ~$1 | ~$5 |
| **Backup** (continuous cloud backup, included in M30+) | $0 | $0 |
| **Atlas subtotal** | **~$611 / month** | **~$1 225 / month** |
| **Atlas annual** | **~$7 332 / year** | **~$14 700 / year** |

> Atlas cluster rates used (approximate 2025 dedicated pricing): M30 ~$0.267/hr per node · M40 ~$0.535/hr per node × 3 nodes × 730 h. `ap-south-1` ~8 % premium · `eu-west-1` ~5 % premium over `us-east-1`. Verify current rates on the [Atlas pricing calculator](https://www.mongodb.com/pricing) before committing — pricing changes frequently.
> Cross-region replication traffic between Atlas zones is handled internally by Atlas and is included in the cluster tier; no additional AWS data-transfer charges apply for intra-Atlas replication.
> Storage above the included 10 GB (M30) / 20 GB (M40) base is billed at $0.10/GB/month.

### Environment totals (single backend region, including Atlas)

| Environment | Backend (per region) | Global | Atlas | **Monthly total** | **Annual total** |
|---|---|---|---|---|---|
| **Dev — current** | ~$32 | ~$12 | — | **~$44 / month** | **~$528 / year** |
| **Dev — proposed** | ~$66 | ~$13 | — | **~$79 / month** | **~$948 / year** |
| **Stg — current** | ~$57 | ~$15 | ~$611 | **~$683 / month** | **~$8 196 / year** |
| **Stg — proposed** | ~$91 | ~$16 | ~$611 | **~$718 / month** | **~$8 616 / year** |
| **Prod — current** | ~$145 | ~$52 | ~$1 225 | **~$1 422 / month** | **~$17 064 / year** |
| **Prod — proposed** | ~$215 | ~$54 | ~$1 225 | **~$1 494 / month** | **~$17 928 / year** |

### Multi-region cost impact

Adding a second backend region repeats the backend stack cost for that environment. The global stack (CloudFront, WAF, S3) is unaffected — with Lambda@Edge routing, re-applying edge adds the new region to the routing table and all regions serve traffic simultaneously; Lambda@Edge cost scales linearly with total request volume. **MongoDB Atlas Global Cluster cost is fixed regardless of how many backend regions are deployed** — the cluster already spans all three zones at creation time.

**AWS infrastructure only (excluding Atlas):**

| Environment | 1 region | 2 regions | 3 regions |
|---|---|---|---|
| Dev — current | ~$44 | ~$76 | ~$108 |
| Dev — proposed | ~$79 | ~$145 | ~$211 |
| Stg — current | ~$72 | ~$129 | ~$186 |
| Stg — proposed | ~$107 | ~$198 | ~$289 |
| Prod — current | ~$197 | ~$342 | ~$487 |
| Prod — proposed | ~$269 | ~$484 | ~$699 |

**Total cost including Atlas (stg + prod):**

| Environment | 1 region | 2 regions | 3 regions |
|---|---|---|---|
| Stg — current | ~$683 | ~$740 | ~$797 |
| Stg — proposed | ~$718 | ~$809 | ~$900 |
| Prod — current | ~$1 422 | ~$1 567 | ~$1 712 |
| Prod — proposed | ~$1 494 | ~$1 709 | ~$1 924 |

### Cost optimisation tips

| Action | Saving | Applicable to |
|---|---|---|
| Stop dev/stg ECS service outside business hours (`desired_count = 0`) | up to 65 % of ECS cost | dev, stg |
| Use `cache.t3.micro` for stg instead of t3.small | ~$13/month | stg |
| Enable CloudFront caching for `/api/*` responses where safe | reduces ALB LCU + ECS load | all |
| Use CloudFront Price Class 100 (US/EU only) instead of PriceClass_200 | ~10–15 % of CF cost | prod (dev/stg already use PriceClass_100; set `cloudfront_price_class` in prod.tfvars) |
| Reduce CloudWatch log retention from 30 to 7 days in dev | ~$0.50/month | dev |
| Add free S3 Gateway Endpoint to each VPC | eliminates NAT GW data charges for all S3 traffic (ECR layers stored in S3); no hourly cost — Gateway Endpoints are free | all (proposed, pair with NAT GW) |
| Add VPC Interface Endpoints for ECR (`ecr.api` + `ecr.dkr`), Secrets Manager, and CloudWatch Logs | eliminates NAT GW data charges for those AWS services; each Interface Endpoint costs $0.01/hour/AZ (~$7.30/AZ/month) — becomes worthwhile only if NAT data charges significantly exceed endpoint hourly cost | all (proposed, evaluate after observing actual NAT data volume) |
| Schedule NAT Gateway deletion outside business hours in dev/stg | ~$33/month per NAT GW; requires Lambda or EventBridge Scheduler to delete/recreate; adds ~2 min cold-start on first deploy of the day | dev, stg |

---

## Production Readiness — Gaps to Address Before Prod Launch

The proposed architecture is well-structured but has the following gaps that must be closed before it can be considered fully production-grade. Items marked **[blocking]** will cause incidents or data loss in production if not addressed; **[recommended]** items significantly reduce operational risk.

### CloudFront Function — JWT auth

| Gap | Risk | Fix |
|---|---|---|
| `exp` claim not validated **[blocking]** | Stolen or leaked tokens remain valid forever — logout is impossible | Add `if (payload.exp < Math.floor(Date.now()/1000)) return 401` before returning `allow` |
| No dual-key rotation strategy **[blocking]** | Rotating the KVS signing key instantly invalidates all tokens at edge nodes that haven't refreshed yet — 401 storm for all logged-in users during rotation | Store `key_current` + `key_previous` in KVS; accept tokens valid under either; retire `key_previous` after ~60 s propagation window |
| Public endpoints not exempted **[blocking]** | `/api/health` (ALB health checks), `/api/auth/login`, and `/api/auth/register` are blocked — health checks fail, new users cannot log in | Add path-prefix check before JWT validation; bypass the check for these three paths |

### Lambda@Edge — geo-routing

| Gap | Risk | Fix |
|---|---|---|
| No health-based failover **[recommended]** | If a regional ALB is unhealthy, Lambda@Edge continues routing to it until a redeployment updates the baked routing table — all affected-region traffic is down | Add a default/fallback entry in the routing table (fall through to primary region for unknown or unmapped countries); consider a separate health-check Lambda that updates the routing table via SSM and triggers a re-deploy |
| Cold-start latency undocumented **[recommended]** | Edge PoPs idle for >15 min trigger 200–500 ms cold starts on the first request — P99 latency spikes unexpectedly | Document in service SLA; add a synthetic CloudWatch Synthetics canary to keep critical PoPs warm if P99 is business-critical |

### ECS — scaling and resilience

| Gap | Risk | Fix |
|---|---|---|
| No ECS Service Auto Scaling **[blocking for prod]** | Prod is hardcoded at 2 tasks — a traffic spike saturates CPU/memory with no automatic scale-out | Add `aws_appautoscaling_target` + `aws_appautoscaling_policy` (target tracking on CPU ≥ 60 % and/or ALB request count per target); set min 2, max 6 tasks for prod; min 1, max 3 for stg |
| ALB deletion protection disabled **[recommended]** | `terraform destroy` or an accidental workflow run drops the ALB (and all traffic) with no confirmation prompt | Add `enable_deletion_protection = true` to the ALB resource in `alb.tf` for `stg` and `prod`; remove it before any intentional destroy |

### Observability

| Gap | Risk | Fix |
|---|---|---|
| No CloudWatch Alarms **[blocking for prod]** | No automated alerting when ECS tasks are unhealthy, ALB 5xx rate spikes, or Redis connection count drops — incidents go undetected until a user reports them | Add alarms for: `HealthyHostCount < 1` (ALB target group), `HTTPCode_Target_5XX_Count > threshold` (ALB), `CPUUtilization > 85 %` (ECS), `CurrConnections` drop (ElastiCache); wire to SNS → email or PagerDuty |
| WAF full logging disabled **[recommended]** | WAF only samples requests (`sampled_requests_enabled = true`) — sampled logs are insufficient for security incident investigation or false-positive tuning | Enable WAF logging to Kinesis Data Firehose → S3: add `aws_wafv2_web_acl_logging_configuration` in `waf.tf` with a Kinesis Firehose delivery stream; retain logs for 90 days in S3 with lifecycle policy |
| ALB access logs disabled **[recommended]** | No record of which IPs/paths hit the ALB — cannot audit traffic patterns, debug 5xx causes, or meet compliance logging requirements | Enable ALB access logs in `alb.tf` (`access_logs { bucket = ... enabled = true }`); use the same logging S3 bucket as WAF or a dedicated one |

### Secrets Management

| Gap | Risk | Fix |
|---|---|---|
| No Secrets Manager automatic rotation **[recommended]** | `JWT_SECRET` and database credentials are never rotated automatically — a credential leak has an unbounded blast radius | Add `aws_secretsmanager_secret_rotation` with a Lambda rotation function for `MONGODB_URI` and `JWT_SECRET`; for JWT, pair with the dual-key KVS strategy above to ensure edge nodes consume the new key before the old one is retired |
