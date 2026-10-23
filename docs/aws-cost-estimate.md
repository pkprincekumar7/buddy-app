# AWS Monthly Cost Estimate

> **What this models:** the infrastructure **as the code defines it today**: the tfvars of each environment, `services.tf` and the Terraform stacks. dev, sbx and stg are costed at their tfvars. **prod is costed at its tfvars in every column**: prod's task counts and Valkey size are fixed by `prod.tfvars` whatever the traffic, so only usage-based lines (data, requests, logs) change with MAU.
> **Scale unit:** Monthly Active Users (MAU): 1K = 1,000 MAU, 10K = 10,000 MAU, and so on.
> **Region:** one backend region, ap-south-1, plus us-east-1 for the edge (CloudFront, WAF, ACM, Lambda@Edge). Each additional backend region adds its own copy of the per-region lines; see "Key caveats".
> **Hours:** 720 h/month, with every environment **always on**. Non-prod environments can instead run on the nightly schedule; see "Scheduled non-prod environments".
> **Traffic model:** 500 requests/MAU/month; 70% are API calls reaching ECS, 30% are static assets served from CloudFront. 2 MB CloudFront egress/MAU/month; 1 MB/MAU/month through the NAT Gateway (outbound LLM API traffic). Decimal units: 1 GB = 1,000 MB.
> **Log volume:** ~175 KB/MAU/month (350 API requests × ~500 bytes per log entry).
> **Pricing confidence:** ✓ = confirmed against AWS's Price List API (`pricing.us-east-1.amazonaws.com`). Re-verified 2026-10-23: ElastiCache (Valkey) `cache.t4g.*`, Firehose (us-east-1), public IPv4, CloudWatch metrics, alarms and log storage. Every other ✓ figure was verified September 2026. "Remaining estimates" lists the few that aren't verified.

---

## Configuration (from the code)

| Resource (per backend region) | dev | sbx | stg | prod (all MAU columns) | Source |
|---|---|---|---|---|---|
| **API** (`backend`) task × min tasks | 0.25 vCPU / 0.5 GB × 1 | 0.25 vCPU / 0.5 GB × 1 | 1 vCPU / 2 GB × 2 | 1 vCPU / 2 GB × 15 | `task_cpu`, `task_memory`, `api_min_capacity` |
| **Worker** task × min tasks | 0.25 / 0.5 × 1 | 0.25 / 0.5 × 1 | 1 / 2 × 1 | 1 / 2 × 5 | `worker_task_*`, `worker_min_capacity` |
| **Auth** task × min tasks | 0.25 / 0.5 × 1 | 0.25 / 0.5 × 1 | 0.5 / 1 × 2 | 2 / 4 × 3 | `auth_task_*`, `auth_min_capacity` |
| **Admin** task × min tasks | 0.25 / 0.5 × 1 | 0.25 / 0.5 × 1 | 0.5 / 1 × 1 | 0.5 / 1 × 1 | `admin_task_*`, `admin_min_capacity` |
| Autoscaling max (API / worker / auth / admin) | 3 / 2 / 2 / 2 | 3 / 2 / 2 / 2 | 10 / 5 / 4 / 2 | 200 / 50 / 30 / 3 | `*_max_capacity` |
| ADOT sidecar | off | off | off | off | `enable_adot_sidecar` |
| **ElastiCache** (Valkey 8.0) | `cache.t4g.micro` × 1 | `cache.t4g.micro` × 1 | `cache.t4g.small` × 1 | `cache.t4g.medium` × 2 (primary + 1 replica, multi-AZ) | `elasticache_*`, `modules/redis` |
| **NAT Gateways** | 1 | 1 | 2 | 3 | `nat_gateway_count` |
| **VPC interface endpoints** (ECR API, ECR DKR, Secrets Manager, Logs, X-Ray) | none | none | 5 × 2 AZ | 5 × 3 AZ | `modules/network` (created when `nat_gateway_count > 1`) |
| **Public IPv4 addresses** (NAT EIPs + public ALB, one per AZ) | 1 + 3 | 1 + 3 | 2 + 3 | 3 + 3 | NAT count; ALB in 3 public subnets |
| ALBs | 1 public | 1 public | 1 public | 1 public | `modules/alb` |
| CloudWatch: basic / all alarms, dashboard | off / off, off | off / off, off | on / off, off | on / on, on | `enable_basic_alarms`, `enable_all_alarms`, `enable_dashboard` |
| Container Insights | on | on | on | on | `ecs.tf` (cluster setting) |
| Log retention | 7 d | 7 d | 30 d | 90 d | `log_retention_days` |
| GuardDuty (backend region / edge us-east-1) | off / off | off / off | on / on | on / on | `enable_guardduty` (backend, edge tfvars) |
| CloudTrail (backend regional trail / edge us-east-1 trail) | off / off | off / off | on / off | on / on | `enable_cloudtrail` (backend, edge tfvars) |
| ALB access logs | off | off | on | on | `enable_alb_access_logs` |
| WAF / WAF logging (Firehose) | off / off | off / off | on / off | on / on | `enable_waf`, `enable_waf_logging` (edge) |
| CloudFront price class | `PriceClass_100` | `PriceClass_100` | `PriceClass_100` | `PriceClass_All` | `cloudfront_price_class` (edge) |

