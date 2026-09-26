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
# Start schedule — full apply + deploy (03:00 PM IST daily by default)
#
# Exactly ONE schedule, not one per region: terraform-live-all.yml's
# backend_regions must always receive the COMPLETE intended region set in a
# single dispatch — infra-live-edge is one shared distribution per
# environment, so a dispatch carrying only a subset of var.target_aws_regions
# would make Terraform destroy whichever regions were left out, not just
# leave them alone. A prior version of this file created one schedule per
# region, each sending only its own region — that was fine only by accident,
# because target_aws_regions had exactly one entry; it would have started
# actively destroying regions the moment a second one was added.
# ---------------------------------------------------------------------------
resource "aws_scheduler_schedule" "start" {
  name       = "${var.app_name}-${var.environment}-start"
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
        # terraform-live-all.yml's backend_regions expects a JSON-array
        # *string* (its own input type is a plain string/choice, not a
        # list) — jsonencode(var.target_aws_regions) here produces exactly
        # that, carrying the complete region set in one dispatch.
        backend_regions = jsonencode(var.target_aws_regions)
        deploy          = "true"
      }
    })

    retry_policy {
      maximum_event_age_in_seconds = 300
      maximum_retry_attempts       = 2
    }
  }
}

# ---------------------------------------------------------------------------
# Stop schedule — full destroy (10:00 PM IST daily by default)
# Exactly ONE schedule — same reasoning as the start schedule above.
# ---------------------------------------------------------------------------
resource "aws_scheduler_schedule" "stop" {
  name       = "${var.app_name}-${var.environment}-stop"
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
        action          = "destroy"
        environment     = var.environment
        backend_regions = jsonencode(var.target_aws_regions)
        deploy          = "false"
      }
    })

    retry_policy {
      maximum_event_age_in_seconds = 300
      maximum_retry_attempts       = 2
    }
  }
}
