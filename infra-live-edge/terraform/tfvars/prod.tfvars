# environment and backend_region are supplied via workflow inputs (TF_VAR_*)
# app_name, domain_name, subdomain, hosted_zone_id, acm_certificate_arn_us_east_1,
# frontend_bucket_name, backend_bucket_name are supplied via GitHub Environment Secrets (TF_VAR_*)
# Note: this module has no aws_region variable — all resources are fixed to us-east-1.

cloudfront_price_class = "PriceClass_200"