> **Why prod is the same in every column:** `prod.tfvars` keeps 15 API, 5 worker, 3 auth and 1 admin tasks and a 2-node `cache.t4g.medium` Valkey running at all times. That's what the code bills, at 1K MAU as at 100M. Sizing prod down for low traffic would need tfvars changes, which aren't modeled here. Above the minimums, autoscaling adds tasks under load (see section 2).
> **Task sizing (TF-03):** each process (one uvicorn or asyncio process per task) can use about 1 vCPU, so the API and worker scale by **task count** at 1 vCPU / 2 GB from stg up. Auth is larger in prod (2 vCPU / 4 GB) because bcrypt runs in threads. dev/sbx run every service at Fargate's smallest size, 0.25 vCPU / 0.5 GB.

---

## 1. Networking (NAT, VPC endpoints, public IPv4)

Prices (✓): NAT Gateway $0.056/hr per gateway + $0.056/GB processed. VPC interface endpoint $0.013/hr per AZ. Public IPv4 address $0.005/hr (in use or idle; re-verified 2026-10-23).

| Resource | dev | sbx | stg | prod (1K) | prod (10K) | prod (100K) | prod (1M) | prod (10M) | prod (100M) |
|---|---|---|---|---|---|---|---|---|---|
| NAT Gateway hourly | $40 | $40 | $81 | $121 | $121 | $121 | $121 | $121 | $121 |
| NAT data processing (1 MB/MAU) | $0 | $0 | $0 | $0 | $1 | $6 | $56 | $560 | $5,600 |
| VPC interface endpoints (5 services) | $0 | $0 | $94 | $140 | $140 | $140 | $140 | $140 | $140 |
| Public IPv4 addresses | $14 | $14 | $18 | $22 | $22 | $22 | $22 | $22 | $22 |
| **Subtotal** | **$54** | **$54** | **$193** | **$283** | **$284** | **$289** | **$339** | **$843** | **$5,883** |

