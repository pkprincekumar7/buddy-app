variable "aws_region" {
  description = "AWS region to deploy resources"
  type        = string

  validation {
    condition     = contains(["ap-south-1", "eu-west-1", "us-east-1"], var.aws_region)
    error_message = "aws_region must be one of: ap-south-1, eu-west-1, us-east-1."
  }
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

# -- Networking ---------------------------------------------------------------

variable "vpc_cidr" {
  description = "CIDR block for the backend VPC"
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

variable "acm_certificate_arn_ap_south_1" {
  description = "ACM certificate ARN in ap-south-1 covering the internal ALB subdomain"
  type        = string
}

# -- Database ------------------------------------------------------------------

variable "mongodb_db_name" {
  description = "MongoDB database name (passed to backend as MONGODB_DB_NAME)"
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

variable "enable_execute_command" {
  description = "Enable ECS Exec (aws ecs execute-command) for live container debugging. Disable in prod."
  type        = bool
  default     = false
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

variable "default_region" {
  type    = string
  default = "us"
}

