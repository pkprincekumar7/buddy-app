# stg with its own tfvars (tfvars/stg.tfvars), every other input as the
# terraform-live-backend workflow passes it. Mock providers: no credentials, nothing is
# created. Checks that the plan's validations and preconditions pass
# (the regions, the connection budget, name lengths) and what differs by environment.
# Run from infra-live-backend/terraform (check.sh and CI do):
#   terraform test -test-directory=tests/envs -filter=tests/envs/stg.tftest.hcl -var-file=tfvars/stg.tfvars

mock_provider "aws" {
  source = "./tests/envs/mocks"
}

mock_provider "aws" {
  alias = "ssm"
}

mock_provider "mongodbatlas" {
  source = "./tests/envs/mocks"
}

variables {
  app_name             = "superpower"
  environment          = "stg"
  repository           = "owner/buddy-app"
  domain_name          = "example.com"
  hosted_zone_id       = "Z0000000000000"
  assets_bucket_name   = "superpower-stg-assets"
  origin_verify_secret = "test-secret"
  jwt_public_keys      = { "key-v1" = "-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----\n" }
  subdomain_internal   = "superpower-internal"
  cookie_domain        = "superpower-stg.example.com"
  openai_model         = "gpt-test"
  anthropic_model      = "claude-test"
  gemini_model         = "gemini-test"
  ops_email            = "ops@example.com"
  atlas_project_id     = "0123456789abcdef01234567"
}

run "stg_ap_south_1" {
  command = apply

  variables {
    aws_region                   = "ap-south-1"
    acm_certificate_arn          = "arn:aws:acm:ap-south-1:111111111111:certificate/00000000-0000-0000-0000-000000000000"
    uploads_bucket_name          = "superpower-stg-uploads-ap-south-1"
    regional_logging_bucket_name = "superpower-stg-logs-ap-south-1"
  }

  assert {
    condition     = length(local.services) == 18 && local.alb_internal_fqdn == "superpower-internal-stg-ap-south-1.example.com"
    error_message = "Every runtime, and the region's internal ALB name."
  }
  assert {
    condition     = length(aws_vpc_endpoint.atlas) == 1
    error_message = "The Atlas PrivateLink endpoint (DEC-02)."
  }
  assert {
    condition     = length(aws_guardduty_detector.main) == 1 && length(aws_cloudtrail.main) == 1
    error_message = "GuardDuty and CloudTrail on."
  }
}

# Served from ap-south-1 only (shared/routing.json served_from, DEC-01).
run "stg_eu_west_1_is_refused" {
  command = plan

  variables {
    aws_region                   = "eu-west-1"
    acm_certificate_arn          = "arn:aws:acm:eu-west-1:111111111111:certificate/00000000-0000-0000-0000-000000000000"
    uploads_bucket_name          = "superpower-stg-uploads-eu-west-1"
    regional_logging_bucket_name = "superpower-stg-logs-eu-west-1"
  }

  expect_failures = [var.aws_region]
}
