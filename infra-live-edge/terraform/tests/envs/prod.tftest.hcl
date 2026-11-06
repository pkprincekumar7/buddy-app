# prod with its own tfvars (tfvars/prod.tfvars), every other input as the
# terraform-live-edge workflow passes it. Mock providers: no credentials, nothing is
# created. Checks the plan's validations pass (the regions,
# served_from) and what differs by environment.
# Run from infra-live-edge/terraform (check.sh and CI do):
#   terraform test -test-directory=tests/envs -filter=tests/envs/prod.tftest.hcl -var-file=tfvars/prod.tfvars

mock_provider "aws" {
  source = "./tests/envs/mocks"
}

mock_provider "aws" {
  alias  = "us_east_1"
  source = "./tests/envs/mocks"
}

mock_provider "time" {}

variables {
  app_name                      = "superpower"
  environment                   = "prod"
  repository                    = "owner/buddy-app"
  domain_name                   = "example.com"
  subdomain                     = "superpower"
  hosted_zone_id                = "Z0000000000000"
  acm_certificate_arn_us_east_1 = "arn:aws:acm:us-east-1:111111111111:certificate/00000000-0000-0000-0000-000000000000"
  spa_bucket_name               = "superpower-prod-spa"
  assets_bucket_name            = "superpower-prod-assets"
  uploads_bucket_names          = { "ap-south-1" = "superpower-prod-uploads-ap-south-1", "eu-west-1" = "superpower-prod-uploads-eu-west-1", "us-east-1" = "superpower-prod-uploads-us-east-1" }
  jwt_public_keys               = { "key-v1" = "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkq\n-----END PUBLIC KEY-----\n" }
  origin_verify_secret          = "test-secret"
  ops_email                     = "ops@example.com"
  global_logging_bucket_name    = "superpower-prod-global-logs"
}

run "prod_ap_south_1" {
  command = apply

  variables {
    backend_regions = ["ap-south-1"]
  }

  assert {
    condition     = local.fqdn == "superpower.example.com" && jsonencode(distinct(values(local.location_to_region))) == jsonencode(["ap-south-1"])
    error_message = "Every location is served from ap-south-1 (served_from, DEC-01)."
  }
  assert {
    condition     = length(aws_wafv2_web_acl.frontend) == 1 && length(aws_guardduty_detector.main) == 1 && length(aws_cloudwatch_metric_alarm.cloudfront_5xx) == 1
    error_message = "WAF, GuardDuty and the 5xx alarm on."
  }
  assert {
    condition     = length(aws_cloudtrail.main) == 1 && length(aws_kinesis_firehose_delivery_stream.waf_logs) == 1
    error_message = "The edge CloudTrail and WAF logging on."
  }
}

run "prod_a_second_region_is_refused" {
  command = plan

  variables {
    backend_regions = ["ap-south-1", "eu-west-1"]
  }

  expect_failures = [var.backend_regions]
}
