# Live Infrastructure — Deployment Guide

This guide covers the three Terraform modules and five GitHub Actions workflows that provision and deploy the production-grade infrastructure for buddy360.

---

## Architecture Overview

```
                              Users (global)
                                    │ HTTPS
                          ┌─────────▼──────────┐
                          │     CloudFront      │
                          │  + WAF WebACL       │
                          │  (us-east-1/global) │
                          └──────┬─────────┬───┘
                       /api/*    │         │   /*
                  ┌──────────────┘         └──────────────────────┐
                  │ HTTPS-only                                      │
                  │ (to primary backend region)                     │
                  ▼                                                 ▼
   ┌──────────────────────────────┐              ┌─────────────────────────┐
   │  Internal ALB  (HTTPS/443)   │              │  S3 — frontend assets   │
   │  buddy-internal-{env}        │              │  (us-east-1)            │
   │    -{region}.learning-dev.com│              │  OAC — no public access │
   └──────────────┬───────────────┘              └─────────────────────────┘
                  │ HTTP/8000  (within VPC)
                  ▼

╔══════════════════╦══════════════════╦══════════════════╗
║   ap-south-1     ║   eu-west-1      ║   us-east-1      ║
║  (Mumbai)        ║  (Ireland)       ║  (N. Virginia)   ║
╠══════════════════╬══════════════════╬══════════════════╣
║ VPC              ║ VPC              ║ VPC              ║
║ ECS Fargate      ║ ECS Fargate      ║ ECS Fargate      ║
║ ALB (HTTPS/443)  ║ ALB (HTTPS/443)  ║ ALB (HTTPS/443)  ║
║ ElastiCache Redis║ ElastiCache Redis║ ElastiCache Redis║
║ ECR              ║ ECR              ║ ECR              ║
║ Secrets Manager  ║ Secrets Manager  ║ Secrets Manager  ║
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

**TLS chain (end-to-end):**
```
Browser ──HTTPS──▶ CloudFront ──HTTPS──▶ ALB (443) ──HTTP/8000──▶ ECS task
         (us-east-1 ACM cert)  (ap-south-1 ACM cert)   (within VPC)
