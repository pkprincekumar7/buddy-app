# buddy360 — AI Code-Generation Prompt

You are an expert AWS infrastructure engineer. Generate all Terraform modules and GitHub Actions workflows described below. Every file listed in the "Files to generate" section must be created with complete, working, production-grade HCL or YAML — no placeholders, no `# TODO` comments, no partial stubs. Where a value is environment-specific it must be driven by a Terraform variable or GitHub input. Where a value is a hardcoded AWS constant (ELB account IDs, managed prefix list IDs) use the exact values listed in this document.

Read every section of this document before generating any file. The sections are interdependent.

---

## 1. Context and Constraints

### Application
- Name: **buddy360** (Terraform variable `app_name`, default `"buddy360"`)
- Framework: FastAPI (Python), port 8000 inside container
- Database: **MongoDB Atlas** only — no SQL, no Alembic, no RDS
- Frontend: React (Vite), static SPA built to `dist/`
- Auth: RS256 JWTs; token location is the `Authorization: Bearer <token>` request header; edge validation via CloudFront Function + KVS

### AWS Account
- **Single AWS account**, multiple regions
- Primary backend region: **ap-south-1** (Mumbai)
- Expansion regions: **eu-west-1** (Ireland), **us-east-1** (N. Virginia)
- Global / edge region: **us-east-1** (CloudFront, WAF, S3 frontend, Lambda@Edge, ACM for CF)

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

All resource names follow `{app_name}-{environment}-{resource}[-{region_short}]`.

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
| CloudFront Function | `{app}-{env}-jwt-auth` | `buddy360-prod-jwt-auth` |
| CloudFront KVS | `{app}-{env}-jwt-kvs` | `buddy360-prod-jwt-kvs` |
| Lambda@Edge function | `{app}-{env}-geo-router` | `buddy360-prod-geo-router` |
| X-Ray sampling rule | `{app}-{env}-default` | `buddy360-prod-default` |
| CloudWatch dashboard | `{app}-{env}` | `buddy360-prod` |
| IAM role (ECS exec) | `{app}-{env}-ecs-exec-role` | `buddy360-prod-ecs-exec-role` |
| IAM role (ECS task) | `{app}-{env}-ecs-task-role` | `buddy360-prod-ecs-task-role` |
| IAM role (GitHub OIDC) | `{app}-{env}-github-actions` | `buddy360-prod-github-actions` |

---

## 4. VPC and Networking — `infra-live-backend`

### CIDR Design

One VPC per region per environment. CIDRs are derived from a region index to avoid overlap:

| Region | Region index | VPC CIDR |
|---|---|---|
| ap-south-1 | 0 | `10.0.0.0/16` |
| eu-west-1 | 1 | `10.1.0.0/16` |
| us-east-1 | 2 | `10.2.0.0/16` |

The Terraform variable `region_index` (type `number`) selects the CIDR. Use `cidrsubnet("10.${var.region_index}.0.0/16", 8, index)` for subnets.

**Subnets per environment:**

| Environment | AZs | Public subnets | Private subnets | NAT Gateways |
|---|---|---|---|---|
| dev | 2 AZs (`data "aws_availability_zones"`, indexes 0–1) | 2 (`/24`) | 2 (`/24`) | 1 (in public subnet 0) |
| stg | 2 AZs | 2 (`/24`) | 2 (`/24`) | 1 |
| prod | 2 AZs | 2 (`/24`) | 2 (`/24`) | 2 (one per AZ — HA) |

NAT Gateway count is driven by: `local.nat_gw_count = var.environment == "prod" ? 2 : 1`.

Private route tables: one per NAT Gateway. In prod, private subnet 0 routes through NAT GW 0 and private subnet 1 routes through NAT GW 1.

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
    "stopTimeout": 60,
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
- Active X-Ray tracing: set in the ECS service `propagate_tags` and task definition `tags`

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

| Policy | Metric | Namespace | Dimension | Target | Scale-out cooldown | Scale-in cooldown |
|---|---|---|---|---|---|---|
| cpu | `ECSServiceAverageCPUUtilization` | `AWS/ECS` | ClusterName + ServiceName | 60 | 60 s | 300 s |
| memory | `ECSServiceAverageMemoryUtilization` | `AWS/ECS` | ClusterName + ServiceName | 70 | 60 s | 300 s |
| alb_rps | `ALBRequestCountPerTarget` | `AWS/ApplicationELB` | TargetGroup (relative ARN) + LoadBalancer (relative ARN) | 1000 | 60 s | 300 s |

---

## 8. ECR — `infra-live-backend`

File: `ecr.tf`

- `scan_on_push = true`
- Image tag mutability: `MUTABLE`
- Lifecycle policy: expire untagged images after 1 day; retain the 20 most recent tagged images
- Cross-region replication in ap-south-1 only (guard with `count = var.aws_region == "ap-south-1" ? 1 : 0`): replicate to eu-west-1 and us-east-1 via `aws_ecr_replication_configuration`
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

Use a conditional resource pattern (count) or `for_each` to generate the correct resource type per environment. The `auth_token` field on both resource types must reference the Secrets Manager secret value (use `random_password` + `aws_secretsmanager_secret_version` in `secrets.tf`, or accept `var.redis_auth_token`).

Both resource types require:
- `at_rest_encryption_enabled = true`
- `transit_encryption_enabled = true`
- `subnet_group_name` pointing to a `aws_elasticache_subnet_group` in the private subnets
- `security_group_ids = [aws_security_group.redis.id]`

---

## 10. Secrets Manager — `infra-live-backend`

File: `secrets.tf`

One secret per region per environment: `{app_name}/{env}/backend-secrets`

**Correct key set:**

| Key | Description |
|---|---|
| `JWT_PRIVATE_KEY` | RSA-2048 private key in PEM format (RS256 signing; private key never leaves Secrets Manager) |
| `GOOGLE_CLIENT_ID` | OAuth client ID |
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic API key (optional; set to `REPLACE_ME` if unused) |
| `GEMINI_API_KEY` | Gemini API key (optional; set to `REPLACE_ME` if unused) |
| `MONGODB_URI` | Atlas connection string |
| `REDIS_AUTH_TOKEN` | ElastiCache AUTH token (64-char random hex; all environments) |