> **NAT hourly:** 1 gateway × $0.056 × 720 h = $40; 2 = $81; 3 = $121. NAT data is outbound LLM API traffic. In dev/sbx (no interface endpoints) AWS API traffic (ECR pulls, logs, Secrets Manager) also goes through the NAT, but at dev traffic that's a few GB.
> **Interface endpoints:** stg 5 × 2 AZ × $0.013 × 720 = $94; prod 5 × 3 × $0.013 × 720 = $140. **The X-Ray endpoint is still created** although nothing sends traces (the ADOT sidecar is off and the app isn't instrumented). That's $19/month in stg and $28/month in prod for an unused endpoint.
> **Public IPv4:** dev/sbx 4 addresses × $0.005 × 720 = $14; stg 5 = $18; prod 6 = $22. The public ALB holds at least one address per AZ (3), and more if AWS adds ALB nodes under load. ECS tasks have no public IP.

---

## 2. ECS Fargate

Prices (✓): vCPU $0.04256/hr, memory $0.004655/GB-hr (Linux/x86, ap-south-1). The task definitions don't set an architecture, so they run on x86.

Per-task monthly cost (720 h):

| Task size | vCPU cost | Memory cost | Total/task/month |
|---|---|---|---|
| 0.25 vCPU / 0.5 GB | $7.66 | $1.68 | **$9.34** |
| 0.5 vCPU / 1 GB | $15.32 | $3.35 | **$18.67** |
| 1 vCPU / 2 GB | $30.65 | $6.70 | **$37.35** |
| 2 vCPU / 4 GB | $61.29 | $13.41 | **$74.70** |

| Resource (min tasks × cost/task) | dev | sbx | stg | prod (1K) | prod (10K) | prod (100K) | prod (1M) | prod (10M) | prod (100M) |
|---|---|---|---|---|---|---|---|---|---|
| API (`backend`) | $9 | $9 | $75 | $560 | $560 | $560 | $560 | $560 | $560 |
| Worker | $9 | $9 | $37 | $187 | $187 | $187 | $187 | $187 | $187 |
| Auth + admin | $19 | $19 | $56 | $243 | $243 | $243 | $243 | $243 | $243 |
| **Subtotal** | **$37** | **$37** | **$168** | **$990** | **$990** | **$990** | **$990** | **$990** | **$990** |

> **Breakdown:** prod is 15 × $37.35 (API) + 5 × $37.35 (worker) + 3 × $74.70 (auth) + 1 × $18.67 (admin) = $990. stg is 2 × $37.35 + 1 × $37.35 + 2 × $18.67 + 1 × $18.67 = $168. dev/sbx are 4 × $9.34 = $37.
> **These are minimum-task costs (a floor).** At every prod service's autoscaling maximum (200 API, 50 worker, 30 auth, 3 admin) Fargate would cost about **$11,633/month**. `desired_count` equals the minimum in every environment.

---

## 3. Application Load Balancer

Prices (✓): $0.0239/hr base + $0.008/LCU-hr (ap-south-1). One public ALB per backend region, with one target group and listener rule per HTTP service (auth, admin, backend); extra rules and target groups cost nothing.

| Resource | dev | sbx | stg | prod (1K) | prod (10K) | prod (100K) | prod (1M) | prod (10M) | prod (100M) |
|---|---|---|---|---|---|---|---|---|---|
| ALB hourly base | $17 | $17 | $17 | $17 | $17 | $17 | $17 | $17 | $17 |
| LCU usage (scales with request rate) | $0 | $0 | $1 | $1 | $1 | $2 | $5 | $30 | $280 |
| **Subtotal** | **$17** | **$17** | **$18** | **$18** | **$18** | **$19** | **$22** | **$47** | **$297** |

---

## 4. ElastiCache (Valkey)

Prices (✓, re-verified 2026-10-23, Valkey on-demand, ap-south-1): `cache.t4g.micro` $0.016/hr, `cache.t4g.small` $0.0328/hr, `cache.t4g.medium` $0.0648/hr. Valkey nodes cost about 20% less than the same Redis OSS nodes.

| Resource | dev | sbx | stg | prod (1K) | prod (10K) | prod (100K) | prod (1M) | prod (10M) | prod (100M) |
|---|---|---|---|---|---|---|---|---|---|
| Node type × nodes | t4g.micro × 1 | t4g.micro × 1 | t4g.small × 1 | t4g.medium × 2 | t4g.medium × 2 | t4g.medium × 2 | t4g.medium × 2 | t4g.medium × 2 | t4g.medium × 2 |
| **Subtotal** (nodes × rate × 720 h) | **$12** | **$12** | **$24** | **$93** | **$93** | **$93** | **$93** | **$93** | **$93** |

> **What Valkey holds:** only rate-limit counters (slowapi per IP and per user, the per-user hourly LLM limit) and the session-cleanup lock. That's a few MB, up to a few GB at very high traffic. If it's unavailable, the app falls back to per-task in-memory limits.
> **Sizing:** prod runs a primary and one replica across AZs for automatic failover. `t4g` nodes are burstable; move prod to `cache.r7g.large` (2 × $129/month on Valkey) when sustained load needs dedicated CPU.

---

## 5. CloudFront + Lambda@Edge

**CloudFront India pricing (✓)** (prod, `PriceClass_All`, assuming viewers mainly in India): 1 TB/month free, then $0.109/GB (next 9 TB), $0.085/GB (next 40 TB), $0.082/GB (next 100 TB), $0.080/GB (next 350 TB). HTTPS requests: 10 M/month free, then $0.0120 per 10,000. dev, sbx and stg use `PriceClass_100` (North America, Europe, Israel edges only), and their traffic is within the free tier.

**Lambda@Edge (✓):** $0.60/million requests + $0.00005001/GB-second. The JWT validator runs at origin-request with 128 MB (~5 ms average), on `/api/*` requests only (70% of total).

**CloudFront Functions (not re-verified, see Pricing Reference):** ~$0.10/million invocations, first 2M/month free. `spa-rewrite` runs at viewer-request on the default `/*` behaviour, i.e. the 30% of requests that aren't `/api/*`, on cache hits too.

### CloudFront data transfer

| Scale | Total GB | Free 1,024 GB | $0.109 (≤9,216 GB) | $0.085 (≤40,960 GB) | $0.082 (≤102,400 GB) | $0.080 (≤358,400 GB) | **Data cost** |
|---|---|---|---|---|---|---|---|
| ≤100K MAU | ≤200 GB | All free | — | — | — | — | **$0** |
| 1M MAU | 2,000 GB | 1,024 GB | 976 GB → $106 | — | — | — | **$106** |
| 10M MAU | 20,000 GB | 1,024 GB | 9,216 GB → $1,005 | 9,760 GB → $830 | — | — | **$1,835** |
| 100M MAU | 200,000 GB | 1,024 GB | 9,216 GB → $1,005 | 40,960 GB → $3,482 | 100,000 GB → $8,200 | 48,800 GB → $3,904 | **$16,591** |

### HTTPS request cost

500 req/MAU; 10 M free/month; $0.0120 per 10,000 thereafter:

| Scale | Total requests | After free tier | **Request cost** |
|---|---|---|---|
| 1K MAU | 500 K | 0 | **$0** |
| 10K MAU | 5 M | 0 | **$0** |
| 100K MAU | 50 M | 40 M | **$48** |
| 1M MAU | 500 M | 490 M | **$588** |
| 10M MAU | 5 B | 4,990 M | **$5,988** |
| 100M MAU | 50 B | 49,990 M | **$59,988** |

| Resource | dev | sbx | stg | prod (1K) | prod (10K) | prod (100K) | prod (1M) | prod (10M) | prod (100M) |
|---|---|---|---|---|---|---|---|---|---|
| CF data transfer | $0 | $0 | $0 | $0 | $0 | $0 | $106 | $1,835 | $16,591 |
| CF HTTPS requests | $0 | $0 | $0 | $0 | $0 | $48 | $588 | $5,988 | $59,988 |
| Lambda@Edge requests ($0.60/M, 70% of req) | $0 | $0 | $0 | $0 | $2 | $21 | $210 | $2,100 | $21,000 |
| Lambda@Edge compute (128 MB / 5 ms) | $0 | $0 | $0 | $0 | $0 | $1 | $11 | $110 | $1,095 |
| CloudFront Functions (`spa-rewrite`, $0.10/M, 30% of req, 2M free) | $0 | $0 | $0 | $0 | $0 | $1 | $15 | $150 | $1,500 |
| **Subtotal** | **$0** | **$0** | **$0** | **$0** | **$2** | **$71** | **$930** | **$10,183** | **$100,174** |

> At 100M MAU, CloudFront HTTPS request charges ($59,988) are the largest single line, driven by 50 billion requests a month. `/api/*` responses aren't cached (`CachingDisabled`), and static assets use `CachingOptimized`.

---

## 6. WAF (us-east-1; stg + prod)

Prices (✓): $5.00/WebACL/month + $1.00/rule/month + $1.00/managed rule group/month + **$0.60 per million requests inspected**, prorated hourly. Configuration (`waf.tf`): 1 WebACL, 2 custom rules (`GeoBlockUnservedCountries`, `RateLimitPerIP`) and 3 AWS managed rule groups (Common, KnownBadInputs, AmazonIpReputationList), i.e. **$10/month fixed**. The WebACL is attached to CloudFront, so **every request is inspected** (500 req/MAU).

WAF logging (prod only, `enable_waf_logging`): delivered through **Kinesis Data Firehose in us-east-1** (CloudFront WAFs log there), Direct PUT, **$0.029/GB with each record billed as at least 5 KB** (✓, re-verified 2026-10-23). A WAF log record is about 1–2 KB, so billing is effectively 5 KB per request, about $0.145 per million requests. Logs are written GZIP-compressed to the global logging bucket. That S3 storage isn't included here, and depends on that bucket's lifecycle.

| Resource | dev | sbx | stg | prod (1K) | prod (10K) | prod (100K) | prod (1M) | prod (10M) | prod (100M) |
|---|---|---|---|---|---|---|---|---|---|
| Fixed (WebACL + rules) | $0 | $0 | $10 | $10 | $10 | $10 | $10 | $10 | $10 |
| Requests ($0.60/M, all requests) | $0 | $0 | $0 | $0 | $3 | $30 | $300 | $3,000 | $30,000 |
| WAF logging (Firehose, 5 KB per request) | $0 | $0 | $0 | $0 | $1 | $7 | $72 | $725 | $7,250 |
| **Subtotal** | **$0** | **$0** | **$10** | **$10** | **$14** | **$47** | **$382** | **$3,735** | **$37,260** |

> At 100M MAU: 50 B requests × $0.60/M = $30,000; WAF logging 50 B × 5 KB = 250,000 GB × $0.029 = $7,250.

---

## 7. Route 53

Prices (✓): $0.50/hosted zone/month. The hosted zone isn't created by Terraform (it's the pre-existing `HOSTED_ZONE_ID`), but it's still billed. The records Terraform creates (the public CloudFront record and the internal ALB record per region) are **alias** records to AWS resources, and **queries to alias records are free**.

