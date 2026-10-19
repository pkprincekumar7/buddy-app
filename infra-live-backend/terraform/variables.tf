variable "aws_region" {
  description = "AWS region to deploy resources. This module is applied once per region as an independent stack (its state key already includes {region} — see provider.tf); each region needs its own ACM cert, uploads bucket, and logging bucket, resolved via GitHub Environment Secrets in terraform-live-backend.yml."
  type        = string

  validation {
    condition     = contains(["ap-south-1", "eu-west-1", "us-east-1"], var.aws_region)
    error_message = "aws_region must be one of: ap-south-1, eu-west-1, us-east-1."
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

# One /16 per (environment, region), so any two backend VPCs can later be
# peered or joined by a Transit Gateway — e.g. eu-west-1/us-east-1 reaching
# the ap-south-1 Atlas cluster privately (DEC-01 = B), or an Atlas Global
# Cluster (DB-01 Stage 2). Identical CIDRs would rule that out, and changing a
# VPC or subnet CIDR later replaces everything inside it (NET-01).
#
# Every environment lists all supported regions, deployed or not, so each
# region's block is reserved up front. Plan (10.<env base + region index>):
#   dev 10.2-4, stg 10.12-14, prod 10.22-24, sbx 10.32-34 — ap-south-1 first.
# Keep the Atlas project CIDR outside 10.0.0.0/8 (e.g. 192.168.248.0/21).
# Subnets are derived from the block in vpc.tf; they aren't configurable.
variable "vpc_cidrs" {
  description = "Backend VPC CIDR per AWS region, for this environment — a /16 per region, unique across regions (and, by the plan above, across environments). The VPC uses the entry for aws_region; subnets are derived from it with cidrsubnet() in vpc.tf."
  type        = map(string)

  validation {
    condition     = contains(keys(var.vpc_cidrs), var.aws_region)
    error_message = "vpc_cidrs has no entry for aws_region — add this region's /16 to tfvars/<env>.tfvars."
  }

  validation {
    condition     = alltrue([for r in keys(var.vpc_cidrs) : contains(["ap-south-1", "eu-west-1", "us-east-1"], r)])
    error_message = "vpc_cidrs keys may only be: ap-south-1, eu-west-1, us-east-1."
  }

  validation {
    condition = alltrue([
      for c in values(var.vpc_cidrs) :
      can(cidrnetmask(c)) && endswith(c, "/16") && can(cidrsubnet(c, 0, 0)) && cidrsubnet(c, 0, 0) == c && startswith(c, "10.")
    ])
    error_message = "Every vpc_cidrs value must be a 10.x.0.0/16 network address (e.g. \"10.22.0.0/16\") — the subnet layout in vpc.tf assumes a /16, and 10.0.0.0/8 keeps it clear of the Atlas CIDR."
  }

  validation {
    condition     = length(distinct(values(var.vpc_cidrs))) == length(var.vpc_cidrs)
    error_message = "vpc_cidrs values must be unique — two regions with the same CIDR can never be peered (NET-01)."
  }
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

variable "origin_verify_secret" {
  description = "Shared secret CloudFront attaches as the X-Origin-Verify header on every request to this ALB (see infra-live-edge's alb-backend origin custom_header). The listener rule in alb.tf rejects any request missing or mismatching it with a fixed 403, so traffic that reaches this ALB via the shared AWS CloudFront IP range but did not pass through this app's own CloudFront distribution — and therefore never hit the Lambda@Edge JWT check — is rejected before reaching ECS. Must equal infra-live-edge's origin_verify_secret; both are set from the same ORIGIN_VERIFY_SECRET GitHub Environment Secret. Rotate with origin_verify_secret_next below — see docs/infra-operations.md \"Rotating the origin-verify secret\"."
  type        = string
  sensitive   = true
}

variable "origin_verify_secret_next" {
  description = "Incoming X-Origin-Verify value during a rotation, from the optional ORIGIN_VERIFY_SECRET_NEXT GitHub Environment Secret. When set, the ALB listener rule accepts BOTH it and origin_verify_secret (http_header values are OR-matched), so CloudFront can switch to it with zero 403s. Empty (the default) outside a rotation. See docs/infra-operations.md \"Rotating the origin-verify secret\"."
  type        = string
  sensitive   = true
  default     = ""
  nullable    = false
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
  description = "Internal subdomain prefix for the ALB (e.g. 'superpower-internal' → superpower-internal-dev-ap-south-1.learning-dev.com in dev/ap-south-1)"
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
  description = "MongoDB database name (passed to backend as MONGODB_DB_NAME); include the environment suffix, e.g. superpower-dev"
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

variable "cors_origins" {
  description = "Allowed CORS origins for the backend API (comma-separated list of URLs)"
  type        = string
}

variable "jwt_key_id" {
  description = "JWT key ID (kid header claim) the backend signs with — must be a key in the JWT_PUBLIC_KEYS map that both the Lambda@Edge validator and the backend verify against. Update during key rotation."
  type        = string
  default     = "key-v1"
}

variable "jwt_public_keys" {
  description = "Map of JWT key ID → RSA public key PEM the backend verifies tokens against, from the same JWT_PUBLIC_KEYS GitHub Environment Secret the edge uses (APP-02). Lets tokens signed with an outgoing key keep validating during a rotation. Empty (the default) = only the current signing key. Public keys only — not a secret."
  type        = map(string)
  default     = {}
}

# -- Photo URLs (EDGE-05) -------------------------------------------------------

variable "uploads_url_ttl_seconds" {
  description = "How long an S3 presigned GET URL for a photo stays valid (seconds). Also bounds how long a deleted photo stays reachable through an already-issued URL. A URL can end sooner if the task role's temporary credentials expire first."
  type        = number
  default     = 3600

  validation {
    condition     = var.uploads_url_ttl_seconds >= 300 && var.uploads_url_ttl_seconds <= 86400
    error_message = "uploads_url_ttl_seconds must be between 300 (5 min) and 86400 (24 h)."
  }
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
  description = "Pre-existing S3 bucket for user uploads (backend region); Terraform manages CORS, lifecycle, and IAM only"
  type        = string
}

variable "regional_logging_bucket_name" {
  description = "Pre-existing S3 logging bucket in this backend region (ALB access logs, regional CloudTrail — both write to this one bucket). Must be non-empty when enable_cloudtrail = true or enable_alb_access_logs = true."
  type        = string
  default     = ""

  validation {
    condition     = !(var.enable_cloudtrail || var.enable_alb_access_logs) || length(var.regional_logging_bucket_name) > 0
    error_message = "regional_logging_bucket_name must be set when enable_cloudtrail = true or enable_alb_access_logs = true."
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
  description = "Provision GuardDuty detector with ECS Runtime Monitoring in this backend region. false on dev/sbx, true on stg/prod."
  type        = bool
  default     = true
}

variable "enable_cloudtrail" {
  description = "Provision CloudTrail regional trail in this backend region. false on dev/sbx, true on stg/prod."
  type        = bool
  default     = true
}

variable "enable_alb_access_logs" {
  description = "Enable ALB access logs to regional_logging_bucket_name (see alb.tf's access_logs block). Independent of enable_cloudtrail — both happen to be set the same way per environment today (false on dev/sbx, true on stg/prod), but either can be flipped on its own without affecting the other. Both share the same bucket/policy resource (see s3.tf), so either flag being true is enough to create the policy."
  type        = bool
  default     = false
}

# -- ADOT sidecar --------------------------------------------------------------

variable "enable_adot_sidecar" {
  description = "Attach the ADOT collector sidecar to API and worker task definitions for X-Ray tracing. Optional on dev/sbx (omit to save cost), required on stg/prod."
  type        = bool
  default     = true
}

