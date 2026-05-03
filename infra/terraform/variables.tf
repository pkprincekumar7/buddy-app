variable "aws_region" {
  description = "AWS region to deploy resources"
  type        = string
}

variable "app_name" {
  description = "Application name used for resource naming and tagging"
  type        = string
  default     = "buddy"
}

variable "environment" {
  description = "Deployment environment (e.g. dev, staging, prod)"
  type        = string
}

# ── Networking ──────────────────────────────────────────────────────────────

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "public_subnet_1_cidr" {
  description = "CIDR block for public subnet in AZ-1"
  type        = string
  default     = "10.0.1.0/24"
}

variable "public_subnet_2_cidr" {
  description = "CIDR block for public subnet in AZ-2"
  type        = string
  default     = "10.0.2.0/24"
}

# ── EC2 ─────────────────────────────────────────────────────────────────────

variable "instance_type" {
  description = "EC2 instance type"
  type        = string
  default     = "t2.small"
}

variable "allowed_ssh_cidr" {
  description = "Your public IP in CIDR notation for SSH access (e.g. 1.2.3.4/32)"
  type        = string
  # Set via TF_VAR_allowed_ssh_cidr environment variable or terraform.tfvars
}

# ── DNS / TLS ────────────────────────────────────────────────────────────────

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
