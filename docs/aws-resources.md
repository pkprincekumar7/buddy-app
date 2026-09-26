# AWS Resources by Environment

All resources are provisioned by four Terraform modules:

| Module | Directory | Region |
|--------|-----------|--------|
| **Backend** | `infra-live-backend/terraform/` | Applied once **per region** — `ap-south-1`, `eu-west-1`, `us-east-1` (`var.aws_region`, chosen per apply). The tables below describe **one region's application**; see the multi-region note in the Summary section for how totals scale as more regions are added. |
| **Edge** | `infra-live-edge/terraform/` | `us-east-1` (hardcoded — CloudFront, WAF, and ACM global certificates require this region). One shared distribution per environment, covering every active backend region. |
| **Frontend** | `infra-live-frontend/terraform/` | `us-east-1` |
| **Scheduler** | `infra-live-scheduler/terraform/` | `us-east-1` (`var.aws_region`, defaults to `us-east-1`) — one application per environment, independent of which backend regions are active |

Legend: ✅ Created &nbsp; ❌ Skipped

---

## Backend Module — one region's application (`ap-south-1` / `eu-west-1` / `us-east-1`)

### Networking

| Resource | AWS Type | dev | sbx | stg | prod |
|----------|----------|:---:|:---:|:---:|:----:|
| VPC | `aws_vpc` | ✅ | ✅ | ✅ | ✅ |
| Public Subnets (×3) | `aws_subnet` | ✅ | ✅ | ✅ | ✅ |
| Private Subnets (×3) | `aws_subnet` | ✅ | ✅ | ✅ | ✅ |
| Internet Gateway | `aws_internet_gateway` | ✅ | ✅ | ✅ | ✅ |
| Route Tables (×4) & Associations (×6) | `aws_route_table` / `aws_route_table_association` | ✅ | ✅ | ✅ | ✅ |
| Routes: Internet + Private NAT (×4) | `aws_route` | ✅ | ✅ | ✅ | ✅ |
| NAT Gateway | `aws_nat_gateway` | ✅ ×1 | ✅ ×1 | ✅ ×2 | ✅ ×3 |
| Elastic IPs (for NAT) | `aws_eip` | ✅ ×1 | ✅ ×1 | ✅ ×2 | ✅ ×3 |

### VPC Endpoints

| Resource | AWS Type | dev | sbx | stg | prod |
|----------|----------|:---:|:---:|:---:|:----:|
| S3 Gateway Endpoint | `aws_vpc_endpoint` | ✅ | ✅ | ✅ | ✅ |
| ECR API Interface Endpoint | `aws_vpc_endpoint` | ❌ ¹ | ❌ ¹ | ✅ | ✅ |
| ECR DKR Interface Endpoint | `aws_vpc_endpoint` | ❌ ¹ | ❌ ¹ | ✅ | ✅ |
| Secrets Manager Interface Endpoint | `aws_vpc_endpoint` | ❌ ¹ | ❌ ¹ | ✅ | ✅ |
| CloudWatch Logs Interface Endpoint | `aws_vpc_endpoint` | ❌ ¹ | ❌ ¹ | ✅ | ✅ |
| X-Ray Interface Endpoint | `aws_vpc_endpoint` | ❌ ¹ | ❌ ¹ | ✅ | ✅ |
| VPC Endpoint Security Group | `aws_security_group` | ❌ ¹ | ❌ ¹ | ✅ | ✅ |
| Endpoint SG Ingress: from API Task | `aws_vpc_security_group_ingress_rule` | ❌ ¹ | ❌ ¹ | ✅ | ✅ |
| Endpoint SG Ingress: from Worker Task | `aws_vpc_security_group_ingress_rule` | ❌ ¹ | ❌ ¹ | ✅ | ✅ |

> ¹ Interface endpoints require `nat_gateway_count > 1`. dev/sbx use a single NAT gateway so all interface endpoint resources (including the shared security group and its ingress rules) are skipped — traffic routes via the NAT gateway instead.

### ECS — API Service

