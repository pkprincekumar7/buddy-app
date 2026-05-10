variable "aws_region" {
  description = "AWS region to deploy resources"
  type        = string

  validation {
    condition     = var.aws_region == "ap-south-1"
    error_message = "aws_region must be ap-south-1."
  }
}

variable "state_bucket" {
  description = "S3 bucket name that holds all Terraform state files"
  type        = string
}

variable "app_name" {
  description = "Application name used for resource naming and tagging"
  type        = string
  default     = "buddy360"
}

variable "environment" {
  description = "Deployment environment (dev, stg, prod)"
  type        = string

  validation {
    condition     = contains(["dev", "stg", "prod"], var.environment)
    error_message = "environment must be one of: dev, stg, prod."
  }
}

# -- Remote state --------------------------------------------------------------

variable "db_state_key" {
  description = "S3 key of the infra-live-database remote state for this environment and region"
  type        = string
}

# -- Networking ---------------------------------------------------------------

variable "vpc_cidr" {
  description = "CIDR block for the backend VPC — must not overlap with the database VPC (default 10.1.0.0/16)"
  type        = string
  default     = "10.2.0.0/16"
}

variable "public_subnet_1_cidr" {
  description = "CIDR for public subnet AZ-1 (ALB and ECS tasks)"
  type        = string
  default     = "10.2.1.0/24"
}

variable "public_subnet_2_cidr" {
  description = "CIDR for public subnet AZ-2 (ALB and ECS tasks)"
  type        = string
  default     = "10.2.2.0/24"
}

variable "private_subnet_1_cidr" {
  description = "CIDR for private subnet AZ-1 (ElastiCache)"
  type        = string
  default     = "10.2.3.0/24"
}

variable "private_subnet_2_cidr" {
  description = "CIDR for private subnet AZ-2 (ElastiCache)"
  type        = string
  default     = "10.2.4.0/24"
}

# -- S3 -----------------------------------------------------------------------

variable "backend_bucket_name" {
  description = "Pre-existing S3 bucket name for backend application use (file uploads, pre-signed URLs). Not managed by Terraform — must exist before apply."
  type        = string
}

# -- Database ------------------------------------------------------------------

variable "db_name" {
  description = "PostgreSQL database name (passed to backend as POSTGRES_DB)"
  type        = string
  default     = "buddy360"
}

# -- ElastiCache ---------------------------------------------------------------

variable "elasticache_node_type" {
  description = "ElastiCache node type"
  type        = string
  default     = "cache.t3.micro"
}

# -- ECS / Fargate -------------------------------------------------------------

variable "task_cpu" {
  description = "Fargate task CPU units (256 = 0.25 vCPU, 512 = 0.5 vCPU, 1024 = 1 vCPU)"
  type        = number
  default     = 512
}

variable "task_memory" {
  description = "Fargate task memory in MiB"
  type        = number
  default     = 1024
}

variable "desired_count" {
  description = "Number of ECS tasks to run"
  type        = number
  default     = 1
}

# -- Application settings ------------------------------------------------------

variable "app_env" {
  description = "APP_ENV value passed to the backend container"
  type        = string
  default     = "prod"
}

variable "openai_model" {
  type    = string
  default = "gpt-5.4-mini"
}

variable "anthropic_model" {
  type    = string
  default = "claude-sonnet-4-6"
}

variable "gemini_model" {
  type    = string
  default = "gemini-1.5-flash"
}

variable "llm_timeout_seconds" {
  type    = number
  default = 60
}

variable "llm_hourly_limit" {
  type    = number
  default = 200
}

variable "postgres_pool_size" {
  type    = number
  default = 5
}

variable "postgres_max_overflow" {
  type    = number
  default = 10
}

variable "default_region" {
  type    = string
  default = "us"
}

variable "reconciler_interval_minutes" {
  type    = number
  default = 5
}
