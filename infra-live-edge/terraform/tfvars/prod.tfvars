# environment and backend_regions are supplied via workflow inputs (TF_VAR_*)
# app_name, domain_name, subdomain, hosted_zone_id, acm_certificate_arn_us_east_1,
# spa_bucket_name, assets_bucket_name are supplied via GitHub Environment Secrets (TF_VAR_*)
# Note: this module has no aws_region variable — all resources are fixed to us-east-1.

# All edge locations, including South America — prod serves a genuinely
# global audience; sbx/dev/stg stay on PriceClass_100 for cost.
cloudfront_price_class = "PriceClass_All"

# Security — GuardDuty and CloudTrail always on for prod
# global_logging_bucket_name is set via TF_VAR_global_logging_bucket_name
# GitHub secret (GLOBAL_LOGGING_BUCKET_NAME) — do not set here
enable_guardduty  = true
enable_cloudtrail = true

# WAF logging — enabled on prod only
enable_waf_logging = true