| Resource | dev | sbx | stg | prod (1K–100M) |
|---|---|---|---|---|
| Hosted zone | $1 | $1 | $1 | $1 |
| DNS queries (alias records) | $0 | $0 | $0 | $0 |
| **Subtotal** | **$1** | **$1** | **$1** | **$1** |

> If dev, sbx and stg share one hosted zone (one `HOSTED_ZONE_ID`), it's billed once, $0.50, not per environment.

---

## 8. ECR

Prices (✓): $0.10/GB/month. One repository per environment per region. The lifecycle policy keeps the newest 30 tagged images and expires untagged ones after 7 days. Images share most layers, so storage stays around 1–3 GB.

| Resource | dev | sbx | stg | prod (1K–100M) |
|---|---|---|---|---|
| Storage | $0 | $0 | $0 | $0 |
| **Subtotal** | **$0** | **$0** | **$0** | **$0** |

---

## 9. Secrets Manager

Prices (✓): $0.40/secret/month. AWS bills per secret resource, not per value inside it. Two secrets per environment in this one-region model:
- the backend `app` secret (one JSON holding JWT key, Google client ID, the LLM keys, MongoDB URI and Redis token);
- the scheduler's `github_pat` secret.

Each additional backend region adds one more `app` secret.

| Resource | dev | sbx | stg | prod (1K–100M) |
|---|---|---|---|---|
| Secrets (2) | $1 | $1 | $1 | $1 |
| **Subtotal** | **$1** | **$1** | **$1** | **$1** |

