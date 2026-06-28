# environment and backend_region are supplied via workflow inputs (TF_VAR_*)
# app_name, domain_name, subdomain, hosted_zone_id, acm_certificate_arn_us_east_1,
# spa_bucket_name, assets_bucket_name are supplied via GitHub Environment Secrets (TF_VAR_*)
# Note: this module has no aws_region variable — all resources are fixed to us-east-1.

cloudfront_price_class = "PriceClass_100"

# Security — skip GuardDuty and CloudTrail on dev to avoid ~$22/mo cost
enable_guardduty  = false
enable_cloudtrail = false

# WAF logging — disabled on dev (no global logging bucket)
enable_waf_logging = false
