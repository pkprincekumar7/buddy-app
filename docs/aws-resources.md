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
| Endpoint SG Ingress: from each runtime's task SG | `aws_vpc_security_group_ingress_rule` | ❌ ¹ | ❌ ¹ | ✅ | ✅ |

> ¹ Interface endpoints require `nat_gateway_count > 1`. dev/sbx use a single NAT gateway so all interface endpoint resources (including the shared security group and its ingress rules) are skipped — traffic routes via the NAT gateway instead.

### Runtimes

The stack runs **18 runtimes** (`services.tf`): 9 HTTP services (auth, users, children, onboarding, discover, grow, transform, release, platform), 8 workers (`<service>-worker`, none for platform) and the OpenTelemetry collector. Rows marked *per runtime* repeat for each of the 18; rows marked *per service* for each of the 9. Task sizes and counts per environment are in `runtime_sizes` (the tfvars).

### ECS

| Resource | AWS Type | dev | sbx | stg | prod |
|----------|----------|:---:|:---:|:---:|:----:|
| ECS Cluster | `aws_ecs_cluster` | ✅ | ✅ | ✅ | ✅ |
| Cluster Capacity Providers | `aws_ecs_cluster_capacity_providers` | ✅ | ✅ | ✅ | ✅ |
| Task Definition + ECS Service (per runtime) | `aws_ecs_task_definition` / `aws_ecs_service` | ✅ | ✅ | ✅ | ✅ |
| Auto Scaling Target (per runtime) | `aws_appautoscaling_target` | ✅ | ✅ | ✅ | ✅ |
| Scaling Policies: HTTP services' CPU, memory and ALB requests (3 each) | `aws_appautoscaling_policy` | ✅ | ✅ | ✅ | ✅ |
| Scaling Policies: workers' CPU floor, queue depth and queue low (3 each), plus pending jobs for the 4 generating workers | `aws_appautoscaling_policy` | ✅ | ✅ | ✅ | ✅ |
| Scaling Policy: collector CPU | `aws_appautoscaling_policy` | ✅ | ✅ | ✅ | ✅ |
| Cloud Map Namespace (`<app>-<env>.internal`) | `aws_service_discovery_private_dns_namespace` | ✅ | ✅ | ✅ | ✅ |
| Cloud Map Service (the 8 HTTP services with an internal API, and the collector) | `aws_service_discovery_service` | ✅ | ✅ | ✅ | ✅ |

### Load Balancer

| Resource | AWS Type | dev | sbx | stg | prod |
|----------|----------|:---:|:---:|:---:|:----:|
| Internal ALB | `aws_lb` | ✅ | ✅ | ✅ | ✅ |
| ALB Target Group (per HTTP service) | `aws_lb_target_group` | ✅ | ✅ | ✅ | ✅ |
| ALB HTTPS Listener | `aws_lb_listener` | ✅ | ✅ | ✅ | ✅ |
| ALB Listener Rules (one per `shared/service-routes.json` rule, plus the fixed 404 at 50000) | `aws_lb_listener_rule` | ✅ | ✅ | ✅ | ✅ |
| ALB Security Group | `aws_security_group` | ✅ | ✅ | ✅ | ✅ |
| ALB SG Ingress: from CloudFront | `aws_vpc_security_group_ingress_rule` | ✅ | ✅ | ✅ | ✅ |
| Task Security Group (per runtime) | `aws_security_group` | ✅ | ✅ | ✅ | ✅ |
| Task SG Ingress: from ALB (per HTTP service) | `aws_vpc_security_group_ingress_rule` | ✅ | ✅ | ✅ | ✅ |
| Internal-callers Security Group | `aws_security_group` | ✅ | ✅ | ✅ | ✅ |
| Task SG Ingress: internal port from internal callers (each Cloud Map runtime) | `aws_vpc_security_group_ingress_rule` | ✅ | ✅ | ✅ | ✅ |

### ElastiCache (Valkey)

| Resource | AWS Type | dev | sbx | stg | prod |
|----------|----------|:---:|:---:|:---:|:----:|
| Subnet Group | `aws_elasticache_subnet_group` | ✅ | ✅ | ✅ | ✅ |
| Parameter Group | `aws_elasticache_parameter_group` | ✅ | ✅ | ✅ | ✅ |
| Replication Group | `aws_elasticache_replication_group` | ✅ Valkey 8.0 `cache.t4g.micro` ×0 replicas | ✅ Valkey 8.0 `cache.t4g.micro` ×0 replicas | ✅ Valkey 8.0 `cache.t4g.small` ×0 replicas | ✅ Valkey 8.0 `cache.t4g.medium` ×1 replica, multi-AZ |
| RBAC User (per service, IAM authentication) and a disabled default user | `aws_elasticache_user` | ✅ | ✅ | ✅ | ✅ |
| RBAC User Group | `aws_elasticache_user_group` | ✅ | ✅ | ✅ | ✅ |
| ElastiCache Security Group | `aws_security_group` | ✅ | ✅ | ✅ | ✅ |
| ElastiCache SG Ingress: from each service runtime (not the collector) | `aws_vpc_security_group_ingress_rule` | ✅ | ✅ | ✅ | ✅ |

