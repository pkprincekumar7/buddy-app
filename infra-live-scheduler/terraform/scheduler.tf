# ---------------------------------------------------------------------------
# GitHub Actions scheduler via AWS EventBridge Scheduler
#
# Flow:
#   EventBridge Scheduler (exact IST time)
#     → Lambda (github-dispatcher)
#     → GitHub workflow_dispatch API
#     → terraform-live-all.yml runs immediately (no queue delay)
#
# schedule_expression_timezone is set via var.schedule_timezone (tfvars) — cron times
# are written in that timezone directly; no UTC conversion needed.
#
# To enable or disable schedules: re-run terraform-live-scheduler.yml with
# the schedule_enabled input set to true or false — no code change needed.
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# IAM role — allows EventBridge Scheduler to invoke the Lambda dispatcher
# ---------------------------------------------------------------------------
resource "aws_iam_role" "scheduler" {
  name = "${var.app_name}-${var.environment}-scheduler-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "scheduler.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "scheduler_invoke" {
  name = "${var.app_name}-${var.environment}-scheduler-invoke"
  role = aws_iam_role.scheduler.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "lambda:InvokeFunction"
      Resource = aws_lambda_function.dispatcher.arn
    }]
  })
}

# ---------------------------------------------------------------------------
# Schedule group
# ---------------------------------------------------------------------------
resource "aws_scheduler_schedule_group" "main" {
  name = "${var.app_name}-${var.environment}-github-actions"
}

# ---------------------------------------------------------------------------
# Start schedules — full apply + deploy (02:00 PM IST daily by default)
# One schedule per region in var.target_aws_regions.
# ---------------------------------------------------------------------------
resource "aws_scheduler_schedule" "start" {
  for_each   = toset(var.target_aws_regions)
  name       = "${var.app_name}-${var.environment}-start-${each.key}"
  group_name = aws_scheduler_schedule_group.main.name
  state      = var.schedule_enabled ? "ENABLED" : "DISABLED"

  flexible_time_window {
    mode = "OFF" # exact time, no flexibility window
  }

  schedule_expression          = var.start_schedule_expression
  schedule_expression_timezone = var.schedule_timezone

  target {
    arn      = aws_lambda_function.dispatcher.arn
    role_arn = aws_iam_role.scheduler.arn

    input = jsonencode({
      ref = var.github_default_branch
      inputs = {
        action      = "apply"
        environment = var.environment
        aws_region  = each.key
        deploy      = "true"
      }
    })

    retry_policy {
      maximum_event_age_in_seconds = 300
      maximum_retry_attempts       = 2
    }
  }
}

# ---------------------------------------------------------------------------
# Stop schedules — full destroy (10:00 PM IST daily by default)
# One schedule per region in var.target_aws_regions.
# ---------------------------------------------------------------------------
resource "aws_scheduler_schedule" "stop" {
  for_each   = toset(var.target_aws_regions)
  name       = "${var.app_name}-${var.environment}-stop-${each.key}"
  group_name = aws_scheduler_schedule_group.main.name
  state      = var.schedule_enabled ? "ENABLED" : "DISABLED"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = var.stop_schedule_expression
  schedule_expression_timezone = var.schedule_timezone

  target {
    arn      = aws_lambda_function.dispatcher.arn
    role_arn = aws_iam_role.scheduler.arn

    input = jsonencode({
      ref = var.github_default_branch
      inputs = {
        action      = "destroy"
        environment = var.environment
        aws_region  = each.key
        deploy      = "false"
      }
    })

    retry_policy {
      maximum_event_age_in_seconds = 300
      maximum_retry_attempts       = 2
    }
  }
}
