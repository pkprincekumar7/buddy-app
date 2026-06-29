variable "aws_region" {
  description = "AWS region to deploy resources"
  type        = string

  # Multi-region expansion checklist — do all of the following for each new region:
  #   1. Provision an ACM certificate in the new region covering the internal ALB
  #      subdomain (e.g. buddy-internal-<env>.<domain>) and add it as a GitHub
  #      environment secret: ACM_CERTIFICATE_ARN_<REGION_UPPER_SNAKE>.
  #   2. Add a case entry to the "Resolve ACM certificate ARN for backend region"
  #      step in .github/workflows/terraform-live-backend.yml.
  #   3. Add the new region as a choice in the aws_region workflow_dispatch input
  #      in terraform-live-backend.yml and terraform-live-all.yml.
  #   4. Remove or relax the validation below once a second region is active.
  #   5. Update infra-live-edge/terraform/variables.tf similarly — the edge module
  #      must read the ALB FQDN for whichever backend_region is being targeted.
  validation {
    condition     = var.aws_region == "ap-south-1"
    error_message = "aws_region must be ap-south-1 (only active region; see expansion checklist in variable description)."
  }
}

variable "app_name" {
  description = "Application name used for resource naming and tagging"
  type        = string
}

variable "environment" {
  description = "Deployment environment (dev, sbx, stg, prod)"
  type        = string

  validation {
    condition     = contains(["dev", "sbx", "stg", "prod"], var.environment)
    error_message = "environment must be one of: dev, sbx, stg, prod."
  }
}

# -- Networking ---------------------------------------------------------------

variable "vpc_cidr" {
  description = "CIDR block for the backend VPC"
  type        = string
}

variable "public_subnet_1_cidr" {
  description = "CIDR for public subnet AZ-1 (ALB, NAT Gateway)"
  type        = string
}

variable "public_subnet_2_cidr" {
  description = "CIDR for public subnet AZ-2 (ALB, NAT Gateway)"
  type        = string
}

variable "public_subnet_3_cidr" {
  description = "CIDR for public subnet AZ-3 (ALB, NAT Gateway)"
  type        = string
}

variable "private_subnet_1_cidr" {
  description = "CIDR for private subnet AZ-1 (ECS tasks, ElastiCache, VPC endpoints)"
  type        = string
}

variable "private_subnet_2_cidr" {
  description = "CIDR for private subnet AZ-2 (ECS tasks, ElastiCache, VPC endpoints)"
  type        = string
}

variable "private_subnet_3_cidr" {
  description = "CIDR for private subnet AZ-3 (ECS tasks, ElastiCache, VPC endpoints)"
  type        = string
}

variable "nat_gateway_count" {
  description = "Number of NAT Gateways to provision (1 for dev/sbx, 2 for stg, 3 for prod). Each NAT GW is placed in a distinct public subnet AZ. Private subnets without a dedicated NAT GW share the nearest one."
  type        = number

  validation {
    condition     = contains([1, 2, 3], var.nat_gateway_count)
    error_message = "nat_gateway_count must be 1, 2, or 3."
  }
}

variable "redis_auth_token" {
  description = "AUTH token for ElastiCache Redis. Must be 16–128 printable ASCII chars (no spaces, quotes, @, or /). Injected via TF_VAR_redis_auth_token from GitHub Environment Secrets."
  type        = string
  sensitive   = true
}

variable "elasticache_replica_count" {
  description = "Number of replica nodes (0 = primary only; 1 = primary + 1 replica; 2 = primary + 2 replicas). dev/sbx/stg: 0, prod: 2."
  type        = number

  validation {
    condition     = contains([0, 1, 2], var.elasticache_replica_count)
    error_message = "elasticache_replica_count must be 0, 1, or 2."
  }
}

variable "elasticache_multi_az" {
  description = "Enable automatic failover and multi-AZ. Must be false when elasticache_replica_count = 0. dev/sbx/stg: false, prod: true."
  type        = bool
}

# -- DNS / TLS ----------------------------------------------------------------

variable "subdomain_internal" {
  description = "Internal subdomain prefix for the ALB (e.g. 'buddy-internal' → buddy-internal-dev.learning-dev.com in dev)"
  type        = string
}

variable "domain_name" {
  description = "Root domain name (e.g. learning-dev.com)"
  type        = string
}

variable "hosted_zone_id" {
  description = "Route 53 hosted zone ID for the domain"
  type        = string
}

variable "acm_certificate_arn" {
  description = "ACM certificate ARN in the backend region covering the internal ALB subdomain"
  type        = string
}

# -- S3 -----------------------------------------------------------------------

variable "assets_bucket_name" {
  description = "Pre-existing S3 bucket name for backend application use (us-east-1, shared across regions)"
  type        = string
}

# -- Database ------------------------------------------------------------------

variable "mongodb_db_name" {
  description = "MongoDB database name (passed to backend as MONGODB_DB_NAME); include the environment suffix, e.g. buddy360-dev"
  type        = string
}

# -- ElastiCache ---------------------------------------------------------------

variable "elasticache_node_type" {
  description = "ElastiCache node type"
  type        = string
}

# -- ECS / Fargate -------------------------------------------------------------

variable "task_cpu" {
  description = "Fargate task CPU units (256 = 0.25 vCPU, 512 = 0.5 vCPU, 1024 = 1 vCPU)"
  type        = number
}

variable "task_memory" {
  description = "Fargate task memory in MiB"
  type        = number
}

variable "desired_count" {
  description = "Number of ECS tasks to run"
  type        = number
}

variable "enable_execute_command" {
  description = "Enable ECS Exec (aws ecs execute-command) for live container debugging. Disable in prod."
  type        = bool
}