| Resource | AWS Type | dev | sbx | stg | prod |
|----------|----------|:---:|:---:|:---:|:----:|
| ECS Cluster | `aws_ecs_cluster` | ✅ | ✅ | ✅ | ✅ |
| Cluster Capacity Providers | `aws_ecs_cluster_capacity_providers` | ✅ | ✅ | ✅ | ✅ |
| API Task Definition | `aws_ecs_task_definition` | ✅ | ✅ | ✅ | ✅ |
| API ECS Service | `aws_ecs_service` | ✅ | ✅ | ✅ | ✅ |
| API Auto Scaling Target | `aws_appautoscaling_target` | ✅ | ✅ | ✅ | ✅ |
| API CPU Scaling Policy | `aws_appautoscaling_policy` | ✅ | ✅ | ✅ | ✅ |
| API Memory Scaling Policy | `aws_appautoscaling_policy` | ✅ | ✅ | ✅ | ✅ |
| API ALB Request Scaling Policy | `aws_appautoscaling_policy` | ✅ | ✅ | ✅ | ✅ |

### ECS — Worker Service

| Resource | AWS Type | dev | sbx | stg | prod |
|----------|----------|:---:|:---:|:---:|:----:|
| Worker Task Definition | `aws_ecs_task_definition` | ✅ | ✅ | ✅ | ✅ |
| Worker ECS Service | `aws_ecs_service` | ✅ | ✅ | ✅ | ✅ |
| Worker Auto Scaling Target | `aws_appautoscaling_target` | ✅ | ✅ | ✅ | ✅ |
| Worker CPU Scaling Policy | `aws_appautoscaling_policy` | ✅ | ✅ | ✅ | ✅ |
| Worker Pending Jobs Scale-Out Policy | `aws_appautoscaling_policy` | ✅ | ✅ | ✅ | ✅ |
| Worker Pending Jobs Scale-In Policy | `aws_appautoscaling_policy` | ✅ | ✅ | ✅ | ✅ |

### Load Balancer

| Resource | AWS Type | dev | sbx | stg | prod |
|----------|----------|:---:|:---:|:---:|:----:|
| Internal ALB | `aws_lb` | ✅ | ✅ | ✅ | ✅ |
| ALB Target Group | `aws_lb_target_group` | ✅ | ✅ | ✅ | ✅ |
| ALB HTTPS Listener | `aws_lb_listener` | ✅ | ✅ | ✅ | ✅ |
| ALB Listener Rule (Origin Verify) | `aws_lb_listener_rule` | ✅ | ✅ | ✅ | ✅ |
| ALB Security Group | `aws_security_group` | ✅ | ✅ | ✅ | ✅ |
| ALB SG Ingress: from CloudFront | `aws_vpc_security_group_ingress_rule` | ✅ | ✅ | ✅ | ✅ |
| ECS Task Security Group | `aws_security_group` | ✅ | ✅ | ✅ | ✅ |
| ECS Task SG Ingress: from ALB | `aws_vpc_security_group_ingress_rule` | ✅ | ✅ | ✅ | ✅ |
| Worker Security Group | `aws_security_group` | ✅ | ✅ | ✅ | ✅ |

### ElastiCache (Redis)

| Resource | AWS Type | dev | sbx | stg | prod |
|----------|----------|:---:|:---:|:---:|:----:|
| Subnet Group | `aws_elasticache_subnet_group` | ✅ | ✅ | ✅ | ✅ |
| Parameter Group | `aws_elasticache_parameter_group` | ✅ | ✅ | ✅ | ✅ |
| Replication Group | `aws_elasticache_replication_group` | ✅ `cache.t3.micro` ×0 replicas | ✅ `cache.t3.micro` ×0 replicas | ✅ `cache.t3.medium` ×0 replicas | ✅ `cache.r6g.4xlarge` ×2 replicas |
| ElastiCache Security Group | `aws_security_group` | ✅ | ✅ | ✅ | ✅ |
| ElastiCache SG Ingress: from ECS Tasks | `aws_vpc_security_group_ingress_rule` | ✅ | ✅ | ✅ | ✅ |

### Storage & Registry

> The S3 uploads bucket and the regional logging bucket are pre-created manually and not managed by Terraform. These resources configure them.

| Resource | AWS Type | dev | sbx | stg | prod |
|----------|----------|:---:|:---:|:---:|:----:|
| ECR Repository | `aws_ecr_repository` | ✅ | ✅ | ✅ | ✅ |
| ECR Lifecycle Policy | `aws_ecr_lifecycle_policy` | ✅ | ✅ | ✅ | ✅ |
| S3 Uploads Bucket CORS Config | `aws_s3_bucket_cors_configuration` | ✅ | ✅ | ✅ | ✅ |
| S3 Uploads Bucket Lifecycle Config | `aws_s3_bucket_lifecycle_configuration` | ✅ | ✅ | ✅ | ✅ |
| S3 Regional Logging Bucket Policy ² | `aws_s3_bucket_policy` | ❌ | ❌ | ✅ | ✅ |