### Events (SNS / SQS)

From `backend/common/events/catalogue.json`, for the 9 services only (`modules/events`).

| Resource | AWS Type | dev | sbx | stg | prod |
|----------|----------|:---:|:---:|:---:|:----:|
| Events KMS Key + Alias | `aws_kms_key` / `aws_kms_alias` | ✅ | ✅ | ✅ | ✅ |
| Topic (per producing service) | `aws_sns_topic` | ✅ | ✅ | ✅ | ✅ |
| Queue + DLQ (per consuming service) | `aws_sqs_queue` | ✅ | ✅ | ✅ | ✅ |
| Queue Policy + Redrive Allow Policy (per consuming service) | `aws_sqs_queue_policy` / `aws_sqs_queue_redrive_allow_policy` | ✅ | ✅ | ✅ | ✅ |
| Subscription (per consumer and producer topic, filtered on `event_type`) | `aws_sns_topic_subscription` | ✅ | ✅ | ✅ | ✅ |
| Alarms: DLQ depth, oldest message age (per queue) | `aws_cloudwatch_metric_alarm` | ❌ | ❌ | ❌ | ✅ |

### Storage & Registry

> The S3 uploads bucket and the regional logging bucket are pre-created manually and not managed by Terraform. These resources configure them.

| Resource | AWS Type | dev | sbx | stg | prod |
|----------|----------|:---:|:---:|:---:|:----:|
| ECR Repository + Lifecycle Policy (per service) | `aws_ecr_repository` / `aws_ecr_lifecycle_policy` | ✅ | ✅ | ✅ | ✅ |
| S3 Uploads Bucket CORS Config | `aws_s3_bucket_cors_configuration` | ✅ | ✅ | ✅ | ✅ |
| S3 Uploads Bucket Lifecycle Config | `aws_s3_bucket_lifecycle_configuration` | ✅ | ✅ | ✅ | ✅ |
| S3 Regional Logging Bucket Policy ² | `aws_s3_bucket_policy` | ❌ | ❌ | ✅ | ✅ |

> ² Created when **either** `enable_cloudtrail` or `enable_alb_access_logs` is true (the two flags are independent — see `variables.tf` — but share this one bucket/policy resource). Both are `false` on dev/sbx and `true` on stg/prod today.

### IAM

| Resource | AWS Type | dev | sbx | stg | prod |
|----------|----------|:---:|:---:|:---:|:----:|
| Execution Role + Managed Policy Attachment (per runtime) | `aws_iam_role` / `aws_iam_role_policy_attachment` | ✅ | ✅ | ✅ | ✅ |
| Execution Secrets Policy: its service's secret and signing key (every runtime but the collector) | `aws_iam_role_policy` | ✅ | ✅ | ✅ | ✅ |
| Task Role (per runtime) | `aws_iam_role` | ✅ | ✅ | ✅ | ✅ |
| Task Policies: `valkey`, `metrics`, `events` (workers), `s3-uploads` (children, transform), `s3-apk` (platform), `xray` (collector) | `aws_iam_role_policy` | ✅ | ✅ | ✅ | ✅ |
| ECS Exec Policy (per runtime) | `aws_iam_role_policy` | ✅ | ✅ | ✅ | ❌ |

### Secrets & Config

| Resource | AWS Type | dev | sbx | stg | prod |
|----------|----------|:---:|:---:|:---:|:----:|
| Service Secret + Placeholder Version (per service) | `aws_secretsmanager_secret` / `aws_secretsmanager_secret_version` | ✅ | ✅ | ✅ | ✅ |
| Service-token Key Pair (per service; generated by Terraform, held in state) | `tls_private_key` | ✅ | ✅ | ✅ | ✅ |
| SSM: Signing Key, SecureString (per service, in the region) | `aws_ssm_parameter` | ✅ | ✅ | ✅ | ✅ |
| SSM: Internal Public Keys | `aws_ssm_parameter` | ✅ | ✅ | ✅ | ✅ |
| SSM: ALB Internal FQDN | `aws_ssm_parameter` | ✅ | ✅ | ✅ | ✅ |
| SSM: ECS Cluster Name | `aws_ssm_parameter` | ✅ | ✅ | ✅ | ✅ |
| SSM: ECS Services manifest | `aws_ssm_parameter` | ✅ | ✅ | ✅ | ✅ |

