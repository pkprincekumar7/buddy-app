# stg with its own tfvars (tfvars/stg.tfvars), every other input as the
# terraform-live-frontend workflow passes it. Mock providers: no credentials, nothing is
# created. Run from infra-live-frontend/terraform (check.sh and CI do):
#   terraform test -test-directory=tests/envs -filter=tests/envs/stg.tftest.hcl -var-file=tfvars/stg.tfvars

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

run "stg_applies" {
  command = apply

  assert {
    condition     = jsondecode(aws_s3_bucket_policy.frontend.policy).Statement[0].Condition.StringEquals["AWS:SourceArn"] == "arn:aws:cloudfront::111111111111:distribution/E123"
    error_message = "Only this environment's distribution reads the bucket."
  }
}

run "stg_another_bucket_is_refused" {
  command = plan

  variables {
    spa_bucket_name = "superpower-other-spa"
  }

  expect_failures = [aws_s3_bucket_policy.frontend]
}
