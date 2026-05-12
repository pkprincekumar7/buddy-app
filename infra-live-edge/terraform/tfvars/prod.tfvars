# aws_region, environment, and backend_region are supplied via workflow inputs (TF_VAR_*)
# domain_name, subdomain, hosted_zone_id, acm_certificate_arn_us_east_1
#   are supplied via GitHub Environment Secrets (TF_VAR_*)

app_name               = "buddy360"
frontend_bucket_name   = "person-frontend-prod-bucket"
cloudfront_price_class = "PriceClass_200"
