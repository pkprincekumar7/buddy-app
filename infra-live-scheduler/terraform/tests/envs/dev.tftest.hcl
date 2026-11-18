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
    condition     = aws_lambda_function.dispatcher.environment[0].variables.DISPATCH_BACKEND_REGIONS == jsonencode(["ap-south-1", "eu-west-1", "us-east-1"]) && aws_lambda_function.dispatcher.environment[0].variables.DISPATCH_ENVIRONMENT == "dev"
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

# SEC-03 fix 3: only this account's scheduler, for this stack's schedule group.
run "dev_trust_is_scoped_to_the_schedule_group" {
  command = apply

  assert {
    condition     = jsondecode(aws_iam_role.scheduler.assume_role_policy).Statement[0].Condition.StringEquals["aws:SourceAccount"] == data.aws_caller_identity.current.account_id && jsondecode(aws_iam_role.scheduler.assume_role_policy).Statement[0].Condition.ArnEquals["aws:SourceArn"] == aws_scheduler_schedule_group.main.arn
    error_message = "The scheduler role is assumable only for this account's schedule group."
  }
}

# There is no prod scheduler (SEC-03).
run "prod_is_refused" {
  command = plan

  variables {
    environment = "prod"
  }

  expect_failures = [var.environment]
}
