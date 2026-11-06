# prod with its own tfvars (tfvars/prod.tfvars), every other input as the
# terraform-live-scheduler workflow passes it. Mock providers: no credentials, nothing is
# created. Run from infra-live-scheduler/terraform (check.sh and CI do):
#   terraform test -test-directory=tests/envs -filter=tests/envs/prod.tftest.hcl -var-file=tfvars/prod.tfvars

mock_provider "aws" {
  source = "./tests/envs/mocks"
}

variables {
  app_name           = "superpower"
  environment        = "prod"
  repository         = "owner/buddy-app"
  github_repo_owner  = "owner"
  github_repo_name   = "buddy-app"
  github_pat         = "not-a-real-token"
  target_aws_regions = ["ap-south-1"]
  schedule_enabled   = false
}

run "prod_applies" {
  command = apply

  assert {
    condition     = jsondecode(aws_scheduler_schedule.start.target[0].input).inputs.backend_regions == jsonencode(["ap-south-1"])
    error_message = "The start dispatch carries the full region list."
  }
  assert {
    condition     = length(aws_scheduler_schedule.stop) == 0
    error_message = "prod has no stop (destroy) schedule."
  }
  assert {
    condition     = length(aws_sns_topic.scheduler_alerts) == 0
    error_message = "No failure emails."
  }
}

# Served from ap-south-1 only (shared/routing.json served_from, DEC-01).
run "prod_another_region_is_refused" {
  command = plan

  variables {
    target_aws_regions = ["ap-south-1", "eu-west-1"]
  }

  expect_failures = [var.target_aws_regions]
}

run "prod_schedule_on_is_refused" {
  command = plan

  variables {
    schedule_enabled = true
  }

  expect_failures = [var.schedule_enabled]
}
