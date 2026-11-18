# The SPA bucket policy, shared by every environment. Mock providers: no credentials,
# nothing is created. Run from infra-live-frontend/terraform (check.sh and CI do):
#   terraform test
#
# The per-environment tests (tests/envs) check each environment's tfvars.

mock_provider "aws" {
  # What infra-live-edge wrote to SSM.
  override_data {
    target = data.aws_ssm_parameter.cloudfront_arn
    values = { value = "arn:aws:cloudfront::111111111111:distribution/E123" }
  }
  override_data {
    target = data.aws_ssm_parameter.s3_bucket_name
    values = { value = "superpower-stg-spa" }
  }
}

variables {
  app_name        = "superpower"
  environment     = "stg"
  repository      = "owner/buddy-app"
  spa_bucket_name = "superpower-stg-spa"
}

run "the_bucket_serves_only_this_distribution_over_tls" {
  command = apply

  assert {
    condition     = alltrue([for s in jsondecode(aws_s3_bucket_policy.frontend.policy).Statement : s.Principal.Service == "cloudfront.amazonaws.com" && s.Condition.StringEquals["AWS:SourceArn"] == "arn:aws:cloudfront::111111111111:distribution/E123" if s.Effect == "Allow"])
    error_message = "Every allow is for this environment's distribution only (OAC)."
  }
  assert {
    condition     = toset([for s in jsondecode(aws_s3_bucket_policy.frontend.policy).Statement : s.Action if s.Effect == "Allow"]) == toset(["s3:GetObject", "s3:ListBucket"])
    error_message = "CloudFront may read objects and list the bucket (so a missing file is a real 404, EDGE-03), and nothing else."
  }
  assert {
    condition     = one([for s in jsondecode(aws_s3_bucket_policy.frontend.policy).Statement : s if s.Effect == "Deny"]).Condition.Bool["aws:SecureTransport"] == "false" && one([for s in jsondecode(aws_s3_bucket_policy.frontend.policy).Statement : s if s.Effect == "Deny"]).Action == "s3:*" && one([for s in jsondecode(aws_s3_bucket_policy.frontend.policy).Statement : s if s.Effect == "Deny"]).Principal == "*"
    error_message = "The SPA bucket refuses every request not made over TLS (TF-05)."
  }
}

# A typo or an unknown environment name is refused at plan, before any SSM read or
# bucket policy: the bucket name and the distribution belong to one of the four.
run "an_unknown_environment_is_refused" {
  command = plan

  variables {
    environment = "qa"
  }

  expect_failures = [var.environment]
}
