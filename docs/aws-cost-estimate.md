# AWS Monthly Cost Estimate

> **Scale unit:** Monthly Active Users (MAU) — 1K = 1,000 MAU, 10K = 10,000 MAU, etc.
> **Region:** ap-south-1 (backend), us-east-1 (CloudFront / WAF / ACM / Lambda@Edge)
> **Traffic model:** 500 requests/MAU/month; 70% are API calls hitting ECS, 30% are static assets served from CloudFront cache.
> **Data transfer:** 2 MB egress/MAU/month via CloudFront; 1 MB/MAU/month through NAT Gateway (LLM API outbound traffic).
> **Log volume:** ~190 KB/MAU/month (350 API requests × ~500 bytes per log entry).
> **Pricing confidence:** ✓ = confirmed from AWS Pricing CSV/documentation (fetched June 2026); ~ = estimate, verify via [AWS Pricing Calculator](https://calculator.aws/).

---

## Configuration Matrix

The appropriate resource sizing changes significantly across MAU scales. The prod tfvars are set for 100M MAU. The table below shows what is used in each cost column.

| Resource | dev | sbx | stg | prod (1K) | prod (10K) | prod (100K) | prod (1M) | prod (10M) | prod (100M) |
|---|---|---|---|---|---|---|---|---|---|
| **API task** | 0.5 vCPU / 1 GB | 0.5 vCPU / 1 GB | 0.5 vCPU / 1 GB | 1 vCPU / 2 GB | 1 vCPU / 2 GB | 1 vCPU / 2 GB | 2 vCPU / 4 GB | 4 vCPU / 8 GB | 4 vCPU / 8 GB |
| **API min tasks** | 1 | 1 | 2 | 2 | 3 | 5 | 10 | 15 | 15 |
| **Worker task** | 0.5 vCPU / 1 GB | 0.5 vCPU / 1 GB | 0.5 vCPU / 1 GB | 1 vCPU / 2 GB | 1 vCPU / 2 GB | 1 vCPU / 2 GB | 2 vCPU / 4 GB | 4 vCPU / 8 GB | 4 vCPU / 8 GB |
| **Worker min tasks** | 1 | 1 | 1 | 1 | 2 | 3 | 5 | 5 | 5 |
| **ElastiCache** | t4g.micro ×1 | t4g.micro ×1 | t4g.medium ×1 | t4g.medium ×2 | r6g.large ×2 | r6g.large ×2 | r6g.xlarge ×2 | r6g.2xlarge ×3 | r6g.4xlarge ×3 |
| **NAT Gateways** | 1 | 1 | 2 | 3 | 3 | 3 | 3 | 3 | 3 |
| **VPC Interface Endpoints** | None | None | 5 svc / 2 AZ | 5 svc / 3 AZ | 5 svc / 3 AZ | 5 svc / 3 AZ | 5 svc / 3 AZ | 5 svc / 3 AZ | 5 svc / 3 AZ |

> **Rationale for task sizing:** FastAPI is async/I-O-bound; at small scale, 1 vCPU handles concurrent LLM calls well. From 1M MAU, larger tasks (2–4 vCPU) reduce per-task overhead and improve throughput under sustained concurrency. Worker tasks are sized identically to API tasks at each tier.
> **Rationale for ElastiCache sizing:** t4g instances are burstable — acceptable for dev/stg/small prod. From 10K MAU, r6g (memory-optimised, dedicated CPU) is used to avoid credit exhaustion under sustained rate-limit traffic. Primary + 1 replica for HA from 1K MAU; 3-node cluster (primary + 2 replicas) from 10M MAU.

---

## 1. Networking (VPC, NAT Gateway, VPC Endpoints)

Confirmed prices (✓): NAT Gateway $0.056/hr/GW + $0.056/GB processed. VPC Interface Endpoints $0.013/AZ/hr.

| Resource | dev | sbx | stg | prod (1K) | prod (10K) | prod (100K) | prod (1M) | prod (10M) | prod (100M) |
|---|---|---|---|---|---|---|---|---|---|
| NAT Gateway hourly | $40 | $40 | $81 | $121 | $121 | $121 | $121 | $121 | $121 |
| NAT data processing (1 MB/MAU) | $0 | $0 | $0 | $0 | $1 | $6 | $56 | $560 | $5,600 |
| VPC Interface Endpoints (5 svc) | $0 | $0 | $94 | $140 | $140 | $140 | $140 | $140 | $140 |
| **Subtotal** | **$40** | **$40** | **$175** | **$261** | **$262** | **$267** | **$317** | **$821** | **$5,861** |

> NAT hourly: 1 GW × $0.056 × 720 h = $40; 2 GW = $81; 3 GW = $121. Interface endpoints (stg): 5 svc × 2 AZ × $0.013 × 720 h = $94; (prod): 5 × 3 × $0.013 × 720 = $140. NAT data = LLM API outbound (requests to OpenAI/Anthropic/Gemini); does not include inbound traffic.

---

## 2. ECS Fargate (API + Worker tasks)

Confirmed prices (✓): vCPU $0.04256/hr, memory $0.004655/GB-hr (Linux/x86, ap-south-1).

Per-task monthly cost (720 hrs):

| Task size | vCPU cost | Memory cost | Total/task/month |
|---|---|---|---|
| 0.5 vCPU / 1 GB | $15.32 | $3.35 | **$18.67** |
| 1 vCPU / 2 GB | $30.65 | $6.70 | **$37.35** |
| 2 vCPU / 4 GB | $61.29 | $13.41 | **$74.70** |
| 4 vCPU / 8 GB | $122.57 | $26.81 | **$149.38** |

| Resource | dev | sbx | stg | prod (1K) | prod (10K) | prod (100K) | prod (1M) | prod (10M) | prod (100M) |
|---|---|---|---|---|---|---|---|---|---|
| API tasks (min × cost/task) | $19 | $19 | $37 | $75 | $112 | $187 | $747 | $2,241 | $2,241 |
| Worker tasks (min × cost/task) | $19 | $19 | $19 | $37 | $75 | $112 | $374 | $747 | $747 |
| **Subtotal** | **$38** | **$38** | **$56** | **$112** | **$187** | **$299** | **$1,121** | **$2,988** | **$2,988** |

> These are **minimum task** costs (floor). Autoscaling adds cost under load. At prod 100M MAU: api_max=200 + worker_max=50 would cost up to ~14× the floor during peak. The burst ceiling is not shown here.

---

## 3. Application Load Balancer

ALB ap-south-1 pricing (~, estimate): ~$0.008/hr base + ~$0.008/LCU/hr.

| Resource | dev | sbx | stg | prod (1K) | prod (10K) | prod (100K) | prod (1M) | prod (10M) | prod (100M) |
|---|---|---|---|---|---|---|---|---|---|
| ALB hourly base | $6 | $6 | $6 | $6 | $6 | $6 | $6 | $6 | $6 |
| LCU usage (scales with request rate) | $0 | $0 | $1 | $1 | $1 | $2 | $5 | $30 | $280 |
| **Subtotal** | **$6** | **$6** | **$7** | **$7** | **$7** | **$8** | **$11** | **$36** | **$286** |

---

## 4. ElastiCache (Redis)

Confirmed prices (✓) ap-south-1: t4g.micro $0.020/hr, t4g.medium $0.081/hr, r6g.large $0.211/hr, r6g.xlarge $0.422/hr, r6g.2xlarge $0.844/hr, r6g.4xlarge $1.688/hr.

| Resource | dev | sbx | stg | prod (1K) | prod (10K) | prod (100K) | prod (1M) | prod (10M) | prod (100M) |
|---|---|---|---|---|---|---|---|---|---|
| Node type | t4g.micro | t4g.micro | t4g.medium | t4g.medium | r6g.large | r6g.large | r6g.xlarge | r6g.2xlarge | r6g.4xlarge |
| Total nodes (primary + replicas) | 1 | 1 | 1 | 2 | 2 | 2 | 2 | 3 | 3 |
| Cost (nodes × rate × 720 h) | $14 | $14 | $58 | $117 | $304 | $304 | $608 | $1,823 | $3,646 |
| **Subtotal** | **$14** | **$14** | **$58** | **$117** | **$304** | **$304** | **$608** | **$1,823** | **$3,646** |

> t4g instances have burstable CPU. For production workloads sustaining high Redis ops/sec, r6g (dedicated CPU, memory-optimised) is required. stg is acceptable on t4g.medium since it runs functional tests, not sustained production load.

---

## 5. CloudFront + Lambda@Edge

**CloudFront India pricing (✓):** 1 TB/month permanently free, then $0.109/GB (next 9 TB), $0.085/GB (next 40 TB), $0.082/GB (next 100 TB), $0.080/GB (next 350 TB). HTTPS requests: 10 M/month free, then $0.0120 per 10,000.

**Lambda@Edge (✓):** $0.60/million requests + $0.00005001/GB-second (128 MB, ~5 ms avg). Only triggers on `/api/*` requests (70% of total).

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
| **Subtotal** | **$0** | **$0** | **$0** | **$0** | **$2** | **$70** | **$915** | **$10,033** | **$98,674** |

> At 100M MAU, CloudFront HTTPS request charges ($59,988) dominate. This is driven by 50 billion requests/month (100M users × 500 req/MAU). Review request rate assumptions carefully before projecting at this scale. Enabling CloudFront caching for more API responses would reduce this significantly.

---

## 6. WAF (us-east-1; stg + prod only)

Confirmed (✓): $5.00/WebACL/month + $1.00/custom rule/month + $1.00/AWS managed rule group/month + $0.60/million requests. Config: 1 WebACL + 1 rate rule + 3 managed groups = **$9/month fixed**.

Kinesis Firehose WAF logging (✓): $0.029/GB (Direct PUT). prod only (`enable_waf_logging = true`).

| Resource | dev | sbx | stg | prod (1K) | prod (10K) | prod (100K) | prod (1M) | prod (10M) | prod (100M) |
|---|---|---|---|---|---|---|---|---|---|
| Fixed base ($9/mo) | $0 | $0 | $9 | $9 | $9 | $9 | $9 | $9 | $9 |
| Request cost ($0.60/M) | $0 | $0 | $0 | $0 | $0 | $0 | $1 | $9 | $86 |
| WAF Firehose logging | $0 | $0 | $0 | $0 | $0 | $0 | $1 | $6 | $58 |
| **Subtotal** | **$0** | **$0** | **$9** | **$9** | **$9** | **$9** | **$11** | **$24** | **$153** |

---

## 7. Route 53

Confirmed (✓): $0.50/hosted zone/month + $0.40/million queries.

| Resource | dev | sbx | stg | prod (1K) | prod (10K) | prod (100K) | prod (1M) | prod (10M) | prod (100M) |
|---|---|---|---|---|---|---|---|---|---|
| Hosted zone | $1 | $1 | $1 | $1 | $1 | $1 | $1 | $1 | $1 |
| DNS queries ($0.40/M) | $0 | $0 | $0 | $0 | $0 | $0 | $1 | $6 | $58 |
| **Subtotal** | **$1** | **$1** | **$1** | **$1** | **$1** | **$1** | **$2** | **$7** | **$59** |

---

## 8. ECR

Confirmed (✓): $0.10/GB/month. ~2 GB of image layers stored. S3 gateway VPC endpoint eliminates NAT charges for image pulls.

| Resource | dev | sbx | stg | prod (1K–100M) |
|---|---|---|---|---|
| Storage (~2 GB images) | $0 | $0 | $0 | $0 |
| **Subtotal** | **$0** | **$0** | **$0** | **$0** |

---

## 9. Secrets Manager

Confirmed (✓): $0.40/secret/month. ~6 secrets per environment. API call costs negligible (first 10K free/month).

| Resource | dev | sbx | stg | prod (1K–100M) |
|---|---|---|---|---|
| Secrets (~6) | $2 | $2 | $2 | $2 |
| **Subtotal** | **$2** | **$2** | **$2** | **$2** |

---

## 10. CloudWatch (Logs, Alarms, Dashboard, X-Ray)

Confirmed (✓): Log ingestion $0.50/GB (first 5 GB/account/month free). Alarms $0.10/alarm/month. Dashboard $3/month. X-Ray: 100K traces free/month, then $5/million.

Log volume: ~190 KB/MAU/month (350 API requests × ~500 bytes/entry).

X-Ray sampling rate: dev/sbx/stg = 5%; prod = 1% (per tfvars `xray_default_sampling_rate = 0.01`). Only API requests (70% of total) generate traces.

| Resource | dev | sbx | stg | prod (1K) | prod (10K) | prod (100K) | prod (1M) | prod (10M) | prod (100M) |
|---|---|---|---|---|---|---|---|---|---|
| Log ingestion (190 KB/MAU; 5 GB free) | $0 | $0 | $0 | $0 | $0 | $7 | $93 | $948 | $9,498 |
| Alarms — autoscaling always-on (2) | $0 | $0 | $0 | $0 | $0 | $0 | $0 | $0 | $0 |
| Alarms — basic (2 ALB; stg+prod) | $0 | $0 | $0 | $0 | $0 | $0 | $0 | $0 | $0 |
| Alarms — all (13 additional; prod only) | $0 | $0 | $0 | $1 | $1 | $1 | $1 | $1 | $1 |
| Dashboard (prod only; ✓ $3/month) | $0 | $0 | $0 | $3 | $3 | $3 | $3 | $3 | $3 |
| X-Ray traces | $0 | $0 | $0 | $0 | $0 | $1 | $17 | $175 | $1,750 |
| **Subtotal** | **$0** | **$0** | **$0** | **$4** | **$4** | **$12** | **$114** | **$1,127** | **$11,252** |

> Log ingestion at 100M MAU: 100M × 190 KB = ~19,000 GB → (19,000 − 5) × $0.50 = $9,498. This assumes request-level logging for all API calls. Reducing log verbosity (e.g. log only errors + summaries) would drop this substantially.
> X-Ray at 100M MAU (1% sampling): 100M × 350 API req × 0.01 = 350M traces → (350M − 100K) / 1M × $5 = $1,750.

---

## 11. GuardDuty

Confirmed (✓): ECS Runtime Monitoring $1.50/vCPU/month. VPC Flow Logs analysis $1.00/GB/month.

GuardDuty monitors running tasks. vCPU count is based on minimum task counts × task vCPUs:

| Scale | API tasks (min) | Worker tasks (min) | Task vCPUs | Total vCPUs | ECS Runtime cost |
|---|---|---|---|---|---|
| stg | 2 | 1 | 0.5 vCPU each | 1.5 vCPU | $2 |
| prod 1K | 2 | 1 | 1 vCPU each | 3 vCPU | $5 |
| prod 10K | 3 | 2 | 1 vCPU each | 5 vCPU | $8 |
| prod 100K | 5 | 3 | 1 vCPU each | 8 vCPU | $12 |
| prod 1M | 10 | 5 | 2 vCPU each | 30 vCPU | $45 |
| prod 10M | 15 | 5 | 4 vCPU each | 80 vCPU | $120 |
| prod 100M | 15 | 5 | 4 vCPU each | 80 vCPU | $120 |

| Resource | dev | sbx | stg | prod (1K) | prod (10K) | prod (100K) | prod (1M) | prod (10M) | prod (100M) |
|---|---|---|---|---|---|---|---|---|---|
| Backend GuardDuty enabled | No | No | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| ECS Runtime Monitoring | $0 | $0 | $2 | $5 | $8 | $12 | $45 | $120 | $120 |
| VPC Flow Logs analysis | $0 | $0 | $1 | $1 | $2 | $2 | $5 | $20 | $100 |
| Edge GuardDuty (us-east-1; stg+prod) | $0 | $0 | $2 | $2 | $2 | $2 | $2 | $2 | $2 |
| **Subtotal** | **$0** | **$0** | **$5** | **$8** | **$12** | **$16** | **$52** | **$142** | **$222** |

> GuardDuty ECS Runtime cost scales with vCPUs in running tasks, not with MAU. At prod 100M MAU, minimum 80 vCPUs (15 API + 5 worker tasks × 4 vCPU) are always monitored.

---

## 12. CloudTrail

Confirmed (✓): First trail management events free. stg: `enable_cloudtrail = false`. prod: management events only.

| Resource | dev | sbx | stg | prod (1K–100M) |
|---|---|---|---|---|
| Management events (first trail free) | $0 | $0 | $0 | $0 |
| **Subtotal** | **$0** | **$0** | **$0** | **$0** |

---

## 13. S3 (Uploads + Logging)

S3 Standard: $0.023/GB/month (US-East-1 reference; ap-south-1 slightly higher ~$0.025). Requests negligible at small scale.

| Resource | dev | sbx | stg | prod (1K) | prod (10K) | prod (100K) | prod (1M) | prod (10M) | prod (100M) |
|---|---|---|---|---|---|---|---|---|---|
| Storage + requests | $0 | $0 | $0 | $0 | $0 | $0 | $1 | $6 | $54 |
| **Subtotal** | **$0** | **$0** | **$0** | **$0** | **$0** | **$0** | **$1** | **$6** | **$54** |

---

## Grand Total

| Section | dev | sbx | stg | prod (1K) | prod (10K) | prod (100K) | prod (1M) | prod (10M) | prod (100M) |
|---|---|---|---|---|---|---|---|---|---|
| 1. Networking | $40 | $40 | $175 | $261 | $262 | $267 | $317 | $821 | $5,861 |
| 2. ECS Fargate | $38 | $38 | $56 | $112 | $187 | $299 | $1,121 | $2,988 | $2,988 |
| 3. ALB | $6 | $6 | $7 | $7 | $7 | $8 | $11 | $36 | $286 |
| 4. ElastiCache | $14 | $14 | $58 | $117 | $304 | $304 | $608 | $1,823 | $3,646 |
| 5. CloudFront + Lambda@Edge | $0 | $0 | $0 | $0 | $2 | $70 | $915 | $10,033 | $98,674 |
| 6. WAF | $0 | $0 | $9 | $9 | $9 | $9 | $11 | $24 | $153 |
| 7. Route 53 | $1 | $1 | $1 | $1 | $1 | $1 | $2 | $7 | $59 |
| 8. ECR | $0 | $0 | $0 | $0 | $0 | $0 | $0 | $0 | $0 |
| 9. Secrets Manager | $2 | $2 | $2 | $2 | $2 | $2 | $2 | $2 | $2 |
| 10. CloudWatch + X-Ray | $0 | $0 | $0 | $4 | $4 | $12 | $114 | $1,127 | $11,252 |
| 11. GuardDuty | $0 | $0 | $5 | $8 | $12 | $16 | $52 | $142 | $222 |
| 12. CloudTrail | $0 | $0 | $0 | $0 | $0 | $0 | $0 | $0 | $0 |
| 13. S3 | $0 | $0 | $0 | $0 | $0 | $0 | $1 | $6 | $54 |
| **Grand Total** | **$101** | **$101** | **$313** | **$521** | **$790** | **$988** | **$3,154** | **$17,009** | **$123,197** |

---

## Dominant Cost Drivers by Scale

| Scale | Top cost driver | Second | Third |
|---|---|---|---|
| dev / sbx | NAT Gateway ($40) | ECS Fargate ($38) | ALB ($6) |
| stg | NAT + VPC Endpoints ($175) | ECS Fargate ($56) | ElastiCache ($58) |
| prod 1K–100K | NAT + VPC Endpoints | ElastiCache | ECS Fargate |
| prod 1M | ECS Fargate ($1,121) | CloudFront ($915) | ElastiCache ($608) |
| prod 10M | CloudFront+L@E ($10,033) | ECS Fargate ($2,988) | ElastiCache ($1,823) |
| prod 100M | CloudFront+L@E ($98,674) | CloudWatch logs ($9,498) | NAT + networking ($5,861) |

---

## Pricing Reference

**Confirmed from AWS Pricing CSV / documentation (✓):**

| Service | Price | Unit |
|---|---|---|
| NAT Gateway | $0.056 | per GW/hr + per GB processed |
| VPC Interface Endpoint | $0.013 | per AZ/hr |
| Fargate vCPU (ap-south-1) | $0.04256 | per vCPU/hr |
| Fargate memory (ap-south-1) | $0.004655 | per GB/hr |
| ElastiCache t4g.micro | $0.020 | per node/hr |
| ElastiCache t4g.medium | $0.081 | per node/hr |
| ElastiCache r6g.large | $0.211 | per node/hr |
| ElastiCache r6g.xlarge | $0.422 | per node/hr |
| ElastiCache r6g.2xlarge | $0.844 | per node/hr |
| ElastiCache r6g.4xlarge | $1.688 | per node/hr |
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
| WAF custom rule | $1.00 | per rule/month |
| WAF AWS managed rule group | $1.00 | per group/month |
| WAF requests | $0.60 | per million |
| Kinesis Firehose (WAF logs) | $0.029 | per GB |
| GuardDuty ECS Runtime | $1.50 | per vCPU/month |
| GuardDuty VPC Flow Logs | $1.00 | per GB/month |
| CloudWatch log ingestion | $0.50 | per GB (5 GB free) |
| CloudWatch alarm | $0.10 | per alarm/month |
| CloudWatch dashboard | $3.00 | per dashboard/month |
| X-Ray traces (first 100K) | $0.000 | free |
| X-Ray traces | $5.00 | per million |
| Secrets Manager | $0.40 | per secret/month |
| ECR storage | $0.10 | per GB/month |
| Route 53 hosted zone | $0.50 | per zone/month |
| Route 53 queries | $0.40 | per million |
| CloudTrail (first trail, mgmt events) | $0.00 | free |

**Estimates only (~) — verify via [AWS Pricing Calculator](https://calculator.aws/):**

| Service | Estimate | Note |
|---|---|---|
| ALB base (ap-south-1) | ~$0.008/hr | Regional pricing page not parseable |
| S3 Standard (ap-south-1) | ~$0.025/GB/month | Slightly higher than us-east-1 |

**Key caveats:**
- All ECS costs reflect **minimum task counts**. Peak autoscaling can multiply ECS cost by up to 4× at high MAU scales.
- CloudFront 1 TB/month data free tier is **per AWS account** — shared across all environments.
- At 100M MAU, CloudFront HTTPS request charges ($59,988) are the single largest line item. If your app can cache a meaningful portion of API responses at CloudFront, this drops dramatically.
- CloudWatch log costs at 100M MAU (~$9,498) assume full request-level logging. Switching to sampled or error-only logging would cut this by 90%+.
- dev and sbx are identical configurations.
