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

variable "frontend_bucket_name" {
  description = "Pre-existing S3 bucket name for frontend static assets (us-east-1)"
  type        = string
}

variable "backend_bucket_name" {
  description = "Pre-existing S3 bucket name for backend application use (us-east-1)"
  type        = string
}
