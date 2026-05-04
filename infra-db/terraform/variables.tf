variable "aws_region" {
  description = "AWS region to deploy resources"
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

# ── Networking ───────────────────────────────────────────────────────────────

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "public_subnet_1_cidr" {
  description = "CIDR block for public subnet in AZ-1 (EC2 / ALB)"
  type        = string
  default     = "10.0.1.0/24"
}

variable "public_subnet_2_cidr" {
  description = "CIDR block for public subnet in AZ-2 (ALB)"
  type        = string
  default     = "10.0.2.0/24"
}

variable "private_subnet_1_cidr" {
  description = "CIDR block for private subnet in AZ-1 (RDS)"
  type        = string
  default     = "10.0.3.0/24"
}

variable "private_subnet_2_cidr" {
  description = "CIDR block for private subnet in AZ-2 (RDS)"
  type        = string
  default     = "10.0.4.0/24"
}

# ── RDS ──────────────────────────────────────────────────────────────────────

variable "db_identifier" {
  description = "RDS instance identifier (shown in the AWS console)"
  type        = string
  default     = "buddy360-app"
}

variable "db_name" {
  description = "Initial database name created inside PostgreSQL"
  type        = string
  default     = "buddy360"
}

variable "db_username" {
  description = "Master username for the RDS instance"
  type        = string
  default     = "postgres"
}

variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t3.micro"
}

variable "db_allocated_storage" {
  description = "Allocated storage in GiB"
  type        = number
  default     = 25
}

variable "db_deletion_protection" {
  description = "Enable deletion protection — set true for staging and production"
  type        = bool
  default     = false
}
