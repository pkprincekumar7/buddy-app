# The scheduler stack's safety settings, shared by every environment: a refactor that
# dropped one would still plan and apply cleanly. Mock providers: no credentials, nothing
# is created. Run from infra-live-scheduler/terraform (check.sh and CI do): terraform test
#
# The per-environment tests (tests/envs) check each environment's tfvars.

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
  schedule_timezone  = "Asia/Kolkata"
  enable_alarms      = true
  ops_email          = "ops@example.com"
}

# SCH-01: a dispatch GitHub accepted but whose answer was lost must not run again.
run "a_failed_dispatch_is_never_retried" {
  command = apply

  assert {
    condition     = aws_lambda_function_event_invoke_config.dispatcher.maximum_retry_attempts == 0
    error_message = "Lambda's async retries are off: a retried dispatch could start the same apply or destroy twice (SCH-01)."
  }
  assert {
    condition     = aws_lambda_function.dispatcher.timeout == 30 && aws_lambda_function.dispatcher.timeout > 10
    error_message = "The function outlives its 10 s GitHub timeout (dispatcher.py, GITHUB_TIMEOUT_SECONDS)."
  }
  assert {
    condition     = one(one(aws_lambda_function_event_invoke_config.dispatcher.destination_config).on_failure).destination == aws_sns_topic.scheduler_alerts[0].arn
    error_message = "A failed dispatch, refused events included, goes to the alert topic."
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.dispatcher_errors[0].metric_name == "Errors" && aws_cloudwatch_metric_alarm.dispatcher_errors[0].threshold == 1 && contains(aws_cloudwatch_metric_alarm.dispatcher_errors[0].alarm_actions, aws_sns_topic.scheduler_alerts[0].arn)
    error_message = "One dispatcher error alarms by email."
  }
}

# SEC-03: each role can do one thing.
run "least_privilege" {
  command = apply

  assert {
    condition     = jsondecode(aws_iam_role_policy.scheduler_invoke.policy).Statement[0].Action == "lambda:InvokeFunction" && jsondecode(aws_iam_role_policy.scheduler_invoke.policy).Statement[0].Resource == aws_lambda_function.dispatcher.arn && length(jsondecode(aws_iam_role_policy.scheduler_invoke.policy).Statement) == 1
    error_message = "The scheduler's role may invoke the dispatcher and nothing else."
  }
  assert {
    condition     = one([for s in jsondecode(aws_iam_role_policy.lambda_exec.policy).Statement : s if s.Sid == "ReadPat"]).Resource == aws_secretsmanager_secret.github_pat.arn && one([for s in jsondecode(aws_iam_role_policy.lambda_exec.policy).Statement : s if s.Sid == "ReadPat"]).Action == "secretsmanager:GetSecretValue"
    error_message = "The function reads this stack's token secret only."
  }
  assert {
    condition     = alltrue([for s in jsondecode(aws_iam_role_policy.lambda_exec.policy).Statement : !strcontains(jsonencode(s.Resource), "\"*\"") && s.Resource != "*"])
    error_message = "No statement of the function's policy is on every resource."
  }
  assert {
    condition     = jsondecode(aws_iam_role.lambda_exec.assume_role_policy).Statement[0].Principal.Service == "lambda.amazonaws.com"
    error_message = "Only Lambda assumes the function's role."
  }
}

run "the_token_is_kept_out_of_the_function" {
  command = apply

  assert {
    condition     = !strcontains(jsonencode(aws_lambda_function.dispatcher.environment[0].variables), "not-a-real-token")
    error_message = "The token is read from Secrets Manager at run time, never put in the function's environment."
  }
  assert {
    condition     = aws_cloudwatch_log_group.dispatcher.retention_in_days == 30
    error_message = "The dispatcher's log group has a retention."
  }
}

run "no_alarms_when_disabled" {
  command = apply

  variables {
    enable_alarms = false
  }

  assert {
    condition     = length(aws_sns_topic.scheduler_alerts) == 0 && length(aws_lambda_function_event_invoke_config.dispatcher.destination_config) == 0 && aws_lambda_function_event_invoke_config.dispatcher.maximum_retry_attempts == 0
    error_message = "Without alarms there is no topic or destination, and still no retries."
  }
}

# SCH-01: the alert topic emails the operator, and nothing else subscribes.
run "failed_dispatches_email_the_operator" {
  command = apply

  assert {
    condition     = aws_sns_topic_subscription.scheduler_ops_email[0].topic_arn == aws_sns_topic.scheduler_alerts[0].arn && aws_sns_topic_subscription.scheduler_ops_email[0].protocol == "email" && aws_sns_topic_subscription.scheduler_ops_email[0].endpoint == "ops@example.com"
    error_message = "The alert topic emails OPS_EMAIL (SCH-01)."
  }
  assert {
    condition     = length(aws_sns_topic_subscription.scheduler_ops_email) == 1
    error_message = "The alert topic has exactly one subscription, the operator's email."
  }
}

# The token secret holds exactly what the workflow passed (GIT_ACTIONS_PAT): a raw
# string, no placeholder and no ignore_changes. Fake tokens only.
run "the_token_secret_holds_the_workflow_token" {
  command = apply

  assert {
    condition     = aws_secretsmanager_secret_version.github_pat.secret_id == aws_secretsmanager_secret.github_pat.id
    error_message = "The token's version belongs to this stack's token secret."
  }
  assert {
    condition     = nonsensitive(aws_secretsmanager_secret_version.github_pat.secret_string == "not-a-real-token")
    error_message = "The secret holds the raw token the workflow passed, not a placeholder or a JSON object."
  }
}

# A rotated GIT_ACTIONS_PAT reaches Secrets Manager on the next apply: the version
# follows the input, it does not ignore changes.
run "a_rotated_token_is_synced" {
  command = apply

  variables {
    github_pat = "not-a-real-token-rotated"
  }

  assert {
    condition     = nonsensitive(aws_secretsmanager_secret_version.github_pat.secret_string == "not-a-real-token-rotated") && aws_secretsmanager_secret_version.github_pat.secret_id == aws_secretsmanager_secret.github_pat.id
    error_message = "Every apply syncs the secret to the token the workflow passed."
  }
}

# Alarms with nowhere to send them would fail silently: refused at plan.
run "alarms_without_an_ops_email_are_refused" {
  command = plan

  variables {
    enable_alarms = true
    ops_email     = ""
  }

  expect_failures = [var.ops_email]
}

# A region routing.json doesn't know is refused at plan. dev isn't in served_from, so
# only the routing.json rule applies (not the one-region rule); prod is never used here.
run "an_unknown_region_is_refused" {
  command = plan

  variables {
    environment        = "dev"
    target_aws_regions = ["eu-central-1"]
  }

  expect_failures = [var.target_aws_regions]
}
