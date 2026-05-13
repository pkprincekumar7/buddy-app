# buddy360 — AI Code-Generation Prompt (V1 — Startup Launch)

You are an expert AWS infrastructure engineer. Generate all Terraform modules and GitHub Actions workflows described below. Every file listed in the "Files to generate" section must be created with complete, working, production-grade HCL or YAML — no placeholders, no `# TODO` comments, no partial stubs. Where a value is environment-specific it must be driven by a Terraform variable or GitHub input. Where a value is a hardcoded AWS constant (ELB account IDs, managed prefix list IDs) use the exact values listed in this document.

Read every section of this document before generating any file. The sections are interdependent.

---

## 1. Context and Constraints

### Application
- Name: **buddy360** (Terraform variable `app_name`, default `"buddy360"`)
- Framework: FastAPI (Python), port 8000 inside container
- Database: **MongoDB Atlas** only — no SQL, no Alembic, no RDS
- Frontend: React (Vite), static SPA built to `dist/`
- Auth: RS256 JWTs; token location is the `Authorization: Bearer <token>` request header; **JWT validation is performed in FastAPI (application layer) — no CloudFront Function or KVS in V1**

### AWS Account
- **Single AWS account**, single backend region in V1
- Primary (and only) backend region: **ap-south-1** (Mumbai)
- Global / edge region: **us-east-1** (CloudFront, WAF, S3 frontend, ACM for CF)

### Terraform
- Version constraint for all modules: `required_version = "~> 1.13.0"`
- AWS provider version: `~> 5.0`
- MongoDB Atlas provider: `mongodb/mongodbatlas`, version `~> 1.16`
- State backend: S3 with `use_lockfile = true` (native S3 locking — no DynamoDB table required; introduced in Terraform 1.10)
- No Terraform Cloud or remote backend other than S3

### Environments
- `dev`, `stg`, `prod` — all modules accept an `environment` variable validated against this list

---

## 2. Repository Layout

Generate files under these directories:

```
infra-live-backend/terraform/
infra-live-edge/terraform/
infra-live-frontend/terraform/
infra-live-atlas/terraform/          ← MongoDB Atlas cluster module
.github/workflows/
```

---

## 3. Naming Conventions

All resource names follow `{app_name}-{environment}-{resource}`.

| Resource | Pattern | Example |
|---|---|---|
| VPC | `{app}-{env}-vpc` | `buddy360-prod-vpc` |
| Subnet (public) | `{app}-{env}-public-{az_index}` | `buddy360-prod-public-0` |
| Subnet (private) | `{app}-{env}-private-{az_index}` | `buddy360-prod-private-0` |
| ECS cluster | `{app}-{env}` | `buddy360-prod` |
| ECS service | `{app}-{env}-backend` | `buddy360-prod-backend` |
| ECS task def | `{app}-{env}-backend` | `buddy360-prod-backend` |
| ECR repo | `{app}-{env}-backend` | `buddy360-prod-backend` |
| ALB | `{app}-{env}-alb` | `buddy360-prod-alb` |
| Target group | `{app}-{env}-tg` | `buddy360-prod-tg` |
| ElastiCache cluster/group | `{app}-{env}-redis` | `buddy360-prod-redis` |
| Secrets Manager secret | `{app_name}/{env}/backend-secrets` | `buddy360/prod/backend-secrets` |
| SSM parameter (ALB FQDN) | `/{app}/{env}/alb-fqdn` | `/buddy360/prod/alb-fqdn` |
| SSM parameter (CF ARN) | `/{app}/{env}/edge/cloudfront_arn` | `/buddy360/prod/edge/cloudfront_arn` |
| SSM parameter (S3 bucket) | `/{app}/{env}/edge/s3_bucket_name` | `/buddy360/prod/edge/s3_bucket_name` |
| SNS topic | `{app}-{env}-alerts` | `buddy360-prod-alerts` |
| CloudWatch log group | `/ecs/{app}/{env}` | `/ecs/buddy360/prod` |
| CloudTrail | `{app}-{env}-trail` | `buddy360-prod-trail` |
| KMS key alias | `alias/{app}-{env}-state` | `alias/buddy360-prod-state` |
| S3 state bucket | `{STATE_BUCKET}` (from GitHub secret) | — |
| S3 global logging bucket | `{app}-{env}-logs-global` | `buddy360-prod-logs-global` |
| S3 regional logging bucket | `{app}-{env}-logs-{aws_region}` | `buddy360-prod-logs-ap-south-1` |
| S3 frontend bucket | passed as `var.frontend_bucket_name` | — |
| WAF WebACL | `{app}-{env}-waf` | `buddy360-prod-waf` |
| CloudFront distribution | identified by domain output | — |
| X-Ray sampling rule | `{app}-{env}-default` | `buddy360-prod-default` |
| CloudWatch dashboard | `{app}-{env}` | `buddy360-prod` |
| IAM role (ECS exec) | `{app}-{env}-ecs-exec-role` | `buddy360-prod-ecs-exec-role` |
| IAM role (ECS task) | `{app}-{env}-ecs-task-role` | `buddy360-prod-ecs-task-role` |
| IAM role (GitHub OIDC) | `{app}-{env}-github-actions` | `buddy360-prod-github-actions` |

---

## 4. VPC and Networking — `infra-live-backend`

### CIDR Design

One VPC for ap-south-1. CIDR: `10.0.0.0/16`. Use `cidrsubnet("10.0.0.0/16", 8, index)` for subnets.

**Subnets per environment:**

| Environment | AZs | Public subnets | Private subnets | NAT Gateways |
|---|---|---|---|---|
| dev | 2 AZs (`data "aws_availability_zones"`, indexes 0–1) | 2 (`/24`) | 2 (`/24`) | 1 (in public subnet 0) |
| stg | 2 AZs | 2 (`/24`) | 2 (`/24`) | 1 |
| prod | 2 AZs | 2 (`/24`) | 2 (`/24`) | 2 (one per AZ — HA) |

NAT Gateway count: `local.nat_gw_count = var.environment == "prod" ? 2 : 1`.

Private route tables: one per NAT Gateway. In prod, private subnet 0 routes through NAT GW 0, private subnet 1 through NAT GW 1.

### Endpoints

- **S3 Gateway Endpoint** (`aws_vpc_endpoint`, type `Gateway`): route all private subnet traffic for `com.amazonaws.{region}.s3` without NAT.
- **VPC Interface Endpoints** (`aws_vpc_endpoint`, type `Interface`) for:
  - `com.amazonaws.{region}.ecr.api`
  - `com.amazonaws.{region}.ecr.dkr`
  - `com.amazonaws.{region}.secretsmanager`
  - `com.amazonaws.{region}.logs`

  Each Interface Endpoint gets a dedicated security group (`{app}-{env}-vpce-sg`) with inbound 443 from the ECS task SG only and no outbound rules.

### VPC Flow Logs

`aws_flow_log` at VPC level, delivering to the regional logging S3 bucket with `traffic_type = "ALL"`.