---

## 10. CloudWatch (logs, alarms, dashboard, Container Insights)

Prices (✓, re-verified 2026-10-23, ap-south-1): log ingestion $0.67/GB (Standard class; 5 GB/month free per account); log storage $0.03/GB-month; alarm $0.10/month (10 free per account); dashboard $3/month; custom metric $0.30/month (first 10,000).

**Alarms (per region, from the code):**
- **Always on, every environment:** about 18. That's 2 worker step-scaling alarms, plus the alarms AWS creates automatically for the 8 target-tracking policies (API 3, auth 2, admin 2, worker 1), usually 2 per policy.
- **`enable_basic_alarms`, stg and prod:** +4, one healthy-hosts alarm per HTTP service and one ALB 5xx alarm.
- **`enable_all_alarms`, prod:** +18. Worker processing-stuck, pending-jobs-high, Redis connections, plus 7 sustained and 8 immediate CPU/memory alarms.
- **Totals:** dev ≈ 18, sbx ≈ 18, stg ≈ 22, prod ≈ 40. dev, sbx and stg share one account, so one set of 10 free alarms covers all three.

**Container Insights** is enabled on every cluster. With 4 services and 4 task-definition families, it publishes about **112 custom metrics per cluster**:
- 10 metrics × (cluster + 4 services + 4 families);
- 5 service-only metrics × 4 services;
- 2 cluster-only metrics.

That's $33.60/month per environment per region, plus a little log ingestion for its performance events.

**X-Ray: $0.** The app has no tracing instrumentation and the ADOT sidecar is off, so no traces are sent. The X-Ray sampling rules exist but cost nothing.

| Resource | dev | sbx | stg | prod (1K) | prod (10K) | prod (100K) | prod (1M) | prod (10M) | prod (100M) |
|---|---|---|---|---|---|---|---|---|---|
| Log ingestion (175 KB/MAU; 5 GB free) | $0 | $0 | $0 | $0 | $0 | $8 | $114 | $1,169 | $11,722 |
| Log storage (prod: 90-day retention, upper bound) | $0 | $0 | $0 | $0 | $0 | $2 | $16 | $158 | $1,575 |
| Alarms (≈18 / 18 / 22 / 40, before the free 10) | $2 | $2 | $2 | $4 | $4 | $4 | $4 | $4 | $4 |
| Dashboard (prod only, one per region) | $0 | $0 | $0 | $3 | $3 | $3 | $3 | $3 | $3 |
| Container Insights (~112 metrics) | $34 | $34 | $34 | $34 | $34 | $34 | $34 | $34 | $34 |
| X-Ray traces | $0 | $0 | $0 | $0 | $0 | $0 | $0 | $0 | $0 |
| **Subtotal** | **$36** | **$36** | **$36** | **$41** | **$41** | **$51** | **$171** | **$1,368** | **$13,338** |

