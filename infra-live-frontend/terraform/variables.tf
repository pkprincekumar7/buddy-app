variable "app_name" {
  description = "Application name"
  type        = string
}

variable "environment" {
  description = "Deployment environment (dev, stg, prod)"
  type        = string

  validation {
    condition     = contains(["dev", "stg", "prod"], var.environment)
    error_message = "environment must be one of: dev, stg, prod."
  }
}

# -- S3 -----------------------------------------------------------------------
variable "frontend_bucket_name" {
  description = "Pre-existing S3 frontend assets bucket name (us-east-1)"
  type        = string
}
