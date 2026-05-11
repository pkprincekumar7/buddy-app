variable "aws_region" {
  description = "AWS region (for SSM reads; bucket policy is applied in us-east-1 via provider alias)"
  type        = string

  validation {
    condition     = contains(["ap-south-1", "eu-west-1", "us-east-1"], var.aws_region)
    error_message = "aws_region must be one of: ap-south-1, eu-west-1, us-east-1."
  }
}

variable "app_name" {
  description = "Application name"
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
