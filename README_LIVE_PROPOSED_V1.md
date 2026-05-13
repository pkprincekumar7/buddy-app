# buddy360 — Production Infrastructure Design (V1 — Startup Launch)

This document is the authoritative specification for the buddy360 **V1 production infrastructure** on AWS. V1 is scoped for a startup launch: single backend region, simple CloudFront CDN without edge auth, and a right-sized MongoDB Atlas replica set. Multi-region expansion and edge JWT validation are deferred to V2 and documented at the end as a roadmap.

---

## Architecture

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
    │ CloudFront custom │               │  S3 — frontend assets   │
    │ origin → ALB      │               │  (us-east-1)            │
    │ (ap-south-1)      │               │  OAC — no public access │
    └─────────┬─────────┘               └─────────────────────────┘
              │ HTTPS/443
              ▼

── Backend VPC (ap-south-1) ──────────────────────────────────────────

  VPC 10.0.0.0/16
  ┌──────────────────────────────────────────────────────────────┐
  │  Public subnets (AZ-a, AZ-b)                                 │
  │    ALB (HTTPS/443, HTTP/80 → redirect)                       │
  │    NAT Gateway × 2 (prod), × 1 (dev/stg)                    │
  ├──────────────────────────────────────────────────────────────┤
  │  Private subnets (AZ-a, AZ-b)                                │
  │    ECS Fargate tasks (FastAPI, port 8000)                    │
  │    ElastiCache Redis (in-VPC, port 6379)                     │
  └──────────────────────────────────────────────────────────────┘
         │ TLS (outbound via NAT GW)
         ▼
  MongoDB Atlas — Replica Set
  (M10 stg / M20 prod, ap-south-1, TLS)
```

**TLS chain:**
```
Browser ──HTTPS──▶ CloudFront ──HTTPS──▶ ALB (443, regional ACM cert) ──HTTP/8000──▶ ECS task
       (us-east-1 ACM cert)              (ap-south-1, private subnet)