---

## 5. Security Groups — `infra-live-backend`

Define four security groups in `security_groups.tf`:

**ALB SG** (`{app}-{env}-alb-sg`):
- Inbound 443/tcp from `aws_ec2_managed_prefix_list` data source for `com.amazonaws.global.cloudfront.origin-facing`
- Inbound 80/tcp from the same CloudFront managed prefix list (HTTP→HTTPS redirect listener)
- Outbound 8000/tcp to ECS task SG

**ECS task SG** (`{app}-{env}-ecs-sg`):
- Inbound 8000/tcp from ALB SG only
- Outbound 443/tcp to `0.0.0.0/0` (Atlas, LLM APIs, ECR via Interface Endpoints, Secrets Manager via Interface Endpoint)
- Outbound 6379/tcp to ElastiCache SG

**ElastiCache SG** (`{app}-{env}-redis-sg`):
- Inbound 6379/tcp from ECS task SG only
- No outbound rules

**VPC Endpoint SG** (`{app}-{env}-vpce-sg`):
- Inbound 443/tcp from ECS task SG CIDR block
- No outbound rules

---

## 6. Application Load Balancer — `infra-live-backend`

File: `alb.tf`

```hcl
# Key attributes — generate the full resource blocks
resource "aws_lb" {
  name               = "${var.app_name}-${var.environment}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id

  enable_deletion_protection = var.environment != "dev"

  access_logs {
    bucket  = aws_s3_bucket.regional_logs.bucket
    prefix  = "alb"
    enabled = true
  }
}

resource "aws_lb_target_group" {
  name        = "${var.app_name}-${var.environment}-tg"
  port        = 8000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"   # REQUIRED for Fargate — awsvpc network mode

  health_check {
    path                = "/api/health"
    interval            = 30
    healthy_threshold   = 2
    unhealthy_threshold = 3
    matcher             = "200"
  }

  deregistration_delay = 60
}

# HTTPS listener — terminates TLS with regional ACM cert
resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.acm_certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.main.arn
  }
}

# HTTP listener — redirect only, no content served
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}
```

---

## 7. ECS Fargate Service — `infra-live-backend`

### Task Definition

File: `ecs.tf`

Container definition JSON (generate as `jsonencode(...)` inside the Terraform resource):

```json
[
  {
    "name": "{app_name}-backend",
    "image": "{ecr_repo_url}:{image_tag}",
    "cpu": 0,
    "portMappings": [{ "containerPort": 8000, "protocol": "tcp" }],
    "essential": true,
    "environment": [
      { "name": "ENVIRONMENT", "value": "{environment}" },
      { "name": "CORS_ORIGINS", "value": "{var.cors_origins}" },
      { "name": "COOKIE_DOMAIN", "value": "{var.cookie_domain}" },
      { "name": "OPENAI_MODEL", "value": "{var.openai_model}" },
      { "name": "ANTHROPIC_MODEL", "value": "{var.anthropic_model}" },
      { "name": "GEMINI_MODEL", "value": "{var.gemini_model}" },
      { "name": "AWS_XRAY_DAEMON_ADDRESS", "value": "127.0.0.1:2000" }
    ],
    "secrets": [
      { "name": "JWT_PRIVATE_KEY", "valueFrom": "{secret_arn}:JWT_PRIVATE_KEY::" },
      { "name": "GOOGLE_CLIENT_ID", "valueFrom": "{secret_arn}:GOOGLE_CLIENT_ID::" },
      { "name": "OPENAI_API_KEY", "valueFrom": "{secret_arn}:OPENAI_API_KEY::" },
      { "name": "ANTHROPIC_API_KEY", "valueFrom": "{secret_arn}:ANTHROPIC_API_KEY::" },
      { "name": "GEMINI_API_KEY", "valueFrom": "{secret_arn}:GEMINI_API_KEY::" },
      { "name": "MONGODB_URI", "valueFrom": "{secret_arn}:MONGODB_URI::" },
      { "name": "REDIS_AUTH_TOKEN", "valueFrom": "{secret_arn}:REDIS_AUTH_TOKEN::" }
    ],
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": {
        "awslogs-group": "/ecs/{app_name}/{environment}",
        "awslogs-region": "{aws_region}",
        "awslogs-stream-prefix": "backend"
      }
    }
  },
  {
    "name": "xray-daemon",
    "image": "amazon/aws-xray-daemon:latest",
    "cpu": 32,
    "memoryReservation": 256,
    "essential": false,
    "portMappings": [{ "containerPort": 2000, "protocol": "udp" }],
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": {
        "awslogs-group": "/ecs/{app_name}/{environment}",
        "awslogs-region": "{aws_region}",
        "awslogs-stream-prefix": "xray"
      }
    }
  }
]
```

Task definition settings:
- `network_mode = "awsvpc"` (required for Fargate + `target_type = "ip"`)
- `requires_compatibilities = ["FARGATE"]`
- `cpu` / `memory` per-environment (see sizing table below)
- `task_role_arn` = ECS task role ARN
- `execution_role_arn` = ECS execution role ARN
- `enable_fault_injection = false`
- `runtime_platform { operating_system_family = "LINUX", cpu_architecture = "X86_64" }`

### ECS Service Sizing

| Environment | CPU (task) | Memory (task) | Min | Desired | Max |
|---|---|---|---|---|---|
| dev | 512 | 1024 | 1 | 1 | 2 |
| stg | 1024 | 2048 | 1 | 1 | 3 |
| prod | 2048 | 4096 | 2 | 2 | 6 |

Drive with locals:
```hcl
locals {
  ecs_cpu    = { dev = 512, stg = 1024, prod = 2048 }[var.environment]
  ecs_memory = { dev = 1024, stg = 2048, prod = 4096 }[var.environment]
  ecs_min    = { dev = 1, stg = 1, prod = 2 }[var.environment]
  ecs_max    = { dev = 2, stg = 3, prod = 6 }[var.environment]
}
```

### ECS Service Resource

```hcl
resource "aws_ecs_service" "backend" {
  name            = "${var.app_name}-${var.environment}-backend"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.backend.arn
  desired_count   = local.ecs_min
  launch_type     = "FARGATE"

  health_check_grace_period_seconds = 60

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.main.arn
    container_name   = "${var.app_name}-backend"
    container_port   = 8000
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  ordered_placement_strategy {
    type  = "spread"
    field = "attribute:ecs.availability-zone"
  }

  lifecycle {
    ignore_changes = [desired_count]
  }
}
```

ECS cluster:
```hcl
resource "aws_ecs_cluster" "main" {
  name = "${var.app_name}-${var.environment}"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}
```

### ECS Auto Scaling

Three target-tracking policies on `aws_appautoscaling_target` / `aws_appautoscaling_policy`:

