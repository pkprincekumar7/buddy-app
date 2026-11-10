# sbx with its own tfvars (tfvars/sbx.tfvars), every other input as the
# terraform-live-scheduler workflow passes it. Mock providers: no credentials, nothing is
# created. Run from infra-live-scheduler/terraform (check.sh and CI do):
#   terraform test -test-directory=tests/envs -filter=tests/envs/sbx.tftest.hcl -var-file=tfvars/sbx.tfvars

mock_provider "aws" {
  source = "./tests/envs/mocks"
}

variables {
  app_name           = "superpower"
  environment        = "sbx"
  repository         = "owner/buddy-app"
  github_repo_owner  = "owner"
  github_repo_name   = "buddy-app"
  github_pat         = "not-a-real-token"
  target_aws_regions = ["ap-south-1", "eu-west-1", "us-east-1"]
  schedule_enabled   = true
}

run "sbx_applies" {
  command = apply

  assert {
    condition     = aws_lambda_function.dispatcher.environment[0].variables.DISPATCH_BACKEND_REGIONS == jsonencode(["ap-south-1", "eu-west-1", "us-east-1"]) && aws_lambda_function.dispatcher.environment[0].variables.DISPATCH_ENVIRONMENT == "sbx"
    error_message = "The dispatcher dispatches this environment with the full region list."
  }
  assert {
    condition     = jsondecode(aws_scheduler_schedule.start.target[0].input) == { action = "apply" } && jsondecode(aws_scheduler_schedule.stop.target[0].input) == { action = "destroy" }
    error_message = "The schedules send only the action (SEC-03 fix 2)."
  }
  assert {
    condition     = length(aws_sns_topic.scheduler_alerts) == 0
    error_message = "No failure emails."
  }
}
