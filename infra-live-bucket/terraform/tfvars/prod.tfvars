# environment is supplied via workflow input (TF_VAR_environment)
# Both buckets are always in us-east-1 — no aws_region variable in this module.

app_name             = "buddy360"
frontend_bucket_name = "person-frontend-prod-bucket"
backend_bucket_name  = "person-backend-prod-app-bucket"