```

**Region roles:**

| Layer | Region | Notes |
|---|---|---|
| CloudFront + WAF | `us-east-1` (global) | One distribution per environment; serves all regions |
| S3 frontend assets | `us-east-1` | One bucket per environment; accessed via CloudFront OAC |
| Backend infra | `ap-south-1` / `eu-west-1` / `us-east-1` | Independently deployable per region |
| SSM Parameter Store | `us-east-1` (control plane) | All modules read/write SSM here regardless of backend region |

---

## Module Structure

| Module | Directory | Workflow | Manages |
|---|---|---|---|
| Backend | `infra-live-backend/` | `terraform-live-backend.yml` | VPC, ECS, ALB, ECR, Redis, Secrets Manager, internal DNS |
| Edge | `infra-live-edge/` | `terraform-live-edge.yml` | CloudFront, WAF, public DNS, OAC; publish CF details to SSM |
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
infra-live-edge      reads: /backend/{backend_region}/alb_internal_fqdn
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
| `ACM_CERTIFICATE_ARN_US_EAST_1` | `terraform-live-edge` | ACM cert in `us-east-1` for CloudFront (must be in `us-east-1`) |
| `VITE_API_URL` | `deploy-live-frontend` | Frontend env var: API base URL |
| `VITE_GOOGLE_CLIENT_ID` | `deploy-live-frontend` | Frontend env var: Google OAuth client ID |
| `JWT_SECRET` | `terraform-live-backend` | Injected into Secrets Manager |
| `GOOGLE_CLIENT_ID` | `terraform-live-backend` | Injected into Secrets Manager |
| `OPENAI_API_KEY` | `terraform-live-backend` | Injected into Secrets Manager (required) |
| `ANTHROPIC_API_KEY` | `terraform-live-backend` | Injected into Secrets Manager (optional — falls back to `REPLACE_ME` if not set) |
| `GEMINI_API_KEY` | `terraform-live-backend` | Injected into Secrets Manager (optional — falls back to `REPLACE_ME` if not set) |
| `OPENAI_MODEL` | `terraform-live-backend` | OpenAI model identifier passed as ECS env var (required, e.g. `gpt-4o-mini`) |
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

> `SUBDOMAIN_INTERNAL` GitHub secret should reflect the region, e.g. `buddy-internal-ap` for ap-south-1.

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
        → CloudFront + WAF + public DNS live
        → backend API accessible via Postman immediately ✓

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

```
1. terraform-live-backend → apply  (aws_region=eu-west-1)
   — writes /backend/eu-west-1/* to SSM

To switch CloudFront origin to eu-west-1:
3. terraform-live-edge    → apply  (backend_region=eu-west-1)
   — updates /api/* origin to buddy-internal-eu-{env}.learning-dev.com
```

### What each step creates

**Step 1 — infra-live-backend**
- Backend VPC: public subnets (ECS/ALB) + private subnets (ElastiCache)
- ECR repository with lifecycle policy (10 tagged images; untagged expire after 1 day)
- ECS Fargate cluster, task definition, service
- ALB (HTTPS/443): CloudFront-only ingress via managed prefix list; TLS via ACM cert
- Route 53 A record: `{SUBDOMAIN_INTERNAL}-{env}.{DOMAIN_NAME}` → ALB
- ElastiCache Redis (private subnet, at-rest + in-transit TLS)
- CloudWatch log group (30-day retention)
- Secrets Manager secret (populated from GitHub secrets including `MONGODB_URI`)
- IAM roles for ECS execution and task
- Writes ALB FQDN and ECS/ECR details to SSM under `/{APP}/{env}/backend/{region}/`

**Step 2 — infra-live-edge**
- WAF WebACL (`us-east-1`): Core Rule Set, Known Bad Inputs, IP Reputation List, rate limit (1 000 req/5 min per IP)
- CloudFront Origin Access Control (OAC) for S3
- CloudFront distribution: S3 default origin + ALB `/api/*` origin (`https-only`)
- Route 53 A record: `{SUBDOMAIN}-{env}.{DOMAIN_NAME}` → CloudFront
- Writes CloudFront distribution ID, ARN, app URL, and S3 bucket name to SSM

**Step 3 — infra-live-frontend**
- S3 bucket policy: grants CloudFront OAC access using distribution ARN from SSM

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

| Region | Code | Primary use |
|---|---|---|
| Asia Pacific (Mumbai) | `ap-south-1` | Default backend region |
| Europe (Ireland) | `eu-west-1` | EU backend region |
| US East (N. Virginia) | `us-east-1` | US backend region; also hosts CloudFront WAF, S3 frontend, ACM cert for CloudFront |

---

## Cost Estimation

All estimates are in **USD/month**, based on **730 hours/month** (continuous 24/7 operation) and **`us-east-1` pricing** (cheapest baseline). `ap-south-1` and `eu-west-1` cost approximately **10–15 % more** for compute and cache. MongoDB Atlas and GitHub Actions minutes are excluded.

### Resource configuration per environment

| Resource | Dev | Stg | Prod |
|---|---|---|---|
| ECS task CPU | 0.25 vCPU | 0.5 vCPU | 1 vCPU |
| ECS task memory | 512 MB | 1 GB | 2 GB |
| ECS desired count | 1 task | 1 task | 2 tasks |
| ElastiCache node | `cache.t3.micro` | `cache.t3.small` | `cache.t3.medium` |
| LLM hourly limit | 50 req/h | 100 req/h | 200 req/h |
| ECS Exec enabled | yes | yes | no |

### Monthly cost breakdown — backend stack (per region)

These resources are created once per backend region. Each additional region deployed adds the same cost again.

| Service | Dev | Stg | Prod |
|---|---|---|---|
| **ECS Fargate** | $9 | $18 | $72 |
| **Application Load Balancer** | $7 | $8 | $12 |
| **ElastiCache Redis** (single node) | $12 | $25 | $50 |
| **ECR** (~1–2 GB image storage) | $1 | $1 | $1 |
| **Secrets Manager** (1 secret) | $1 | $1 | $1 |
| **CloudWatch Logs** (30-day retention) | $1 | $2 | $5 |
| **Backend subtotal** | **~$31** | **~$55** | **~$141** |

> ECS Fargate rates used: $0.04048/vCPU/hour · $0.004445/GB/hour (us-east-1).
> ElastiCache rates: t3.micro $0.017/h · t3.small $0.034/h · t3.medium $0.068/h.
> ALB: $0.008/hour fixed + LCU charges (estimated at ~1–3 LCU for dev/stg, ~5 LCU for prod).

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
| **Global subtotal** | **~$12** | **~$15** | **~$48** |

> WAF: $5/month WebACL + $1/month per rule + $0.60/million requests.
> CloudFront: $0.0085/10 K HTTPS requests + $0.085/GB data transfer out (first 10 TB).

### Environment totals (single backend region)

| Environment | Backend | Global | **Monthly total** | **Annual total** |
|---|---|---|---|---|
| **Dev** | ~$31 | ~$12 | **~$43 / month** | **~$516 / year** |
| **Stg** | ~$55 | ~$15 | **~$70 / month** | **~$840 / year** |
| **Prod** | ~$141 | ~$48 | **~$189 / month** | **~$2 268 / year** |

### Multi-region cost impact

Adding a second backend region repeats the backend stack cost for that environment. The global stack (CloudFront, WAF, S3) is unaffected — it simply switches origin to the new region.

| Environment | 1 region | 2 regions | 3 regions |
|---|---|---|---|
| Dev | ~$43 | ~$74 | ~$105 |
| Stg | ~$70 | ~$125 | ~$180 |
| Prod | ~$189 | ~$330 | ~$471 |

### Cost optimisation tips

| Action | Saving | Applicable to |
|---|---|---|
| Stop dev/stg ECS service outside business hours (`desired_count = 0`) | up to 65 % of ECS cost | dev, stg |
| Use `cache.t3.micro` for stg instead of t3.small | ~$13/month | stg |
| Enable CloudFront caching for `/api/*` responses where safe | reduces ALB LCU + ECS load | all |
| Use CloudFront Price Class 100 (US/EU only) instead of PriceClass_200 | ~10–15 % of CF cost | prod (dev/stg already use PriceClass_100; set `cloudfront_price_class` in prod.tfvars) |
| Reduce CloudWatch log retention from 30 to 7 days in dev | ~$0.50/month | dev |
