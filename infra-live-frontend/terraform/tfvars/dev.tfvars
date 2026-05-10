# aws_region and environment are supplied via workflow inputs (TF_VAR_*)
# state_bucket and app_state_key are supplied via secrets/workflow (TF_VAR_*)
# domain_name, subdomain, hosted_zone_id, acm_certificate_arn_us_east_1
#   are supplied via GitHub Secrets (TF_VAR_*)

app_name             = "buddy360"
frontend_bucket_name = "person-frontend-dev-bucket"
