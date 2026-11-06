# stg with its own tfvars (tfvars/stg.tfvars), every other input as the
# terraform-live-scheduler workflow passes it. Mock providers: no credentials, nothing is
# created. Run from infra-live-scheduler/terraform (check.sh and CI do):
#   terraform test -test-directory=tests/envs -filter=tests/envs/stg.tftest.hcl -var-file=tfvars/stg.tfvars

mock_provider "aws" {
  source = "./tests/envs/mocks"
}

variables {
  app_name           = "superpower"
  environment        = "stg"
  repository         = "owner/buddy-app"
  github_repo_owner  = "owner"
  github_repo_name   = "buddy-app"
  github_pat         = "not-a-real-token"
  target_aws_regions = ["ap-south-1"]
  schedule_enabled   = true
  ops_email          = "ops@example.com"
}

run "stg_applies" {
  command = apply

  assert {
    condition     = jsondecode(aws_scheduler_schedule.start.target[0].input).inputs.backend_regions == jsonencode(["ap-south-1"])
    error_message = "The start dispatch carries the full region list."
  }
  assert {
    condition     = length(aws_scheduler_schedule.stop) == 1
    error_message = "The nightly stop schedule."
  }
  assert {
    condition     = length(aws_sns_topic.scheduler_alerts) == 1
    error_message = "Failed dispatches are emailed (SCH-01)."
  }
}

# Served from ap-south-1 only (shared/routing.json served_from, DEC-01).
run "stg_another_region_is_refused" {
  command = plan

  variables {
    target_aws_regions = ["ap-south-1", "eu-west-1"]
  }

  expect_failures = [var.target_aws_regions]
}