> ² Created when **either** `enable_cloudtrail` or `enable_alb_access_logs` is true (the two flags are independent — see `variables.tf` — but share this one bucket/policy resource). Both happen to be `false` on dev/sbx and `true` on stg/prod today, so the ✅/❌ pattern is the same as before the flags were decoupled; either one being flipped independently would change this row without changing the other security/ALB rows.

### IAM

| Resource | AWS Type | dev | sbx | stg | prod |
|----------|----------|:---:|:---:|:---:|:----:|
| ECS Execution Role | `aws_iam_role` | ✅ | ✅ | ✅ | ✅ |
| ECS Execution Managed Policy Attachment | `aws_iam_role_policy_attachment` | ✅ | ✅ | ✅ | ✅ |
| ECS Execution Secrets Policy | `aws_iam_role_policy` | ✅ | ✅ | ✅ | ✅ |
| ECS Task Role | `aws_iam_role` | ✅ | ✅ | ✅ | ✅ |
| ECS Task S3 Policy | `aws_iam_role_policy` | ✅ | ✅ | ✅ | ✅ |
| ECS Task S3 Uploads Policy | `aws_iam_role_policy` | ✅ | ✅ | ✅ | ✅ |
| Worker Task Role | `aws_iam_role` | ✅ | ✅ | ✅ | ✅ |
| Worker Task CloudWatch Policy | `aws_iam_role_policy` | ✅ | ✅ | ✅ | ✅ |
| ECS Exec Policy (API) | `aws_iam_role_policy` | ✅ | ✅ | ✅ | ❌ |
| ECS Exec Policy (Worker) | `aws_iam_role_policy` | ✅ | ✅ | ✅ | ❌ |
| X-Ray Policy (API) | `aws_iam_role_policy` | ❌ | ❌ | ✅ | ✅ |
| X-Ray Policy (Worker) | `aws_iam_role_policy` | ❌ | ❌ | ✅ | ✅ |

### Secrets & Config

| Resource | AWS Type | dev | sbx | stg | prod |
|----------|----------|:---:|:---:|:---:|:----:|
| App Secret | `aws_secretsmanager_secret` | ✅ | ✅ | ✅ | ✅ |
| App Secret Placeholder Version | `aws_secretsmanager_secret_version` | ✅ | ✅ | ✅ | ✅ |
| SSM: ALB Internal FQDN | `aws_ssm_parameter` | ✅ | ✅ | ✅ | ✅ |
| SSM: ECR Repository URL | `aws_ssm_parameter` | ✅ | ✅ | ✅ | ✅ |
| SSM: ECS Cluster Name | `aws_ssm_parameter` | ✅ | ✅ | ✅ | ✅ |
| SSM: ECS Service Name | `aws_ssm_parameter` | ✅ | ✅ | ✅ | ✅ |
| SSM: ECS Worker Service Name | `aws_ssm_parameter` | ✅ | ✅ | ✅ | ✅ |

### DNS

| Resource | AWS Type | dev | sbx | stg | prod |
|----------|----------|:---:|:---:|:---:|:----:|
| Internal Route53 Record (ALB) | `aws_route53_record` | ✅ | ✅ | ✅ | ✅ |

### Observability