> **Log ingestion** at 100M MAU: 100M × 175 KB = 17,500 GB → (17,500 − 5) × $0.67 = $11,722. That assumes a log line per API request; error-and-summary logging would cut it sharply.
> **Log storage** is an upper bound: 3 months of ingested volume at $0.03/GB-month. CloudWatch stores logs compressed, so the real figure is lower. dev/sbx keep logs 7 days and stg 30 days.

---

## 11. GuardDuty

Prices (✓): Runtime Monitoring $1.81/vCPU/month (first 500 vCPU); VPC Flow Log analysis $1.10/GB (first 500 GB). The edge (us-east-1) detector figure is an inherited estimate.

**Runtime Monitoring costs $0 today, and protects nothing:**
- **What the code does:** `security.tf` enables the `RUNTIME_MONITORING` feature, but doesn't enable automated agent management for Fargate (`ECS_FARGATE_AGENT_MANAGEMENT`).
- **Why that matters:** GuardDuty only monitors, and bills, tasks that run its security agent.
- **The result:** no task is monitored and nothing is billed per vCPU.
- **If agent management is turned on:** about $8/month in stg (4.5 vCPU at minimum) and $48/month in prod (26.5 vCPU at minimum). It grows with autoscaled tasks.

What GuardDuty does bill today is its foundational analysis of flow logs, DNS and CloudTrail events. A detector covers its whole account and region, so stg's detector in ap-south-1 also covers dev and sbx resources there (they share the account).

| Resource | dev | sbx | stg | prod (1K) | prod (10K) | prod (100K) | prod (1M) | prod (10M) | prod (100M) |
|---|---|---|---|---|---|---|---|---|---|
| Backend detector (ap-south-1) | No | No | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Runtime Monitoring (no agent, so nothing billed) | $0 | $0 | $0 | $0 | $0 | $0 | $0 | $0 | $0 |
| VPC Flow Log analysis | $0 | $0 | $1 | $1 | $2 | $2 | $6 | $22 | $110 |
| Edge detector (us-east-1; stg + prod) | $0 | $0 | $2 | $2 | $2 | $2 | $2 | $2 | $2 |
| **Subtotal** | **$0** | **$0** | **$3** | **$3** | **$4** | **$4** | **$8** | **$24** | **$112** |

---

## 12. CloudTrail

Prices (✓): the first copy of management events in each region is free.
- **Backend regional trail** (management events, ap-south-1): stg and prod.
- **Edge trail** (us-east-1, single-region, includes global service events): prod only.

No two trails record the same region's events, so both are free copies. Their logs go to the pre-existing logging buckets (S3 storage, small).

| Resource | dev | sbx | stg | prod (1K–100M) |
|---|---|---|---|---|
| Management events (first copy per region free) | $0 | $0 | $0 | $0 |
| **Subtotal** | **$0** | **$0** | **$0** | **$0** |

---

## 13. S3

Prices (✓): S3 Standard $0.025/GB/month (ap-south-1, first 50 TB). Terraform creates no buckets; it configures pre-existing ones:
- uploads (one per region);
- assets;
- SPA;
- regional and global logging.

The row below is uploads and assets storage. Log storage depends on each logging bucket's lifecycle and isn't modeled:
- **ALB access logs:** stg and prod.
- **CloudTrail:** stg and prod.
- **WAF logs:** prod. At high traffic, the GZIP-compressed WAF logs are the largest of these.

| Resource | dev | sbx | stg | prod (1K) | prod (10K) | prod (100K) | prod (1M) | prod (10M) | prod (100M) |
|---|---|---|---|---|---|---|---|---|---|
| Storage + requests | $0 | $0 | $0 | $0 | $0 | $0 | $1 | $6 | $54 |
| **Subtotal** | **$0** | **$0** | **$0** | **$0** | **$0** | **$0** | **$1** | **$6** | **$54** |

---

## Grand Total (always on, one backend region)

