# Live Infrastructure — Deployment Guide

This guide covers the three Terraform modules and five GitHub Actions workflows that provision and deploy the production-grade infrastructure for buddy360.

---

## Architecture Overview

```
                             Users
                               │ HTTPS
                         ┌─────▼──────┐
                         │ CloudFront │  (global CDN + WAF)
                         └──┬─────┬──┘
                   /api/*   │     │  /*
              ┌────────────┘     └──────────────────┐
              ▼                                      ▼
       ┌─────────────┐                      ┌──────────────┐
       │  ALB (HTTP) │                      │  S3 (static  │
       │  ap-south-1 │                      │   assets)    │
       └──────┬──────┘                      │  us-east-1   │
              │                             └──────────────┘
┌─────────────▼──────────────────────────────────────────┐
│  Backend VPC  (ap-south-1)                             │
│                                                        │
│   ┌─────────────┐   same VPC   ┌──────────────────┐   │
│   │  ECS Fargate│─────────────▶│  ElastiCache      │   │
│   │  (FastAPI)  │              │  (Redis)          │   │
│   └──────┬──────┘              └──────────────────┘   │
└──────────┼─────────────────────────────────────────────┘
           │ VPC Peering
┌──────────▼─────────────────────────────────────────────┐
│  Database VPC  (ap-south-1)                            │
│                                                        │
│   ┌──────────────┐                                     │
│   │  RDS Postgres│  (private subnets)                  │
│   └──────────────┘                                     │
└────────────────────────────────────────────────────────┘
```

---

## Module Structure

| Module | Directory | Workflow |
|---|---|---|
| Database (RDS + VPC) | `infra-live-database/terraform/` | `terraform-live-database.yml` |
| Backend (ECS + ALB + ECR + Redis + S3 IAM) | `infra-live-backend/terraform/` | `terraform-live-backend.yml` |
| Frontend (CloudFront + WAF + Route 53) | `infra-live-frontend/terraform/` | `terraform-live-frontend.yml` |
| Backend image deploy | — | `deploy-live-backend.yml` |
| Frontend assets deploy | — | `deploy-live-frontend.yml` |

**Creation order is mandatory:** Database → Backend → Frontend.
The backend reads database remote state; the frontend reads backend remote state.

---

## Prerequisites

### AWS — must exist before first apply

| Resource | Convention | Notes |
|---|---|---|
| S3 state bucket | any name | Must be in `us-east-1`; set as `STATE_BUCKET` secret |
| Backend app bucket | `person-backend-{env}-app-bucket` | One per environment; any region, but `us-east-1` recommended |
| Frontend assets bucket | `person-frontend-{env}-bucket` | One per environment; **must be in `us-east-1`** |
| IAM role (OIDC) | any name | Trusted by GitHub Actions; ARN set as `ROLE_ARN` secret |
| ACM certificate | `us-east-1` | Must cover the frontend domain; set as `ACM_CERTIFICATE_ARN_US_EAST_1` |
| Route 53 hosted zone | — | For your domain; ID set as `HOSTED_ZONE_ID` |

### GitHub Actions secrets

Configure the following in **GitHub → Settings → Environments** (one set per environment: `dev`, `stg`, `prod`).

#### Repository secrets (same value for all environments)

| Secret | Description |
|---|---|
| `APP_NAME` | Application name used in resource naming and state paths (e.g. `buddy360`) |
| `STATE_BUCKET` | S3 bucket name holding all Terraform state files |

#### Environment secrets (set per environment: dev / stg / prod)

| Secret | Used by | Description |
|---|---|---|
| `ROLE_ARN` | All workflows | IAM role ARN assumed via OIDC |
| `DOMAIN_NAME` | `terraform-live-frontend` | Root domain (e.g. `example.com`) |
| `SUBDOMAIN` | `terraform-live-frontend` | Subdomain prefix (e.g. `app`) |
| `HOSTED_ZONE_ID` | `terraform-live-frontend` | Route 53 hosted zone ID for the domain |
| `ACM_CERTIFICATE_ARN_US_EAST_1` | `terraform-live-frontend` | ACM certificate ARN in `us-east-1` |
| `VITE_API_URL` | `deploy-live-frontend` | Frontend env var: API base URL |
| `VITE_GOOGLE_CLIENT_ID` | `deploy-live-frontend` | Frontend env var: Google OAuth client ID |
| `JWT_SECRET` | `terraform-live-backend` | Backend app secret injected into Secrets Manager |
| `GOOGLE_CLIENT_ID` | `terraform-live-backend` | Backend app secret injected into Secrets Manager |
| `OPENAI_API_KEY` | `terraform-live-backend` | Backend app secret injected into Secrets Manager |
| `ANTHROPIC_API_KEY` | `terraform-live-backend` | Backend app secret injected into Secrets Manager |
| `GEMINI_API_KEY` | `terraform-live-backend` | Backend app secret injected into Secrets Manager |
| `CORS_ORIGINS` | `terraform-live-backend` | Backend app secret injected into Secrets Manager |
| `COOKIE_DOMAIN` | `terraform-live-backend` | Backend app secret injected into Secrets Manager |

---

## Infrastructure Creation Flow

Run the three Terraform workflows in this order via **GitHub → Actions → workflow → Run workflow**.

### Step 1 — Database

**Workflow:** `Terraform Live Database`
**Action:** `apply`

Creates:
- Database VPC (`10.1/10.11/10.21.0.0/16` per environment)
- RDS PostgreSQL 16 in private subnets
- RDS security group (ingress rules added later by backend module)
- AWS Secrets Manager secret for RDS master password (auto-rotated by RDS)

