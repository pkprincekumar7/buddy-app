variable "app_name" {
  description = "Application name used for resource naming and tagging"
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
variable "spa_bucket_name" {
  description = "Pre-existing S3 frontend assets bucket name (us-east-1)"
  type        = string
}

variable "assets_bucket_name" {
  description = "Pre-existing S3 backend bucket name (us-east-1) — holds static assets under app-assets/"
  type        = string
}

# -- CloudFront ---------------------------------------------------------------
# -- JWT ----------------------------------------------------------------------
variable "jwt_public_keys" {
  description = "Map of JWT key ID → RSA public key PEM (SubjectPublicKeyInfo / PKCS#8). Normally one entry. During key rotation, include both the outgoing and incoming key so CloudFront accepts tokens signed by either. See docs/jwt-keys.md."
  type        = map(string)
}

variable "jwt_key_id" {
  description = "JWT key ID (kid) that the backend currently uses for signing. Must be present as a key in jwt_public_keys. Update during key rotation after the new key is live."
  type        = string
  default     = "key-v1"
}

variable "cloudfront_price_class" {
  description = "CloudFront price class controlling which edge locations serve traffic. PriceClass_100 = US/EU only; PriceClass_200 = US/EU/Asia/ME/Africa; PriceClass_All = all edge locations."
  type        = string

  validation {
    condition     = contains(["PriceClass_100", "PriceClass_200", "PriceClass_All"], var.cloudfront_price_class)
    error_message = "cloudfront_price_class must be one of: PriceClass_100, PriceClass_200, PriceClass_All."
  }
}

# -- Security -----------------------------------------------------------------

variable "enable_guardduty" {
  description = "Enable GuardDuty in us-east-1. Skipped on dev/sbx to avoid ~$22/mo cost."
  type        = bool
  default     = true
}

variable "enable_cloudtrail" {
  description = "Enable CloudTrail in us-east-1 (global service events). Requires global_logging_bucket_name to be set."
  type        = bool
  default     = true
}

# -- WAF logging --------------------------------------------------------------

variable "enable_waf_logging" {
  description = "Enable WAF full logs via Kinesis Firehose → global S3 bucket. Prod only."
  type        = bool
  default     = false
}

variable "global_logging_bucket_name" {
  description = "Pre-existing S3 bucket in us-east-1 for CloudTrail and WAF logs. Set from GLOBAL_LOGGING_BUCKET_NAME GitHub secret. Must be non-empty when enable_cloudtrail = true or enable_waf_logging = true."
  type        = string
  default     = ""

  validation {
    condition     = (!var.enable_cloudtrail && !var.enable_waf_logging) || length(var.global_logging_bucket_name) > 0
    error_message = "global_logging_bucket_name must be set when enable_cloudtrail = true or enable_waf_logging = true."
  }
}
