# Live Infrastructure — Proposed Changes

This document describes the planned improvements to the current buddy360 infrastructure. For the current baseline — module structure, deploy workflows, GitHub Actions secrets, and operational runbooks — see [README_LIVE.md](README_LIVE.md).

---

## Summary of Proposed Changes

Three additions are planned, all independent of each other and deployable incrementally:

| # | Change | Where | What it solves |
|---|---|---|---|
| 1 | **NAT Gateway + S3 Gateway Endpoint** | `infra-live-backend` | Move ECS tasks from public subnets to private subnets; eliminates direct public IPs on tasks |
| 2 | **CloudFront Function + KeyValueStore** | `infra-live-edge` | JWT auth at the CloudFront edge — blocks unauthenticated requests before they reach any backend |
| 3 | **Lambda@Edge** | `infra-live-edge` | Geo-based multi-region routing — routes `/api/*` to the nearest regional ALB based on viewer country |

---

## Proposed Architecture

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

── Proposed backend VPC layout (ECS in private subnets, NAT Gateway for egress) ──

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

**Proposed TLS chain:**
```
Browser ──HTTPS──▶ CloudFront ──[CF Fn: JWT auth]──▶ [L@E: geo-route] ──HTTPS──▶ ALB (443) ──HTTP/8000──▶ ECS task
         (us-east-1 ACM cert)   viewer request         origin request    (region ACM cert)      (private subnet · NAT egress)
```

**Proposed region roles (additions to current):**

| Layer | Region | Notes |
|---|---|---|
| CloudFront Function | `us-east-1` (deployed; runs at all CF edge nodes) | JWT validation (HS256) on every `/api/*` viewer request; reads signing key from CloudFront KeyValueStore (KVS); returns `401` for missing or invalid tokens before the request reaches Lambda@Edge or any backend ALB |
| Lambda@Edge | `us-east-1` (deployed; runs at all CF edge nodes) | Geo-based origin routing on every `/api/*` request; selects nearest backend region's ALB via `CloudFront-Viewer-Country` header |

---

## Proposed Changes per Module

### Backend — `infra-live-backend`

#### NAT Gateway

Move ECS tasks from public subnets to private subnets. NAT Gateway provides outbound internet access from private subnets.

- One NAT Gateway per AZ in use; `dev`/`stg` deploy 1 (single-AZ); `prod` deploys 2 (one per AZ for HA)
- ECS tasks no longer have public IPs; outbound traffic exits via NAT GW Elastic IP
- Terraform changes required: update `aws_ecs_service` network configuration to use private subnets; add `aws_nat_gateway` + `aws_eip`; add a default route in the private route table pointing to the NAT GW

> ⚠ **Breaking change on adoption:** ECS tasks currently reach MongoDB Atlas using their assigned public IP addresses (`assign_public_ip = true`). After this change, all outbound traffic exits via the NAT Gateway's Elastic IP. **Update the MongoDB Atlas IP Access List to whitelist the NAT GW EIP(s) before applying** — if you apply without updating Atlas, all database connections will be refused immediately and the service will be down.
>
> Capture the NAT GW EIP from Terraform output (`aws_eip.nat[*].public_ip`) and add it to Atlas before the ECS service restarts.
>
> `dev`/`stg` single-AZ NAT GW is a single point of failure: if the NAT GW becomes unavailable, ECS tasks lose all outbound access (MongoDB, LLM APIs, ECR pulls). Acceptable for non-prod; for `prod` the 2-NAT-GW layout distributes this risk across AZs.

#### S3 Gateway Endpoint

A free VPC Gateway Endpoint (`aws_vpc_endpoint`, type `Gateway`) attached to the private route table. Routes all S3 traffic — including ECR layer downloads, which are stored in S3 — directly over the AWS backbone without traversing the NAT Gateway.

- Eliminates NAT data-processing charges for S3 traffic; no hourly cost
- Must be deployed alongside or before NAT Gateway to avoid paying NAT data charges for ECR pulls from day one

---

### Edge — `infra-live-edge`

#### CloudFront Function + KeyValueStore

A Viewer Request function attached to the `/api/*` CloudFront behaviour. Validates JWT (HS256) using the signing key stored in CloudFront KeyValueStore (KVS). Returns `401` for missing or invalid tokens before the request reaches Lambda@Edge, ALB, or ECS.

- Adds ≤ 1 ms latency at edge; eliminates unauthenticated request load on all downstream components
- KVS key rotation requires a single `aws cloudfront-keyvaluestore put-key` call — no distribution re-deploy needed
- KVS cost: $0.50/month flat; first 10 M reads/month free