| Policy | Metric | Namespace | Target | Scale-out cooldown | Scale-in cooldown |
|---|---|---|---|---|---|
| cpu | `ECSServiceAverageCPUUtilization` | `AWS/ECS` | 60 | 60 s | 300 s |
| memory | `ECSServiceAverageMemoryUtilization` | `AWS/ECS` | 70 | 60 s | 300 s |
| alb_rps | `ALBRequestCountPerTarget` | `AWS/ApplicationELB` | 1000 | 60 s | 300 s |

---

## 8. ECR — `infra-live-backend`

File: `ecr.tf`

- `scan_on_push = true`
- Image tag mutability: `MUTABLE`
- Lifecycle policy: expire untagged images after 1 day; retain the 20 most recent tagged images
- **No cross-region replication in V1** — single region only
- EventBridge rule: `ECR Image Scan` findings with HIGH or CRITICAL severity → SNS topic

---

## 9. ElastiCache Redis — `infra-live-backend`

File: `elasticache.tf`

Redis version: **7.1**. Parameter group family: **`default.redis7`**.

| Environment | Resource type | Node type | Nodes | Auth token | Multi-AZ |
|---|---|---|---|---|---|
| dev | `aws_elasticache_cluster` | `cache.t3.micro` | 1 | Required (from Secrets Manager) | No |
| stg | `aws_elasticache_cluster` | `cache.t3.micro` | 1 | Required | No |
| prod | `aws_elasticache_replication_group` | `cache.r6g.large` | 1 primary + 1 replica | Required | `automatic_failover_enabled = true`, `multi_az_enabled = true` |

Use a conditional resource pattern (count) to generate the correct resource type per environment. The `auth_token` field on both resource types must reference the Secrets Manager secret value.

Both resource types require:
- `at_rest_encryption_enabled = true`
- `transit_encryption_enabled = true`
- `subnet_group_name` pointing to a `aws_elasticache_subnet_group` in the private subnets
- `security_group_ids = [aws_security_group.redis.id]`

---

## 10. Secrets Manager — `infra-live-backend`

File: `secrets.tf`

One secret per environment: `{app_name}/{env}/backend-secrets`

| Key | Description |
|---|---|
| `JWT_PRIVATE_KEY` | RSA-2048 private key in PEM format (RS256 signing; validated in FastAPI) |
| `GOOGLE_CLIENT_ID` | OAuth client ID |
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic API key (optional; set to `REPLACE_ME` if unused) |
| `GEMINI_API_KEY` | Gemini API key (optional; set to `REPLACE_ME` if unused) |
| `MONGODB_URI` | Atlas connection string |
| `REDIS_AUTH_TOKEN` | ElastiCache AUTH token (64-char random hex; all environments) |

Terraform creates the secret with `REPLACE_ME` placeholders. The `terraform-live-backend` workflow populates real values on the first apply only (checks for `JWT_PRIVATE_KEY == "REPLACE_ME"` before writing — never `JWT_SECRET`).

---

## 11. IAM Roles — `infra-live-backend`

File: `iam.tf`

### ECS Execution Role

Trust policy: `ecs-tasks.amazonaws.com`.

Inline policy — exact actions only:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["ecr:GetAuthorizationToken"],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"],
      "Resource": "{ecr_repo_arn}"
    },
    {
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue"],
      "Resource": "{secret_arn}"
    },
    {
      "Effect": "Allow",
      "Action": ["logs:CreateLogStream", "logs:PutLogEvents"],
      "Resource": "{log_group_arn}:*"
    }
  ]
}
```

### ECS Task Role

Trust policy: `ecs-tasks.amazonaws.com`.

Inline policy:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["xray:PutTraceSegments", "xray:PutTelemetryRecords"],
      "Resource": "*"
    }
  ]
}
```

### GitHub Actions OIDC Role

File: `iam_github.tf`

OIDC provider (create if it does not yet exist):
```hcl
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1",
                     "1c58a3a8518e8759bf075b76b750d4f2df264fcd"]
}
```

Trust policy condition:
```json
{
  "StringLike": {
    "token.actions.githubusercontent.com:sub": "repo:prince-els/buddy-app:*"
  }
}
```

Attach `AdministratorAccess` managed policy for initial deployment. Replace with a custom least-privilege policy scoped to exact resource ARN patterns once the full resource set is known.

---

## 12. CloudWatch Alarms — `infra-live-backend`

File: `alarms.tf`

All alarms use `treat_missing_data = "notBreaching"` and send to `aws_sns_topic.alerts.arn`.

| Alarm name | Namespace | MetricName | Statistic | Period | Eval Periods | Threshold | Comparison |
|---|---|---|---|---|---|---|---|
| `{app}-{env}-healthy-hosts` | `AWS/ApplicationELB` | `HealthyHostCount` | Minimum | 60 | 2 | 1 | LessThanThreshold |
| `{app}-{env}-alb-5xx` | `AWS/ApplicationELB` | `HTTPCode_Target_5XX_Count` | Sum | 60 | 5 | `var.alb_5xx_threshold` (default 10) | GreaterThanThreshold |
| `{app}-{env}-alb-4xx` | `AWS/ApplicationELB` | `HTTPCode_Target_4XX_Count` | Sum | 60 | 5 | `var.alb_4xx_threshold` (default 100) | GreaterThanThreshold |
| `{app}-{env}-ecs-cpu` | `AWS/ECS` | `CPUUtilization` | Average | 60 | 3 | 85 | GreaterThanThreshold |
| `{app}-{env}-redis-conn` | `AWS/ElastiCache` | `CurrConnections` | Average | 60 | 3 | 5 | LessThanThreshold |

Also define `aws_cloudwatch_dashboard` in `alarms.tf` with these widgets:

| Widget | Metric |
|---|---|
| ECS CPU utilisation | `CPUUtilization` per ECS service |
| ECS memory utilisation | `MemoryUtilization` per ECS service |
| ALB 5XX rate | `HTTPCode_Target_5XX_Count` |
| ALB 4XX rate | `HTTPCode_Target_4XX_Count` |
| ALB request count | `RequestCount` |
| Healthy host count | `HealthyHostCount` |
| ElastiCache connections | `CurrConnections` |
| ElastiCache CPU | `EngineCPUUtilization` |

---

## 13. X-Ray Sampling Rule — `infra-live-backend`

File: `xray.tf`

```hcl
resource "aws_xray_sampling_rule" "default" {
  rule_name      = "${var.app_name}-${var.environment}-default"
  priority       = 1000
  reservoir_size = 5
  fixed_rate     = local.xray_fixed_rate
  url_path       = "*"
  host           = "*"
  http_method    = "*"
  service_type   = "*"
  service_name   = "${var.app_name}-${var.environment}-backend"
  resource_arn   = "*"
  version        = 1
}
```

Use `local.xray_fixed_rate = var.environment == "prod" ? 0.05 : 1.0`.

---

## 14. CloudTrail — `infra-live-backend`

File: `cloudtrail.tf`

