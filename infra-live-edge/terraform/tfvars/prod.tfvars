# environment and backend_region are supplied via workflow inputs (TF_VAR_*)
# app_name, domain_name, subdomain, hosted_zone_id, acm_certificate_arn_us_east_1,
# spa_bucket_name, assets_bucket_name are supplied via GitHub Environment Secrets (TF_VAR_*)
# Note: this module has no aws_region variable — all resources are fixed to us-east-1.

cloudfront_price_class = "PriceClass_200"

# Security — GuardDuty and CloudTrail always on for prod
# global_logging_bucket_name is set via TF_VAR_global_logging_bucket_name
# GitHub secret (GLOBAL_LOGGING_BUCKET_NAME) — do not set here
enable_guardduty  = true
enable_cloudtrail = true

# WAF logging — enabled on prod only
enable_waf_logging = true
