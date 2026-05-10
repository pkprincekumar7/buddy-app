variable "aws_region" {
  description = "AWS region for the S3 bucket (WAF and CloudFront are always global/us-east-1)"
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

# -- DNS / TLS -----------------------------------------------------------------

variable "domain_name" {
  description = "Root domain name (e.g. example.com)"
  type        = string
}

variable "subdomain" {
  description = "Subdomain prefix for the frontend (e.g. 'www' → www.example.com in prod, www-dev.example.com in dev)"
  type        = string
}

variable "hosted_zone_id" {
  description = "Route 53 hosted zone ID for the domain"
  type        = string
}

variable "acm_certificate_arn_us_east_1" {
  description = "ACM certificate ARN in us-east-1 covering the frontend domain (CloudFront requires certs in us-east-1; this is separate from the ALB cert in ap-south-1)"
  type        = string
}

# -- S3 -----------------------------------------------------------------------

variable "frontend_bucket_name" {
  description = "Pre-existing S3 bucket name for frontend static assets (us-east-1). Not managed by Terraform — must exist before apply."
  type        = string
}

# -- Remote state --------------------------------------------------------------

variable "app_state_key" {
  description = "S3 key of the infra-live-backend remote state for this environment and region — used to read the ALB DNS name for the /api/* CloudFront origin (e.g. terraform-state-files/myapp/dev/backend/ap-south-1/terraform.tfstate)"
  type        = string
}