```hcl
resource "aws_cloudtrail" "main" {
  name                          = "${var.app_name}-${var.environment}-trail"
  s3_bucket_name                = aws_s3_bucket.regional_logs.bucket
  s3_key_prefix                 = "cloudtrail"
  include_global_service_events = false
  is_multi_region_trail         = false
  enable_log_file_validation    = true

  cloud_watch_logs_group_arn = "${aws_cloudwatch_log_group.cloudtrail.arn}:*"
  cloud_watch_logs_role_arn  = aws_iam_role.cloudtrail_cw.arn

  kms_key_id = aws_kms_key.cloudtrail.arn
}

resource "aws_kms_key" "cloudtrail" {
  description             = "${var.app_name}-${var.environment} CloudTrail"
  deletion_window_in_days = 30
  enable_key_rotation     = true
}
```

CloudWatch log group for CloudTrail: `/aws/cloudtrail/{app_name}/{environment}`, retention 365 days (prod), 90 days (dev/stg).

---

## 15. Logging S3 Buckets — `infra-live-backend`

File: `s3_logs.tf`

Regional logging bucket name: `{app_name}-{environment}-logs-{aws_region}`.

Bucket policy granting ELB service account PutObject (ap-south-1 ELB account ID: `718504428378`). Policy must allow `s3:PutObject` for `arn:aws:iam::718504428378:root` on `arn:aws:s3:::{bucket}/alb/*`.

Both logging buckets (global in edge module and regional here) must have:
- All four public-access block flags set to `true`
- SSE-S3 encryption
- No versioning
- Lifecycle rule: transition to `GLACIER_IR` after 30 days; expire after 90 days (365 for prod via `var.log_retention_days`)

---

## 16. Terraform State Backend — all modules

File: `provider.tf` (pattern for all modules)

```hcl
terraform {
  required_version = "~> 1.13.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    # Values supplied via -backend-config in CI
    use_lockfile = true
    encrypt      = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = var.app_name
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# Required by ssm_output.tf — writes /{app}/{env}/alb-fqdn to us-east-1 SSM so that
# infra-live-edge (default provider = us-east-1) can read it. Without this alias the
# parameter lands in ap-south-1 SSM and CloudFront has no ALB origin to resolve.
provider "aws" {
  alias  = "ssm"
  region = "us-east-1"

  default_tags {
    tags = {
      Project     = var.app_name
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
```

The `provider.tf` for `infra-live-backend` must contain **both** provider blocks above. The default block handles all backend resources (VPC, ECS, ALB, etc.) in ap-south-1. The `ssm` alias block is used only by `ssm_output.tf`.

---

## 17. Module Variables — `infra-live-backend`

File: `variables.tf`

```hcl
variable "app_name"            { type = string; default = "buddy360" }
variable "environment"         { type = string; validation { condition = contains(["dev","stg","prod"], var.environment); error_message = "must be dev, stg, or prod." } }
variable "aws_region"          { type = string; default = "ap-south-1" }
variable "acm_certificate_arn" { type = string; description = "Pre-existing ACM certificate ARN in ap-south-1" }
variable "subdomain_internal"  { type = string; description = "Backend subdomain (e.g. api.dev.buddy360.com)" }
variable "domain_name"         { type = string }
variable "hosted_zone_id"      { type = string }
variable "cors_origins"        { type = string }
variable "cookie_domain"       { type = string }
variable "openai_model"        { type = string; default = "gpt-5.4-mini" }
variable "anthropic_model"     { type = string; default = "" }
variable "gemini_model"        { type = string; default = "" }
variable "image_tag"           { type = string; default = "latest" }
variable "alb_5xx_threshold"   { type = number; default = 10 }
variable "alb_4xx_threshold"   { type = number; default = 100 }
variable "log_retention_days"  { type = number; default = 90 }
```

File: `outputs.tf`

```hcl
output "alb_dns_name"     { value = aws_lb.main.dns_name }
output "ecr_repo_url"     { value = aws_ecr_repository.backend.repository_url }
output "ecs_cluster_name" { value = aws_ecs_cluster.main.name }
output "ecs_service_name" { value = aws_ecs_service.backend.name }
output "app_secret_arn"   { value = aws_secretsmanager_secret.app.arn }
output "nat_eips"         { value = aws_eip.nat[*].public_ip }
```

File: `ssm_output.tf`

**Critical:** The `aws_ssm_parameter` resource that writes `/{app}/{env}/alb-fqdn` **must** use `provider = aws.ssm` (the us-east-1 alias). The `infra-live-edge` module reads this parameter using its default provider (us-east-1). If the backend writes to ap-south-1 SSM (the default provider region), the edge module will read nothing and CloudFront will have no ALB origin.

```hcl
resource "aws_ssm_parameter" "alb_fqdn" {
  provider = aws.ssm   # us-east-1 — must match the region edge reads from
  name     = "/${var.app_name}/${var.environment}/alb-fqdn"
  type     = "String"
  value    = aws_lb.main.dns_name
}
```

---

## 18. tfvars Files — `infra-live-backend`

File: `tfvars/dev.tfvars`
```hcl
environment        = "dev"
openai_model       = "gpt-5.4-mini"
log_retention_days = 30
```

File: `tfvars/stg.tfvars`
```hcl
environment        = "stg"
openai_model       = "gpt-5.4-mini"
log_retention_days = 30
```

File: `tfvars/prod.tfvars`
```hcl
environment        = "prod"
openai_model       = "gpt-5.4-mini"
log_retention_days = 365
```

Injected as `TF_VAR_*` from GitHub environment secrets at CI time: `aws_region`, `acm_certificate_arn`, `subdomain_internal`, `domain_name`, `hosted_zone_id`, `cors_origins`, `cookie_domain`.

---

## 19. Global Edge — `infra-live-edge`

### Provider

File: `provider.tf`

One provider (us-east-1, hardcoded for all edge resources). The `ssm` alias below is also us-east-1 — it exists for consistency with `infra-live-frontend` (which uses `provider = aws.ssm` on its SSM reads). All SSM reads and writes in this module can use the default provider; the alias is optional but include it for symmetry.

```hcl
terraform {
  required_version = "~> 1.13.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
  backend "s3" { use_lockfile = true; encrypt = true }
}

provider "aws" {
  region = "us-east-1"
  default_tags { tags = { Project = var.app_name, Environment = var.environment, ManagedBy = "terraform" } }
}

provider "aws" {
  alias  = "ssm"
  region = "us-east-1"
  default_tags { tags = { Project = var.app_name, Environment = var.environment, ManagedBy = "terraform" } }
}
```

### Variables — `infra-live-edge`

File: `variables.tf`

```hcl
variable "app_name"             { type = string; default = "buddy360" }
variable "environment"          { type = string }
variable "acm_certificate_arn"  { type = string; description = "Pre-existing ACM cert in us-east-1 for CloudFront" }
variable "domain_name"          { type = string }
variable "hosted_zone_id"       { type = string }
variable "frontend_bucket_name" { type = string; description = "Name for the S3 frontend assets bucket (created by this module; referenced by infra-live-frontend)" }
variable "waf_count_mode"       { type = bool; default = false; description = "Set to true for stg — deploys managed rules in COUNT mode" }
variable "alerts_email"         { type = string; description = "Operator email address for SNS alert subscriptions" }
```