```

**JWT validation in V1:** performed in the FastAPI application layer (not at edge). CloudFront forwards all `/api/*` requests to the ALB; the backend validates the `Authorization: Bearer` header on every protected route. Edge JWT validation (CloudFront Function + KVS) is deferred to V2.

**Region layout:**

| Layer | Region | Role |
|---|---|---|
| CloudFront + WAF | Global (us-east-1) | CDN, DDoS protection, WAF inspection |
| S3 — frontend assets | us-east-1 | Static origin for React app |
| Backend (ECS, ALB, ElastiCache) | ap-south-1 | API serving, session caching |
| MongoDB Atlas Replica Set | ap-south-1 (primary) | Database |

---

## Infrastructure Modules

### Global Edge — `infra-live-edge`

#### CloudFront Distribution

- WAF WebACL attached with the following rule groups (deploy in `COUNT` mode in dev and stg; switch to `BLOCK` in prod only after validating no false positives in stg — controlled by `waf_count_mode = true` in dev/stg tfvars):
  - **AWS Managed Rules — Core Rule Set** — blocks common OWASP exploits
  - **AWS Managed Rules — Known Bad Inputs** — blocks Log4Shell, SSRF probes
  - **Rate-based rule (global)** — 2,000 requests per 5 min per IP
  - **Rate-based rule (auth endpoints)** — 100 requests per 5 min per IP, scoped to `/api/auth/login` and `/api/auth/register` via `scope_down_statement` byte match on URI — blocks credential stuffing; must have lower WAF priority number (evaluated first) than the global rate rule
- S3 Origin Access Control (OAC) for frontend assets — bucket has no public access
- Full access logging to global logging S3 bucket (see [Observability](#observability))
- `viewer_protocol_policy = "redirect-to-https"` on all behaviours
- `price_class = "PriceClass_200"` — covers US, EU, and APAC (ap-south-1 primary users); switch to `PriceClass_All` if sub-regions show high latency
- **HSTS response headers** via `aws_cloudfront_response_headers_policy`: `Strict-Transport-Security: max-age=31536000; includeSubDomains` — prevents SSL-stripping; attached to all behaviours

**No Lambda@Edge and no CloudFront Function in V1.** All API requests pass through CloudFront to the ALB directly. JWT validation is handled by FastAPI.

#### S3 — Frontend Assets

| Setting | Value |
|---|---|
| Access | OAC only — all four public-access block flags set to `true` |
| Versioning | Enabled — allows same-day rollback by redeploying a previous build |
| Encryption | SSE-S3 |
| Lifecycle rule | Expire non-current object versions after 30 days |

---

### Frontend Bucket Policy — `infra-live-frontend`

A thin post-edge module with one responsibility: attach the S3 OAC bucket policy granting CloudFront read access to the frontend assets bucket. Cannot be merged into `infra-live-edge` because the bucket policy references the CloudFront distribution ARN, which is only known after `infra-live-edge` completes.

| Property | Value |
|---|---|
| State key | `terraform-state-files/{app}/{env}/frontend/us-east-1/terraform.tfstate` |
| Region | us-east-1 (hardcoded) |
| Depends on | `infra-live-edge` (reads `/{app}/{env}/edge/cloudfront_arn` and `/{app}/{env}/edge/s3_bucket_name` from SSM) |
| Destroy before | `infra-live-edge` |

Grants `s3:GetObject` to `cloudfront.amazonaws.com` scoped to the specific distribution ARN via `AWS:SourceArn`. A `precondition` block cross-checks `var.frontend_bucket_name` against the SSM value to prevent accidental policy attachment to the wrong bucket.

**Apply / destroy order:**

Apply: `backend → edge → frontend → deploy-backend → deploy-frontend`

Destroy: `frontend → edge → backend`

---

### Backend — `infra-live-backend` (ap-south-1 only in V1)

#### VPC and Networking

| Subnet type | Contents |
|---|---|
| Public | ALB, NAT Gateway |
| Private | ECS Fargate tasks, ElastiCache Redis |

NAT Gateway count: dev/stg single-AZ (1 NAT GW); prod 2 AZs (2 NAT GWs for HA).

**S3 Gateway Endpoint** (`aws_vpc_endpoint`, type `Gateway`) — routes S3 and ECR layer traffic over AWS backbone; eliminates NAT data charges for image pulls at no hourly cost.

**VPC Interface Endpoints** for ECR (`ecr.api` + `ecr.dkr`), Secrets Manager, and CloudWatch Logs — keeps container image pulls, secret fetches, and log delivery on the AWS network; eliminates those traffic paths from the public internet via NAT Gateway.

**VPC Flow Logs** to the regional logging S3 bucket. Required for security group misconfiguration diagnosis and SOC 2 / ISO 27001 network audit controls.

#### Security Groups

No broad `0.0.0.0/0` inbound rules on any security group.

| Security group | Inbound | Outbound |
|---|---|---|
| **ALB SG** | 443 from CloudFront managed prefix list (`com.amazonaws.global.cloudfront.origin-facing`); 80 from same prefix list (redirect listener) | 8000 to ECS task SG |
| **ECS task SG** | 8000 from ALB SG only | 443 to internet via NAT GW (Atlas, LLM APIs, ECR); 6379 to ElastiCache SG |
| **ElastiCache SG** | 6379 from ECS task SG only | — |

> The ALB SG inbound restricted to the CloudFront managed prefix list is critical. Without it the ALB is directly reachable via its public DNS name, bypassing CloudFront and WAF entirely.

#### Application Load Balancer

- HTTPS (443) listener terminates TLS (regional ACM certificate in ap-south-1)
- HTTP (80) listener redirects to HTTPS
- `enable_deletion_protection = true` for stg and prod
- Target group `deregistration_delay = 60 s` — coordinated with ECS `stopTimeout = 60 s`
- Health check: path `/api/health`, interval 30 s, healthy threshold 2, unhealthy threshold 3
- Access logs enabled → regional logging S3 bucket

**CloudWatch Alarms:**
- `HealthyHostCount < 1` → SNS alert
- `HTTPCode_Target_5XX_Count > threshold` → SNS alert

#### ECS Fargate Service

| Environment | CPU | Memory | Min tasks | Initial desired | Max tasks |
|---|---|---|---|---|---|
| Dev | 512 | 1,024 MB | 1 | 1 | 2 |
| Stg | 1,024 | 2,048 MB | 1 | 1 | 3 |
| Prod | 2,048 | 4,096 MB | 2 | 2 | 6 |

- Tasks in private subnets; `assign_public_ip = false`
- `health_check_grace_period_seconds = 60`
- `stopTimeout = 60 s` with SIGTERM handler in FastAPI draining in-flight requests
- `desired_count` in `ignore_changes` — managed by Application Auto Scaler
- `deployment_circuit_breaker { enable = true, rollback = true }` on all environments
- `ordered_placement_strategy { type = "spread", field = "attribute:ecs.availability-zone" }`
- Container Insights enabled on ECS cluster
- CloudWatch log group `/ecs/{APP_NAME}/{env}` — retention 90 days (prod), 30 days (dev/stg)
- X-Ray daemon sidecar container — active tracing on all environments

**ECS Service Auto Scaling:**

| Metric | Target | Scale-out cooldown | Scale-in cooldown |
|---|---|---|---|
| `ECSServiceAverageCPUUtilization` | 60 % | 60 s | 300 s |
| `ECSServiceAverageMemoryUtilization` | 70 % | 60 s | 300 s |
| `ALBRequestCountPerTarget` | 1,000 req/min per task | 60 s | 300 s |

Scale-in cooldown is intentionally longer (5 min) to prevent task thrashing. Tune `ALBRequestCountPerTarget` via load test before production launch.

**CloudWatch Alarm:** `CPUUtilization > 85 %` → SNS alert

**IAM — least-privilege roles:**

- **Execution role**: `ecr:GetAuthorizationToken` (any), `ecr:BatchGetImage` + `ecr:GetDownloadUrlForLayer` (specific ECR repo ARN), `secretsmanager:GetSecretValue` (specific secret ARN), `logs:CreateLogStream` + `logs:PutLogEvents` (specific log group ARN)
- **Task role**: `xray:PutTraceSegments` + `xray:PutTelemetryRecords` (scoped to `"*"` — X-Ray has no resource-level policy support). Add additional actions scoped to exact ARNs as the application expands.

#### ECR

- `scan_on_push = true`
- EventBridge rule: ECR Image Scan findings with HIGH or CRITICAL severity → SNS alerts topic
- Image lifecycle policy: expire untagged images after 1 day; retain 20 most recent tagged images
- **No cross-region replication in V1** — single region, not needed

#### ElastiCache Redis

Engine: **Redis 7.1**. Parameter group family: `default.redis7`.

| Environment | Node type | Resource | Multi-AZ | Encryption |
|---|---|---|---|---|
| Dev | `cache.t3.micro` | `aws_elasticache_cluster` | No | at-rest + in-transit |
| Stg | `cache.t3.micro` | `aws_elasticache_cluster` | No | at-rest + in-transit |
| Prod | `cache.r6g.large` × 2 | `aws_elasticache_replication_group` | Yes (`automatic_failover_enabled = true`, `multi_az_enabled = true`) | at-rest + in-transit |

**All environments require `auth_token`** on the ElastiCache resource. Store in Secrets Manager (`REDIS_AUTH_TOKEN`); inject into ECS tasks as an environment variable. Application connects via `rediss://` (TLS).

#### Secrets Manager

One secret per environment at `{APP_NAME}/{env}/backend-secrets`:

| Key | Description |
|---|---|
| `JWT_PRIVATE_KEY` | RSA-2048 private key PEM (RS256 signing; validated in FastAPI, not at edge in V1) |
| `GOOGLE_CLIENT_ID` | OAuth client ID |
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `GEMINI_API_KEY` | Gemini API key |
| `MONGODB_URI` | Atlas connection string |
| `REDIS_AUTH_TOKEN` | ElastiCache AUTH token (64-char random hex) |

- Terraform creates the secret with `REPLACE_ME` placeholders on first apply; the workflow auto-populates real values on first apply only (checks `JWT_PRIVATE_KEY == "REPLACE_ME"` before writing)
- To rotate after initial setup: `aws secretsmanager put-secret-value --secret-id <arn> --secret-string '{...}'`

**Plain env vars** (not secrets — injected as ECS task definition env vars at `terraform apply`): `CORS_ORIGINS`, `COOKIE_DOMAIN`, `OPENAI_MODEL`, `ANTHROPIC_MODEL`, `GEMINI_MODEL`.

#### CloudTrail

One trail per backend region in `cloudtrail.tf`.

| Setting | Value |
|---|---|
| S3 destination | Regional logging S3 bucket |
| Log file validation | `enable_log_file_validation = true` |
| CloudWatch Logs | Enabled — management events to a dedicated log group |
| Encryption | SSE-KMS; `enable_key_rotation = true` |
| Multi-region | `is_multi_region_trail = false` |

A separate trail in `infra-live-edge` covers CloudFront and WAF management events in us-east-1.

#### GuardDuty

`aws_guardduty_detector` per backend region (and us-east-1 in `infra-live-edge`):

- `enable = true`; `finding_publishing_frequency = "FIFTEEN_MINUTES"` for prod, `"SIX_HOURS"` for dev/stg
- EventBridge rule: findings with severity ≥ HIGH → SNS alerts topic
- Cost: ~$1–3/month per region — enable in all environments

---

### Database — MongoDB Atlas Replica Set

| Environment | Tier | Cluster type | Continuous backup | Retention |
|---|---|---|---|---|
| Dev | M0 (free) | Shared (no backup) | None | — |
| Stg | M10 | Replica set (ap-south-1) | Enabled | 7 days |
| Prod | M20 | Replica set (ap-south-1) | Enabled | 30 days |

- M10 (~$0.08/hr ≈ $57/month) is sufficient for stg. M20 (~$0.26/hr ≈ $190/month) provides more RAM and IOPS for prod.
- Atlas IP Access List: NAT GW EIP(s) only — not individual task IPs
- TLS enforced; no plaintext connections
- Enable Continuous Cloud Backup at cluster creation — do not defer
- Verify PITR restore procedure in stg before prod launch
- Upgrade to M30 if prod workload observably saturates M20 CPU or RAM under auto-scaled load

**V1 uses a single-region replica set, not a Global Cluster.** A Global Cluster (minimum M30 = 9 nodes ≈ $3,550/month) is deferred to V2 when multi-region backend is needed.

**Connection pool sizing:** default motor `maxPoolSize = 100` per ECS task. At prod max scale (6 tasks): 600 total connections — well within M20 limit (~1,500). Rolling deploy worst case: 12 concurrent tasks = 1,200 connections, still within limit.

---

### Cross-module Communication — SSM Parameter Store

`infra-live-backend` writes one SSM parameter after a successful apply:

```
/{APP_NAME}/{env}/alb-fqdn   →   <alb-dns-name>
```

`infra-live-edge` reads this to configure the CloudFront custom origin (the single backend ALB). In V1 there is no Lambda@Edge; CloudFront reads the ALB FQDN directly as a static custom origin.

---

### DNS and TLS Certificates

#### Route 53

One hosted zone per domain. Records required:

| Record | Type | Target |
|---|---|---|
| `buddy360.com` / `www.buddy360.com` | A (Alias) | CloudFront distribution domain name |
| `api.{env}.buddy360.com` (or equivalent) | CNAME | ALB DNS name (ap-south-1) |

#### ACM Certificates

| Certificate | Region | Used by |
|---|---|---|
| `*.buddy360.com` or `buddy360.com` | **us-east-1** | CloudFront distribution |
| `*.{env}.buddy360.com` or backend subdomain | **ap-south-1** | ALB HTTPS listener |

> CloudFront only accepts ACM certificates from `us-east-1`. ALB certs must be in the same region as the ALB.

---

## Observability

### Alerts SNS Topic

One SNS topic per environment (`{APP_NAME}-{env}-alerts`):

| Resource | Purpose |
|---|---|
| `aws_sns_topic` | Topic ARN referenced by all CloudWatch Alarms and ECR EventBridge rules |
| `aws_sns_topic_subscription` (email) | Operator email — all environments |
| `aws_sns_topic_subscription` (HTTPS) | PagerDuty endpoint — prod only |

### CloudWatch Alarms

| Alarm | Threshold | Source |
|---|---|---|
| `HealthyHostCount` | < 1 | ALB target group |
| `HTTPCode_Target_5XX_Count` | > configurable threshold | ALB |
| `HTTPCode_Target_4XX_Count` | > configurable threshold | ALB |
| `CPUUtilization` | > 85 % | ECS service |
| `CurrConnections` | unexpected drop | ElastiCache |

### Log Groups and Retention

| Log group | Retention |
|---|---|
| `/ecs/{APP_NAME}/{env}` | 90 days (prod), 30 days (dev/stg) |
| `/aws/cloudtrail/{APP_NAME}/{env}` | 365 days (prod), 90 days (dev/stg) |

### Distributed Tracing — AWS X-Ray

X-Ray daemon sidecar in the ECS task definition. Active tracing on the task definition. `aws_xray_sampling_rule` in `infra-live-backend`.

Instrument FastAPI with `opentelemetry-sdk` middleware to emit spans for every inbound request, outbound HTTP call (Atlas, LLM APIs), and Redis operation.

Required IAM: `xray:PutTraceSegments` + `xray:PutTelemetryRecords` on the task role.

### CloudWatch Dashboard

One dashboard per environment (`{APP_NAME}-{env}`) in `alarms.tf`:

| Widget | Metric |
|---|---|
| ECS CPU utilisation | `CPUUtilization` per service |
| ECS memory utilisation | `MemoryUtilization` per service |
| ALB 5XX rate | `HTTPCode_Target_5XX_Count` |
| ALB 4XX rate | `HTTPCode_Target_4XX_Count` |
| ALB request count | `RequestCount` |
| Healthy host count | `HealthyHostCount` |
| ElastiCache connections | `CurrConnections` |
| ElastiCache CPU | `EngineCPUUtilization` |

### Tagging Strategy

```hcl
default_tags {
  tags = {
    Project     = var.app_name
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}
```

### S3 Logging Bucket Strategy

Two separate S3 buckets per environment:

| Log source | Delivery | Region constraint | Bucket |
|---|---|---|---|
| **CloudFront access logs** | Direct S3 delivery | Bucket must be in **us-east-1**; `BucketOwnerPreferred` ownership required | Global logging bucket |
| **WAF full logs** | Kinesis Firehose → S3 | Firehose in **us-east-1**; **stream name must start with `aws-waf-logs-`** | Global logging bucket |
| **ALB access logs** | Direct S3 delivery | Bucket must be in **same region as ALB** | Regional logging bucket |
| **VPC Flow Logs** | Direct S3 delivery | Any region | Regional logging bucket |

Both buckets: all four public-access block flags `true`, SSE-S3, no versioning, lifecycle rule (transition to Glacier Instant Retrieval after 30 days; expire after 90 days, or 365 days for prod).

---

## CI/CD

### GitHub Actions Workflows

| Workflow | Trigger | What it does |
|---|---|---|
| `terraform-live-backend` | `workflow_dispatch` | Plan / apply / plan-destroy / destroy backend infra (ap-south-1) |
| `terraform-live-edge` | `workflow_dispatch` | Plan / apply / plan-destroy / destroy edge infra (CloudFront, WAF, S3) |
| `terraform-live-frontend` | `workflow_dispatch` | Plan / apply / plan-destroy / destroy the S3 OAC bucket policy |
| `deploy-live-backend` | `workflow_dispatch`; push to main deploys dev/stg only | Trivy scan → Docker build → ECR push → ECS update |
| `deploy-live-frontend` | `workflow_dispatch`; push to main deploys dev/stg only | React build → S3 sync → CloudFront invalidation |
| `terraform-live-full-stack` | `workflow_dispatch` | Orchestrates all workflows in dependency order |

### Frontend Cache Invalidation

After uploading new frontend assets to S3, run immediately:

```bash
aws cloudfront create-invalidation --distribution-id <id> --paths "/*"
```

This must be the final step of every `deploy-live-frontend` run.

### Environment Protection

The `prod` GitHub environment must have at least one Required Reviewer (GitHub → Settings → Environments → `prod` → Required reviewers). This enforces four-eyes on every production apply and deploy.

### Database Migration Strategy

MongoDB Atlas is schemaless — schema changes are managed at the application layer.

**Rules:**

1. **Backward-compatible changes only** — new fields must have application-level defaults or be treated as optional. Never remove or rename a field in the same deploy that removes the code reading the old name.
2. **Index management** — create new indexes via a pre-deploy one-off ECS task using Motor's `create_index` API before deploying code that depends on them. The one-off task must exit 0 before the rolling service update proceeds.
3. **Two-phase deploys for breaking changes** — Phase 1: deploy code reading both old and new field names; run backfill task; Phase 2: deploy code removing old field read path.
4. **Rollback** — redeploy the previous image. Code rollback is the primary mechanism — MongoDB has no DDL rollback.
5. **Destructive data operations** — create an Atlas on-demand snapshot before any bulk delete or backfill. Confirm PITR restore procedure has been validated in stg first.

### Terraform State Bucket

| Setting | Reason |
|---|---|
| Versioning enabled | Recover from accidental `terraform destroy` or corrupted state |
| SSE-KMS with `enable_key_rotation = true` | State files can contain plaintext secrets; annual key rotation is a baseline compliance requirement |
| MFA delete on bucket versions | Prevents permanent deletion of state history without a second authentication factor |

State locking: `use_lockfile = true` in all S3 backend blocks (native S3 locking, Terraform 1.10+; no DynamoDB table required). GitHub Actions `concurrency` groups with `cancel-in-progress: false` queue concurrent runs rather than cancelling them.

---

## Deployment Guide

```
Phase 1 — Backend (ap-south-1)
  1a. Create Atlas cluster in the Atlas console:
        dev  → M0 (free)
        stg  → M10, Continuous Cloud Backup enabled, 7-day retention
        prod → M20, Continuous Cloud Backup enabled, 30-day retention
  1b. Run terraform-live-backend apply for ap-south-1
        → Creates VPC, subnets, NAT GW (+ EIPs), ALB, ECS service, ElastiCache,
          ECR, Secrets Manager secret, S3 Gateway Endpoint, regional logging S3 bucket
  1c. Record NAT GW EIPs from Terraform output (aws_eip.nat[*].public_ip)
  1d. Whitelist NAT GW EIPs in the Atlas IP Access List
  1e. Verify Secrets Manager was auto-populated; populate manually if auto-population was skipped
  1f. Run deploy-live-backend to build and push the application image
  1g. Verify ECS tasks are healthy:
        → aws ecs describe-services --cluster <name> --services <name>
        → Check CloudWatch Logs for DB connection errors

Phase 2 — ECS Auto Scaling verification
  2a. Run a load test against the stg ALB:
        → Confirm scale-out at CPU 60 %, memory 70 %, or 1,000 req/min/task
        → Confirm scale-in after 5-minute cooldown
  2b. Tune ALBRequestCountPerTarget before prod launch

Phase 3 — CloudFront + WAF + Frontend
  3a. Run terraform-live-edge apply
        → Creates CloudFront distribution (custom origin = ap-south-1 ALB),
          WAF WebACL, S3 frontend bucket, Route 53 records, global logging bucket
  3b. Run terraform-live-frontend apply (attaches OAC bucket policy)
  3c. Run deploy-live-frontend to build and deploy the React app
  3d. Smoke test:
        → /api/health                  → 200
        → /api/auth/login              → 200
        → /api/users (no token)        → 401 (rejected by FastAPI)
        → /api/users (valid JWT)       → 200
        → https://<domain>/            → 200 (React app from S3 via OAC)
        → Direct ALB DNS name         → blocked (CloudFront prefix list SG rule)
```

**Rollback procedures:**

| Phase | Rollback |
|---|---|
| Phase 1 | `terraform destroy` for the backend stack; delete Atlas cluster in Atlas console |
| Phase 2 | `terraform destroy -target=aws_appautoscaling_policy.* -target=aws_appautoscaling_target.*` |
| Phase 3 | Run `terraform destroy` for `infra-live-frontend` first; then `terraform destroy` for `infra-live-edge` |

---

## Cost

### Monthly cost — V1 single region (ap-south-1)

| Environment | Atlas tier | Atlas cost | AWS cost | Total |
|---|---|---|---|---|
| **Dev** | M0 (free) | $0 | ~$79 | **~$79** |
| **Stg** | M10 | ~$57 | ~$107 | **~$164** |
| **Prod** | M20 | ~$190 | ~$478 | **~$668** |

> AWS cost breakdown (prod): ECS Fargate ~$144 (2 tasks baseline), ALB ~$18, ElastiCache cache.r6g.large Multi-AZ ~$234, NAT GW 2 AZs ~$66, CloudFront/WAF ~$6, misc ~$10 ≈ $478.
>
> ECS Auto Scaling ceiling at 6 tasks ≈ $433/month Fargate cost vs $144 baseline — worst-case delta ~$289/month.

### Cost optimisation

| Action | Saving | Applicable to |
|---|---|---|
| S3 Gateway Endpoint (deployed by default) | Eliminates NAT data charges for ECR/S3 traffic; free | All |
| VPC Interface Endpoints for ECR, Secrets Manager, CW Logs | Eliminates NAT data charges for those services; ~$7.30/AZ/month each | All |
| NAT Gateway scheduled deletion outside business hours | ~$33/month per NAT GW; requires EventBridge Scheduler | dev, stg |
| Fargate Spot capacity provider | 40–70 % saving on task cost; use with FARGATE fallback | dev, stg |

---

## V2 Roadmap (deferred from V1)

These items are excluded from V1 scope. Implement when the business justifies the cost and complexity.

| Item | Trigger to implement |
|---|---|
| **CloudFront Function JWT auth at edge** (CF Function + KVS dual-key RS256) | Observably high unauthenticated traffic reaching ALB, or P99 latency requirement on auth check |
| **Multi-region backend expansion** (eu-west-1, us-east-1) | User distribution data showing significant latency for EU or Americas users |
| **Lambda@Edge geo-routing** | Multi-region backend is active |
| **MongoDB Atlas Global Cluster** (M30, geo-sharded by `location`) | Multi-region backend requires data locality for latency or compliance |
| **Health-based automated failover pipeline** (CloudWatch Synthetics → EventBridge → Lambda → Terraform re-apply) | Multi-region is active and manual failover SLA is unacceptable |
| **ECR cross-region replication** | Multi-region ECS deploys are needed |
| **Route 53 latency routing with ALB health checks** | Sub-minute failover SLA when multi-region is active |
