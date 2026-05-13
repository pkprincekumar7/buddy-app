# buddy360 — Production Infrastructure Design

This document is the authoritative specification for the buddy360 production infrastructure on AWS. It covers architecture, module specifications, security, observability, CI/CD, and deployment procedures. All requirements described here must be satisfied for the system to be considered production-grade.

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
        │  CloudFront Fn    │               │  S3 — frontend assets   │
        │  JWT auth at edge │               │  (us-east-1)            │
        │  (viewer request) │               │  OAC — no public access │
        └─────────┬─────────┘               └─────────────────────────┘
                  │ 401 on invalid token · passes valid requests to
                  ▼
        ┌───────────────────┐
        │   Lambda@Edge     │
        │  geo-routing      │
        │  (origin request) │
        └─────────┬─────────┘
                  │ HTTPS/443 to nearest region's ALB
                  ▼

── Backend VPC layout (ECS in private subnets, NAT Gateway for egress) ──

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
╚══════════════════╩══════════════════╩══════════════════╝
  each region: outbound via NAT Gateway ──▶ ECR (regional) · Secrets Manager (regional)
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

**TLS chain:**
```
Browser ──HTTPS──▶ CloudFront ──[CF Fn: JWT auth]──▶ [L@E: geo-route] ──HTTPS──▶ ALB (443) ──HTTP/8000──▶ ECS task
         (us-east-1 ACM cert)   viewer request         origin request    (region ACM cert)      (private subnet · NAT egress)
```

**Region layout:**

| Layer | Region | Role |
|---|---|---|
| CloudFront + WAF | Global (us-east-1) | CDN, DDoS protection, WAF inspection |
| CloudFront Function | us-east-1 (runs at all CF edge nodes) | JWT validation on every `/api/*` viewer request |
| Lambda@Edge | us-east-1 (runs at all CF edge nodes) | Geo-based origin routing on every `/api/*` request |
| S3 — frontend assets | us-east-1 | Static origin for React app |
| Backend (ECS, ALB, ElastiCache) | ap-south-1 (primary); eu-west-1, us-east-1 (expansion) | API serving, session caching |
| MongoDB Atlas Global Cluster | Global | Database, sharded by `location` field |

---

## Infrastructure Modules

### Global Edge — `infra-live-edge`

#### CloudFront Distribution

- WAF WebACL attached with the following rule groups (deploy in `COUNT` mode in stg; switch to `BLOCK` in prod after validating no false positives):
  - **AWS Managed Rules — Core Rule Set** — blocks common OWASP exploits
  - **AWS Managed Rules — Known Bad Inputs** — blocks Log4Shell, SSRF probes
  - **Rate-based rule (global)** — 2,000 requests per 5 min per IP (general throttle)
  - **Rate-based rule (auth endpoints)** — 100 requests per 5 min per IP, scoped to `/api/auth/login` and `/api/auth/register` via `scope_down_statement` byte match on the URI — blocks credential stuffing; evaluated before the global rule and must have higher WAF rule priority