### tfvars Files — `infra-live-edge`

```hcl
# tfvars/dev.tfvars
environment    = "dev"
waf_count_mode = true    # COUNT mode in dev — no blocking; validate rules here

# tfvars/stg.tfvars
environment    = "stg"
waf_count_mode = true    # COUNT mode in stg — validate no false positives before switching prod to BLOCK

# tfvars/prod.tfvars
environment    = "prod"
waf_count_mode = false   # BLOCK mode in prod — only set after validating COUNT mode in stg
```

`alerts_email`, `acm_certificate_arn`, `domain_name`, `hosted_zone_id`, and `frontend_bucket_name` are injected as `TF_VAR_*` from GitHub environment secrets at CI time.

### Outputs — `infra-live-edge`

File: `outputs.tf`

```hcl
output "cloudfront_domain" { value = aws_cloudfront_distribution.main.domain_name }
output "cloudfront_arn"    { value = aws_cloudfront_distribution.main.arn }
output "s3_bucket_name"    { value = var.frontend_bucket_name }
```

Write `cloudfront_arn` and `s3_bucket_name` to SSM after apply:
```hcl
resource "aws_ssm_parameter" "cloudfront_arn" {
  name  = "/${var.app_name}/${var.environment}/edge/cloudfront_arn"
  type  = "String"
  value = aws_cloudfront_distribution.main.arn
}

resource "aws_ssm_parameter" "s3_bucket_name" {
  name  = "/${var.app_name}/${var.environment}/edge/s3_bucket_name"
  type  = "String"
  value = var.frontend_bucket_name
}
```

### WAF WebACL

File: `waf.tf`

`scope = "CLOUDFRONT"` — must be created in us-east-1.

WAF rule priorities (lower number = evaluated first):

| Priority | Rule name | Type | Action |
|---|---|---|---|
| 1 | `auth-endpoint-rate-limit` | Rate-based, 100 req/5min/IP, scope_down URI match `/api/auth/login` OR `/api/auth/register` | BLOCK |
| 2 | `global-rate-limit` | Rate-based, 2000 req/5min/IP | BLOCK |
| 10 | `AWSManagedRulesKnownBadInputsRuleSet` | AWS managed | COUNT (stg) / BLOCK (prod) |
| 20 | `AWSManagedRulesCoreRuleSet` | AWS managed | COUNT (stg) / BLOCK (prod) |

Use `var.waf_count_mode` to set override actions: `count {}` when true, `none {}` when false.

WAF full logs → Kinesis Data Firehose → S3 global logging bucket. **The Firehose delivery stream name must start with `aws-waf-logs-`** — AWS enforces this; any other name causes WAF logging to silently fail. Delivery stream name: `aws-waf-logs-{app_name}-{environment}`.

HSTS response headers policy:
```hcl
resource "aws_cloudfront_response_headers_policy" "hsts" {
  name = "${var.app_name}-${var.environment}-hsts"

  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      override                   = true
    }
  }
}
```

### CloudFront Distribution

File: `cloudfront.tf`

- `price_class = "PriceClass_200"`
- `viewer_protocol_policy = "redirect-to-https"` on all behaviours
- `web_acl_id = aws_wafv2_web_acl.main.arn`
- `response_headers_policy_id = aws_cloudfront_response_headers_policy.hsts.id` on all behaviours
- **No Lambda@Edge and no CloudFront Function in V1**

Two origins:
1. **S3 origin** (OAC) for frontend assets
2. **Custom origin** for the ap-south-1 ALB — read ALB FQDN from SSM parameter `/{app}/{env}/alb-fqdn` via `data "aws_ssm_parameter"`

Behaviour routing:
- `/api/*` → ALB custom origin (no edge functions)
- `/*` → S3 origin via OAC

Access logging → global logging S3 bucket.

---

## 20. Frontend Bucket Policy — `infra-live-frontend`

### Provider

```hcl
terraform {
  required_version = "~> 1.13.0"
  required_providers { aws = { source = "hashicorp/aws", version = "~> 5.0" } }
  backend "s3" { use_lockfile = true; encrypt = true }
}

provider "aws" {
  region = "us-east-1"
  default_tags { tags = { Project = var.app_name, Environment = var.environment, ManagedBy = "terraform" } }
}

provider "aws" {
  alias  = "ssm"
  region = "us-east-1"
  default_tags { tags = { Project = var.app_name, Environment = var.environment, ManagedBy = "terraform" } }
}
```

### Variables

```hcl
variable "app_name"             { type = string; default = "buddy360" }
variable "environment"          { type = string }
variable "frontend_bucket_name" { type = string; description = "Pre-existing S3 bucket name (must match SSM value written by infra-live-edge)" }
```

### Resources

SSM reads (`ssm_read.tf`):
```hcl
data "aws_ssm_parameter" "cloudfront_arn" {
  provider = aws.ssm
  name     = "/${var.app_name}/${var.environment}/edge/cloudfront_arn"
}

data "aws_ssm_parameter" "s3_bucket_name" {
  provider = aws.ssm
  name     = "/${var.app_name}/${var.environment}/edge/s3_bucket_name"
}
```

Bucket policy (`s3_policy.tf`) with `precondition` cross-checking `var.frontend_bucket_name` against the SSM value. Grant `s3:GetObject` to `cloudfront.amazonaws.com` scoped to the distribution ARN via `AWS:SourceArn` condition.

State key for this module: `terraform-state-files/{app_name}/{env}/frontend/us-east-1/terraform.tfstate`

---

## 21. MongoDB Atlas — `infra-live-atlas`

### Provider

```hcl
terraform {
  required_version = "~> 1.13.0"
  required_providers {
    mongodbatlas = { source = "mongodb/mongodbatlas", version = "~> 1.16" }
  }
  backend "s3" { use_lockfile = true; encrypt = true }
}

provider "mongodbatlas" {
  # Credentials via MONGODB_ATLAS_PUBLIC_KEY and MONGODB_ATLAS_PRIVATE_KEY env vars
}
```

### Variables

```hcl
variable "app_name"           { type = string; default = "buddy360" }
variable "environment"        { type = string }
variable "atlas_org_id"       { type = string }
variable "atlas_project_name" { type = string; default = "buddy360" }
variable "nat_eips"           { type = list(string); description = "NAT Gateway EIPs — whitelisted in Atlas IP Access List" }
```

### Resources

**V1 uses a replica set for all environments — no Global Cluster, no geo-sharding.**