# -- Application settings ------------------------------------------------------

variable "openai_model" {
  description = "OpenAI model identifier (gpt-5.4-mini is a valid, tested model identifier — not a typo)"
  type        = string
}

variable "anthropic_model" {
  type = string
}

variable "gemini_model" {
  type = string
}

variable "llm_timeout_seconds" {
  type = number
}

variable "llm_hourly_limit" {
  type = number
}

variable "default_region" {
  type = string
}

variable "default_location" {
  description = "Default MongoDB location shard for users without an explicit location in their JWT (e.g. \"us\", \"eu\")"
  type        = string
  default     = "us"
}

variable "cors_origins" {
  description = "Allowed CORS origins for the backend API (comma-separated list of URLs)"
  type        = string
}

variable "jwt_key_id" {
  description = "JWT key ID (kid header claim) — must match the key label in the CloudFront Function PUBLIC_KEYS map. Update during key rotation."
  type        = string
  default     = "key-v1"
}

variable "cookie_domain" {
  description = "Cookie domain for session cookies (public CloudFront FQDN, derived in workflow)"
  type        = string
}

# -- Worker ECS ---------------------------------------------------------------

variable "worker_task_cpu" {
  description = "Fargate task CPU units for the worker service"
  type        = number
  default     = 512
}

variable "worker_task_memory" {
  description = "Fargate task memory in MiB for the worker service"
  type        = number
  default     = 1024
}

variable "worker_desired_count" {
  description = "Initial desired count for the worker ECS service (managed by autoscaling after first deploy)"
  type        = number
  default     = 1
}

variable "worker_concurrency" {
  description = "Number of parallel LLM job slots per worker task (WORKER_CONCURRENCY env var)"
  type        = number
  default     = 5
}

variable "worker_poll_interval_seconds" {
  description = "Idle poll interval in seconds for the worker (WORKER_POLL_INTERVAL_SECONDS env var)"
  type        = number
  default     = 2
}

# -- Autoscaling ---------------------------------------------------------------

variable "api_min_capacity" {
  description = "Minimum ECS task count for the API service autoscaling target"
  type        = number
  default     = 1
}

variable "api_max_capacity" {
  description = "Maximum ECS task count for the API service autoscaling target"
  type        = number
  default     = 10
}

variable "worker_min_capacity" {
  description = "Minimum ECS task count for the worker service autoscaling target"
  type        = number
  default     = 1
}

variable "worker_max_capacity" {
  description = "Maximum ECS task count for the worker service autoscaling target"
  type        = number
  default     = 5
}

# -- S3 (managed externally — Terraform configures, does not create) ----------

variable "uploads_bucket_name" {
  description = "Pre-existing S3 bucket for user uploads (ap-south-1); Terraform manages CORS, lifecycle, and IAM only"
  type        = string
}

variable "regional_logging_bucket_name" {
  description = "Pre-existing S3 logging bucket in ap-south-1 (ALB access logs, CloudTrail ap-south-1). Must be non-empty when enable_cloudtrail = true."
  type        = string
  default     = ""

  validation {
    condition     = !var.enable_cloudtrail || length(var.regional_logging_bucket_name) > 0
    error_message = "regional_logging_bucket_name must be set when enable_cloudtrail = true."
  }
}

# -- Observability -------------------------------------------------------------

variable "log_retention_days" {
  description = "CloudWatch log retention in days. 7 = dev/sbx, 30 = stg, 90 = prod."
  type        = number
  default     = 90
}

variable "ops_email" {
  description = "Operator email address for CloudWatch alarm SNS notifications. Must be non-empty when enable_ops_email = true."
  type        = string
  default     = ""

  validation {
    condition     = !var.enable_ops_email || length(var.ops_email) > 0
    error_message = "ops_email must be set when enable_ops_email = true."
  }
}

variable "enable_ops_email" {
  description = "Create an SNS email subscription for CloudWatch alarm notifications. Set per environment in tfvars."
  type        = bool
  default     = false
}

variable "enable_basic_alarms" {
  description = "Create ALB HealthyHostCount and 5XX alerting alarms. true on stg and prod, false on dev/sbx."
  type        = bool
  default     = false
}

variable "enable_all_alarms" {
  description = "Create full set of ECS, Redis, and ALB alerting alarms (superset of enable_basic_alarms). true only on prod."
  type        = bool
  default     = false
}

variable "enable_dashboard" {
  description = "Create CloudWatch dashboard. true on prod, optional on stg, false on dev/sbx."
  type        = bool
  default     = false
}

variable "enable_xray_error_rule" {
  description = "Add a second X-Ray sampling rule that captures 100%% of error traces. true only on prod."
  type        = bool
  default     = false
}

variable "xray_default_sampling_rate" {
  description = "Fixed sampling rate for the default X-Ray rule. 0.05 (5%%) for dev/sbx/stg, 0.01 (1%%) for prod."
  type        = number
  default     = 0.05
}

# -- Security ------------------------------------------------------------------

variable "enable_guardduty" {
  description = "Provision GuardDuty detector with ECS Runtime Monitoring in ap-south-1. false on dev/sbx, true on stg/prod."
  type        = bool
  default     = true
}

variable "enable_cloudtrail" {
  description = "Provision CloudTrail regional trail in ap-south-1. false on dev/sbx, true on stg/prod."
  type        = bool
  default     = true
}

# -- ADOT sidecar --------------------------------------------------------------

variable "enable_adot_sidecar" {
  description = "Attach the ADOT collector sidecar to API and worker task definitions for X-Ray tracing. Optional on dev/sbx (omit to save cost), required on stg/prod."
  type        = bool
  default     = true
}

