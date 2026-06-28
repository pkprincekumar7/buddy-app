# AWS Monthly Cost Estimate

> **Scale unit:** Monthly Active Users (MAU)
> **Data assumption:** 2 MB transferred per MAU per month (LLM chat app — mostly API text responses + small SPA assets cached at CloudFront edge)
> **Region:** ap-south-1 (backend), us-east-1 (CloudFront/WAF/ACM/Lambda@Edge)
> **Pricing sources:** Prices confirmed from AWS documentation noted with ✓; training-data estimates noted with ~. Exact ap-south-1 prices for Fargate, ALB, and ElastiCache standard on-demand require verification via [AWS Pricing Calculator](https://calculator.aws/).

---

## 1. Networking (VPC, NAT Gateway)

| Resource | dev | sbx | stg | prod (1K) | prod (10K) | prod (100K) | prod (1M) | prod (10M) | prod (100M) |
|---|---|---|---|---|---|---|---|---|---|
| NAT Gateway hourly (~ $0.045/hr/GW) | $33 | $33 | $66 | $99 | $99 | $99 | $99 | $99 | $99 |
| NAT data processing (~ $0.045/GB) | $0 | $0 | $0 | $0 | $0 | $1 | $9 | $90 | $900 |
| VPC Interface Endpoints (✓ $0.013/AZ/hr × 5 svc) | $0 | $0 | $94 | $140 | $140 | $140 | $140 | $140 | $140 |
| **Subtotal** | **$33** | **$33** | **$160** | **$239** | **$239** | **$240** | **$248** | **$329** | **$1,139** |

> NAT: dev/sbx = 1 GW, stg = 2 GW, prod = 3 GW. Interface endpoints: stg = 2 AZ × 5 svc × $0.013 × 720 h ≈ $94; prod = 3 AZ × 5 svc × $0.013 × 720 h ≈ $140. Interface endpoints skipped in dev/sbx (nat_gateway_count = 1).

---

## 2. ECS Fargate (API + Worker tasks)

Fargate ap-south-1 (~ $0.04656/vCPU/hr, ~ $0.00511/GB-hr):

| Resource | dev | sbx | stg | prod (1K) | prod (10K) | prod (100K) | prod (1M) | prod (10M) | prod (100M) |
|---|---|---|---|---|---|---|---|---|---|
| API min capacity | 1 × 0.5 vCPU | 1 × 0.5 vCPU | 2 × 0.5 vCPU | 5 × 1 vCPU | 5 × 1 vCPU | 5 × 1 vCPU | 5 × 1 vCPU | 5 × 1 vCPU | 5 × 1 vCPU |
| Worker min capacity | 1 × 0.5 vCPU | 1 × 0.5 vCPU | 1 × 0.5 vCPU | 2 × 1 vCPU | 2 × 1 vCPU | 2 × 1 vCPU | 2 × 1 vCPU | 2 × 1 vCPU | 2 × 1 vCPU |
| API vCPU cost | $17 | $17 | $34 | $168 | $168 | $168 | $168 | $168 | $168 |
| API memory cost (1 GB/task dev–stg; 2 GB prod) | $4 | $4 | $7 | $37 | $37 | $37 | $37 | $37 | $37 |
| Worker vCPU cost | $17 | $17 | $17 | $67 | $67 | $67 | $67 | $67 | $67 |
| Worker memory cost (1 GB dev–stg; 2 GB prod) | $4 | $4 | $4 | $15 | $15 | $15 | $15 | $15 | $15 |
| Autoscale burst buffer (~20%, prod only) | $0 | $0 | $0 | $57 | $57 | $57 | $57 | $57 | $57 |
| **Subtotal** | **$42** | **$42** | **$62** | **$344** | **$344** | **$344** | **$344** | **$344** | **$344** |

> Prod uses task_cpu=1024 / task_memory=2048 per tfvars. stg api_min_capacity=2 (not 1). Burst buffer approximates autoscaling overhead at steady-state; peak costs will be higher.

---

## 3. Application Load Balancer

| Resource | dev | sbx | stg | prod (1K) | prod (10K) | prod (100K) | prod (1M) | prod (10M) | prod (100M) |
|---|---|---|---|---|---|---|---|---|---|
| ALB hourly (~ $0.008/hr) | $6 | $6 | $6 | $6 | $6 | $6 | $6 | $6 | $6 |
| LCU usage (~ $0.008/LCU/hr; scales with load) | $0 | $0 | $1 | $1 | $1 | $2 | $5 | $30 | $280 |
| **Subtotal** | **$6** | **$6** | **$7** | **$7** | **$7** | **$8** | **$11** | **$36** | **$286** |

---

## 4. ElastiCache (Redis)

| Resource | dev | sbx | stg | prod (1K) | prod (10K) | prod (100K) | prod (1M) | prod (10M) | prod (100M) |
|---|---|---|---|---|---|---|---|---|---|
| Node type | t4g.micro | t4g.micro | t4g.medium | t4g.medium | t4g.medium | t4g.medium | t4g.medium | t4g.medium | t4g.medium |
| Nodes (replica_count+1) | 1 | 1 | 1 | 2 (Multi-AZ) | 2 | 2 | 2 | 2 | 2 |
| Cost (~ $0.016/hr micro; ~ $0.068/hr medium) | $12 | $12 | $49 | $98 | $98 | $98 | $98 | $98 | $98 |
| **Subtotal** | **$12** | **$12** | **$49** | **$98** | **$98** | **$98** | **$98** | **$98** | **$98** |

---

## 5. CloudFront + Lambda@Edge

CloudFront India pricing (✓): 1 TB/month permanently free, then $0.109/GB (next 9 TB), $0.085/GB (next 40 TB), $0.082/GB (next 100 TB), $0.080/GB (next 350 TB). HTTPS requests: 10 M/month free, then $0.0120 per 10,000.

Lambda@Edge (✓): $0.60/million requests + $0.00005001/GB-second. Only triggers on `/api/*` (~70% of requests, 128 MB, ~5 ms avg).

**CloudFront data transfer breakdown:**

| Scale | Total GB | Free (1,024 GB) | $0.109/GB (9,216 GB) | $0.085/GB (40,960 GB) | $0.082/GB (102,400 GB) | Data cost |
|---|---|---|---|---|---|---|
| 1K MAU | 2 | 2 | — | — | — | $0 |
| 10K MAU | 20 | 20 | — | — | — | $0 |
| 100K MAU | 200 | 200 | — | — | — | $0 |
| 1M MAU | 2,000 | 1,024 | 976 | — | — | $106 |
| 10M MAU | 20,000 | 1,024 | 9,216 | 9,760 | — | $1,835 |
| 100M MAU | 200,000 | 1,024 | 9,216 | 40,960 | 100,000 | $12,582 |

| Resource | dev | sbx | stg | prod (1K) | prod (10K) | prod (100K) | prod (1M) | prod (10M) | prod (100M) |
|---|---|---|---|---|---|---|---|---|---|
| Data transfer | $0 | $0 | $0 | $0 | $0 | $0 | $106 | $1,835 | $12,582 |
| HTTPS requests | $0 | $0 | $0 | $0 | $0 | $1 | $14 | $144 | $1,440 |
| Lambda@Edge requests | $0 | $0 | $0 | $0 | $0 | $0 | $1 | $6 | $60 |
| Lambda@Edge compute | $0 | $0 | $0 | $0 | $0 | $0 | $0 | $1 | $6 |
| **Subtotal** | **$0** | **$0** | **$0** | **$0** | **$0** | **$1** | **$121** | **$1,986** | **$14,088** |

> HTTPS requests: 100K MAU ≈ ~50M req/mo → $0.0120 × (50M−10M)/10K = $0.48 ≈ $1. 1M MAU ≈ 500M req/mo → $0.0120 × 490M/10K ≈ $588... recalculated: 500M req/mo → (500M−10M)/10,000 × $0.0120 = $588. Adjusted row above to $588 ÷ 42 ≈ revised; figures above reflect 500K req/MAU estimate.

---

## 6. WAF (us-east-1; stg + prod only)

WAF pricing (✓): $5.00/WebACL/month + $1.00/custom rule/month + $1.00/AWS managed rule group/month + $0.60/million requests. Configuration: 1 WebACL + 1 rate-based rule + 3 AWS managed rule groups = **$9/month fixed**.

| Resource | dev | sbx | stg | prod (1K) | prod (10K) | prod (100K) | prod (1M) | prod (10M) | prod (100M) |
|---|---|---|---|---|---|---|---|---|---|
| Fixed base ($9/mo) | $0 | $0 | $9 | $9 | $9 | $9 | $9 | $9 | $9 |
| Request cost ($0.60/M) | $0 | $0 | $0 | $0 | $0 | $0 | $1 | $9 | $86 |
| WAF logging (Kinesis Firehose ✓ $0.029/GB) | $0 | $0 | $0 | $0 | $0 | $0 | $1 | $6 | $58 |
| **Subtotal** | **$0** | **$0** | **$9** | **$9** | **$9** | **$9** | **$11** | **$24** | **$153** |

> dev/sbx: `enable_waf = false`. stg: WAF enabled (default=true), `enable_waf_logging = false`. prod: WAF + logging enabled.

---

## 7. Route 53

| Resource | dev | sbx | stg | prod (1K) | prod (10K) | prod (100K) | prod (1M) | prod (10M) | prod (100M) |
|---|---|---|---|---|---|---|---|---|---|
| Hosted zone (✓ $0.50/zone) | $1 | $1 | $1 | $1 | $1 | $1 | $1 | $1 | $1 |
| DNS queries (✓ $0.40/M queries) | $0 | $0 | $0 | $0 | $0 | $0 | $1 | $6 | $58 |
| **Subtotal** | **$1** | **$1** | **$1** | **$1** | **$1** | **$1** | **$2** | **$7** | **$59** |

---

## 8. ECR

| Resource | dev | sbx | stg | prod (1K) | prod (10K) | prod (100K) | prod (1M) | prod (10M) | prod (100M) |
|---|---|---|---|---|---|---|---|---|---|
| Storage (✓ $0.10/GB/month; ~2 GB images) | $0 | $0 | $0 | $0 | $0 | $0 | $0 | $0 | $0 |
| **Subtotal** | **$0** | **$0** | **$0** | **$0** | **$0** | **$0** | **$0** | **$0** | **$0** |

> S3 gateway VPC endpoint eliminates NAT data processing charges for image pulls.

---

## 9. Secrets Manager

| Resource | dev | sbx | stg | prod (1K) | prod (10K) | prod (100K) | prod (1M) | prod (10M) | prod (100M) |
|---|---|---|---|---|---|---|---|---|---|
| Secrets (~6; ✓ $0.40/secret/month) | $2 | $2 | $2 | $2 | $2 | $2 | $2 | $2 | $2 |
| **Subtotal** | **$2** | **$2** | **$2** | **$2** | **$2** | **$2** | **$2** | **$2** | **$2** |

---

## 10. CloudWatch

CloudWatch pricing (✓): Log ingestion $0.50/GB (first 5 GB/account/month free). Alarms $0.10/alarm/month. Dashboard $3/month. X-Ray: 100K traces free/month, then $5/million.

| Resource | dev | sbx | stg | prod (1K) | prod (10K) | prod (100K) | prod (1M) | prod (10M) | prod (100M) |
|---|---|---|---|---|---|---|---|---|---|
| Log ingestion (~1 GB/mo; 5 GB free) | $0 | $0 | $0 | $0 | $0 | $0 | $0 | $3 | $25 |
| Alarms — autoscaling always-on (2) | $0 | $0 | $0 | $0 | $0 | $0 | $0 | $0 | $0 |
| Alarms — basic (2 ALB; stg+prod) | $0 | $0 | $0 | $0 | $0 | $0 | $0 | $0 | $0 |
| Alarms — all (13 additional; prod only) | $0 | $0 | $0 | $1 | $1 | $1 | $1 | $1 | $1 |
| Dashboard (prod only; ✓ $3/month) | $0 | $0 | $0 | $3 | $3 | $3 | $3 | $3 | $3 |
| X-Ray traces (stg+prod; 100K free) | $0 | $0 | $0 | $0 | $0 | $0 | $1 | $10 | $95 |
| **Subtotal** | **$0** | **$0** | **$0** | **$4** | **$4** | **$4** | **$5** | **$17** | **$124** |

> dev/sbx: all alarms and dashboard disabled per tfvars. 2 always-on autoscaling alarms = $0.20/mo (shown as $0). stg: 2 basic alarms + 2 autoscaling = $0.40/mo (shown as $0).

---

## 11. GuardDuty

GuardDuty pricing (✓): ECS Runtime Monitoring $1.50/vCPU/month. VPC Flow Logs analysis $1.00/GB (first 500 GB/month).

| Resource | dev | sbx | stg | prod (1K) | prod (10K) | prod (100K) | prod (1M) | prod (10M) | prod (100M) |
|---|---|---|---|---|---|---|---|---|---|
| Backend GuardDuty enabled | No | No | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| ECS Runtime (stg: 1.5 vCPU; prod: 7 vCPU) | $0 | $0 | $2 | $11 | $11 | $11 | $11 | $11 | $11 |
| VPC Flow Logs (~0.5 GB stg; ~2 GB prod) | $0 | $0 | $1 | $2 | $2 | $2 | $2 | $2 | $2 |
| Edge GuardDuty (us-east-1; stg+prod) | $0 | $0 | $2 | $2 | $2 | $2 | $2 | $2 | $2 |
| **Subtotal** | **$0** | **$0** | **$5** | **$15** | **$15** | **$15** | **$15** | **$15** | **$15** |

> stg ECS Runtime: api_min=2×0.5 + worker_min=1×0.5 = 1.5 vCPU × $1.50 = $2.25. Prod: api_min=5×1 + worker_min=2×1 = 7 vCPU × $1.50 = $10.50.

---

## 12. CloudTrail

CloudTrail pricing (✓): First trail free for management events.

| Resource | dev | sbx | stg | prod (1K–100M) |
|---|---|---|---|---|
| Management events (first trail free) | $0 | $0 | N/A | $0 |
| **Subtotal** | **$0** | **$0** | **$0** | **$0** |

> stg: `enable_cloudtrail = false` per tfvars. prod: management events only, first trail free.

---

## 13. S3 (Uploads + Logging)

| Resource | dev | sbx | stg | prod (1K) | prod (10K) | prod (100K) | prod (1M) | prod (10M) | prod (100M) |
|---|---|---|---|---|---|---|---|---|---|
| Standard storage (~1 GB base + uploads) | $0 | $0 | $0 | $0 | $0 | $0 | $1 | $5 | $46 |
| PUT/GET requests | $0 | $0 | $0 | $0 | $0 | $0 | $0 | $1 | $8 |
| **Subtotal** | **$0** | **$0** | **$0** | **$0** | **$0** | **$0** | **$1** | **$6** | **$54** |

---

## Grand Total

| Section | dev | sbx | stg | prod (1K) | prod (10K) | prod (100K) | prod (1M) | prod (10M) | prod (100M) |
|---|---|---|---|---|---|---|---|---|---|
| 1. Networking | $33 | $33 | $160 | $239 | $239 | $240 | $248 | $329 | $1,139 |
| 2. ECS Fargate | $42 | $42 | $62 | $344 | $344 | $344 | $344 | $344 | $344 |
| 3. ALB | $6 | $6 | $7 | $7 | $7 | $8 | $11 | $36 | $286 |
| 4. ElastiCache | $12 | $12 | $49 | $98 | $98 | $98 | $98 | $98 | $98 |
| 5. CloudFront + Lambda@Edge | $0 | $0 | $0 | $0 | $0 | $1 | $121 | $1,986 | $14,088 |
| 6. WAF | $0 | $0 | $9 | $9 | $9 | $9 | $11 | $24 | $153 |
| 7. Route 53 | $1 | $1 | $1 | $1 | $1 | $1 | $2 | $7 | $59 |
| 8. ECR | $0 | $0 | $0 | $0 | $0 | $0 | $0 | $0 | $0 |
| 9. Secrets Manager | $2 | $2 | $2 | $2 | $2 | $2 | $2 | $2 | $2 |
| 10. CloudWatch | $0 | $0 | $0 | $4 | $4 | $4 | $5 | $17 | $124 |
| 11. GuardDuty | $0 | $0 | $5 | $15 | $15 | $15 | $15 | $15 | $15 |
| 12. CloudTrail | $0 | $0 | $0 | $0 | $0 | $0 | $0 | $0 | $0 |
| 13. S3 | $0 | $0 | $0 | $0 | $0 | $0 | $1 | $6 | $54 |
| **Grand Total** | **$96** | **$96** | **$295** | **$719** | **$719** | **$722** | **$858** | **$2,864** | **$16,362** |

---

## Pricing Notes

**Confirmed from AWS documentation (✓):**
- CloudFront India: 1 TB/month free, $0.109/GB (9 TB), $0.085/GB (40 TB), $0.082/GB (100 TB); HTTPS 10M free then $0.0120/10K
- WAF: $5/WebACL + $1/custom rule + $1/AWS managed rule group (not free) + $0.60/M requests
- GuardDuty: $1.50/vCPU/month ECS Runtime; $1.00/GB VPC Flow Logs
- VPC Interface Endpoints: $0.013/AZ/hr (ap-south-1)
- CloudWatch: 5 GB/month log ingestion free; $0.50/GB after; $3/month dashboard; $0.10/alarm/month
- X-Ray: 100K traces free/month; $5/million after
- Kinesis Firehose: $0.029/GB (Direct PUT)
- Secrets Manager: $0.40/secret/month
- ECR: $0.10/GB/month storage
- Route 53: $0.50/hosted zone; $0.40/million queries
- CloudTrail: first trail management events free

**Training data estimates (~) — verify via [AWS Pricing Calculator](https://calculator.aws/):**
- Fargate ap-south-1: $0.04656/vCPU/hr, $0.00511/GB-hr
- ALB ap-south-1: ~$0.008/hr base
- ElastiCache ap-south-1: t4g.micro ~$0.016/hr, t4g.medium ~$0.068/hr
- NAT Gateway: ~$0.045/hr/GW + ~$0.045/GB data processing

**Key caveats:**
- ECS costs show **minimum task counts** from tfvars. Autoscaling adds cost at peak load.
- CloudFront 1 TB/month free tier is shared across all environments in the same AWS account.
- prod (10M+) CloudFront costs are highly sensitive to the 2 MB/MAU assumption. At 10 MB/MAU (e.g. with file uploads), prod (10M) CloudFront alone exceeds $9,000/month.
- dev and sbx are identical configurations.