```hcl
data "mongodbatlas_project" "main" {
  name = var.atlas_project_name
}

locals {
  atlas_instance_size = {
    dev  = "M0"
    stg  = "M10"
    prod = "M20"
  }[var.environment]
}

resource "mongodbatlas_advanced_cluster" "main" {
  project_id   = data.mongodbatlas_project.main.id
  name         = "${var.app_name}-${var.environment}"
  cluster_type = "REPLICASET"

  replication_specs {
    region_configs {
      provider_name = "AWS"
      region_name   = "AP_SOUTH_1"
      priority      = 7
      electable_specs {
        instance_size = local.atlas_instance_size
        node_count    = var.environment == "dev" ? 0 : 3
      }
    }
  }

  backup_enabled = var.environment != "dev"
}

resource "mongodbatlas_project_ip_access_list" "nat_eips" {
  for_each   = toset(var.nat_eips)
  project_id = data.mongodbatlas_project.main.id
  ip_address = each.value
  comment    = "${var.app_name}-${var.environment} NAT Gateway EIP"
}
```

> Note: M0 uses the shared free tier (node_count = 0 in replication_specs for provider-managed shared clusters). If the Atlas provider requires different handling for M0 free tier vs paid tiers, use a `count` guard to create an `mongodbatlas_advanced_cluster` with `instance_size = "M0"` for dev and a separate resource for stg/prod.

Continuous backup schedule (stg and prod only):
```hcl
resource "mongodbatlas_cloud_backup_schedule" "main" {
  count        = var.environment != "dev" ? 1 : 0
  project_id   = data.mongodbatlas_project.main.id
  cluster_name = mongodbatlas_advanced_cluster.main.name

  reference_hour_of_day    = 2
  reference_minute_of_hour = 0
  restore_window_days      = var.environment == "prod" ? 30 : 7
}
```

---

## 22. GitHub Actions Workflows

### Consolidated GitHub Secrets Table

Set the following secrets in each GitHub **Environment** (`dev`, `stg`, `prod`):

| Secret | Description |
|---|---|
| `ROLE_ARN` | ARN of the `{app_name}-{env}-github-actions` IAM role (OIDC) |
| `APP_NAME` | `buddy360` |
| `STATE_BUCKET` | S3 bucket name for Terraform state |
| `ACM_CERTIFICATE_ARN_AP_SOUTH_1` | ACM cert ARN in ap-south-1 (for ALB) |
| `ACM_CERTIFICATE_ARN_US_EAST_1` | ACM cert ARN in us-east-1 (for CloudFront) |
| `SUBDOMAIN_INTERNAL` | Backend subdomain (e.g. `api.dev.buddy360.com`) |
| `DOMAIN_NAME` | Root domain (e.g. `buddy360.com`) |
| `HOSTED_ZONE_ID` | Route 53 hosted zone ID |
| `CORS_ORIGINS` | Allowed CORS origins |
| `COOKIE_DOMAIN` | Cookie domain |
| `FRONTEND_BUCKET_NAME` | S3 frontend assets bucket name |
| `ATLAS_ORG_ID` | MongoDB Atlas organisation ID |
| `MONGODB_ATLAS_PUBLIC_KEY` | Atlas API public key |
| `MONGODB_ATLAS_PRIVATE_KEY` | Atlas API private key |
| `JWT_PRIVATE_KEY` | RSA-2048 private key PEM for app secret initialisation |
| `GOOGLE_CLIENT_ID` | OAuth client ID |
| `MONGODB_URI` | Atlas connection string |
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic API key (optional) |
| `GEMINI_API_KEY` | Gemini API key (optional) |
| `CLOUDFRONT_DISTRIBUTION_ID` | CloudFront distribution ID (for frontend deploy) |
| `ECR_REGISTRY` | ECR registry URI (e.g. `123456789.dkr.ecr.ap-south-1.amazonaws.com`) |
| `ALERTS_EMAIL` | Operator email for SNS alert subscriptions (all environments) |

---

### Workflow: `terraform-live-backend.yml`

```yaml
name: Terraform Live Backend
run-name: Terraform Live Backend (${{ inputs.action }}, ${{ inputs.environment }})

on:
  workflow_dispatch:
    inputs:
      action:
        description: "plan | apply | plan-destroy | destroy"
        required: true
        default: plan
        type: choice
        options: [plan, apply, plan-destroy, destroy]
      environment:
        required: true
        default: dev
        type: choice
        options: [dev, stg, prod]
  workflow_call:
    inputs:
      action:      { type: string, required: true }
      environment: { type: string, required: true }
```

**Env block:**
```yaml
env:
  FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: "true"
  TF_VERSION: "1.13.0"
  TF_VAR_aws_region:   "ap-south-1"
  TF_VAR_environment:  ${{ inputs.environment }}
```

**Job env block** (from GitHub Environment Secrets):
```yaml
TF_VAR_subdomain_internal: ${{ secrets.SUBDOMAIN_INTERNAL }}
TF_VAR_domain_name:        ${{ secrets.DOMAIN_NAME }}
TF_VAR_hosted_zone_id:     ${{ secrets.HOSTED_ZONE_ID }}
TF_VAR_cors_origins:       ${{ secrets.CORS_ORIGINS }}
TF_VAR_cookie_domain:      ${{ secrets.COOKIE_DOMAIN }}
TF_VAR_acm_certificate_arn: ${{ secrets.ACM_CERTIFICATE_ARN_AP_SOUTH_1 }}
```

**Steps in order:**

1. Checkout `actions/checkout@v4`
2. Validate required secrets (bash: check all listed secrets are non-empty; fail with clear message listing missing names)
3. Configure AWS credentials: `aws-actions/configure-aws-credentials@v4` with `role-to-assume: ${{ secrets.ROLE_ARN }}`
4. Resolve optional model overrides (OPENAI_API_KEY required; ANTHROPIC_API_KEY / GEMINI_API_KEY optional → export as TF_VAR_* when non-empty)
5. Setup Terraform: `hashicorp/setup-terraform@v3` with `terraform_version: ${{ env.TF_VERSION }}`
6. Terraform init: `-backend-config="bucket=${{ secrets.STATE_BUCKET }}"` and `-backend-config="key=terraform-state-files/${{ secrets.APP_NAME }}/${{ inputs.environment }}/backend/ap-south-1/terraform.tfstate"`
7. Terraform fmt check
8. Terraform validate
9. Terraform plan (if action == plan or apply): `-out=tfplan.bin -input=false -no-color -var-file=tfvars/${{ inputs.environment }}.tfvars`
10. Show plan summary → `$GITHUB_STEP_SUMMARY`
11. Upload plan artefact: `actions/upload-artifact@v4`, retention 7 days
12. Terraform apply (if action == apply): `terraform apply -auto-approve tfplan.bin`
13. **Initialise app secrets (first apply only):** Read current secret; if `JWT_PRIVATE_KEY == "REPLACE_ME"`, write all keys. Check key is `JWT_PRIVATE_KEY`, not `JWT_SECRET`.
14. Terraform plan-destroy (if action == plan-destroy or destroy)
15. Show destroy plan summary; upload destroy plan artefact
16. Terraform destroy (if action == destroy)

**Concurrency:** `group: terraform-live-backend-buddy360-${{ inputs.environment }}`, `cancel-in-progress: false`

