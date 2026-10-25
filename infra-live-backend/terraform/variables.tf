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
  description = "Number of replica nodes (0 = primary only; 1 = primary + 1 replica; 2 = primary + 2 replicas). dev/sbx/stg: 0, prod: 1."
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

# -- ElastiCache ---------------------------------------------------------------

variable "elasticache_node_type" {
  description = "ElastiCache (Valkey) node type. dev/sbx: cache.t4g.micro, stg: cache.t4g.small, prod: cache.t4g.medium."
  type        = string
}

# -- ECS / Fargate -------------------------------------------------------------

variable "runtime_sizes" {
  description = <<-EOT
    Task size and count per runtime tier (docs/auth-users-split.md, 15.3). Every
    runtime in services.tf uses one tier:
      http              — the HTTP services except auth (users, children, the circles, platform)
      auth              — auth's HTTP service (bcrypt makes it CPU-bound)
      worker            — auth, users, children and onboarding workers
      generating-worker — discover, grow, transform and release workers (LLM jobs)
      collector         — the OpenTelemetry collector
    desired_count is the initial count (deploys and autoscaling own it after);
    min_capacity / max_capacity bound autoscaling.
  EOT
  type = map(object({
    cpu           = number
    memory        = number
    desired_count = number
    min_capacity  = number
    max_capacity  = number
  }))

  validation {
    condition     = length(setsubtract(["http", "auth", "worker", "generating-worker", "collector"], keys(var.runtime_sizes))) == 0
    error_message = "runtime_sizes needs every tier: http, auth, worker, generating-worker, collector."
  }
  validation {
    condition = alltrue([
      for t in values(var.runtime_sizes) : t.min_capacity >= 1 && t.min_capacity <= t.desired_count && t.desired_count <= t.max_capacity
    ])
    error_message = "Each tier needs 1 <= min_capacity <= desired_count <= max_capacity (a consumer always keeps one task polling, 15.5)."
  }
}

variable "otel_collector_image" {
  description = "The OpenTelemetry collector's image (AWS Distro for OpenTelemetry), pinned. It reads its configuration from AOT_CONFIG_CONTENT (otel_collector.tf)."
  type        = string
  default     = "public.ecr.aws/aws-observability/aws-otel-collector:v0.40.0"
}

variable "mongodb_max_pool_size" {
  description = "MongoDB connections per task (MONGODB_MAX_POOL_SIZE). Atlas M0 (dev, sbx, stg) allows 500 connections per cluster across every task: 5 keeps a busy environment inside it (15.3)."
  type        = number
  default     = 5
}

variable "service_token_key_versions" {
  description = "Service-token key version per service (default 1): bump one to rotate that service's Ed25519 key pair and kid (service_tokens.tf)."
  type        = map(number)
  default     = {}
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
  description = "Map of JWT key ID → RSA public key PEM, from the same JWT_PUBLIC_KEYS GitHub Environment Secret the edge uses (APP-02). The API service (APP_COMPONENT=api) has no private key and verifies tokens with these keys ONLY, so it must include jwt_key_id's key; outgoing keys stay listed during a rotation. Public keys only — not a secret."
  type        = map(string)

  validation {
    condition     = contains(keys(var.jwt_public_keys), var.jwt_key_id)
    error_message = "jwt_public_keys (the JWT_PUBLIC_KEYS secret) must contain the current signing key, jwt_key_id — the API service verifies with these keys only. See docs/jwt-keys.md."
  }
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

variable "xray_default_sampling_rate" {
  description = "Share of ordinary traces the OpenTelemetry collector keeps (tail sampling, otel_collector.tf); every error and slow trace is kept regardless. 0.05 (5%%) for dev/sbx/stg, 0.01 (1%%) for prod."
  type        = number
  default     = 0.05
}

variable "enable_container_insights" {
  description = "Turn on ECS Container Insights for the backend cluster (task-level CPU/memory/network/storage, task counts, performance log events). It costs $0.30 per metric per month, and a cluster publishes about 12 + 25 × (number of services) metrics. Nothing in this stack depends on it: autoscaling, alarms and the dashboard use the free AWS/ECS and AWS/ApplicationELB metrics. prod: true; dev/sbx/stg: false."
  type        = bool
  default     = true
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