> ⚠ **Three requirements before enabling in production:**
> 1. **Validate the `exp` claim** — signature-only validation accepts expired tokens indefinitely; the function must reject any token where `exp < current_unix_time`.
> 2. **Dual-key rotation strategy** — CloudFront edge nodes cache the KVS value independently. Writing a new key instantly breaks tokens signed with the old key at nodes that haven't refreshed yet. Store both `key_current` and `key_previous` in KVS and accept tokens valid under either; retire `key_previous` after a safe propagation window (~60 s).
> 3. **Exempt public endpoints** — `/api/health`, `/api/auth/login`, and `/api/auth/register` must bypass JWT validation (add a path-prefix check before the signature check). Blocking them causes ALB health-check failures and prevents unauthenticated users from logging in.

#### Lambda@Edge

An Origin Request handler deployed to `us-east-1`. Reads each deployed region's ALB FQDN from SSM at `terraform apply` time and bakes a geo-routing table keyed by `CloudFront-Viewer-Country` header into the function bundle. At request time the function selects the nearest regional ALB and rewrites the origin; it cannot access VPC resources or SSM at runtime.

- Re-applying `infra-live-edge` after adding a new backend region updates the routing table with the new region's ALB
- Routing table is baked at deploy time — no runtime SSM calls, no cold-path latency

> ⚠ **No health-based failover:** the routing table is static. If a regional ALB becomes unhealthy or unreachable, Lambda@Edge continues routing traffic to it until a re-deploy bakes an updated table. Mitigation: add a default/fallback entry so unknown or unmapped countries fall through to the primary (`ap-south-1`) ALB; consider a separate health-check Lambda that updates the routing table via SSM and triggers a re-apply.
>
> **Cold starts** occur after ~15 min of idle at a given edge PoP and add 200–500 ms latency on the first request. Document this in your latency SLAs; add a CloudWatch Synthetics canary to keep critical PoPs warm if P99 is business-critical.

---

## Implementation Order

Apply these changes in sequence to minimise risk. Each step is independently deployable.

```
Phase 1 — NAT Gateway + S3 Gateway Endpoint
  1a. Capture existing ECS task public IPs (for reference)
  1b. Create NAT Gateway EIPs and record Elastic IP addresses
  1c. Update MongoDB Atlas IP Access List with the new EIP(s)
  1d. Apply infra-live-backend (adds NAT GW, S3 GW endpoint, moves ECS to private subnets)
  1e. Verify ECS tasks are healthy and Atlas connections succeed
      → Run: aws ecs describe-services + check CloudWatch Logs for DB errors

Phase 2 — CloudFront Function + KVS (JWT auth at edge)
  2a. Implement CF Function with exp validation, dual-key KVS support, and public endpoint exemptions
  2b. Load signing key into KVS (key_current)
  2c. Apply infra-live-edge (deploys CF Function + KVS, attaches to /api/* behaviour)
  2d. Smoke test: unauthenticated /api/health → 200, /api/users → 401, valid JWT → 200

Phase 3 — Lambda@Edge (geo-routing)
  3a. Implement Lambda@Edge function with geo-routing table + fallback entry
  3b. Apply infra-live-edge (deploys Lambda@Edge alongside CF Function)
  3c. Verify routing from multiple regions using VPN or curl with x-forwarded-for headers
```

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
| Cold-start latency undocumented **[recommended]** | Edge PoPs idle for >15 min trigger 200–500 ms cold starts on the first request — P99 latency spikes unexpectedly | Document in service SLA; add a CloudWatch Synthetics canary to keep critical PoPs warm if P99 is business-critical |

### ECS — scaling and resilience

| Gap | Risk | Fix |
|---|---|---|
| No ECS Service Auto Scaling **[blocking for prod]** | Prod is hardcoded at 2 tasks — a traffic spike saturates CPU/memory with no automatic scale-out | Add `aws_appautoscaling_target` + `aws_appautoscaling_policy` (target tracking on CPU ≥ 60 % and/or ALB request count per target); set min 2, max 6 tasks for prod; min 1, max 3 for stg |
| ALB deletion protection disabled **[recommended]** | `terraform destroy` or an accidental workflow run drops the ALB (and all traffic) with no confirmation prompt | Add `enable_deletion_protection = true` to the ALB resource in `alb.tf` for `stg` and `prod`; remove it before any intentional destroy |

### Observability