| Section | dev | sbx | stg | prod (1K) | prod (10K) | prod (100K) | prod (1M) | prod (10M) | prod (100M) |
|---|---|---|---|---|---|---|---|---|---|
| 1. Networking | $54 | $54 | $193 | $283 | $284 | $289 | $339 | $843 | $5,883 |
| 2. ECS Fargate | $37 | $37 | $168 | $990 | $990 | $990 | $990 | $990 | $990 |
| 3. ALB | $17 | $17 | $18 | $18 | $18 | $19 | $22 | $47 | $297 |
| 4. ElastiCache | $12 | $12 | $24 | $93 | $93 | $93 | $93 | $93 | $93 |
| 5. CloudFront + Lambda@Edge | $0 | $0 | $0 | $0 | $2 | $71 | $930 | $10,183 | $100,174 |
| 6. WAF | $0 | $0 | $10 | $10 | $14 | $47 | $382 | $3,735 | $37,260 |
| 7. Route 53 | $1 | $1 | $1 | $1 | $1 | $1 | $1 | $1 | $1 |
| 8. ECR | $0 | $0 | $0 | $0 | $0 | $0 | $0 | $0 | $0 |
| 9. Secrets Manager | $1 | $1 | $1 | $1 | $1 | $1 | $1 | $1 | $1 |
| 10. CloudWatch | $36 | $36 | $36 | $41 | $41 | $51 | $171 | $1,368 | $13,338 |
| 11. GuardDuty | $0 | $0 | $3 | $3 | $4 | $4 | $8 | $24 | $112 |
| 12. CloudTrail | $0 | $0 | $0 | $0 | $0 | $0 | $0 | $0 | $0 |
| 13. S3 | $0 | $0 | $0 | $0 | $0 | $0 | $1 | $6 | $54 |
| **Grand Total** | **$158** | **$158** | **$454** | **$1,440** | **$1,448** | **$1,566** | **$2,938** | **$17,291** | **$158,203** |

---

## Scheduled non-prod environments

`infra-live-scheduler` can run dev, sbx and stg on a daily schedule (prod can never be scheduled):
- **22:00 IST:** a full **destroy** (`terraform-live-all`, `action = destroy`).
- **15:00 IST:** a full **apply and deploy**.

The schedules are off by default (`schedule_enabled` input). When they're on, the environment exists about **7 hours a day**, so every hourly line drops to about 7/24:
- NAT, endpoints and public IPv4;
- Fargate, ALB and ElastiCache (Valkey);
- the WAF fixed fee;
- alarms and Container Insights metrics (both prorated hourly).

The hosted zone and secrets don't change.

| Environment | Always on | Scheduled (≈ 7 h/day) |
|---|---|---|
| dev | $158 | **≈ $48** |
| sbx | $158 | **≈ $48** |
| stg | $454 | **≈ $136** |

---

## Dominant Cost Drivers by Scale

| Scale | Top cost driver | Second | Third |
|---|---|---|---|
| dev / sbx | Networking ($54: NAT $40, public IPv4 $14) | ECS Fargate ($37) | CloudWatch ($36, almost all Container Insights) |
| stg | Networking ($193: NAT $81, endpoints $94) | ECS Fargate ($168) | CloudWatch ($36) |
| prod 1K–100K | ECS Fargate ($990) | Networking ($283–289) | ElastiCache ($93) |
| prod 1M | ECS Fargate ($990) | CloudFront + Lambda@Edge ($930) | WAF ($382) |
| prod 10M | CloudFront + Lambda@Edge ($10,183) | WAF ($3,735, requests + logging) | CloudWatch ($1,368) |
| prod 100M | CloudFront + Lambda@Edge ($100,174) | WAF ($37,260) | CloudWatch ($13,338) |

---

## Pricing Reference

**Confirmed from the AWS Price List API (✓):**