**permissions:** `id-token: write`, `contents: read`

---

### Workflow: `terraform-live-edge.yml`

Mirror the structure of `terraform-live-backend.yml` with these differences:

- No `aws_region` input — edge is always us-east-1
- `working-directory: infra-live-edge/terraform`
- State key: `terraform-state-files/${{ secrets.APP_NAME }}/${{ inputs.environment }}/edge/us-east-1/terraform.tfstate`
- Additional TF_VARs: `TF_VAR_acm_certificate_arn: ${{ secrets.ACM_CERTIFICATE_ARN_US_EAST_1 }}`, `TF_VAR_frontend_bucket_name: ${{ secrets.FRONTEND_BUCKET_NAME }}`, and `TF_VAR_alerts_email: ${{ secrets.ALERTS_EMAIL }}`
- No Secrets Manager initialisation step
- Concurrency group: `terraform-live-edge-buddy360-${{ inputs.environment }}`

---

### Workflow: `terraform-live-frontend.yml`

- `working-directory: infra-live-frontend/terraform`
- State key: `terraform-state-files/${{ secrets.APP_NAME }}/${{ inputs.environment }}/frontend/us-east-1/terraform.tfstate`
- Only needs: `TF_VAR_frontend_bucket_name: ${{ secrets.FRONTEND_BUCKET_NAME }}`
- Add workflow comment: "Run after terraform-live-edge; requires edge/cloudfront_arn and edge/s3_bucket_name in SSM"
- Concurrency group: `terraform-live-frontend-buddy360-${{ inputs.environment }}`

---

### Workflow: `deploy-live-backend.yml`

```yaml
name: Deploy Live Backend
on:
  workflow_dispatch:
    inputs:
      environment: { required: true, default: dev, type: choice, options: [dev, stg, prod] }
      image_tag:   { required: false, default: "", description: "Leave empty to use commit SHA" }
  workflow_call:
    inputs:
      environment: { type: string, required: true }
      image_tag:   { type: string, required: false, default: "" }
  push:
    branches: [main]
    paths: ["backend/**"]
```

**On push to main:** deploy to `dev` and `stg` only. Prod requires explicit `workflow_dispatch` with GitHub Environment Required Reviewer protection.

**Steps in order:**

1. Checkout
2. Configure AWS credentials (OIDC)
3. Set image tag: `IMAGE_TAG=${{ inputs.image_tag || github.sha }}`
4. Build Docker image: `docker build -t $IMAGE_URI:$IMAGE_TAG ./backend`
5. **Pre-push Trivy scan:**
   ```bash
   docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
     aquasec/trivy:latest image --exit-code 1 --severity HIGH,CRITICAL \
     --ignore-unfixed $IMAGE_URI:$IMAGE_TAG
   ```
   Must fail the job on any HIGH or CRITICAL CVE before push.
6. ECR login: `aws ecr get-login-password | docker login --username AWS --password-stdin ${{ secrets.ECR_REGISTRY }}`
7. Docker push
8. **Pre-deploy MongoDB migration task** (one-off ECS Fargate task):
   ```bash
   TASK_ARN=$(aws ecs run-task \
     --cluster $CLUSTER_NAME \
     --task-definition $TASK_DEF_FAMILY \
     --launch-type FARGATE \
     --overrides '{"containerOverrides":[{"name":"...-backend","command":["python","-m","app.migrations.run"]}]}' \
     --network-configuration "awsvpcConfiguration={subnets=[...],securityGroups=[...],assignPublicIp=DISABLED}" \
     --query 'tasks[0].taskArn' --output text)

   aws ecs wait tasks-stopped --cluster $CLUSTER_NAME --tasks $TASK_ARN

   EXIT_CODE=$(aws ecs describe-tasks --cluster $CLUSTER_NAME --tasks $TASK_ARN \
     --query 'tasks[0].containers[0].exitCode' --output text)

   [[ "$EXIT_CODE" != "0" ]] && echo "Migration task failed (exit $EXIT_CODE)" && exit 1
   ```
9. Update ECS service: `aws ecs update-service --cluster $CLUSTER_NAME --service $SERVICE_NAME --force-new-deployment`
10. Wait for stability: `aws ecs wait services-stable --cluster $CLUSTER_NAME --services $SERVICE_NAME`

---

### Workflow: `deploy-live-frontend.yml`

```yaml
name: Deploy Live Frontend
on:
  workflow_dispatch:
    inputs:
      environment: { required: true, default: dev, type: choice, options: [dev, stg, prod] }
  workflow_call:
    inputs:
      environment: { type: string, required: true }
  push:
    branches: [main]
    paths: ["frontend/**"]
```

**Steps in order:**

1. Checkout
2. Setup Node.js (`actions/setup-node@v4`, `node-version: '20'`)
3. Install: `npm ci` in `./frontend`
4. Build: `npm run build` in `./frontend` (output: `./frontend/dist`)
5. Configure AWS credentials (OIDC)
6. Sync to S3:
   ```bash
   aws s3 sync ./frontend/dist s3://${{ secrets.FRONTEND_BUCKET_NAME }} \
     --delete \
     --cache-control "public,max-age=31536000,immutable"
   aws s3 cp ./frontend/dist/index.html s3://${{ secrets.FRONTEND_BUCKET_NAME }}/index.html \
     --cache-control "no-cache,no-store,must-revalidate"
   ```
7. **CloudFront cache invalidation (must be last step):**
   ```bash
   aws cloudfront create-invalidation \
     --distribution-id ${{ secrets.CLOUDFRONT_DISTRIBUTION_ID }} \
     --paths "/*"
   ```

---

### Workflow: `terraform-live-full-stack.yml`

```yaml
name: Terraform Live Full Stack
on:
  workflow_dispatch:
    inputs:
      action:      { required: true, default: plan, type: choice, options: [plan, apply, plan-destroy, destroy] }
      environment: { required: true, default: dev, type: choice, options: [dev, stg, prod] }

jobs:
  backend:
    uses: ./.github/workflows/terraform-live-backend.yml
    with:
      action:      ${{ inputs.action }}
      environment: ${{ inputs.environment }}
    secrets: inherit

  edge:
    needs: [backend]
    if: inputs.action != 'destroy' && inputs.action != 'plan-destroy'
    uses: ./.github/workflows/terraform-live-edge.yml
    with:
      action:      ${{ inputs.action }}
      environment: ${{ inputs.environment }}
    secrets: inherit

  frontend:
    needs: [edge]
    if: inputs.action != 'destroy' && inputs.action != 'plan-destroy'
    uses: ./.github/workflows/terraform-live-frontend.yml
    with:
      action:      ${{ inputs.action }}
      environment: ${{ inputs.environment }}
    secrets: inherit

  deploy-backend:
    needs: [frontend]
    if: inputs.action == 'apply'
    uses: ./.github/workflows/deploy-live-backend.yml
    with:
      environment: ${{ inputs.environment }}
    secrets: inherit

  deploy-frontend:
    needs: [deploy-backend]
    if: inputs.action == 'apply'
    uses: ./.github/workflows/deploy-live-frontend.yml
    with:
      environment: ${{ inputs.environment }}
    secrets: inherit

  # Destroy order is reversed
  destroy-frontend:
    if: inputs.action == 'destroy'
    uses: ./.github/workflows/terraform-live-frontend.yml
    with:
      action:      destroy
      environment: ${{ inputs.environment }}
    secrets: inherit

  destroy-edge:
    needs: [destroy-frontend]
    if: inputs.action == 'destroy'
    uses: ./.github/workflows/terraform-live-edge.yml
    with:
      action:      destroy
      environment: ${{ inputs.environment }}
    secrets: inherit

  destroy-backend:
    needs: [destroy-edge]
    if: inputs.action == 'destroy'
    uses: ./.github/workflows/terraform-live-backend.yml
    with:
      action:      destroy
      environment: ${{ inputs.environment }}
    secrets: inherit
```

