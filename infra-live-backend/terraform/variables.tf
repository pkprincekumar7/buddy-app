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
  description = "CIDR for public subnet AZ-1 (ALB and ECS tasks)"
  type        = string
}

variable "public_subnet_2_cidr" {
  description = "CIDR for public subnet AZ-2 (ALB and ECS tasks)"
  type        = string
}

variable "private_subnet_1_cidr" {
  description = "CIDR for private subnet AZ-1 (ElastiCache)"
  type        = string
}

variable "private_subnet_2_cidr" {
  description = "CIDR for private subnet AZ-2 (ElastiCache)"
  type        = string
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