### DNS

| Resource | AWS Type | dev | sbx | stg | prod |
|----------|----------|:---:|:---:|:---:|:----:|
| Internal Route53 Record (ALB) | `aws_route53_record` | ✅ | ✅ | ✅ | ✅ |

### Observability

| Resource | AWS Type | dev | sbx | stg | prod |
|----------|----------|:---:|:---:|:---:|:----:|
| CloudWatch Log Group (per runtime) | `aws_cloudwatch_log_group` | ✅ 7d | ✅ 7d | ✅ 30d | ✅ 90d |
| SNS Alerts Topic | `aws_sns_topic` | ✅ | ✅ | ✅ | ✅ |
| SNS Email Subscription | `aws_sns_topic_subscription` | ❌ | ❌ | ❌ | ✅ |
| CloudWatch Dashboard | `aws_cloudwatch_dashboard` | ❌ | ❌ | ❌ | ✅ |
| Alarm: ALB Healthy Hosts (per HTTP service) | `aws_cloudwatch_metric_alarm` | ❌ | ❌ | ✅ | ✅ |
| Alarm: ALB 5XX Errors | `aws_cloudwatch_metric_alarm` | ❌ | ❌ | ✅ | ✅ |
| Alarms: CPU / memory sustained and high (per runtime) | `aws_cloudwatch_metric_alarm` | ❌ | ❌ | ❌ | ✅ |
| Alarms: pending jobs high, processing stuck, pending jobs missing (per generating service) | `aws_cloudwatch_metric_alarm` | ❌ | ❌ | ❌ | ✅ |
| Alarm: outbox stale (per worker) | `aws_cloudwatch_metric_alarm` | ❌ | ❌ | ❌ | ✅ |
| Scaling alarms: queue depth and queue low (per worker), pending jobs (per generating worker) | `aws_cloudwatch_metric_alarm` | ✅ | ✅ | ✅ | ✅ |
| Alarm: Redis Connections | `aws_cloudwatch_metric_alarm` | ❌ | ❌ | ❌ | ✅ |

Traces go through the collector runtime to X-Ray. It keeps errors, slow traces and `xray_default_sampling_rate` of the rest (5% dev/sbx/stg, 1% prod). There are no X-Ray sampling rules.

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
| Response Headers Policy (Frontend) | `aws_cloudfront_response_headers_policy` | ✅ | ✅ | ✅ | ✅ |
| Response Headers Policy (API) | `aws_cloudfront_response_headers_policy` | ✅ | ✅ | ✅ | ✅ |
| Response Headers Policy (Assets) | `aws_cloudfront_response_headers_policy` | ✅ | ✅ | ✅ | ✅ |
| SPA Rewrite Function (default behaviour, viewer-request) | `aws_cloudfront_function` | ✅ | ✅ | ✅ | ✅ |
| Route53 Public DNS Record | `aws_route53_record` | ✅ | ✅ | ✅ | ✅ |
| Assets S3 Bucket Policy (CloudFront OAC) | `aws_s3_bucket_policy` | ✅ | ✅ | ✅ | ✅ |

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

Counts below are one application each of edge, frontend, and scheduler. The backend's count isn't kept here: it follows from the *per runtime* (18) and *per service* (9) rows above, and `terraform plan` in a region gives the exact number.

| Category | dev | sbx | stg | prod |
|----------|:---:|:---:|:---:|:----:|
| **Backend (per region)** | see above | see above | see above | see above |
| CloudFront + OAC (×2) + response headers + SPA function + DNS + assets S3 policy | 9 | 9 | 9 | 9 |
| Lambda@Edge (incl. destroy-only `time_sleep`) | 4 | 4 | 4 | 4 |
| WAF | 0 | 0 | 1 | 5 |
| SSM Parameters (edge) | 4 | 4 | 4 | 4 |
| Security — edge (GuardDuty, CloudTrail) | 0 | 0 | 1 | 2 |
| **Edge subtotal** | **17** | **17** | **19** | **24** |
| Frontend S3 policy | 1 | 1 | 1 | 1 |
| Scheduler (Lambda, IAM, EventBridge, Secrets Manager) | 10 | 10 | 10 | 10 |

### Scaling to more backend regions

The backend is per region and multiplies directly: applying `infra-live-backend` for `eu-west-1` and `us-east-1` in addition to `ap-south-1` adds two more full backend stacks. Edge, Frontend, and Scheduler stay fixed regardless of how many backend regions are active (the edge no longer manages any uploads-bucket policy, EDGE-05).