---

## 23. Files to Generate

Generate every file in this list. All files must be complete — no stubs, no `# TODO` markers.

```
infra-live-backend/terraform/
  provider.tf
  variables.tf
  outputs.tf
  vpc.tf
  security_groups.tf
  alb.tf
  ecs.tf
  ecr.tf
  elasticache.tf
  secrets.tf
  iam.tf
  iam_github.tf
  cloudtrail.tf
  guardduty.tf
  xray.tf
  alarms.tf          ← includes aws_cloudwatch_dashboard resource
  sns.tf
  s3_logs.tf
  ssm_output.tf      ← writes /{app}/{env}/alb-fqdn to SSM after apply
  tfvars/dev.tfvars
  tfvars/stg.tfvars
  tfvars/prod.tfvars

infra-live-edge/terraform/
  provider.tf
  variables.tf
  outputs.tf
  waf.tf
  cloudfront.tf      ← NO CloudFront Function, NO Lambda@Edge; ALB FQDN read from SSM
  s3_frontend.tf     ← aws_s3_bucket + versioning + encryption + lifecycle + public access block
  s3_logs_global.tf
  route53.tf
  ssm_alb_read.tf    ← data source for ALB FQDN from SSM /{app}/{env}/alb-fqdn
  ssm_outputs.tf     ← writes cloudfront_arn and s3_bucket_name to SSM
  sns.tf             ← aws_sns_topic + email subscription (all envs) + PagerDuty HTTPS sub (prod); required by guardduty.tf EventBridge rule
  guardduty.tf
  cloudtrail.tf
  tfvars/dev.tfvars
  tfvars/stg.tfvars
  tfvars/prod.tfvars

infra-live-frontend/terraform/
  provider.tf
  variables.tf
  outputs.tf
  ssm_read.tf
  s3_policy.tf
  tfvars/dev.tfvars
  tfvars/stg.tfvars
  tfvars/prod.tfvars

infra-live-atlas/terraform/
  provider.tf
  variables.tf
  outputs.tf
  cluster.tf         ← REPLICASET only; M0 dev / M10 stg / M20 prod; NO geo-sharding
  ip_access_list.tf
  backup.tf
  tfvars/dev.tfvars
  tfvars/stg.tfvars
  tfvars/prod.tfvars

.github/workflows/
  terraform-live-backend.yml
  terraform-live-edge.yml
  terraform-live-frontend.yml
  deploy-live-backend.yml
  deploy-live-frontend.yml
  terraform-live-full-stack.yml
```

---

## 24. Invariants and Constraints

Enforce these invariants across all generated files:

1. `target_type = "ip"` on all ALB target groups — Fargate uses `awsvpc` network mode
2. The Kinesis Firehose stream name for WAF logs **must** start with `aws-waf-logs-` — AWS enforces this; any other prefix causes WAF logging to silently fail
3. **No Lambda@Edge and no CloudFront Function in V1** — remove any edge function association from the CloudFront distribution
4. ACM certificate for CloudFront **must** be in `us-east-1`; the ALB cert must be in `ap-south-1`
5. CloudFront WebACL scope **must** be `CLOUDFRONT` — created in us-east-1
6. The auth rate rule (100 req/5min, priority 1) **must** have a lower WAF priority number than the global rate rule (2000 req/5min, priority 2) — lower number = evaluated first
7. `desired_count` on `aws_ecs_service` **must** be in `lifecycle { ignore_changes = [desired_count] }` — Auto Scaling manages it
8. `deployment_circuit_breaker { enable = true, rollback = true }` on **all** ECS services across all environments
9. `ordered_placement_strategy { type = "spread", field = "attribute:ecs.availability-zone" }` on all ECS services
10. `use_lockfile = true` in the S3 backend block in all Terraform modules
11. `required_version = "~> 1.13.0"` in all modules
12. Secrets Manager secret key is `JWT_PRIVATE_KEY` (RSA PEM), not `JWT_SECRET`
13. JWT is extracted from the `Authorization: Bearer <token>` header, not a cookie; validation is performed in FastAPI, not at edge
14. `enable_key_rotation = true` on all KMS CMKs (CloudTrail)
15. All four S3 public-access block flags must be `true` on all buckets (logging, frontend, state)
16. `cancel-in-progress: false` on all GitHub Actions concurrency groups — queue, never cancel
17. Prod deploy workflows must only run via `workflow_dispatch` (never via push-to-main trigger)
18. Pre-push Trivy scan must run **before** `docker push` and must fail on HIGH or CRITICAL findings
19. CloudFront cache invalidation (`aws cloudfront create-invalidation --paths "/*"`) must be the **last step** of every frontend deploy
20. `health_check_grace_period_seconds = 60` on all ECS services
21. MongoDB Atlas cluster type is `REPLICASET` for all environments — do not use `GEOSHARDED` or `SHARDED` in V1
22. Atlas instance sizes: M0 (dev), M10 (stg), M20 (prod) — do not use M30 in V1
23. Default `openai_model` variable value is `"gpt-5.4-mini"` in both `variables.tf` and all tfvars files
24. `aws_cloudwatch_dashboard` resource must be defined in `alarms.tf` with all 8 widgets listed in section 12
25. `ssm_output.tf` in `infra-live-backend` **must** use `provider = aws.ssm` (us-east-1 alias) on the `aws_ssm_parameter` resource — `infra-live-edge` reads from us-east-1 SSM; writing to ap-south-1 SSM (the default provider) will break CloudFront origin resolution
26. `infra-live-edge` must define its own `aws_sns_topic` (in `sns.tf`) — GuardDuty EventBridge rule and CloudTrail alarms in this module send to this topic; the backend's SNS topic is in a different region and cannot be referenced cross-module
27. `waf_count_mode = true` in `tfvars/dev.tfvars` and `tfvars/stg.tfvars` for `infra-live-edge`; `waf_count_mode = false` (or omit, using the default) in `tfvars/prod.tfvars`