Terraform creates the secret with `REPLACE_ME` placeholders. The `terraform-live-backend` workflow populates real values on the first apply only (checks for `REPLACE_ME` before writing).

The GitHub Actions step that initialises the secret must check for `JWT_PRIVATE_KEY == "REPLACE_ME"` (not `JWT_SECRET`) to determine if initialisation is needed.

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

Inline policy (minimum; extend per application needs):
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

Create in each region for environment-scoped deployment. One role per environment (not per region — the same OIDC provider and role are reused; the role is created in us-east-1 once and assumed cross-region via the same `role-to-assume` ARN).

OIDC provider (create once, reference everywhere):
```hcl
data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}
```

If the OIDC provider does not yet exist, create it:
```hcl
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1",
                     "1c58a3a8518e8759bf075b76b750d4f2df264fcd"]
}
```

Trust policy:
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::{ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
      },
      "StringLike": {
        "token.actions.githubusercontent.com:sub": "repo:prince-els/buddy-app:*"
      }
    }
  }]
}
```

Attach a managed policy granting the permissions needed by the Terraform workflows (at minimum: `AdministratorAccess` scoped or a custom least-privilege policy covering all resources managed by Terraform). For production hardening, replace `AdministratorAccess` with a custom policy scoped to the exact resource ARN patterns used by each module.

---

## 12. CloudWatch Alarms — `infra-live-backend`

File: `alarms.tf`

All alarms use `treat_missing_data = "notBreaching"` unless specified otherwise. All alarms send `alarm_action` to `aws_sns_topic.alerts.arn`.

| Alarm name | Namespace | MetricName | Dimensions | Statistic | Period | Evaluation Periods | Threshold | Comparison |
|---|---|---|---|---|---|---|---|---|
| `{app}-{env}-healthy-hosts` | `AWS/ApplicationELB` | `HealthyHostCount` | TargetGroup | Minimum | 60 | 2 | 1 | LessThanThreshold |
| `{app}-{env}-alb-5xx` | `AWS/ApplicationELB` | `HTTPCode_Target_5XX_Count` | LoadBalancer | Sum | 60 | 5 | 10 | GreaterThanThreshold |
| `{app}-{env}-alb-4xx` | `AWS/ApplicationELB` | `HTTPCode_Target_4XX_Count` | LoadBalancer | Sum | 60 | 5 | 100 | GreaterThanThreshold |
| `{app}-{env}-ecs-cpu` | `AWS/ECS` | `CPUUtilization` | ClusterName + ServiceName | Average | 60 | 3 | 85 | GreaterThanThreshold |
| `{app}-{env}-redis-conn` | `AWS/ElastiCache` | `CurrConnections` | CacheClusterId | Average | 60 | 3 | 5 | LessThanThreshold |

`{app}` = `var.app_name`, `{env}` = `var.environment`. Thresholds for 5XX and 4XX are `var.alb_5xx_threshold` and `var.alb_4xx_threshold` with defaults 10 and 100 respectively.

### CloudWatch Dashboard

File: `dashboard.tf`

```hcl
resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = "${var.app_name}-${var.environment}"

  dashboard_body = jsonencode({
    widgets = [
      {
        type = "metric"; width = 6; height = 6
        properties = {
          title   = "ECS CPU Utilization"
          metrics = [["AWS/ECS", "CPUUtilization", "ClusterName", "${var.app_name}-${var.environment}", "ServiceName", "${var.app_name}-${var.environment}-backend"]]
          stat    = "Average"; period = 60; view = "timeSeries"
        }
      },
      {
        type = "metric"; width = 6; height = 6
        properties = {
          title   = "ECS Memory Utilization"
          metrics = [["AWS/ECS", "MemoryUtilization", "ClusterName", "${var.app_name}-${var.environment}", "ServiceName", "${var.app_name}-${var.environment}-backend"]]
          stat    = "Average"; period = 60; view = "timeSeries"
        }
      },
      {
        type = "metric"; width = 6; height = 6
        properties = {
          title   = "ALB 5XX Errors"
          metrics = [["AWS/ApplicationELB", "HTTPCode_Target_5XX_Count", "LoadBalancer", aws_lb.main.arn_suffix]]
          stat    = "Sum"; period = 60; view = "timeSeries"
        }
      },
      {
        type = "metric"; width = 6; height = 6
        properties = {
          title   = "ALB 4XX Errors"
          metrics = [["AWS/ApplicationELB", "HTTPCode_Target_4XX_Count", "LoadBalancer", aws_lb.main.arn_suffix]]
          stat    = "Sum"; period = 60; view = "timeSeries"
        }
      },
      {
        type = "metric"; width = 6; height = 6
        properties = {
          title   = "ALB Request Count"
          metrics = [["AWS/ApplicationELB", "RequestCount", "LoadBalancer", aws_lb.main.arn_suffix]]
          stat    = "Sum"; period = 60; view = "timeSeries"
        }
      },
      {
        type = "metric"; width = 6; height = 6
        properties = {
          title   = "ALB Healthy Host Count"
          metrics = [["AWS/ApplicationELB", "HealthyHostCount", "TargetGroup", aws_lb_target_group.main.arn_suffix, "LoadBalancer", aws_lb.main.arn_suffix]]
          stat    = "Minimum"; period = 60; view = "timeSeries"
        }
      },
      {
        type = "metric"; width = 6; height = 6
        properties = {
          title   = "ElastiCache Current Connections"
          metrics = [["AWS/ElastiCache", "CurrConnections", "CacheClusterId", "${var.app_name}-${var.environment}-redis"]]
          stat    = "Average"; period = 60; view = "timeSeries"
        }
      },
      {
        type = "metric"; width = 6; height = 6
        properties = {
          title   = "ElastiCache CPU Utilization"
          metrics = [["AWS/ElastiCache", "EngineCPUUtilization", "CacheClusterId", "${var.app_name}-${var.environment}-redis"]]
          stat    = "Average"; period = 60; view = "timeSeries"
        }
      }
    ]
  })
}
```

---

## 13. X-Ray Sampling Rule — `infra-live-backend`

File: `xray.tf`

```hcl
resource "aws_xray_sampling_rule" "default" {
  rule_name      = "${var.app_name}-${var.environment}-default"
  priority       = 1000
  reservoir_size = 5
  fixed_rate     = 0.05    # 5 % sampling in prod; set to 1.0 for dev/stg
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
  include_global_service_events = false   # false in backend; true in infra-live-edge trail
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

## 14b. GuardDuty — `infra-live-backend`

File: `guardduty.tf`

```hcl
resource "aws_guardduty_detector" "main" {
  enable = true

  finding_publishing_frequency = var.environment == "prod" ? "FIFTEEN_MINUTES" : "SIX_HOURS"
}

resource "aws_cloudwatch_event_rule" "guardduty_findings" {
  name        = "${var.app_name}-${var.environment}-guardduty-findings"
  description = "GuardDuty HIGH/CRITICAL findings to SNS"

  event_pattern = jsonencode({
    source      = ["aws.guardduty"]
    detail-type = ["GuardDuty Finding"]
    detail      = { severity = [{ numeric = [">=", 7] }] }
  })
}

resource "aws_cloudwatch_event_target" "guardduty_sns" {
  rule      = aws_cloudwatch_event_rule.guardduty_findings.name
  target_id = "sns"
  arn       = aws_sns_topic.alerts.arn
}
```

- `finding_publishing_frequency`: `"FIFTEEN_MINUTES"` for prod, `"SIX_HOURS"` for dev and stg
- EventBridge rule forwards findings with severity ≥ HIGH (numeric ≥ 7) to `aws_sns_topic.alerts`

---

## 15. Logging S3 Buckets — `infra-live-backend`

File: `s3_logs.tf`

Regional logging bucket name: `{app_name}-{environment}-logs-{aws_region}`.

Required bucket policy granting ELB service account PutObject (use the correct ELB service account per region):

| Region | ELB Service Account ID |
|---|---|
| ap-south-1 | `718504428378` |
| eu-west-1 | `156460612806` |
| us-east-1 | `127311923021` |

Bucket policy must allow `s3:PutObject` for `arn:aws:iam::{elb_account_id}:root` on `arn:aws:s3:::{bucket}/alb/*`.

Both logging buckets (global and regional) must have:
- All four public-access block flags set to `true`
- SSE-S3 encryption
- No versioning
- Lifecycle rule: transition to `GLACIER_IR` after 30 days; expire after 90 days (365 for prod with a `var.log_retention_days` variable)

---

## 16. Terraform State Backend — `infra-live-backend`

File: `provider.tf` (representative; all three modules follow this pattern)

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
    # Values supplied via -backend-config in CI; do not hardcode
    # bucket, key, and region here — they are passed as arguments to terraform init
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

# SSM alias required when reading parameters written by infra-live-edge (us-east-1)
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

---

## 17. Module Variables — `infra-live-backend`

File: `variables.tf`

```hcl
variable "app_name"           { type = string; default = "buddy360" }
variable "environment"        { type = string; validation { condition = contains(["dev","stg","prod"], var.environment); error_message = "must be dev, stg, or prod." } }
variable "aws_region"         { type = string }
variable "region_index"       { type = number; description = "0=ap-south-1, 1=eu-west-1, 2=us-east-1 — used to derive VPC CIDR" }
variable "acm_certificate_arn" { type = string; description = "Pre-existing ACM certificate ARN in the same region as the ALB" }
variable "subdomain_internal"  { type = string; description = "Internal backend subdomain (e.g. api.dev.buddy360.com)" }
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
variable "alerts_email"        { type = string; description = "Email address for SNS alert subscriptions" }
```

File: `outputs.tf`

```hcl
output "alb_dns_name"    { value = aws_lb.main.dns_name }
output "ecr_repo_url"    { value = aws_ecr_repository.backend.repository_url }
output "ecs_cluster_name" { value = aws_ecs_cluster.main.name }
output "ecs_service_name" { value = aws_ecs_service.backend.name }
output "app_secret_arn"  { value = aws_secretsmanager_secret.app.arn }
output "nat_eips"        { value = aws_eip.nat[*].public_ip }
```

---

## 17b. Route 53 Records — `infra-live-backend`

File: `route53.tf`

One CNAME record per backend region pointing the internal API subdomain to the ALB DNS name:

```hcl
resource "aws_route53_record" "api" {
  zone_id = var.hosted_zone_id
  name    = var.subdomain_internal   # e.g. api.dev.buddy360.com
  type    = "CNAME"
  ttl     = 300
  records = [aws_lb.main.dns_name]
}
```

`var.subdomain_internal` is injected as `TF_VAR_subdomain_internal` from GitHub Environment Secrets at CI time — do **not** put it in tfvars files.

---

## 18. tfvars Files — `infra-live-backend`

File: `tfvars/dev.tfvars`
```hcl
environment        = "dev"
region_index       = 0
openai_model       = "gpt-5.4-mini"
log_retention_days = 30
```

File: `tfvars/stg.tfvars`
```hcl
environment        = "stg"
region_index       = 0
openai_model       = "gpt-5.4-mini"
log_retention_days = 30
```

File: `tfvars/prod.tfvars`
```hcl
environment        = "prod"
region_index       = 0
openai_model       = "gpt-5.4-mini"
log_retention_days = 365
```

The following variables are environment-sensitive secrets and are **not** in tfvars files — they are injected as `TF_VAR_*` environment variables from GitHub environment secrets at CI time: `aws_region`, `acm_certificate_arn`, `subdomain_internal`, `domain_name`, `hosted_zone_id`, `cors_origins`, `cookie_domain`.

---

## 19. Global Edge — `infra-live-edge`

### Provider

File: `provider.tf`

Three providers: default (us-east-1 hardcoded — all edge resources must be in us-east-1), a `us_east_1` alias (same region, used for WAF and OAC), and an `ssm` alias (us-east-1, reads ALB FQDNs written by backend).

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
  alias  = "us_east_1"
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
variable "app_name"            { type = string; default = "buddy360" }
variable "environment"         { type = string }
variable "acm_certificate_arn" { type = string; description = "Pre-existing ACM cert in us-east-1 for CloudFront" }
variable "domain_name"         { type = string }
variable "hosted_zone_id"      { type = string }
variable "frontend_bucket_name" { type = string; description = "Pre-existing S3 bucket for frontend assets (us-east-1)" }
variable "enabled_regions"     { type = list(string); default = ["ap-south-1"]; description = "Regions with a deployed backend ALB in SSM" }
variable "waf_count_mode"      { type = bool; default = false; description = "Set to true for stg — deploys managed rules in COUNT mode" }
variable "alerts_email"        { type = string; description = "Email address for SNS alert subscriptions (GuardDuty, CloudTrail findings)" }
```

### Outputs — `infra-live-edge`

File: `outputs.tf`

```hcl
output "cloudfront_domain"   { value = aws_cloudfront_distribution.main.domain_name }
output "cloudfront_arn"      { value = aws_cloudfront_distribution.main.arn }
output "s3_bucket_name"      { value = var.frontend_bucket_name }
output "kvs_arn"             { value = aws_cloudfront_key_value_store.jwt.arn }
output "lambda_edge_arn"     { value = aws_lambda_function.geo_router.qualified_arn }
```

Write `cloudfront_arn` and `s3_bucket_name` to SSM after apply via `aws_ssm_parameter`:
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

`scope = "CLOUDFRONT"` — must be created in us-east-1 with `provider = aws.us_east_1`.

WAF rule priorities (lower number = evaluated first):

| Priority | Rule name | Type | Action |
|---|---|---|---|
| 1 | `auth-endpoint-rate-limit` | Rate-based, 100 req/5min/IP, scope_down_statement URI byte match `/api/auth/login` OR `/api/auth/register` | BLOCK |
| 2 | `global-rate-limit` | Rate-based, 2000 req/5min/IP | BLOCK |
| 10 | `AWSManagedRulesKnownBadInputsRuleSet` | AWS managed | COUNT (stg) / BLOCK (prod) |
| 20 | `AWSManagedRulesCoreRuleSet` | AWS managed | COUNT (stg) / BLOCK (prod) |

Use `var.waf_count_mode` to set override actions: `count {}` when true, `none {}` when false.

WAF full logs → Kinesis Data Firehose → S3 global logging bucket. **The Firehose delivery stream name must start with `aws-waf-logs-`** (AWS requirement for WAF logging). Delivery stream name: `aws-waf-logs-{app_name}-{environment}`.

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

- `price_class = "PriceClass_All"`
- `viewer_protocol_policy = "redirect-to-https"` on all behaviours
- `web_acl_id = aws_wafv2_web_acl.main.arn`
- `response_headers_policy_id = aws_cloudfront_response_headers_policy.hsts.id` on all behaviours
- Two origins: S3 (OAC) and a custom origin per region (baked from Lambda@Edge — the ALB FQDNs are not set directly in the distribution; the Lambda@Edge function changes the origin at runtime)

Behaviour routing:
- `/api/*` → CloudFront Function (viewer request) + Lambda@Edge (origin request) → routed to ALB by Lambda@Edge
- `/*` → S3 origin via OAC; no Lambda@Edge; no CF Function

### CloudFront Function (JWT Auth at Edge)

File: `cloudfront_function.js` (embedded in `cloudfront.tf` via `file()` or inline)

**Full implementation specification:**

```javascript
// Runtime: cloudfront-js-2.0 (supports Web Crypto API)
// Trigger: viewer-request on /api/* behaviour

import cf from 'cloudfront';

const PUBLIC_ENDPOINTS = ['/api/health', '/api/auth/login', '/api/auth/register'];
const KVS_ID = 'REPLACE_WITH_KVS_ARN';  // set via templatefile() in Terraform

async function handler(event) {
  const request = event.request;
  const uri = request.uri;

  // Bypass JWT check for public endpoints
  for (const path of PUBLIC_ENDPOINTS) {
    if (uri === path || uri.startsWith(path + '/')) {
      return request;
    }
  }

  // Extract Bearer token from Authorization header
  const authHeader = request.headers['authorization'];
  if (!authHeader || !authHeader.value) {
    return { statusCode: 401, statusDescription: 'Unauthorized', body: '{"error":"missing token"}' };
  }
  const parts = authHeader.value.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return { statusCode: 401, statusDescription: 'Unauthorized', body: '{"error":"invalid authorization header"}' };
  }
  const token = parts[1];

  // Decode JWT (no library — base64url decode only)
  const tokenParts = token.split('.');
  if (tokenParts.length !== 3) {
    return { statusCode: 401, statusDescription: 'Unauthorized', body: '{"error":"malformed token"}' };
  }

  let payload;
  try {
    payload = JSON.parse(atob(tokenParts[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch (e) {
    return { statusCode: 401, statusDescription: 'Unauthorized', body: '{"error":"invalid token payload"}' };
  }

  // Validate exp claim BEFORE signature verification
  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < now) {
    return { statusCode: 401, statusDescription: 'Unauthorized', body: '{"error":"token expired"}' };
  }

  // Load public keys from KVS (dual-key strategy: key_current and key_previous)
  const kvsHandle = cf.kvs(KVS_ID);
  let verified = false;

  for (const keyName of ['key_current', 'key_previous']) {
    let jwkStr;
    try { jwkStr = await kvsHandle.get(keyName); } catch (e) { continue; }
    if (!jwkStr) continue;

    try {
      const jwk = JSON.parse(jwkStr);
      const cryptoKey = await crypto.subtle.importKey(
        'jwk', jwk,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false, ['verify']
      );
      const signingInput = tokenParts[0] + '.' + tokenParts[1];
      const signature = Uint8Array.from(
        atob(tokenParts[2].replace(/-/g, '+').replace(/_/g, '/')),
        c => c.charCodeAt(0)
      );
      verified = await crypto.subtle.verify(
        'RSASSA-PKCS1-v1_5', cryptoKey,
        signature,
        new TextEncoder().encode(signingInput)
      );
      if (verified) break;
    } catch (e) { continue; }
  }

  if (!verified) {
    return { statusCode: 401, statusDescription: 'Unauthorized', body: '{"error":"invalid token signature"}' };
  }

  return request;
}
```

**KVS key format — JWK (JSON Web Key), RSA public key:**
```json
{
  "kty": "RSA",
  "alg": "RS256",
  "use": "sig",
  "n": "<base64url-encoded modulus>",
  "e": "AQAB"
}
```

The KVS stores two keys: `key_current` (active public key JWK string) and `key_previous` (previous public key JWK string, empty string when not rotating).

In Terraform, create the KVS with:
```hcl
resource "aws_cloudfront_key_value_store" "jwt" {
  name    = "${var.app_name}-${var.environment}-jwt-kvs"
  comment = "RS256 public key store for JWT edge validation"
}
```

Use `templatefile()` to inject the KVS ARN into the CF Function JavaScript.

### Lambda@Edge Geo-Router

File: `lambda_geo_router.js` + `lambda.tf`

**Runtime:** `nodejs20.x`. **Handler:** `index.handler`. Must be created in us-east-1.

Lambda@Edge IAM trust policy — must trust both `lambda.amazonaws.com` AND `edgelambda.amazonaws.com`:
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": ["lambda.amazonaws.com", "edgelambda.amazonaws.com"] },
    "Action": "sts:AssumeRole"
  }]
}
```

**Handler specification:**

```javascript
// Origin Request handler — modifies the origin based on viewer country
// Routing table is baked at deploy time via templatefile()
const ROUTING_TABLE = {
  // APAC
  "IN": "ap-south-1-alb-fqdn",
  "SG": "ap-south-1-alb-fqdn",
  "AU": "ap-south-1-alb-fqdn",
  "JP": "ap-south-1-alb-fqdn",
  // EU
  "GB": "eu-west-1-alb-fqdn",
  "DE": "eu-west-1-alb-fqdn",
  "FR": "eu-west-1-alb-fqdn",
  // AMER
  "US": "us-east-1-alb-fqdn",
  "CA": "us-east-1-alb-fqdn",
  "BR": "us-east-1-alb-fqdn",
};

const FALLBACK_HOST = "ap-south-1-alb-fqdn";   // primary region

exports.handler = async (event) => {
  const request = event.Records[0].cf.request;
  const country = request.headers['cloudfront-viewer-country']?.[0]?.value || '';
  const targetHost = ROUTING_TABLE[country] || FALLBACK_HOST;

  request.origin = {
    custom: {
      domainName: targetHost,
      port: 443,
      protocol: 'https',
      sslProtocols: ['TLSv1.2'],
      readTimeout: 30,
      keepaliveTimeout: 5,
      customHeaders: {},
      path: ''
    }
  };
  request.headers['host'] = [{ key: 'Host', value: targetHost }];

  return request;
};
```

In Terraform, read ALB FQDNs from SSM using `data "aws_ssm_parameter"` for each region in `var.enabled_regions` and pass them to `templatefile()` to bake the routing table. Use a `for_each` over `var.enabled_regions` for the SSM data sources. Build a local map `region_to_alb_fqdn` from the SSM values and pass to `templatefile`.

Lambda package: create via `data "archive_file"` from the rendered template file, stored in a local temp directory. Upload as `filename` on `aws_lambda_function`. Lambda@Edge requires `publish = true` and the CloudFront behaviour references `qualified_arn`.

### Route 53 Records — `infra-live-edge`

File: `route53.tf`

Two records per environment — an alias A record pointing the root domain and `www` subdomain to the CloudFront distribution:

```hcl
resource "aws_route53_record" "root" {
  zone_id = var.hosted_zone_id
  name    = var.environment == "prod" ? var.domain_name : "${var.environment}.${var.domain_name}"
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.main.domain_name
    zone_id                = aws_cloudfront_distribution.main.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "www" {
  zone_id = var.hosted_zone_id
  name    = var.environment == "prod" ? "www.${var.domain_name}" : "www.${var.environment}.${var.domain_name}"
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.main.domain_name
    zone_id                = aws_cloudfront_distribution.main.hosted_zone_id
    evaluate_target_health = false
  }
}
```

- `prod` uses the bare apex domain (`buddy360.com`, `www.buddy360.com`)
- `stg` and `dev` use environment-prefixed subdomains (`stg.buddy360.com`, `dev.buddy360.com`)
- `var.domain_name` and `var.hosted_zone_id` are injected as `TF_VAR_*` from GitHub Environment Secrets — do **not** put them in tfvars files

### SNS Topic — `infra-live-edge`

File: `sns.tf`

One SNS topic per environment for GuardDuty and CloudTrail findings from the edge (us-east-1) region:

```hcl
resource "aws_sns_topic" "alerts" {
  name = "${var.app_name}-${var.environment}-alerts"
}

resource "aws_sns_topic_subscription" "alerts_email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alerts_email
}
```

`guardduty.tf` and `cloudtrail.tf` in this module must reference `aws_sns_topic.alerts.arn` as the destination for findings and log metric alarms respectively.

`guardduty.tf` in this module must set `finding_publishing_frequency = var.environment == "prod" ? "FIFTEEN_MINUTES" : "SIX_HOURS"` — same rule as `infra-live-backend`.

### tfvars Files — `infra-live-edge`

File: `tfvars/dev.tfvars`
```hcl
environment    = "dev"
waf_count_mode = true
```

File: `tfvars/stg.tfvars`
```hcl
environment    = "stg"
waf_count_mode = true
```

File: `tfvars/prod.tfvars`
```hcl
environment    = "prod"
waf_count_mode = false
```

`waf_count_mode = true` in dev and stg deploys all managed WAF rules in COUNT mode — traffic is logged but never blocked. `waf_count_mode = false` in prod switches to BLOCK. The environment-sensitive secrets (`acm_certificate_arn`, `domain_name`, `hosted_zone_id`, `frontend_bucket_name`) are injected as `TF_VAR_*` from GitHub Environment Secrets at CI time and are **not** in tfvars files.

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
  region = "us-east-1"   # hardcoded — bucket and SSM are both in us-east-1
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

Bucket policy (`s3_policy.tf`):
```hcl
resource "aws_s3_bucket_policy" "frontend" {
  bucket = var.frontend_bucket_name

  lifecycle {
    precondition {
      condition     = data.aws_ssm_parameter.s3_bucket_name.value == var.frontend_bucket_name
      error_message = "frontend_bucket_name in tfvars (\"${var.frontend_bucket_name}\") does not match SSM value written by infra-live-edge (\"${data.aws_ssm_parameter.s3_bucket_name.value}\"). Update tfvars."
    }
  }

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "AllowCloudFrontOAC"
      Effect = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "arn:aws:s3:::${var.frontend_bucket_name}/*"
      Condition = {
        StringEquals = {
          "AWS:SourceArn" = data.aws_ssm_parameter.cloudfront_arn.value
        }
      }
    }]
  })
}
```

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
variable "app_name"          { type = string; default = "buddy360" }
variable "environment"       { type = string }
variable "atlas_org_id"      { type = string; description = "MongoDB Atlas organisation ID" }
variable "atlas_project_name" { type = string; default = "buddy360" }
variable "nat_eips"          { type = list(string); description = "NAT Gateway EIPs from backend regional stacks — whitelisted in Atlas" }
```

### Resources

```hcl
data "mongodbatlas_project" "main" {
  name = var.atlas_project_name
}

resource "mongodbatlas_advanced_cluster" "main" {
  project_id   = data.mongodbatlas_project.main.id
  name         = "${var.app_name}-${var.environment}"
  cluster_type = var.environment == "dev" ? "REPLICASET" : "GEOSHARDED"

  # Geo-sharded zones (stg and prod only)
  dynamic "replication_specs" {
    for_each = var.environment == "dev" ? [] : [
      { zone = "APAC",    region = "AP_SOUTH_1" },
      { zone = "EU",      region = "EU_WEST_1"  },
      { zone = "AMER",    region = "US_EAST_1"  },
    ]
    content {
      zone_name = replication_specs.value.zone
      region_configs {
        provider_name  = "AWS"
        region_name    = replication_specs.value.region
        priority       = 7
        electable_specs {
          instance_size = "M30"
          node_count    = 3
        }
      }
    }
  }

  # Dev: simple replica set
  dynamic "replication_specs" {
    for_each = var.environment == "dev" ? [1] : []
    content {
      region_configs {
        provider_name = "AWS"
        region_name   = "AP_SOUTH_1"
        priority      = 7
        electable_specs {
          instance_size = "M0"
          node_count    = 3
        }
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

Continuous backup and PITR:
```hcl
resource "mongodbatlas_cloud_backup_schedule" "main" {
  count      = var.environment != "dev" ? 1 : 0
  project_id = data.mongodbatlas_project.main.id
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
| `OPENAI_MODEL` | OpenAI model name (required) |
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_MODEL` | Anthropic model name (optional) |
| `ANTHROPIC_API_KEY` | Anthropic API key (optional) |
| `GEMINI_MODEL` | Gemini model name (optional) |
| `GEMINI_API_KEY` | Gemini API key (optional) |
| `CLOUDFRONT_DISTRIBUTION_ID` | CloudFront distribution ID (for frontend deploy) |
| `ECR_REGISTRY` | ECR registry URI (e.g. `123456789.dkr.ecr.ap-south-1.amazonaws.com`) |

---

### Workflow: `terraform-live-backend.yml`

```yaml
name: Terraform Live Backend
run-name: Terraform Live Backend (${{ inputs.action }}, ${{ inputs.environment }}, ${{ inputs.aws_region }})

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
      aws_region:
        required: true
        default: ap-south-1
        type: choice
        options: [ap-south-1]
  workflow_call:
    inputs:
      action:    { type: string, required: true }
      environment: { type: string, required: true }
      aws_region:  { type: string, required: true }
```

**Env block:**
```yaml
env:
  FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: "true"
  TF_VERSION: "1.13.0"
  TF_VAR_aws_region:   ${{ inputs.aws_region }}
  TF_VAR_environment:  ${{ inputs.environment }}
```

**Job env block** (resolved from GitHub Environment Secrets):
```yaml
TF_VAR_subdomain_internal: ${{ secrets.SUBDOMAIN_INTERNAL }}
TF_VAR_domain_name:        ${{ secrets.DOMAIN_NAME }}
TF_VAR_hosted_zone_id:     ${{ secrets.HOSTED_ZONE_ID }}
TF_VAR_cors_origins:       ${{ secrets.CORS_ORIGINS }}
TF_VAR_cookie_domain:      ${{ secrets.COOKIE_DOMAIN }}
```

**Steps in order:**

1. Checkout `actions/checkout@v4`
2. Validate required secrets (bash: check all listed secrets are non-empty; fail with clear message listing missing names)
3. Configure AWS credentials: `aws-actions/configure-aws-credentials@v4` with `role-to-assume: ${{ secrets.ROLE_ARN }}`
4. Resolve ACM certificate ARN (case statement on `inputs.aws_region` → `echo "TF_VAR_acm_certificate_arn=..." >> $GITHUB_ENV`)
5. Resolve optional model overrides (OPENAI_MODEL required, ANTHROPIC_MODEL / GEMINI_MODEL optional → export as TF_VAR_* when non-empty)
6. Setup Terraform: `hashicorp/setup-terraform@v3` with `terraform_version: ${{ env.TF_VERSION }}`
7. Terraform init: `-backend-config="bucket=${{ secrets.STATE_BUCKET }}"` and `-backend-config="key=terraform-state-files/${{ secrets.APP_NAME }}/${{ inputs.environment }}/backend/${{ inputs.aws_region }}/terraform.tfstate"`
8. Terraform fmt check
9. Terraform validate
10. Terraform plan (if action == plan or apply): `-out=tfplan.bin -input=false -no-color -var-file=tfvars/${{ inputs.environment }}.tfvars`
11. Show plan summary → `$GITHUB_STEP_SUMMARY`
12. Upload plan artefact: `actions/upload-artifact@v4`, retention 7 days
13. Terraform apply (if action == apply): `terraform apply -auto-approve tfplan.bin`
14. **Initialise app secrets (first apply only):** Read current secret value; if `JWT_PRIVATE_KEY == "REPLACE_ME"`, write all secret keys (JWT_PRIVATE_KEY, GOOGLE_CLIENT_ID, OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, MONGODB_URI, REDIS_AUTH_TOKEN) using `aws secretsmanager put-secret-value`. Skip if already initialised. Note: the check key is `JWT_PRIVATE_KEY`, not `JWT_SECRET`.
15. Terraform plan-destroy (if action == plan-destroy or destroy)
16. Show destroy plan summary
17. Upload destroy plan artefact
18. Terraform destroy (if action == destroy)

**Concurrency:** `group: terraform-live-backend-buddy360-${{ inputs.environment }}-${{ inputs.aws_region }}`, `cancel-in-progress: false`

**permissions:** `id-token: write`, `contents: read`

---

### Workflow: `terraform-live-edge.yml`

Mirror the structure of `terraform-live-backend.yml` with these differences:

- `run-name: Terraform Live Edge (${{ inputs.action }}, ${{ inputs.environment }})`
- No `aws_region` input — edge is always us-east-1 (hardcoded in provider.tf)
- **Both `workflow_dispatch` and `workflow_call` triggers are required** (the full-stack orchestrator calls this workflow via `uses:`):
  ```yaml
  workflow_call:
    inputs:
      action:      { type: string, required: true }
      environment: { type: string, required: true }
  ```
- `working-directory: infra-live-edge/terraform`
- State key: `terraform-state-files/${{ secrets.APP_NAME }}/${{ inputs.environment }}/edge/us-east-1/terraform.tfstate`
- Additional GitHub environment secret injected as TF_VAR: `TF_VAR_acm_certificate_arn: ${{ secrets.ACM_CERTIFICATE_ARN_US_EAST_1 }}` and `TF_VAR_frontend_bucket_name: ${{ secrets.FRONTEND_BUCKET_NAME }}`
- No Secrets Manager initialisation step
- Concurrency group: `terraform-live-edge-buddy360-${{ inputs.environment }}`

---

### Workflow: `terraform-live-frontend.yml`

- `run-name: Terraform Live Frontend (${{ inputs.action }}, ${{ inputs.environment }})`
- **Both `workflow_dispatch` and `workflow_call` triggers are required** (the full-stack orchestrator calls this workflow via `uses:`):
  ```yaml
  workflow_call:
    inputs:
      action:      { type: string, required: true }
      environment: { type: string, required: true }
  ```
- `working-directory: infra-live-frontend/terraform`
- State key: `terraform-state-files/${{ secrets.APP_NAME }}/${{ inputs.environment }}/frontend/us-east-1/terraform.tfstate`
- Only needs: `TF_VAR_frontend_bucket_name: ${{ secrets.FRONTEND_BUCKET_NAME }}`
- Must document in workflow comments: "Run after terraform-live-edge; requires edge/cloudfront_arn and edge/s3_bucket_name in SSM"
- Concurrency group: `terraform-live-frontend-buddy360-${{ inputs.environment }}`

---

### Workflow: `deploy-live-backend.yml`

```yaml
name: Deploy Live Backend
on:
  workflow_dispatch:
    inputs:
      environment: { required: true, default: dev, type: choice, options: [dev, stg, prod] }
      aws_region:  { required: true, default: ap-south-1, type: choice, options: [ap-south-1] }
      image_tag:   { required: false, default: "", description: "Leave empty to use commit SHA" }
  workflow_call:
    inputs:
      environment: { type: string, required: true }
      aws_region:  { type: string, required: true }
      image_tag:   { type: string, required: false, default: "" }
  push:
    branches: [main]
    paths: ["backend/**"]
```

**On push to main:** deploy to `dev` and `stg` only. Use a job condition: `if: github.event_name == 'push' && (inputs.environment == 'dev' || inputs.environment == 'stg') || github.event_name == 'workflow_dispatch'`. Prod always requires `workflow_dispatch` with GitHub Environment Required Reviewer protection.

**Steps in order:**

1. Checkout
2. Configure AWS credentials (OIDC, `role-to-assume: ${{ secrets.ROLE_ARN }}`)
3. Set image tag: `IMAGE_TAG=${{ inputs.image_tag || github.sha }}`
4. Build Docker image locally: `docker build -t $IMAGE_URI:$IMAGE_TAG ./backend`
5. **Pre-push Trivy scan:**
   ```bash
   docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
     aquasec/trivy:latest image --exit-code 1 --severity HIGH,CRITICAL \
     --ignore-unfixed $IMAGE_URI:$IMAGE_TAG
   ```
   This step must fail the job on any HIGH or CRITICAL CVE finding before push.
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
2. Setup Node.js (use `actions/setup-node@v4` with `node-version: '20'`)
3. Install dependencies: `npm ci` in `./frontend`
4. Build: `npm run build` in `./frontend` (output: `./frontend/dist`)
5. Configure AWS credentials (OIDC)
6. Sync to S3:
   ```bash
   aws s3 sync ./frontend/dist s3://${{ secrets.FRONTEND_BUCKET_NAME }} \
     --delete \
     --cache-control "public,max-age=31536000,immutable"  # for hashed assets
   # Set shorter cache on index.html separately:
   aws s3 cp ./frontend/dist/index.html s3://${{ secrets.FRONTEND_BUCKET_NAME }}/index.html \
     --cache-control "no-cache,no-store,must-revalidate"
   ```
7. **CloudFront cache invalidation (required — must be last step):**
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
      environment: { required: true, default: dev,  type: choice, options: [dev, stg, prod] }
      aws_region:  { required: true, default: ap-south-1, type: choice, options: [ap-south-1] }

jobs:
  backend:
    uses: ./.github/workflows/terraform-live-backend.yml
    with:
      action:      ${{ inputs.action }}
      environment: ${{ inputs.environment }}
      aws_region:  ${{ inputs.aws_region }}
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
      aws_region:  ${{ inputs.aws_region }}
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
      aws_region:  ${{ inputs.aws_region }}
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
  alarms.tf
  dashboard.tf
  sns.tf
  s3_logs.tf
  ssm_output.tf      ← writes /{app}/{env}/alb-fqdn to SSM after apply
  route53.tf         ← CNAME record: subdomain_internal → ALB DNS name
  tfvars/dev.tfvars
  tfvars/stg.tfvars
  tfvars/prod.tfvars

infra-live-edge/terraform/
  provider.tf
  variables.tf
  outputs.tf
  waf.tf
  cloudfront.tf
  cloudfront_function.js
  lambda.tf
  lambda_geo_router.js
  s3_frontend.tf     ← aws_s3_bucket + versioning + encryption + lifecycle + public access block
  s3_logs_global.tf
  route53.tf
  ssm_alb_reads.tf   ← data sources for ALB FQDNs from SSM
  ssm_outputs.tf     ← writes cloudfront_arn and s3_bucket_name to SSM
  guardduty.tf
  cloudtrail.tf
  sns.tf
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
  cluster.tf
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
3. Lambda@Edge IAM trust policy **must** include both `lambda.amazonaws.com` and `edgelambda.amazonaws.com`
4. Lambda@Edge function **must** have `publish = true`; CloudFront behaviour references `qualified_arn`
5. ACM certificate for CloudFront **must** be in `us-east-1` regardless of backend region; regional ALB certs must be in the same region as the ALB
6. CloudFront WebACL scope **must** be `CLOUDFRONT` — it is created in us-east-1 with `provider = aws.us_east_1`
7. The auth rate rule (100 req/5min) **must** have a lower WAF priority number than the global rate rule (2000 req/5min) — lower number = evaluated first
8. `desired_count` on `aws_ecs_service` **must** be in `lifecycle { ignore_changes = [desired_count] }` — Auto Scaling manages it
9. `deployment_circuit_breaker { enable = true, rollback = true }` on **all** ECS services across all environments
10. `ordered_placement_strategy { type = "spread", field = "attribute:ecs.availability-zone" }` on all ECS services
11. `use_lockfile = true` in the S3 backend block in all three Terraform modules
12. `required_version = "~> 1.13.0"` in all modules
13. Secrets Manager secret key is `JWT_PRIVATE_KEY` (RSA PEM), not `JWT_SECRET`
14. KVS key format is a JWK JSON string (`{ "kty": "RSA", "alg": "RS256", "use": "sig", "n": "...", "e": "AQAB" }`) — not a raw PEM
15. JWT is extracted from the `Authorization: Bearer <token>` header, not a cookie
16. `enable_key_rotation = true` on all KMS CMKs (CloudTrail, state bucket)
17. All four S3 public-access block flags must be `true` on all buckets (logging, frontend, state)
18. `cancel-in-progress: false` on all GitHub Actions concurrency groups — queue, never cancel
19. Prod `deploy-live-backend` and `deploy-live-frontend` must only run via `workflow_dispatch` (never via push-to-main trigger) — prod GitHub Environment Required Reviewer protection enforces the four-eyes principle
20. Pre-push Trivy scan must run **before** `docker push` and must fail the job on HIGH or CRITICAL findings
21. CloudFront cache invalidation (`aws cloudfront create-invalidation --paths "/*"`) must be the **last step** of every frontend deploy
22. `health_check_grace_period_seconds = 60` on all ECS services — FastAPI startup (model loading, DB pool init) typically takes 10–30 s
23. `aws_cloudwatch_dashboard` must be generated in `dashboard.tf` in `infra-live-backend` with exactly 8 widgets: ECS CPU, ECS memory, ALB 5XX, ALB 4XX, ALB request count, ALB healthy host count, ElastiCache current connections, ElastiCache CPU — all using `jsonencode()` in the `dashboard_body` argument
24. `"stopTimeout": 60` must be set on the main backend container definition — this matches `deregistration_delay = 60` on the ALB target group and gives ECS 60 s to drain in-flight requests before SIGKILL
25. `waf_count_mode = true` must be explicitly set in `infra-live-edge/terraform/tfvars/dev.tfvars` and `tfvars/stg.tfvars`; `waf_count_mode = false` must be explicit in `tfvars/prod.tfvars` — never rely on the default
26. Every deploy workflow (`deploy-live-backend.yml`, `deploy-live-frontend.yml`) and every Terraform workflow (`terraform-live-edge.yml`, `terraform-live-frontend.yml`) must have a `workflow_call` trigger in addition to `workflow_dispatch` — the full-stack orchestrator (`terraform-live-full-stack.yml`) uses `uses:` to call them
27. `variable "alerts_email"` must be declared in `infra-live-backend/terraform/variables.tf` and used as the subscription endpoint for the `aws_sns_topic_subscription` in `sns.tf`
28. `infra-live-edge` must also declare `variable "alerts_email"` and generate `sns.tf` with one SNS topic (`{app}-{env}-alerts`) and one email subscription — `guardduty.tf` and `cloudtrail.tf` in the edge module must reference this topic ARN for findings
29. `route53.tf` in `infra-live-edge` must create two alias A records pointing to the CloudFront distribution: the apex domain for prod (`{domain_name}`) and an environment-prefixed subdomain for dev/stg (`{environment}.{domain_name}`); the `www` variant of each must also be created
30. `route53.tf` in `infra-live-backend` must create a CNAME record for `var.subdomain_internal` (e.g. `api.dev.buddy360.com`) pointing to `aws_lb.main.dns_name` — one record per deployed region
31. `aws_guardduty_detector.finding_publishing_frequency` must be `"FIFTEEN_MINUTES"` for prod and `"SIX_HOURS"` for dev/stg in both `infra-live-backend/guardduty.tf` and `infra-live-edge/guardduty.tf`
