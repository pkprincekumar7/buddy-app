variable "aws_region" {
  description = "AWS region to deploy resources"
  type        = string
}

variable "db_state_key" {
  description = "S3 key of the infra-db remote state for this environment and region (e.g. terraform-state-files/buddy360/dev/db/ap-south-1/terraform.tfstate)"
  type        = string
}

variable "app_name" {
  description = "Application name used for resource naming and tagging"
  type        = string
  default     = "buddy360"
}

variable "environment" {
  description = "Deployment environment (e.g. dev, staging, prod)"
  type        = string
}

# -- EC2 ----------------------------------------------------------------------

variable "instance_type" {
  description = "EC2 instance type"
  type        = string
  default     = "t3.small"
}

variable "allowed_ssh_cidr" {
  description = "Your public IP in CIDR notation for SSH access (e.g. 1.2.3.4/32)"
  type        = string
  # Set via TF_VAR_allowed_ssh_cidr environment variable or terraform.tfvars
}

variable "key_name" {
  description = "EC2 key pair name for SSH access (optional  -  leave null if SSM Session Manager is your only access method)"
  type        = string
  default     = null
}

# -- ElastiCache ---------------------------------------------------------------

variable "elasticache_node_type" {
  description = "ElastiCache node type for Redis (cache.t3.micro matches the db.t3.micro RDS tier)"
  type        = string
  default     = "cache.t3.micro"
}

# -- DNS / TLS -----------------------------------------------------------------

variable "domain_name" {
  description = "Root domain name (e.g. sample.com)"
  type        = string
}

variable "subdomain" {
  description = "Subdomain prefix for the application"
  type        = string
}

variable "hosted_zone_id" {
  description = "Route 53 hosted zone ID for the domain"
  type        = string
}

variable "acm_certificate_arn" {
  description = "ARN of the ACM certificate for HTTPS (must be in ap-south-1)"
  type        = string
}
