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
  description = "Public subdomain prefix (e.g. 'superpower' → superpower.learning-dev.com in prod, superpower-dev.learning-dev.com in dev)"
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

variable "backend_regions" {
  description = "AWS regions with a deployed backend (ALB) — this is the single source of truth for every region-aware resource in this module: the jwt_validator Lambda@Edge (see lambda_edge.tf) uses it to route each /api/* request by the token's location claim with no default region, and response_headers.tf uses it to allow each region's uploads bucket in the CSP. Each entry must already be applied via infra-live-backend (its SSM alb_internal_fqdn parameter must exist, and its uploads bucket name must be present in uploads_bucket_names below) before being added here. Unless bootstrap_region below names a region, the FIRST entry is the bootstrap region (login, Google sign-in, health, hint-less register). Required — no default, so a run that doesn't pass it (TF_VAR_backend_regions from terraform-live-edge.yml's backend_regions input) fails instead of silently assuming a region."
  type        = list(string)

  validation {
    condition     = length(var.backend_regions) > 0
    error_message = "backend_regions must not be empty — the API would have no origin to route to."
  }

  validation {
    condition     = alltrue([for r in var.backend_regions : contains(["ap-south-1", "eu-west-1", "us-east-1"], r)])
    error_message = "backend_regions may only contain: ap-south-1, eu-west-1, us-east-1."
  }
}

# The region that serves the jwt_validator Lambda@Edge's PUBLIC_PATHS
# (register, login, google, health, and refresh/logout when no
# location-bearing session is found) — every one of those requests genuinely
# lands on this region's ALB (the alb-backend origin in cloudfront.tf),
# unlike authenticated /api/* traffic, which is always re-routed by location.
#
# Chosen at apply time. "auto" (the default) keeps the original behaviour:
# whichever region is first in backend_regions. Naming a region pins it, so
# changing the backend_regions selection can't silently move every login
# worldwide to another region. Any region works — the Atlas cluster is
# reachable from every backend region via its Mongo URI.
variable "bootstrap_region" {
  description = "AWS region whose ALB serves the bootstrap (unauthenticated) API paths: login, Google sign-in, health, and hint-less register/refresh/logout. \"auto\" (default) uses the first entry of backend_regions; otherwise it must be one of backend_regions. Set via terraform-live-edge.yml's bootstrap_region input (TF_VAR_bootstrap_region)."
  type        = string
  default     = "auto"

  validation {
    condition     = var.bootstrap_region == "auto" || contains(var.backend_regions, var.bootstrap_region)
    error_message = "bootstrap_region must be \"auto\" or one of backend_regions — its ALB is the origin for login, Google sign-in and health."
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

variable "uploads_bucket_names" {
  description = "Pre-existing S3 uploads bucket name per region, keyed by AWS region (e.g. { \"ap-south-1\" = \"...\", \"eu-west-1\" = \"...\" }) — each holds user-generated content under uploads/, private and reached only through API-issued S3 presigned URLs (EDGE-05). Used here for the CSP's connect-src. Must contain an entry for every region in backend_regions."
  type        = map(string)

  validation {
    condition     = alltrue([for r in var.backend_regions : contains(keys(var.uploads_bucket_names), r)])
    error_message = "uploads_bucket_names must have an entry for every region in backend_regions."
  }
}

# -- CloudFront ---------------------------------------------------------------
# -- JWT ----------------------------------------------------------------------
variable "jwt_public_keys" {
  description = "Map of JWT key ID → RSA public key PEM (SubjectPublicKeyInfo / PKCS#8). Normally one entry. During key rotation, include both the outgoing and incoming key so CloudFront accepts tokens signed by either. A token whose kid isn't a key here is rejected (no default key). The backend reads the same JWT_PUBLIC_KEYS secret. See docs/jwt-keys.md."
  type        = map(string)

  validation {
    condition     = length(var.jwt_public_keys) > 0
    error_message = "jwt_public_keys must contain at least one kid → PEM entry."
  }

  validation {
    condition     = alltrue([for pem in values(var.jwt_public_keys) : can(regex("-----BEGIN PUBLIC KEY-----[A-Za-z0-9+/=\\s]+-----END PUBLIC KEY-----", pem))])
    error_message = "Every jwt_public_keys value must be a PEM public key (-----BEGIN PUBLIC KEY----- ... -----END PUBLIC KEY-----). See docs/jwt-keys.md."
  }
}

# -- Origin verify --------------------------------------------------------------

variable "origin_verify_secret" {
  description = "Shared secret sent as the X-Origin-Verify custom header on every CloudFront→ALB origin request (see the alb-backend origin in cloudfront.tf; the jwt_validator Lambda@Edge copies it from there when it re-routes, so it is never in the function code). Must equal infra-live-backend's origin_verify_secret; both are set from the same ORIGIN_VERIFY_SECRET GitHub Environment Secret."
  type        = string
  sensitive   = true
}

variable "origin_verify_secret_next" {
  description = "Incoming X-Origin-Verify value during a rotation, from the optional ORIGIN_VERIFY_SECRET_NEXT GitHub Environment Secret. When set, CloudFront sends it instead of origin_verify_secret. Apply infra-live-backend in EVERY backend region with the same value first, so each ALB already accepts it. Empty (the default) outside a rotation. See docs/infra-operations.md \"Rotating the origin-verify secret\"."
  type        = string
  sensitive   = true
  default     = ""
  nullable    = false
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

# -- WAF ----------------------------------------------------------------------

variable "enable_waf" {
  description = "Enable WAF WebACL on CloudFront. Skipped on dev/sbx to avoid ~$10/mo (WebACL + 5 rules, prorated hourly) + per-request charges."
  type        = bool
  default     = true
}

# -- WAF logging --------------------------------------------------------------

variable "enable_waf_logging" {
  description = "Enable WAF full logs via Kinesis Firehose → global S3 bucket. Prod only. Requires enable_waf = true."
  type        = bool
  default     = false

  validation {
    condition     = !var.enable_waf_logging || var.enable_waf
    error_message = "enable_waf_logging requires enable_waf = true."
  }
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
