variable "app_name" {
  description = "Application name used for resource naming and tagging"
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

variable "domain_name" {
  description = "Root domain name (e.g. learning-dev.com)"
  type        = string
}

variable "subdomain" {
  description = "Public subdomain prefix (e.g. 'buddy' → buddy.learning-dev.com in prod, buddy-dev.learning-dev.com in dev)"
  type        = string
}

variable "hosted_zone_id" {
  description = "Route 53 hosted zone ID for the domain"
  type        = string
}

variable "acm_certificate_arn_us_east_1" {
  description = "ACM certificate ARN in us-east-1 covering the public frontend domain (CloudFront requires certs in us-east-1)"
  type        = string
}

variable "backend_region" {
  description = "AWS region where the backend (ALB) was deployed — used to read the correct ALB FQDN from SSM"
  type        = string

  # Multi-region expansion checklist — do all of the following for each new region:
  #   1. Apply infra-live-backend for the new region first. This module reads the
  #      ALB FQDN from SSM using backend_region as a path segment; if the backend
  #      hasn't been applied the SSM parameter won't exist and this apply will fail
  #      with a cryptic "parameter not found" error.
  #   2. Add the new region as a choice in the backend_region workflow_dispatch
  #      input in terraform-live-edge.yml.
  #   3. Add the new region to the validation condition below.
  #   4. For the full cross-module checklist see infra-live-backend/terraform/variables.tf.
  validation {
    condition     = var.backend_region == "ap-south-1"
    error_message = "backend_region must be ap-south-1 (only active region; see expansion checklist in variable description)."
  }
}

# -- S3 -----------------------------------------------------------------------
variable "frontend_bucket_name" {
  description = "Pre-existing S3 frontend assets bucket name (us-east-1)"
  type        = string
}

variable "backend_bucket_name" {
  description = "Pre-existing S3 backend bucket name (us-east-1) — holds static assets under assets/"
  type        = string
}

# -- CloudFront ---------------------------------------------------------------
variable "cloudfront_price_class" {
  description = "CloudFront price class controlling which edge locations serve traffic. PriceClass_100 = US/EU only; PriceClass_200 = US/EU/Asia/ME/Africa; PriceClass_All = all edge locations."
  type        = string

  validation {
    condition     = contains(["PriceClass_100", "PriceClass_200", "PriceClass_All"], var.cloudfront_price_class)
    error_message = "cloudfront_price_class must be one of: PriceClass_100, PriceClass_200, PriceClass_All."
  }
}