| Service | Price | Unit |
|---|---|---|
| NAT Gateway | $0.056 | per GW/hr + per GB processed |
| VPC Interface Endpoint | $0.013 | per AZ/hr |
| Public IPv4 address (ap-south-1) | $0.005 | per address/hr (re-verified 2026-10-23) |
| Fargate vCPU (ap-south-1, x86) | $0.04256 | per vCPU/hr |
| Fargate memory (ap-south-1, x86) | $0.004655 | per GB/hr |
| ElastiCache `cache.t4g.micro` (Valkey) | $0.016 | per node/hr (re-verified 2026-10-23) |
| ElastiCache `cache.t4g.small` (Valkey) | $0.0328 | per node/hr (re-verified 2026-10-23) |
| ElastiCache `cache.t4g.medium` (Valkey) | $0.0648 | per node/hr (re-verified 2026-10-23) |
| ElastiCache `cache.r7g.large` (Valkey; growth option) | $0.1792 | per node/hr (re-verified 2026-10-23) |
| CloudFront India data (first 1 TB) | $0.000 | free |
| CloudFront India data (next 9 TB) | $0.109 | per GB |
| CloudFront India data (next 40 TB) | $0.085 | per GB |
| CloudFront India data (next 100 TB) | $0.082 | per GB |
| CloudFront India data (next 350 TB) | $0.080 | per GB |
| CloudFront HTTPS requests (first 10M) | $0.000 | free |
| CloudFront HTTPS requests | $0.0120 | per 10,000 |
| Lambda@Edge requests | $0.60 | per million |
| Lambda@Edge compute | $0.00005001 | per GB-second |
| WAF WebACL | $5.00 | per month |
| WAF rule | $1.00 | per rule/month |
| WAF AWS managed rule group | $1.00 | per group/month |
| WAF requests | $0.60 | per million |
| Kinesis Data Firehose Direct PUT (us-east-1) | $0.029 | per GB, each record rounded up to 5 KB (re-verified 2026-10-23) |
| GuardDuty Runtime Monitoring (first 500 vCPU) | $1.81 | per monitored vCPU/month |
| GuardDuty VPC Flow Logs (first 500 GB) | $1.10 | per GB |
| CloudWatch log ingestion (Standard class) | $0.67 | per GB (5 GB free; re-verified 2026-10-23) |
| CloudWatch log storage | $0.03 | per GB-month (re-verified 2026-10-23) |
| CloudWatch custom metric (first 10,000) | $0.30 | per metric/month (re-verified 2026-10-23) |
| CloudWatch alarm (standard resolution) | $0.10 | per alarm/month (10 free; re-verified 2026-10-23) |
| CloudWatch dashboard | $3.00 | per dashboard/month |
| X-Ray traces | $5.00 | per million (100K free); unused today |
| Secrets Manager | $0.40 | per secret/month |
| ECR storage | $0.10 | per GB/month |
| Route 53 hosted zone | $0.50 | per zone/month |
| Route 53 queries to alias records | $0.00 | free |
| CloudTrail (first copy of management events per region) | $0.00 | free |
| ALB base (ap-south-1) | $0.0239 | per hr |
| ALB LCU | $0.008 | per LCU/hr |
| S3 Standard (ap-south-1, first 50 TB) | $0.025 | per GB/month |

**Remaining estimates (not independently verified):**

| Item | Estimate | Note |
|---|---|---|
| Edge GuardDuty detector (us-east-1) | ~$2/month | Inherited flat estimate |
| CloudFront Functions invocations | ~$0.10 per million, first 2M/month free | `spa-rewrite`; not checked against the Price List API |
| Target-tracking alarm count | ~2 per policy | AWS creates these automatically; the exact number depends on each policy's scale-in setting |
| Container Insights metric count | ~112 per cluster | Counted from AWS's ECS Container Insights metric list for 4 services and 4 task-definition families |
| ALB LCU and VPC Flow Log volumes | as shown | Rough traffic-based figures carried over from earlier versions of this estimate |

**Key caveats:**
- **prod's fixed cost (about $1,440/month at 1K MAU) is set by `prod.tfvars`,** not by traffic, and it's mostly the minimum task counts ($990) and networking ($283).
- **All ECS costs are minimum task counts.** prod's autoscaling maximums would bring Fargate to about $11,633/month at peak.
- **Free tiers are per AWS account, not per environment.** That covers CloudFront's 1 TB and 10M requests, CloudWatch's 5 GB of logs and 10 alarms and 10 metrics, and X-Ray's 100K traces. dev, sbx and stg share one account; prod has its own.
- **One backend region.** Each extra backend region (`eu-west-1`, `us-east-1`) adds its own Networking, ECS, ALB, ElastiCache, Secrets, CloudWatch and GuardDuty lines (sections 1–4 and 9–11). In prod that's about $1,430/month per region before traffic. Usage-based edge costs (CloudFront, Lambda@Edge, WAF) don't multiply; they follow total traffic.
- **Unused today but still billed:**
  - the X-Ray VPC endpoint, $19/month in stg and $28/month in prod;
  - GuardDuty Runtime Monitoring, enabled without its Fargate agent, so it bills nothing but also protects nothing.
- **WAF logging and request fees scale with every request,** about $0.74 per million requests together. They become the second-largest line at high traffic.
- **Not modeled:**
  - S3 storage of ALB, CloudTrail and WAF logs;
  - data transfer between AZs;
  - the scheduler's Lambda and EventBridge Scheduler (two invocations a day, within the free tier);
  - SNS alert emails (free tier);
  - MongoDB Atlas (not an AWS cost).