| Resource | AWS Type | dev | sbx | stg | prod |
|----------|----------|:---:|:---:|:---:|:----:|
| CloudWatch Log Group (API) | `aws_cloudwatch_log_group` | ✅ 7d | ✅ 7d | ✅ 30d | ✅ 90d |
| CloudWatch Log Group (Worker) | `aws_cloudwatch_log_group` | ✅ 7d | ✅ 7d | ✅ 30d | ✅ 90d |
| SNS Alerts Topic | `aws_sns_topic` | ✅ | ✅ | ✅ | ✅ |
| SNS Email Subscription | `aws_sns_topic_subscription` | ❌ | ❌ | ❌ | ✅ |
| X-Ray Default Sampling Rule | `aws_xray_sampling_rule` | ✅ 5% | ✅ 5% | ✅ 5% | ✅ 1% |
| X-Ray Error Sampling Rule (100%) | `aws_xray_sampling_rule` | ❌ | ❌ | ❌ | ✅ |
| CloudWatch Dashboard (9 widgets) | `aws_cloudwatch_dashboard` | ❌ | ❌ | ❌ | ✅ |
| Alarm: ALB Healthy Hosts | `aws_cloudwatch_metric_alarm` | ❌ | ❌ | ✅ | ✅ |
| Alarm: ALB 5XX Errors | `aws_cloudwatch_metric_alarm` | ❌ | ❌ | ✅ | ✅ |
| Alarm: API CPU Sustained | `aws_cloudwatch_metric_alarm` | ❌ | ❌ | ❌ | ✅ |
| Alarm: API Memory Sustained | `aws_cloudwatch_metric_alarm` | ❌ | ❌ | ❌ | ✅ |
| Alarm: API CPU High | `aws_cloudwatch_metric_alarm` | ❌ | ❌ | ❌ | ✅ |
| Alarm: API Memory High | `aws_cloudwatch_metric_alarm` | ❌ | ❌ | ❌ | ✅ |
| Alarm: Worker CPU Sustained | `aws_cloudwatch_metric_alarm` | ❌ | ❌ | ❌ | ✅ |
| Alarm: Worker CPU High | `aws_cloudwatch_metric_alarm` | ❌ | ❌ | ❌ | ✅ |
| Alarm: Worker Memory High | `aws_cloudwatch_metric_alarm` | ❌ | ❌ | ❌ | ✅ |
| Alarm: Worker Processing Stuck | `aws_cloudwatch_metric_alarm` | ❌ | ❌ | ❌ | ✅ |
| Alarm: Worker Pending Jobs High | `aws_cloudwatch_metric_alarm` | ❌ | ❌ | ❌ | ✅ |
| Alarm: Worker Pending Jobs (Scale-Out) | `aws_cloudwatch_metric_alarm` | ✅ | ✅ | ✅ | ✅ |
| Alarm: Worker Pending Jobs (Scale-In) | `aws_cloudwatch_metric_alarm` | ✅ | ✅ | ✅ | ✅ |
| Alarm: Redis Connections | `aws_cloudwatch_metric_alarm` | ❌ | ❌ | ❌ | ✅ |

### Security

| Resource | AWS Type | dev | sbx | stg | prod |
|----------|----------|:---:|:---:|:---:|:----:|
| GuardDuty Detector | `aws_guardduty_detector` | ❌ | ❌ | ✅ | ✅ |
| GuardDuty Runtime Monitoring Feature | `aws_guardduty_detector_feature` | ❌ | ❌ | ✅ | ✅ |
| CloudTrail Regional Trail | `aws_cloudtrail` | ❌ | ❌ | ✅ | ✅ |

---

## Edge Module (`us-east-1`, one shared distribution per environment)

### CloudFront & DNS

| Resource | AWS Type | dev | sbx | stg | prod |
|----------|----------|:---:|:---:|:---:|:----:|
| CloudFront Distribution | `aws_cloudfront_distribution` | ✅ PriceClass_100 | ✅ PriceClass_100 | ✅ PriceClass_100 | ✅ PriceClass_All |
| CloudFront Origin Access Control (Frontend S3) | `aws_cloudfront_origin_access_control` | ✅ | ✅ | ✅ | ✅ |
| CloudFront Origin Access Control (Assets S3) | `aws_cloudfront_origin_access_control` | ✅ | ✅ | ✅ | ✅ |
| CloudFront Origin Access Control (Uploads S3, shared across regions) | `aws_cloudfront_origin_access_control` | ✅ | ✅ | ✅ | ✅ |
| Response Headers Policy (Frontend) | `aws_cloudfront_response_headers_policy` | ✅ | ✅ | ✅ | ✅ |
| Response Headers Policy (API) | `aws_cloudfront_response_headers_policy` | ✅ | ✅ | ✅ | ✅ |
| Response Headers Policy (Assets) | `aws_cloudfront_response_headers_policy` | ✅ | ✅ | ✅ | ✅ |
| Route53 Public DNS Record | `aws_route53_record` | ✅ | ✅ | ✅ | ✅ |
| Assets S3 Bucket Policy (CloudFront OAC) | `aws_s3_bucket_policy` | ✅ | ✅ | ✅ | ✅ |
| Uploads S3 Bucket Policy (CloudFront OAC) ³ | `aws_s3_bucket_policy` | ✅ ×1–3 | ✅ ×1–3 | ✅ ×1–3 | ✅ ×1–3 |