Outputs written to Terraform state (S3):
```
terraform-state-files/{APP_NAME}/{env}/database/ap-south-1/terraform.tfstate
```

### Step 2 — Backend

**Workflow:** `Terraform Live Backend`
**Action:** `apply`

Reads database state → creates:
- Backend VPC (`10.2/10.12/10.22.0.0/16` per environment)
- VPC Peering connection (backend ↔ database) + routes in both VPCs
- RDS ingress rule (backend VPC CIDR → port 5432)
- ECR repository
- ECS Fargate cluster, task definition, service
- ALB (HTTP/80) with CloudFront-only ingress
- ElastiCache Redis (private subnet)
- CloudWatch log group
- AWS Secrets Manager app secret (populated from GitHub environment secrets)
- IAM roles for ECS execution and task

After apply, writes to SSM Parameter Store (`ap-south-1`):
```
/{APP_NAME}/{env}/backend/ecr_repository_url
/{APP_NAME}/{env}/backend/ecs_cluster_name
/{APP_NAME}/{env}/backend/ecs_service_name
```

Outputs written to Terraform state (S3):
```
terraform-state-files/{APP_NAME}/{env}/backend/ap-south-1/terraform.tfstate
```

### Step 3 — Frontend

**Workflow:** `Terraform Live Frontend`
**Action:** `apply`

Reads backend state → creates:
- WAF WebACL (`us-east-1`, CloudFront scope)
- CloudFront Origin Access Control
- S3 bucket policy (OAC-only access on pre-existing bucket)
- CloudFront distribution (S3 default, ALB for `/api/*`)
- Route 53 A-record alias → CloudFront

After apply, writes to SSM Parameter Store (`ap-south-1`):
```
/{APP_NAME}/{env}/frontend/s3_bucket_name
/{APP_NAME}/{env}/frontend/cloudfront_distribution_id
```

---

## Application Deployment

After infrastructure is provisioned, use the deploy workflows to push code changes.

### Backend deploy

**Workflow:** `Deploy Live Backend`

1. Reads `ecr_repository_url`, `ecs_cluster_name`, `ecs_service_name` from SSM
2. Builds Docker image, pushes as `:<git-sha>` and `:latest` to ECR
3. Runs Alembic migrations as a one-off ECS task (skippable via `skip_migrations` input)
4. Force-deploys ECS service (tasks restart, pull `:latest` image)
5. Waits for service to reach steady state

### Frontend deploy

**Workflow:** `Deploy Live Frontend`

1. Reads `s3_bucket_name`, `cloudfront_distribution_id` from SSM
2. Builds React app with `VITE_API_URL` and `VITE_GOOGLE_CLIENT_ID` from GitHub env secrets
3. Syncs built assets to S3 (hashed JS/CSS with 1-year cache; `index.html` with no-cache)
4. Invalidates CloudFront cache (`/*`)
5. Waits for invalidation to complete

---

## DNS and URL

| Environment | Frontend URL |
|---|---|
| dev | `https://{SUBDOMAIN}-dev.{DOMAIN_NAME}` |
| stg | `https://{SUBDOMAIN}-stg.{DOMAIN_NAME}` |
| prod | `https://{SUBDOMAIN}.{DOMAIN_NAME}` |

All API calls go to `{url}/api/*` — proxied by CloudFront to the ALB without CORS.

---

## Retrieving the RDS Password

The RDS master password is auto-managed and rotated by AWS every 7 days. To retrieve it:

```bash
aws secretsmanager get-secret-value \
  --secret-id "<rds_secret_arn from terraform output>" \
  --query SecretString \
  --output text \
  --region ap-south-1
```

The ARN is available as the `rds_secret_arn` Terraform output from `infra-live-database`.

---

## Destroying Infrastructure

Destroy in reverse order: Frontend → Backend → Database.

### Frontend / Backend

```
Workflow: Terraform Live {Frontend|Backend}
Action: destroy
```

No special steps needed — neither module manages the S3 buckets themselves.

### Database

The RDS instance has `deletion_protection = true` and a `prevent_destroy` lifecycle block.
To destroy intentionally:

1. In `tfvars/{env}.tfvars`, set:
   ```hcl
   db_deletion_protection = false
   db_skip_final_snapshot = true
   ```
2. Remove (or comment out) the `prevent_destroy` lifecycle block in `rds.tf`
3. Run `Terraform Live Database` → **apply** (removes the RDS deletion-protection flag)
4. Run `Terraform Live Database` → **destroy**

> **Warning:** For `stg` and `prod`, both flags default to `true`/`false` respectively to prevent accidental data loss.

---

## Secrets Manager — App Secrets

The backend app secrets (JWT, API keys, CORS origins, etc.) are populated automatically from GitHub environment secrets every time `terraform-live-backend` runs with `action = apply`.

If a GitHub secret is not set, the value falls back to `REPLACE_ME` (or `""` for `COOKIE_DOMAIN`). The ECS task will start but fail to authenticate correctly until real values are provided.

To update a secret without a full Terraform apply, update the GitHub environment secret and re-run the workflow with `action = apply`, or update Secrets Manager directly:

```bash
aws secretsmanager put-secret-value \
  --secret-id "{APP_NAME}/{env}/backend-secrets" \
  --secret-string '{"JWT_SECRET":"...","GOOGLE_CLIENT_ID":"...",...}' \
  --region ap-south-1
```

Changes take effect on the next ECS task restart (run `deploy-live-backend` or force a new deployment).
