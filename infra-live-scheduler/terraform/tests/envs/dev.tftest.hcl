# dev with its own tfvars (tfvars/dev.tfvars), every other input as the
# terraform-live-scheduler workflow passes it. Mock providers: no credentials, nothing is
# created. Run from infra-live-scheduler/terraform (check.sh and CI do):
#   terraform test -test-directory=tests/envs -filter=tests/envs/dev.tftest.hcl -var-file=tfvars/dev.tfvars

mock_provider "aws" {
  source = "./tests/envs/mocks"
}

variables {
  app_name           = "superpower"
  environment        = "dev"
  repository         = "owner/buddy-app"
  github_repo_owner  = "owner"
  github_repo_name   = "buddy-app"
  github_pat         = "not-a-real-token"
  target_aws_regions = ["ap-south-1", "eu-west-1", "us-east-1"]
  schedule_enabled   = true
}

run "dev_applies" {
  command = apply

  assert {
    condition     = jsondecode(aws_scheduler_schedule.start.target[0].input).inputs.backend_regions == jsonencode(["ap-south-1", "eu-west-1", "us-east-1"])
    error_message = "The start dispatch carries the full region list."
  }
  assert {
    condition     = length(aws_scheduler_schedule.stop) == 1
    error_message = "The nightly stop schedule."
  }
  assert {
    condition     = length(aws_sns_topic.scheduler_alerts) == 0
    error_message = "No failure emails."
  }
}