> ³ One policy per region in `var.backend_regions` (the `terraform-live-edge`/`terraform-live-all` workflow's region-selection input), not per environment — up to 3 (`ap-south-1`, `eu-west-1`, `us-east-1`). Counted as **×1** in the Summary totals below, matching the current single-region default (`["ap-south-1"]`).

### Lambda@Edge

| Resource | AWS Type | dev | sbx | stg | prod |
|----------|----------|:---:|:---:|:---:|:----:|
| JWT Validator Lambda Function | `aws_lambda_function` | ✅ | ✅ | ✅ | ✅ |
| JWT Validator IAM Role | `aws_iam_role` | ✅ | ✅ | ✅ | ✅ |
| JWT Validator IAM Policy Attachment | `aws_iam_role_policy_attachment` | ✅ | ✅ | ✅ | ✅ |
| Replica Cleanup Delay (destroy-only, no-op on apply) | `time_sleep` | ✅ | ✅ | ✅ | ✅ |

### WAF

| Resource | AWS Type | dev | sbx | stg | prod |
|----------|----------|:---:|:---:|:---:|:----:|
| WAF WebACL | `aws_wafv2_web_acl` | ❌ | ❌ | ✅ | ✅ |
| WAF Logging Firehose IAM Role | `aws_iam_role` | ❌ | ❌ | ❌ | ✅ |
| WAF Logging Firehose IAM Policy | `aws_iam_role_policy` | ❌ | ❌ | ❌ | ✅ |
| Kinesis Firehose (WAF logs → S3) | `aws_kinesis_firehose_delivery_stream` | ❌ | ❌ | ❌ | ✅ |
| WAF Logging Configuration | `aws_wafv2_web_acl_logging_configuration` | ❌ | ❌ | ❌ | ✅ |

### SSM & Security

| Resource | AWS Type | dev | sbx | stg | prod |
|----------|----------|:---:|:---:|:---:|:----:|
| SSM: CloudFront Distribution ID | `aws_ssm_parameter` | ✅ | ✅ | ✅ | ✅ |
| SSM: CloudFront ARN | `aws_ssm_parameter` | ✅ | ✅ | ✅ | ✅ |
| SSM: App URL | `aws_ssm_parameter` | ✅ | ✅ | ✅ | ✅ |
| SSM: SPA S3 Bucket Name | `aws_ssm_parameter` | ✅ | ✅ | ✅ | ✅ |
| Global Logging Bucket Policy (CloudTrail) | `aws_s3_bucket_policy` | ❌ | ❌ | ❌ | ✅ |
| GuardDuty Detector | `aws_guardduty_detector` | ❌ | ❌ | ✅ | ✅ |
| CloudTrail Global Trail | `aws_cloudtrail` | ❌ | ❌ | ❌ ⁴ | ✅ |

> ⁴ CloudTrail in edge is disabled for stg — no global logging S3 bucket provisioned for stg yet.

---

## Frontend Module (`us-east-1`)

| Resource | AWS Type | dev | sbx | stg | prod |
|----------|----------|:---:|:---:|:---:|:----:|
| SPA S3 Bucket Policy (CloudFront OAC) | `aws_s3_bucket_policy` | ✅ | ✅ | ✅ | ✅ |

> The SPA S3 bucket itself is pre-created manually (not managed by Terraform). This module only applies the bucket policy.

---

## Scheduler Module (`us-east-1`, one application per environment)

> Drives the daily start/stop automation (`terraform-live-scheduler.yml`) that dispatches `terraform-live-all.yml` at fixed IST times via EventBridge Scheduler → Lambda → GitHub Actions `workflow_dispatch`. `schedule_enabled` toggles the schedules' `ENABLED`/`DISABLED` **state** — it does not change which resources exist; every row below is created regardless of that flag.

| Resource | AWS Type | dev | sbx | stg | prod |
|----------|----------|:---:|:---:|:---:|:----:|
| GitHub PAT Secret | `aws_secretsmanager_secret` | ✅ | ✅ | ✅ | ✅ |
| GitHub PAT Secret Version | `aws_secretsmanager_secret_version` | ✅ | ✅ | ✅ | ✅ |
| Lambda Execution IAM Role | `aws_iam_role` | ✅ | ✅ | ✅ | ✅ |
| Lambda Execution IAM Policy (Logs + Secrets read) | `aws_iam_role_policy` | ✅ | ✅ | ✅ | ✅ |
| GitHub Dispatcher Lambda Function | `aws_lambda_function` | ✅ | ✅ | ✅ | ✅ |
| Scheduler IAM Role | `aws_iam_role` | ✅ | ✅ | ✅ | ✅ |
| Scheduler Invoke IAM Policy | `aws_iam_role_policy` | ✅ | ✅ | ✅ | ✅ |
| Schedule Group | `aws_scheduler_schedule_group` | ✅ | ✅ | ✅ | ✅ |
| Start Schedule (apply, 03:00 PM IST default) | `aws_scheduler_schedule` | ✅ | ✅ | ✅ | ✅ |
| Stop Schedule (destroy, 10:00 PM IST default) | `aws_scheduler_schedule` | ✅ | ✅ | ✅ | ✅ |

---

## Summary — Resource Count per Environment

Counts below are for **one backend region** (the current single-region default, `["ap-south-1"]`) plus one application each of edge, frontend, and scheduler.

| Category | dev | sbx | stg | prod |
|----------|:---:|:---:|:---:|:----:|
| Networking (VPC, subnets, IGW, route tables, routes, associations) | 22 | 22 | 22 | 22 |
| NAT Gateways + EIPs | 2 | 2 | 4 | 6 |
| VPC Endpoints + SG ingress rules | 1 | 1 | 9 | 9 |
| ECS (cluster, tasks, services, autoscaling policies) | 14 | 14 | 14 | 14 |
| Load Balancer (ALB, TG, listener, listener rule, SGs, ingress rules) | 9 | 9 | 9 | 9 |
| ElastiCache (Redis, SG, ingress rule) | 5 | 5 | 5 | 5 |
| ECR | 2 | 2 | 2 | 2 |
| S3 configs & policies (backend) | 2 | 2 | 3 | 3 |
| IAM roles & policies (backend) | 10 | 10 | 12 | 10 |
| Secrets Manager (backend) | 2 | 2 | 2 | 2 |
| SSM Parameters (backend) | 5 | 5 | 5 | 5 |
| DNS (internal) | 1 | 1 | 1 | 1 |
| Observability (logs, alarms, X-Ray, SNS) | 6 | 6 | 8 | 21 |
| Security — backend (GuardDuty, CloudTrail) | 0 | 0 | 3 | 3 |
| **Backend subtotal (per region)** | **81** | **81** | **99** | **112** |
| CloudFront + OAC (×3) + response headers + DNS + S3 policies (×1 region) | 10 | 10 | 10 | 10 |
| Lambda@Edge (incl. destroy-only `time_sleep`) | 4 | 4 | 4 | 4 |
| WAF | 0 | 0 | 1 | 5 |
| SSM Parameters (edge) | 4 | 4 | 4 | 4 |
| Security — edge (GuardDuty, CloudTrail) | 0 | 0 | 1 | 2 |
| **Edge subtotal** | **18** | **18** | **20** | **25** |
| Frontend S3 policy | 1 | 1 | 1 | 1 |
| Scheduler (Lambda, IAM, EventBridge, Secrets Manager) | 10 | 10 | 10 | 10 |
| **Total (1 backend region)** | **110** | **110** | **130** | **148** |

### Scaling to more backend regions

The **Backend subtotal** is per region and multiplies directly — applying `infra-live-backend` for `eu-west-1` and `us-east-1` in addition to `ap-south-1` adds two more full backend subtotals. The **Edge** module stays at one application per environment, but its uploads-bucket-policy count (folded into the CloudFront row above) grows by one per additional active region — everything else in Edge, Frontend, and Scheduler stays fixed regardless of how many backend regions are active:

| Active backend regions | dev/sbx total | stg total | prod total |
|:---:|:---:|:---:|:---:|
| 1 (`ap-south-1` only) | 110 | 130 | 148 |
| 2 (+ `eu-west-1`) | 110 + 81 + 1 = 192 | 130 + 99 + 1 = 230 | 148 + 112 + 1 = 261 |
| 3 (+ `us-east-1`) | 192 + 81 + 1 = 274 | 230 + 99 + 1 = 330 | 261 + 112 + 1 = 374 |

(`+1` per added region is the extra uploads-bucket S3 bucket policy in the Edge module.)