| Gap | Risk | Fix |
|---|---|---|
| No CloudWatch Alarms **[blocking for prod]** | No automated alerting when ECS tasks are unhealthy, ALB 5xx rate spikes, or Redis connection count drops — incidents go undetected until a user reports them | Add alarms for: `HealthyHostCount < 1` (ALB target group), `HTTPCode_Target_5XX_Count > threshold` (ALB), `CPUUtilization > 85 %` (ECS), `CurrConnections` drop (ElastiCache); wire to SNS → email or PagerDuty |
| WAF full logging disabled **[recommended]** | WAF only samples requests — sampled logs are insufficient for security incident investigation or false-positive tuning | Enable WAF logging to Kinesis Data Firehose → S3: add `aws_wafv2_web_acl_logging_configuration` in `waf.tf` with a Kinesis Firehose delivery stream; retain logs for 90 days in S3 with lifecycle policy |
| ALB access logs disabled **[recommended]** | No record of which IPs/paths hit the ALB — cannot audit traffic patterns, debug 5xx causes, or meet compliance logging requirements | Enable ALB access logs in `alb.tf` (`access_logs { bucket = ... enabled = true }`); use the same logging S3 bucket as WAF or a dedicated one |

### Secrets Management

| Gap | Risk | Fix |
|---|---|---|
| No Secrets Manager automatic rotation **[recommended]** | `JWT_SECRET` and database credentials are never rotated automatically — a credential leak has an unbounded blast radius | Add `aws_secretsmanager_secret_rotation` with a Lambda rotation function for `MONGODB_URI` and `JWT_SECRET`; for JWT, pair with the dual-key KVS strategy above to ensure edge nodes consume the new key before the old one is retired |

---

## Cost Impact

### Incremental cost of proposed changes (per backend region per month)

| Addition | Dev | Stg | Prod |
|---|---|---|---|
| **NAT Gateway — hourly** | $33 | $33 | $66 |
| **NAT Gateway — data processing** (~10 / 25 / 100 GB) | $1 | $1 | $4 |
| **S3 Gateway Endpoint** | $0 | $0 | $0 |
| **Backend delta** | **+$34** | **+$34** | **+$70** |

| Addition | Dev | Stg | Prod |
|---|---|---|---|
| **CloudFront Function — invocations** | $0 | $0 | ~$1 |
| **CloudFront KeyValueStore — flat fee** | $1 | $1 | $1 |
| **Lambda@Edge — Origin Request** | $0 | $0 | ~$4 |
| **Global delta** | **+$1** | **+$1** | **+$6** |

> NAT Gateway: $0.045/hour × 730 h = $32.85/AZ/month + $0.045/GB data processed. Dev/stg 1 AZ · prod 2 AZs. S3 Gateway Endpoint (free) eliminates NAT data charges for all S3/ECR traffic.
> CloudFront Function: $0.10/million invocations; assumes ~60 % of traffic hits `/api/*`. Dev ~300 K · stg ~1.2 M · prod ~12 M invocations/month.
> KVS: $0.50/month base; first 10 M reads/month free.
> Lambda@Edge: ~$0.60/million requests + $0.00000625125/100ms execution.

### Environment totals — current vs proposed (single backend region, including Atlas)

| Environment | Current | Proposed | Monthly delta |
|---|---|---|---|
| **Dev** | ~$44 / month | ~$79 / month | +$35 |
| **Stg** | ~$683 / month | ~$718 / month | +$35 |
| **Prod** | ~$1 418 / month | ~$1 494 / month | +$76 |

### Multi-region cost impact — proposed (AWS infrastructure only, excluding Atlas)

| Environment | 1 region | 2 regions | 3 regions |
|---|---|---|---|
| Dev — proposed | ~$79 | ~$145 | ~$211 |
| Stg — proposed | ~$107 | ~$198 | ~$289 |
| Prod — proposed | ~$269 | ~$484 | ~$699 |

### Multi-region cost impact — proposed (including Atlas)

| Environment | 1 region | 2 regions | 3 regions |
|---|---|---|---|
| Stg — proposed | ~$718 | ~$809 | ~$900 |
| Prod — proposed | ~$1 494 | ~$1 709 | ~$1 924 |

> Atlas Global Cluster cost is fixed regardless of region count — the cluster already spans all three zones at creation time.

### Cost optimisation tips for proposed additions

| Action | Saving | Applicable to |
|---|---|---|
| Add S3 Gateway Endpoint alongside NAT GW | Eliminates NAT data charges for all S3 traffic (ECR layers are stored in S3); free — no hourly cost | All (deploy together with NAT GW) |
| Add VPC Interface Endpoints for ECR (`ecr.api` + `ecr.dkr`), Secrets Manager, and CloudWatch Logs | Eliminates NAT data charges for those AWS services; each Interface Endpoint ~$7.30/AZ/month — worth it only if observed NAT data volume significantly exceeds endpoint cost | All (evaluate after observing actual NAT data in the first billing cycle) |
| Schedule NAT Gateway deletion outside business hours in dev/stg | ~$33/month per NAT GW; requires Lambda or EventBridge Scheduler to delete/recreate; adds ~2 min cold-start on first deploy of the day | dev, stg |
