# sbx with its own tfvars (tfvars/sbx.tfvars), every other input as the
# terraform-live-backend workflow passes it. Mock providers: no credentials, nothing is
# created. Checks that the plan's validations and preconditions pass
# (the regions, the connection budget, name lengths) and what differs by environment.
# Run from infra-live-backend/terraform (check.sh and CI do):
#   terraform test -test-directory=tests/envs -filter=tests/envs/sbx.tftest.hcl -var-file=tfvars/sbx.tfvars

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
  environment          = "sbx"
  repository           = "owner/buddy-app"
  domain_name          = "example.com"
  hosted_zone_id       = "Z0000000000000"
  assets_bucket_name   = "superpower-sbx-assets"
  origin_verify_secret = "test-secret"
  jwt_public_keys      = { "key-v1" = "-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----\n" }
  subdomain_internal   = "superpower-internal"
  cookie_domain        = "superpower-sbx.example.com"
  openai_model         = "gpt-test"
  anthropic_model      = "claude-test"
  gemini_model         = "gemini-test"
}

run "sbx_ap_south_1" {
  command = apply

  variables {
    aws_region          = "ap-south-1"
    acm_certificate_arn = "arn:aws:acm:ap-south-1:111111111111:certificate/00000000-0000-0000-0000-000000000000"
    uploads_bucket_name = "superpower-sbx-uploads-ap-south-1"
  }

  assert {
    condition     = length(local.services) == 18 && local.alb_internal_fqdn == "superpower-internal-sbx-ap-south-1.example.com"
    error_message = "Every runtime, and the region's internal ALB name."
  }
  assert {
    condition     = length(aws_vpc_endpoint.atlas) == 0
    error_message = "No PrivateLink: Atlas M0 over the public endpoint."
  }
  assert {
    condition     = length(aws_guardduty_detector.main) == 0 && length(aws_cloudtrail.main) == 0
    error_message = "GuardDuty and CloudTrail off."
  }
}

run "sbx_eu_west_1" {
  command = apply

  variables {
    aws_region          = "eu-west-1"
    acm_certificate_arn = "arn:aws:acm:eu-west-1:111111111111:certificate/00000000-0000-0000-0000-000000000000"
    uploads_bucket_name = "superpower-sbx-uploads-eu-west-1"
  }

  assert {
    condition     = length(local.services) == 18 && local.alb_internal_fqdn == "superpower-internal-sbx-eu-west-1.example.com"
    error_message = "Every runtime, and the region's internal ALB name."
  }
  assert {
    condition     = length(aws_vpc_endpoint.atlas) == 0
    error_message = "No PrivateLink: Atlas M0 over the public endpoint."
  }
  assert {
    condition     = length(aws_guardduty_detector.main) == 0 && length(aws_cloudtrail.main) == 0
    error_message = "GuardDuty and CloudTrail off."
  }
}

run "sbx_us_east_1" {
  command = apply

  variables {
    aws_region          = "us-east-1"
    acm_certificate_arn = "arn:aws:acm:us-east-1:111111111111:certificate/00000000-0000-0000-0000-000000000000"
    uploads_bucket_name = "superpower-sbx-uploads-us-east-1"
  }

  assert {
    condition     = length(local.services) == 18 && local.alb_internal_fqdn == "superpower-internal-sbx-us-east-1.example.com"
    error_message = "Every runtime, and the region's internal ALB name."
  }
  assert {
    condition     = length(aws_vpc_endpoint.atlas) == 0
    error_message = "No PrivateLink: Atlas M0 over the public endpoint."
  }
  assert {
    condition     = length(aws_guardduty_detector.main) == 0 && length(aws_cloudtrail.main) == 0
    error_message = "GuardDuty and CloudTrail off."
  }
}
