# dev with its own tfvars (tfvars/dev.tfvars), every other input as the
# terraform-live-edge workflow passes it. Mock providers: no credentials, nothing is
# created. Checks the plan's validations pass (the regions,
# served_from) and what differs by environment.
# Run from infra-live-edge/terraform (check.sh and CI do):
#   terraform test -test-directory=tests/envs -filter=tests/envs/dev.tftest.hcl -var-file=tfvars/dev.tfvars

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
  environment                   = "dev"
  repository                    = "owner/buddy-app"
  domain_name                   = "example.com"
  subdomain                     = "superpower"
  hosted_zone_id                = "Z0000000000000"
  acm_certificate_arn_us_east_1 = "arn:aws:acm:us-east-1:111111111111:certificate/00000000-0000-0000-0000-000000000000"
  spa_bucket_name               = "superpower-dev-spa"
  assets_bucket_name            = "superpower-dev-assets"
  uploads_bucket_names          = { "ap-south-1" = "superpower-dev-uploads-ap-south-1", "eu-west-1" = "superpower-dev-uploads-eu-west-1", "us-east-1" = "superpower-dev-uploads-us-east-1" }
  jwt_public_keys               = { "key-v1" = "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkq\n-----END PUBLIC KEY-----\n" }
  origin_verify_secret          = "test-secret"
}

run "dev_1_region" {
  command = apply

  variables {
    backend_regions = ["ap-south-1"]
  }

  assert {
    condition     = local.fqdn == "superpower-dev.example.com" && length(local.regional_alb_fqdns) == 1 && length(distinct(values(local.location_to_region))) == 3
    error_message = "Each location routes to its own region; only the deployed ones have an ALB."
  }
  assert {
    condition     = length(aws_wafv2_web_acl.frontend) + length(aws_cloudtrail.main) + length(aws_guardduty_detector.main) + length(aws_cloudwatch_metric_alarm.cloudfront_5xx) == 0
    error_message = "No WAF, CloudTrail, GuardDuty or alarms."
  }
}

run "dev_3_regions" {
  command = apply

  variables {
    backend_regions = ["ap-south-1", "eu-west-1", "us-east-1"]
  }

  assert {
    condition     = local.fqdn == "superpower-dev.example.com" && length(local.regional_alb_fqdns) == 3 && length(distinct(values(local.location_to_region))) == 3
    error_message = "Each location routes to its own region; only the deployed ones have an ALB."
  }
  assert {
    condition     = length(aws_wafv2_web_acl.frontend) + length(aws_cloudtrail.main) + length(aws_guardduty_detector.main) + length(aws_cloudwatch_metric_alarm.cloudfront_5xx) == 0
    error_message = "No WAF, CloudTrail, GuardDuty or alarms."
  }
}
