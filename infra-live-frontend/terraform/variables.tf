variable "app_name" {
  description = "Application name"
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

# -- S3 -----------------------------------------------------------------------
variable "spa_bucket_name" {
  description = "Pre-existing S3 frontend assets bucket name (us-east-1)"
  type        = string
}