- CloudFront Function on `/api/*` Viewer Request events (JWT auth at edge)
- Lambda@Edge on `/api/*` Origin Request events (geo-based routing)
- S3 Origin Access Control (OAC) for frontend assets — bucket has no public access
- Full access logging to global logging S3 bucket (see [Observability](#observability))
- `viewer_protocol_policy = "redirect-to-https"` on all behaviours
- `price_class = "PriceClass_All"` — serves from all global edge locations; required for low-latency delivery to APAC users (primary region ap-south-1). `PriceClass_100` (US + EU only) or `PriceClass_200` (US + EU + APAC) are lower-cost alternatives if full global coverage is not needed
- **HSTS response headers** via `aws_cloudfront_response_headers_policy`: `Strict-Transport-Security: max-age=31536000; includeSubDomains` — instructs browsers to always use HTTPS and prevents SSL-stripping attacks; attached to all CloudFront behaviours

#### CloudFront Function + KeyValueStore (JWT auth at edge)

Validates every `/api/*` viewer request. Returns `401` for missing or invalid tokens; adds ≤ 1 ms latency at edge; eliminates unauthenticated load from all downstream components.

**Required implementation:**

1. **Validate `exp` claim** — reject any token where `exp < Math.floor(Date.now() / 1000)`; signature-only validation accepts expired tokens indefinitely
2. **Dual-key KVS strategy** — store `key_current` and `key_previous` in KVS; accept tokens valid under either; retire `key_previous` after ~60 s edge-node propagation window to avoid a 401 storm during key rotation
3. **Exempt public endpoints** — bypass JWT check for `/api/health`, `/api/auth/login`, and `/api/auth/register`; blocking these fails ALB health checks and prevents new users from logging in
4. Signing algorithm: **RS256** (asymmetric). The **public verification key** is stored in CloudFront KeyValueStore — safe to expose; possession of the public key does not enable token forgery. The private signing key lives exclusively in Secrets Manager on the backend; only the backend issues tokens. A KVS compromise leaks only a verification key; an attacker cannot forge tokens without the private key.
5. **Token revocation strategy** — RS256 JWTs are stateless; a stolen token remains valid until `exp`. Mitigate with short-lived access tokens (≤ 15 min) combined with a refresh token flow — the attack window is bounded to the access token TTL with no revocation infrastructure overhead. A Redis-based deny-list keyed by `jti` is an alternative but requires the CF Function to call the origin on every request, defeating the purpose of edge auth. If neither is implemented at launch, document it as an accepted risk and ensure access token `exp` is set to ≤ 15 min.

**KVS key rotation procedure (RS256):**
1. Generate a new RS256 key pair on the backend; write the new **public key** to `key_current`; move the old public key to `key_previous`
2. Update the private signing key in Secrets Manager and redeploy the backend service to pick it up
3. Wait ~60 s for all edge nodes to refresh their KVS cache
4. Clear `key_previous`

KVS cost: $0.50/month flat; first 10 M reads/month free. The private key never leaves Secrets Manager — no CloudFront distribution re-deploy needed.

#### Lambda@Edge (geo-routing)

Origin Request handler deployed to `us-east-1`. Reads each deployed region's ALB FQDN from SSM Parameter Store at `terraform apply` time and bakes a static geo-routing table into the function bundle.

- Routes by `CloudFront-Viewer-Country` header; fallback to `ap-south-1` for unknown or unmapped countries
- Routing table is baked at deploy time — no runtime SSM calls, no cold-path latency
- Re-apply `infra-live-edge` after deploying a new backend region to update the routing table

**Operational requirements:**

- **Health-based failover:** the routing table is static — if a regional ALB becomes unhealthy, Lambda@Edge continues routing to it until a re-deploy updates the table. Implement an automated failover pipeline: (1) a CloudWatch Synthetics canary polls each regional ALB `/api/health` endpoint every 60 s; (2) on ≥ 3 consecutive failures, an EventBridge rule triggers a Lambda that marks the SSM ALB FQDN parameter for that region as `UNHEALTHY` and fires the `terraform-live-edge` workflow via `workflow_dispatch` using a GitHub App token stored in Secrets Manager; (3) `infra-live-edge` re-reads SSM, excludes the unhealthy region from the routing table, and re-applies. Expected failover time: 3–5 min. If sub-minute failover is a hard requirement, replace Lambda@Edge geo-routing with Route 53 latency routing + ALB health checks — Route 53 performs automatic failover in ~60 s with no re-deploy required.
- **Cold starts:** ~200–500 ms after 15 min of idle at a given edge PoP. Add a CloudWatch Synthetics canary to keep critical PoPs warm if P99 latency is SLA-critical.

#### S3 — Frontend Assets

| Setting | Value |
|---|---|
| Access | OAC only — all four public-access block flags set to `true` |
| Versioning | Enabled — allows same-day rollback by redeploying a previous build to S3 |
| Encryption | SSE-S3 |
| Lifecycle rule | Expire non-current object versions after 30 days |
| Terraform resources | `aws_s3_bucket` + `aws_s3_bucket_versioning` + `aws_s3_bucket_server_side_encryption_configuration` + `aws_s3_bucket_public_access_block` + `aws_s3_bucket_lifecycle_configuration` |

---

### Frontend Bucket Policy — `infra-live-frontend`

A thin, post-edge module with a single responsibility: attach the S3 OAC bucket policy that grants CloudFront read access to the frontend assets bucket. It cannot be merged into `infra-live-edge` because the bucket policy references the CloudFront distribution ARN, which is only known after `infra-live-edge` completes.

| Property | Value |
|---|---|
| State key | `terraform-state-files/{app}/{env}/frontend/us-east-1/terraform.tfstate` |
| Region | us-east-1 (hardcoded — bucket and SSM parameters both live here) |
| Depends on | `infra-live-edge` (reads `/{app}/{env}/edge/cloudfront_arn` and `/{app}/{env}/edge/s3_bucket_name` from SSM) |
| Destroy before | `infra-live-edge` — remove the bucket policy before destroying the CloudFront distribution |

**Single resource: `aws_s3_bucket_policy`**

Grants `s3:GetObject` to `cloudfront.amazonaws.com` scoped to the specific distribution ARN via `AWS:SourceArn` condition. This is the OAC enforcement mechanism — without it the S3 bucket rejects all requests, including those from CloudFront.

A `precondition` block cross-checks `var.frontend_bucket_name` against the bucket name written to SSM by `infra-live-edge` and fails fast if they diverge, preventing accidental policy attachment to the wrong bucket.

**Apply / destroy order in the full-stack orchestrator:**

Apply: `backend → edge → frontend → deploy-backend → deploy-frontend`

Destroy: `frontend → edge → backend`

---

### Backend — `infra-live-backend` (one deployment per region)

#### VPC and Networking

| Subnet type | Contents |
|---|---|
| Public | ALB, NAT Gateway |
| Private | ECS Fargate tasks, ElastiCache Redis |

NAT Gateway count: dev/stg single-AZ (1 NAT GW per environment); prod 2 AZs (2 NAT GWs for HA — if one AZ becomes unavailable, ECS tasks in the other AZ retain outbound access).

**S3 Gateway Endpoint** (`aws_vpc_endpoint`, type `Gateway`) attached to the private route table. Routes all S3 and ECR layer traffic over the AWS backbone without traversing the NAT Gateway — eliminates NAT data-processing charges for image pulls at no hourly cost.

**VPC Interface Endpoints** for ECR (`ecr.api` + `ecr.dkr`), Secrets Manager, and CloudWatch Logs (`aws_vpc_endpoint`, type `Interface`): the primary reason is **security** — without Interface Endpoints, ECS tasks fetch container images and secrets over the public internet via NAT Gateway even though the destination is an AWS service. Interface Endpoints keep this traffic entirely within the AWS network, eliminating a public internet exposure path for secret fetches and log delivery. Secondary benefit: eliminates NAT data-processing charges for these services (~$7.30/AZ/month each — evaluate against observed NAT volume after the first billing cycle).

**VPC Flow Logs** enabled at the VPC level (`aws_flow_log` in `vpc.tf`), delivering to the regional logging S3 bucket. Provides audit trail for accepted and rejected traffic at the ENI level; required for security group misconfiguration diagnosis and SOC 2 / ISO 27001 network audit controls.

#### Security Groups

The full traffic isolation chain must be enforced with explicit rules. No broad `0.0.0.0/0` inbound rules on any security group.

| Security group | Inbound | Outbound |
|---|---|---|
| **ALB SG** | 443 from CloudFront managed prefix list (`com.amazonaws.global.cloudfront.origin-facing`); 80 from CloudFront managed prefix list (HTTP→HTTPS redirect listener — no content served over HTTP) | 8000 to ECS task SG |
| **ECS task SG** | 8000 from ALB SG only | 443 to internet via NAT GW (Atlas, LLM APIs, ECR); 6379 to ElastiCache SG |
| **ElastiCache SG** | 6379 from ECS task SG only | — |

> The ALB SG inbound rule restricted to the CloudFront managed prefix list is critical. Without it, the ALB is directly reachable via its public DNS name, bypassing CloudFront, WAF, and the CloudFront Function JWT check entirely.

#### Application Load Balancer

- HTTPS (443) listener terminates TLS (regional ACM certificate)
- HTTP (80) listener redirects to HTTPS
- `enable_deletion_protection = true` for stg and prod (remove before any intentional destroy)
- Target group `deregistration_delay = 60 s` — coordinated with ECS `stopTimeout = 60 s` (see ECS section); ensures ALB finishes draining before ECS force-kills the container
- Health check: path `/api/health`, interval 30 s, healthy threshold 2, unhealthy threshold 3
- Access logs enabled → regional logging S3 bucket (see [Observability](#observability))

**CloudWatch Alarms:**
- `HealthyHostCount < 1` → SNS alert
- `HTTPCode_Target_5XX_Count > threshold` → SNS alert

#### ECS Fargate Service

| Environment | CPU | Memory | Min tasks | Initial desired | Max tasks |
|---|---|---|---|---|---|
| Dev | 512 | 1,024 MB | 1 | 1 | 2 |
| Stg | 1,024 | 2,048 MB | 1 | 1 | 3 |
| Prod | 2,048 | 4,096 MB | 2 | 2 | 6 |

- Tasks placed in private subnets; `assign_public_ip = false`
- `health_check_grace_period_seconds = 60` — prevents ALB from marking tasks unhealthy before FastAPI has finished starting (model loading, DB pool init typically takes 10–30 s)
- `stopTimeout = 60 s` with a SIGTERM handler in the FastAPI app that drains in-flight requests before exit; coordinated with ALB `deregistration_delay = 60 s`
- `desired_count` in `ignore_changes` on `aws_ecs_service` — managed by Application Auto Scaler; Terraform must not reset it on apply
- `deployment_circuit_breaker { enable = true, rollback = true }` enabled on **all environments** — if tasks repeatedly fail to become healthy during a deployment, ECS automatically rolls back to the previous task definition revision without manual intervention
- **AZ spread:** `ordered_placement_strategy { type = "spread", field = "attribute:ecs.availability-zone" }` on `aws_ecs_service` — ensures tasks are distributed across AZs. Without this, ECS defaults to `binpack` (cost-optimised, not HA) and can schedule all tasks in the same AZ, making the Multi-AZ NAT GW, ALB, and Redis configuration ineffective.
- Container Insights enabled on the ECS cluster: `setting { name = "containerInsights" value = "enabled" }`
- CloudWatch log group: `/ecs/{APP_NAME}/{env}` — `retention_in_days = 90` (prod), `30` (dev/stg)

**ECS Service Auto Scaling:**

Three target-tracking policies on the ECS service (`aws_appautoscaling_target` + `aws_appautoscaling_policy` × 3):

| Metric | Target | Scale-out cooldown | Scale-in cooldown |
|---|---|---|---|
| `ECSServiceAverageCPUUtilization` | 60 % | 60 s | 300 s |
| `ECSServiceAverageMemoryUtilization` | 70 % | 60 s | 300 s |
| `ALBRequestCountPerTarget` | 1,000 req/min per task | 60 s | 300 s |

Scale-in cooldown is intentionally longer (5 min) to prevent task thrashing — Fargate drain periods are non-trivial. The `ALBRequestCountPerTarget` value of 1,000 req/min is a starting estimate; tune it via load test after initial deployment and before production launch.

**CloudWatch Alarm:** `CPUUtilization > 85 %` → SNS alert

**IAM — least-privilege roles:**

- **Execution role** (ECS uses at task start):
  - `ecr:GetAuthorizationToken` — any resource
  - `ecr:BatchGetImage`, `ecr:GetDownloadUrlForLayer` — specific ECR repo ARN
  - `secretsmanager:GetSecretValue` — specific regional secret ARN
  - `logs:CreateLogStream`, `logs:PutLogEvents` — specific log group ARN
- **Task role** (container uses at runtime): always includes at minimum `xray:PutTraceSegments` and `xray:PutTelemetryRecords` (scoped to `"*"` — X-Ray does not support resource-level policies). Add additional actions scoped to exact resource ARNs if the application calls other AWS APIs (e.g., `s3:PutObject` for uploads).

#### ECR

- `scan_on_push = true`
- EventBridge rule matching `ECR Image Scan` events where `findingSeverityCounts` contains HIGH or CRITICAL → SNS alerts topic
- Image lifecycle policy (`aws_ecr_lifecycle_policy`): expire untagged images after 1 day; retain the 20 most recent tagged images — prevents unbounded image accumulation at CI cadence
- **Cross-region replication:** `aws_ecr_replication_configuration` in ap-south-1 (primary) replicates pushed images to eu-west-1 and us-east-1 automatically (~2–5 min lag). Each regional ECS service pulls from its own regional ECR. Add a destination rule when expanding to a new region — without replication, multi-region ECS deploys fail with "image not found."
- **Pre-push vulnerability scanning:** `deploy-live-backend` runs Trivy (or Grype) on the locally-built image before `docker push`. A HIGH or CRITICAL CVE finding fails the CI job and blocks the push. `scan_on_push` on ECR provides a second layer; image tags are commit SHAs to ensure traceability.

#### ElastiCache Redis

Engine: **Redis 7.1**. Parameter group family: **`default.redis7`**.

| Environment | Node type | Resource | Multi-AZ | Encryption |
|---|---|---|---|---|
| Dev | `cache.t3.micro` | `aws_elasticache_cluster` | No | `at_rest_encryption_enabled = true`, `transit_encryption_enabled = true` |
| Stg | `cache.t3.micro` | `aws_elasticache_cluster` | No | `at_rest_encryption_enabled = true`, `transit_encryption_enabled = true` |
| Prod | `cache.r6g.large` × 2 | `aws_elasticache_replication_group` | Yes (`automatic_failover_enabled = true`, `multi_az_enabled = true`, 1 primary + 1 replica across 2 AZs) | `at_rest_encryption_enabled = true`, `transit_encryption_enabled = true` |

Application connects via `rediss://` (TLS scheme) for in-transit encryption. **All environments require `auth_token`** on the ElastiCache resource (`auth_token` field on both `aws_elasticache_replication_group` and `aws_elasticache_cluster`). TLS authenticates the channel but not the client — without an AUTH token, any process in the VPC that reaches port 6379 can read and write session data with no credential challenge. Store the AUTH token in the regional Secrets Manager secret (see `REDIS_AUTH_TOKEN` below) and inject it into ECS tasks as an environment variable. Prod Multi-AZ ensures automatic failover if the primary node's AZ becomes unavailable — the replica is promoted with no manual intervention.

> `cache.r6g.large` (13.07 GB RAM, non-burstable CPU) is the minimum prod-grade node. `cache.t3.micro` (0.5 GB RAM, burstable CPU) is suitable for dev/stg only — under 6 ECS tasks with active sessions and concurrent connections it will burst and throttle. Downgrade only if a load test confirms memory and connection headroom are sufficient.

**CloudWatch Alarm:** `CurrConnections` drops unexpectedly → SNS alert

#### Secrets Manager

One secret per region per environment at `{APP_NAME}/{env}/backend-secrets`:

| Key | Description |
|---|---|
| `JWT_PRIVATE_KEY` | RSA-2048 private key in PEM format (RS256 signing; private key never leaves Secrets Manager — only the backend issues tokens) |
| `GOOGLE_CLIENT_ID` | OAuth client ID |
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `GEMINI_API_KEY` | Gemini API key |
| `MONGODB_URI` | Atlas connection string |
| `REDIS_AUTH_TOKEN` | ElastiCache AUTH token (64-char random hex; all environments) |

- Terraform creates the secret with `REPLACE_ME` placeholders on first apply; the `terraform-live-backend` workflow auto-populates real values on first apply only (checks `JWT_PRIVATE_KEY == "REPLACE_ME"` before writing — subsequent applies do not overwrite)
- To rotate after initial setup: `aws secretsmanager put-secret-value --secret-id <arn> --secret-string '{...}'`; for `JWT_PRIVATE_KEY`, coordinate with KVS dual-key rotation (write the new **public key** to `key_current` in KVS before updating `JWT_PRIVATE_KEY` in Secrets Manager and redeploying the backend)
- Each region requires its own regional secret — ECS execution roles cannot read Secrets Manager secrets cross-region; `secrets.tf` is parameterised by `var.aws_region` so each regional apply creates the correct secret automatically
- Recommended: add `aws_secretsmanager_secret_rotation` with a Lambda rotation function for `MONGODB_URI` and `JWT_PRIVATE_KEY`

**Plain env vars** (not secrets — set via GitHub environment secrets, injected as ECS task definition env vars at `terraform apply`): `CORS_ORIGINS`, `COOKIE_DOMAIN`, `OPENAI_MODEL`, `ANTHROPIC_MODEL`, `GEMINI_MODEL`.

#### CloudTrail

`aws_cloudtrail` in `cloudtrail.tf`, one per backend region. A separate trail in `infra-live-edge` covers CloudFront and WAF management events in us-east-1.

| Setting | Value |
|---|---|
| S3 destination | Regional logging S3 bucket (same bucket as ALB access logs and VPC Flow Logs) |
| Log file validation | `enable_log_file_validation = true` — detects tampered log files |
| CloudWatch Logs | Enabled — delivers management events to a dedicated log group for real-time alarming |
| Encryption | SSE-KMS; `enable_key_rotation = true` on the KMS CMK — annual automatic key rotation is a baseline SOC 2 / ISO 27001 compliance requirement |
| Multi-region | `is_multi_region_trail = false` — one trail per module per region; the `infra-live-edge` trail captures global/us-east-1 events |

CloudTrail is a baseline requirement for SOC 2 and ISO 27001 audit controls and is the primary forensic tool for "who changed what and when" in AWS.

#### GuardDuty

`aws_guardduty_detector` in `guardduty.tf`, one per backend region (and us-east-1 in `infra-live-edge`):

- `enable = true`; `finding_publishing_frequency = "FIFTEEN_MINUTES"` for prod, `"SIX_HOURS"` for dev/stg
- EventBridge rule: GuardDuty findings with severity ≥ HIGH → SNS alerts topic
- Detects compromised IAM credentials, crypto mining, unusual API call patterns, and network anomalies originating from ECS tasks

Cost: ~$1–3/month per region at typical workload volume. Enable in all environments — the threat detection value far exceeds the cost.

---

### Database — MongoDB Atlas Global Cluster

| Environment | Tier | Cluster nodes | Continuous backup | Retention |
|---|---|---|---|---|
| Dev | M0 (free) | Shared | None | — |
| Stg | M30 | 9 (1 shard × 3 nodes × 3 zones) | Enabled | 7 days |
| Prod | M30 | 9 (1 shard × 3 nodes × 3 zones) | Enabled | 30 days |

- M10 and M20 support replica sets only — they do not support sharding or Global Clusters. M30 is the minimum tier for a Global Cluster.
- Sharded by `location` field: `APAC` (ap-south-1), `EU` (eu-west-1), `AMER` (us-east-1)
- Atlas IP Access List: NAT GW EIP(s) per active region only — not individual task IPs
- TLS enforced on all connections; no plaintext connections permitted
- Enable Continuous Cloud Backup at cluster creation time — do not defer backup configuration
- Verify PITR restore procedure in stg before prod launch — run a restore drill and confirm the application connects successfully to the restored cluster
- Upgrade to M40 (~$6,835/month) if prod workload observably saturates M30 CPU or RAM limits under auto-scaled load

**Connection pool sizing:** default motor `maxPoolSize = 100` per ECS task. At prod max scale (6 tasks): 600 total connections — within M30 limit (~3,000). **Rolling deploy spike:** during an ECS rolling deploy, old and new task revisions run concurrently during the drain window — worst case is 2× `desired_count` tasks active simultaneously (e.g. 12 tasks during a 6-task prod deploy) = 1,200 connections. Still within M30 limits at default `maxPoolSize`. Re-validate if `maxPoolSize` is raised above 250. Saturating Atlas connections causes `ServerSelectionTimeoutError` across all tasks simultaneously.

---

### Cross-module Communication — SSM Parameter Store

`infra-live-backend` writes one SSM parameter per deployed region after a successful apply:

```
/{APP_NAME}/{env}/alb-fqdn   →   <regional-alb-dns-name>
```

`infra-live-edge` reads all regional ALB FQDNs from this path to bake the Lambda@Edge routing table at `terraform apply` time. When referencing the parameter in `infra-live-edge`, pass only the region-specific suffix — the `/{APP_NAME}/{env}` prefix is prepended by `var.ssm_parameter_prefix`.

All three regional parameters must be present in SSM before applying `infra-live-edge` with Lambda@Edge enabled.

---

### DNS and TLS Certificates

#### Route 53

One hosted zone per domain (e.g., `buddy360.com`) managed in Route 53. Records required:

| Record | Type | Target |
|---|---|---|
| `buddy360.com` / `www.buddy360.com` | A (Alias) | CloudFront distribution domain name |
| `api.{env}.buddy360.com` (or equivalent backend subdomain) | CNAME | Regional ALB DNS name (one record per deployed region) |

Use DNS validation for all ACM certificates — validation CNAME records are stable and can be created once, persisting across certificate renewals.

#### ACM Certificates

Two certificate categories are required. Both must use DNS validation.

| Certificate | Region | Used by | Notes |
|---|---|---|---|
| `*.buddy360.com` or `buddy360.com` | **us-east-1** | CloudFront distribution | CloudFront only accepts ACM certs from `us-east-1` regardless of edge location |
| `*.{env}.buddy360.com` or backend subdomain | **Same region as ALB** | ALB HTTPS listener | One cert per backend region; must be in the same region as the ALB |

> ACM certificates in `us-east-1` are referenced in `infra-live-edge` via `var.acm_certificate_arn`. Regional ALB certs are referenced in `infra-live-backend` via `var.acm_certificate_arn` (resolved per-region in the `terraform-live-backend` workflow from the `ACM_CERTIFICATE_ARN_{REGION}` GitHub environment secret).

---

## Observability

### Alerts SNS Topic

One SNS topic per environment (`{APP_NAME}-{env}-alerts`) defined in `sns.tf`:

| Resource | Purpose |
|---|---|
| `aws_sns_topic` | Topic ARN referenced by all CloudWatch Alarms and ECR EventBridge rules |
| `aws_sns_topic_subscription` (email) | Operator email notification — all environments |
| `aws_sns_topic_subscription` (HTTPS) | PagerDuty endpoint — prod only |

All CloudWatch Alarms in this document and the ECR image scan EventBridge rule target this topic. The topic ARN is passed as a Terraform output and consumed by alarm resources in `alarms.tf`.

### CloudWatch Alarms

All alarms target the environment SNS topic:

| Alarm | Threshold | Source |
|---|---|---|
| `HealthyHostCount` | < 1 | ALB target group |
| `HTTPCode_Target_5XX_Count` | > configurable threshold | ALB |
| `HTTPCode_Target_4XX_Count` | > configurable threshold | ALB — spike indicates credential stuffing or a broken auth deploy |
| `CPUUtilization` | > 85 % | ECS service |
| `CurrConnections` | unexpected drop | ElastiCache |

### Log Groups and Retention

| Log group | Retention |
|---|---|
| `/ecs/{APP_NAME}/{env}` | 90 days (prod), 30 days (dev/stg) |
| `/aws/cloudtrail/{APP_NAME}/{env}` | 365 days (prod), 90 days (dev/stg) — required for audit and forensics |

Without a retention policy, CloudWatch log groups default to `Never expire` and accumulate cost indefinitely.

Container Insights must be enabled on the ECS cluster to expose per-task CPU/memory metrics in CloudWatch. Without it, only service-level aggregates are available — per-task alarming and auto-scaling diagnosis are not possible.

### Distributed Tracing — AWS X-Ray

`aws_xray_sampling_rule` in `infra-live-backend`. Enable active tracing on the ECS task definition (`tracingConfig = { mode = "Active" }`). Run the X-Ray daemon as a sidecar container in the task definition.

Instrument the FastAPI application with `opentelemetry-sdk` (recommended) or `aws-xray-sdk-python`. Attach the OTel SDK middleware to FastAPI to emit spans for every inbound request, outbound HTTP call (Atlas, LLM APIs), and Redis operation.

X-Ray traces a request end-to-end: CloudFront → ALB → ECS task → Atlas / LLM API. Without trace IDs, debugging a slow `/api/*` request across 3 regions and 6 tasks requires correlating CloudWatch logs by timestamp — impractical under load.

Required IAM permissions on the ECS task role are covered in the [IAM — least-privilege roles](#ecs-fargate-service) section above.

### CloudWatch Dashboard

One dashboard per environment (`{APP_NAME}-{env}`) defined in `alarms.tf` via `aws_cloudwatch_dashboard`:

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

Without a dashboard, operators must navigate to individual metric pages during an incident. A single dashboard cuts mean time to diagnose.

### Tagging Strategy

All three modules define `default_tags` in the AWS provider block:

```hcl
default_tags {
  tags = {
    Project     = var.app_name
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}
```

`default_tags` in the AWS provider automatically propagates these tags to every resource created by the provider — no per-resource `tags` blocks required. Add `Owner` and `CostCenter` to the default tags when cost allocation reporting is needed across 3 regions × 3 environments = 9 stacks.

### S3 Logging Bucket Strategy

Four log sources write to S3 with different delivery mechanisms and region constraints. They require two separate S3 buckets.

| Log source | Delivery mechanism | Region constraint | Bucket |
|---|---|---|---|
| **CloudFront access logs** | Direct S3 delivery (AWS-managed) | Bucket must be in **us-east-1**; `BucketOwnerPreferred` object ownership required | Global logging bucket |
| **WAF full logs** | Kinesis Data Firehose → S3 | Firehose must be in **us-east-1** (CloudFront WAF constraint); **Firehose stream name must start with `aws-waf-logs-`** — AWS enforces this prefix; any other name causes WAF logging to silently fail | Global logging bucket |
| **ALB access logs** | Direct S3 delivery (ELB service account) | Bucket must be in the **same region as the ALB** | Regional logging bucket |
| **VPC Flow Logs** | Direct S3 delivery | Any region; S3 preferred over CloudWatch Logs for long-retention cost | Regional logging bucket |

**Two-bucket layout (one set per environment):**

- **Global logging bucket** (`us-east-1`): receives CloudFront access logs and WAF Firehose logs. Must have `BucketOwnerPreferred` object ownership via `aws_s3_bucket_ownership_controls` — do not enable ACLs (CloudFront log delivery since 2023 uses bucket policy, not ACL).
- **Regional logging bucket** (one per backend region): receives ALB access logs and VPC Flow Logs. Must have an `aws_s3_bucket_policy` granting `s3:PutObject` to the regional ELB service account (account IDs vary by region — see [AWS ELB account IDs](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/enable-access-logging.html)).

**Both buckets must have this configuration:**

| Setting | Value |
|---|---|
| Block all public access | All four flags `true` |
| Server-side encryption | SSE-S3 (no extra cost) or SSE-KMS if subject to key management policy |
| S3 lifecycle rule | Transition to Glacier Instant Retrieval after 30 days; expire after 90 days (365 days for compliance-regulated workloads) |
| Versioning | Disabled — log files are append-only; versioning adds cost with no benefit |
| Terraform resources | `aws_s3_bucket` + `aws_s3_bucket_public_access_block` + `aws_s3_bucket_server_side_encryption_configuration` + `aws_s3_bucket_lifecycle_configuration` |

---

## CI/CD

### GitHub Actions Workflows

| Workflow | Trigger | What it does |
|---|---|---|
| `terraform-live-backend` | `workflow_dispatch` | Plan / apply / plan-destroy / destroy backend infra for a given region + environment |
| `terraform-live-edge` | `workflow_dispatch` | Plan / apply / plan-destroy / destroy edge infra (CloudFront, WAF, S3 bucket, DNS) |
| `terraform-live-frontend` | `workflow_dispatch` | Plan / apply / plan-destroy / destroy the S3 OAC bucket policy; must run after `terraform-live-edge` |
| `deploy-live-backend` | `workflow_dispatch`; push to main deploys dev/stg only — prod requires explicit `workflow_dispatch` with Required Reviewer approval | Runs pre-push Trivy scan, builds and pushes Docker image to ECR (replicates to other regions automatically), runs pre-deploy MongoDB migration task, updates ECS service |
| `deploy-live-frontend` | `workflow_dispatch`; push to main deploys dev/stg only — prod requires explicit `workflow_dispatch` with Required Reviewer approval | Builds React app, syncs to S3, creates CloudFront cache invalidation |
| `terraform-live-full-stack` | `workflow_dispatch` | Orchestrates all component workflows in dependency order: backend → edge → frontend → deploy |

### Frontend Cache Invalidation

After uploading new frontend assets to S3, a CloudFront cache invalidation must run immediately — without it, edge nodes serve stale JS/CSS bundles until the TTL expires, causing client-server version mismatches:

```bash
aws cloudfront create-invalidation --distribution-id <id> --paths "/*"
```

This must be the final step of every `deploy-live-frontend` run.

### Environment Protection

The `prod` GitHub environment must have at least one Required Reviewer configured (GitHub → Settings → Environments → `prod` → Required reviewers). This blocks all jobs in the `prod` environment — including `terraform apply` and `deploy-*` — until a human approves, enforcing a four-eyes principle on every production change.

### Database Migration Strategy

MongoDB Atlas is schemaless — there is no DDL and no SQL migration tool. Schema changes are managed at the application layer and must be designed for rolling deploys, where old and new task revisions run simultaneously during the transition window.

**Rules:**

1. **Backward-compatible changes only** — new fields must have application-level defaults or be treated as optional by the application code. Never remove or rename a field in the same deploy that removes the code path reading the old field name.
2. **Index management** — create new indexes via a pre-deploy one-off ECS task (`aws ecs run-task`, Fargate, new image) using Motor's `create_index` / `create_indexes` API before deploying application code that depends on them. Atlas builds indexes as background operations and does not block reads or writes, but the index must exist before the new query paths go live. The one-off task must exit 0 before the rolling service update proceeds.
3. **Two-phase deploys for breaking changes** — if a field rename or removal is unavoidable: Phase 1 deploys code that reads both old and new field names; after all running tasks are on Phase 1, run a backfill one-off task to rewrite documents to the new field name; Phase 2 (next deploy) removes the old field read path.
4. **Rollback** — MongoDB has no DDL rollback. Code rollback is the primary mechanism — redeploy the previous image. If Phase 1 wrote new fields to documents, the rolled-back application must still handle documents containing those fields (treat them as ignored, not as errors).
5. **Destructive data operations** — for bulk deletes or backfills, create an Atlas on-demand snapshot before running the operation. Confirm the PITR restore procedure has been validated in stg before executing in prod.

### Terraform State Bucket

The S3 bucket storing Terraform state must be hardened:

| Setting | Reason |
|---|---|
| Versioning enabled | Recover from accidental `terraform destroy` or corrupted state file — without versioning a bad apply is unrecoverable |
| SSE-KMS encryption with `enable_key_rotation = true` | State files can contain plaintext sensitive resource attributes; annual automatic KMS key rotation is a baseline compliance requirement |
| MFA delete on bucket versions | Prevents permanent deletion of state history without a second authentication factor |

**State locking:** all three Terraform modules (`infra-live-backend`, `infra-live-edge`, `infra-live-frontend`) use `use_lockfile = true` in the S3 backend block — the native S3 locking mechanism introduced in Terraform 1.10 (all modules pin `required_version = "~> 1.13.0"`). Terraform writes a `.tflock` object to the same S3 bucket as the state file using a conditional `PutObject` with `If-None-Match: *` — a second concurrent `terraform apply` cannot acquire the lock and fails with an explicit error. No DynamoDB table is required. The IAM role must have `s3:PutObject` and `s3:DeleteObject` on the state bucket for lock acquire and release respectively. GitHub Actions `concurrency` groups (`cancel-in-progress: false`) provide a second layer — concurrent workflow runs are queued rather than killed, so no apply is silently dropped.

---

## Deployment Guide

This guide deploys the full production stack from zero. All phases assume GitHub environment secrets are configured and the Terraform backend S3 bucket (with versioning and SSE-KMS) exists.

```
Phase 1 — Primary backend (ap-south-1)
  1a. Create Atlas cluster in the Atlas console:
        stg → M30, Continuous Cloud Backup enabled, 7-day retention
        prod → M30, Continuous Cloud Backup enabled, 30-day retention
        dev  → M0 (no Global Cluster; no backup needed)
  1b. Run terraform-live-backend apply for ap-south-1
        → Creates VPC, subnets, NAT GW (+ EIPs), ALB, ECS service, ElastiCache,
          ECR, Secrets Manager secret, S3 Gateway Endpoint, regional logging S3 bucket
  1c. Record NAT GW EIPs from Terraform output (aws_eip.nat[*].public_ip)
  1d. Whitelist NAT GW EIPs in the Atlas IP Access List
  1e. Verify Secrets Manager was auto-populated (workflow checks for REPLACE_ME placeholders);
        populate manually if auto-population was skipped
  1f. Run deploy-live-backend to build and activate the application image
  1g. Verify ECS tasks are healthy:
        → aws ecs describe-services --cluster <name> --services <name>
        → Check CloudWatch Logs for DB connection errors

Phase 2 — ECS Auto Scaling verification
  Auto scaling policies are deployed with Phase 1 (included in terraform).
  2a. Run a load test against the stg ALB:
        → Confirm scale-out triggers at CPU 60 %, memory 70 %, or 1,000 req/min/task
        → Confirm scale-in after 5-minute cooldown with no task thrashing
  2b. Tune ALBRequestCountPerTarget based on observed metrics before prod launch

Phase 3 — CloudFront Function + KVS (JWT auth at edge)
  3a. Implement CF Function: exp validation, dual-key KVS, exempt /api/health + /api/auth/*
  3b. Load signing key into KVS (key_current); leave key_previous empty initially
  3c. Apply infra-live-edge (deploys CF Function + KVS, attaches to /api/* behaviour)
  3d. Apply infra-live-frontend (attaches OAC bucket policy; requires infra-live-edge to be healthy)
  3e. Smoke test:
        → /api/health                     → 200 (bypassed)
        → /api/auth/login                 → 200 (bypassed)
        → /api/users (no token)           → 401
        → /api/users (valid JWT)          → 200
        → https://<domain>/               → 200 (React app served from S3 via OAC)

Phase 4 — Multi-region backend expansion (prerequisite for Lambda@Edge)
  Lambda@Edge geo-routing requires regional ALBs to exist before the routing table can
  be baked. Repeat the following for each additional region (eu-west-1, us-east-1):
    4a-i.   Request or import an ACM certificate for the backend subdomain in that region
    4a-ii.  Add the region to the aws_region input options in terraform-live-backend.yml
    4a-iii. Configure GitHub environment secrets for the new region (ACM ARN, etc.)
    4a-iv.  Run terraform-live-backend apply for the new region
    4a-v.   Whitelist the new NAT GW EIP in the Atlas IP Access List
    4a-vi.  Populate the new regional Secrets Manager secret with real values
    4a-vii. Run deploy-live-backend for the new region
    4a-viii.Verify the regional ALB health check passes and CloudWatch Logs show no DB errors
    4a-ix.  Confirm SSM /{APP_NAME}/{env}/alb-fqdn is written for the new region
  4b. Confirm all three regional ALB FQDNs are present in SSM before proceeding

Phase 5 — Lambda@Edge (geo-routing)
  5a. Implement Lambda@Edge function with routing table + fallback entry to ap-south-1
  5b. Apply infra-live-edge (reads all regional ALB FQDNs from SSM; bakes routing table)
  5c. Verify multi-region routing using VPN or curl with CloudFront-Viewer-Country override
```

**Rollback procedures:**

| Phase | Rollback |
|---|---|
| Phase 1 | `terraform destroy` for the region (Atlas cluster must be deleted separately in Atlas console) |
| Phase 2 | `terraform destroy -target=aws_appautoscaling_policy.*` and `aws_appautoscaling_target.*` |
| Phase 3 | Run `terraform destroy` for `infra-live-frontend` first (removes OAC bucket policy); then remove CF Function association from the `/api/*` CloudFront behaviour and `terraform apply infra-live-edge` |
| Phase 4 | `terraform destroy` for the new regional stack; remove its Atlas IP Access List entry and SSM parameter |
| Phase 5 | Remove Lambda@Edge association from the CloudFront behaviour; `terraform apply` |

---

## Cost

### Monthly cost by environment — single backend region (including Atlas)

| Environment | Atlas tier | Atlas cost | AWS cost | Total |
|---|---|---|---|---|
| **Dev** | M0 (free) | $0 | ~$79 | **~$79** |
| **Stg** | M30 Global Cluster | ~$3,550 | ~$107 | **~$3,657** |
| **Prod** | M30 Global Cluster | ~$3,550 | ~$478 | **~$4,028** |

> Atlas Global Cluster rates (us-east-1 baseline; ap-south-1 ~10–15 % higher): M30 ~$0.54/node/hr. Minimal 3-zone Global Cluster = 9 nodes (1 shard × 3 nodes × 3 zones). M30: 9 × $0.54 × 730 h ≈ $3,550/month. Fixed at cluster creation regardless of how many backend regions are active. Upgrade to M40 (~$1.04/node/hr, ≈ $6,835/month) if workload observably saturates M30 CPU or RAM limits under production load.
>
> AWS cost breakdown (stg, 1 region): ECS Fargate ~$36 (1 vCPU × $0.04048 × 730 h + 2 GB × $0.004445 × 730 h), ALB ~$18, ElastiCache cache.t3.micro ~$12, NAT GW ~$34, CloudFront/WAF ~$1, misc ~$7 ≈ $107.
>
> AWS cost breakdown (prod, 1 region): ECS Fargate ~$144 total (2 tasks × ~$72/task; 2 vCPU × $0.04048 × 730 h + 4 GB × $0.004445 × 730 h per task), ALB ~$18, ElastiCache cache.r6g.large Multi-AZ ~$234 (2 nodes × ~$0.160/hr × 730 h; us-east-1 on-demand rate), NAT GW 2 AZs ~$66, CloudFront/WAF ~$6, misc ~$10 ≈ $478.
>
> ECS Auto Scaling variable cost: prod budget ceiling at 6 tasks = ~$433/month (~$72/task × 6) vs ~$144/month at baseline (2 tasks) — worst-case scale-out delta ~$289/month.

### Multi-region cost — AWS infrastructure only (excluding Atlas)

| Environment | 1 region | 2 regions | 3 regions |
|---|---|---|---|
| Dev | ~$79 | ~$145 | ~$211 |
| Stg | ~$107 | ~$198 | ~$289 |
| Prod | ~$478 | ~$902 | ~$1,326 |

### Multi-region cost — including Atlas (fixed regardless of region count)

Atlas Global Cluster spans all three zones at creation — adding backend regions increases AWS infrastructure cost only; Atlas cost does not change.

| Environment | Atlas tier | Atlas cost | 1 region | 2 regions | 3 regions |
|---|---|---|---|---|---|
| Stg | M30 | ~$3,550/month | ~$3,657 | ~$3,748 | ~$3,839 |
| Prod | M30 | ~$3,550/month | ~$4,028 | ~$4,452 | ~$4,876 |

### Cost optimisation

| Action | Saving | Applicable to |
|---|---|---|
| S3 Gateway Endpoint (deployed by default alongside NAT GW) | Eliminates NAT data charges for all ECR/S3 traffic; free — no hourly cost | All |
| VPC Interface Endpoints for ECR (`ecr.api` + `ecr.dkr`), Secrets Manager, CloudWatch Logs | Eliminates NAT data charges for those AWS services; ~$7.30/AZ/month each — evaluate after observing actual NAT data volume in the first billing cycle | All |
| NAT Gateway scheduled deletion outside business hours for dev/stg | ~$33/month per NAT GW saved; requires EventBridge Scheduler to delete/recreate; adds ~2 min cold-start on first deploy of the day | dev, stg |
| Fargate Spot capacity provider for dev/stg | 40–70 % saving on Fargate task cost; add `capacity_provider_strategy` with `FARGATE_SPOT` as base and `FARGATE` as fallback — Spot tasks replaced within ~2 min on interruption, acceptable for non-prod | dev, stg |
