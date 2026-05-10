variable "aws_region" {
  description = "AWS region to deploy resources"
  type        = string

  validation {
    condition     = var.aws_region == "ap-south-1"
    error_message = "aws_region must be ap-south-1."
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
  description = "CIDR block for the database VPC — must not overlap with the backend VPC (default 10.2.0.0/16)"
  type        = string
  default     = "10.1.0.0/16"
}

variable "public_subnet_1_cidr" {
  description = "CIDR block for public subnet in AZ-1 (reserved for future use)"
  type        = string
  default     = "10.1.1.0/24"
}

variable "public_subnet_2_cidr" {
  description = "CIDR block for public subnet in AZ-2 (reserved for future use)"
  type        = string
  default     = "10.1.2.0/24"
}

variable "private_subnet_1_cidr" {
  description = "CIDR block for private subnet in AZ-1 (RDS)"
  type        = string
  default     = "10.1.3.0/24"
}

variable "private_subnet_2_cidr" {
  description = "CIDR block for private subnet in AZ-2 (RDS)"
  type        = string
  default     = "10.1.4.0/24"
}

# -- RDS ----------------------------------------------------------------------

variable "db_identifier" {
  description = "RDS instance identifier"
  type        = string
  default     = "buddy360"
}

variable "db_name" {
  description = "Initial database name"
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

variable "db_multi_az" {
  description = "Enable Multi-AZ deployment for high availability — recommended true for stg and prod"
  type        = bool
  default     = false
}

variable "db_deletion_protection" {
  description = "Enable RDS deletion protection — prevents accidental destroy; set false only when intentionally decommissioning"
  type        = bool
  default     = true
}

variable "db_skip_final_snapshot" {
  description = "Skip final snapshot on destroy — set true only for dev/throwaway environments; always false for stg and prod"
  type        = bool
  default     = false
}
