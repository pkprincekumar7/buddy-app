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
data "aws_caller_identity" "current" {}

# Only this account's scheduler, for this stack's schedule group, may assume the role, so
# another account's (or another group's) schedule can't borrow it to invoke the dispatcher
# (production-readiness review, SEC-03 fix 3). For EventBridge Scheduler aws:SourceArn is
# the schedule group's ARN, not the schedule's.
resource "aws_iam_role" "scheduler" {
  name = "${var.app_name}-${var.environment}-scheduler-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "scheduler.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = {
        StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id }
        ArnEquals    = { "aws:SourceArn" = aws_scheduler_schedule_group.main.arn }
      }
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
# single dispatch (the dispatcher sends var.target_aws_regions, lambda.tf) — infra-live-edge is one shared distribution per
# environment, so a dispatch carrying only a subset of var.target_aws_regions
# would make Terraform destroy whichever regions were left out, not just
# leave them alone. A prior version of this file created one schedule per
# region, each sending only its own region — that was fine only by accident,
# because target_aws_regions had exactly one entry; it would have started
# actively destroying regions the moment a second one was added.
# ---------------------------------------------------------------------------
resource "aws_scheduler_schedule" "start" {
  #checkov:skip=CKV_AWS_297:The schedule's input is only the action (apply), no secrets; AWS-owned encryption is enough
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

    # The action only: the dispatcher builds the rest of the dispatch from this
    # stack (lambda.tf) and refuses anything else (SEC-03 fix 2).
    input = jsonencode({ action = "apply" })

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
  #checkov:skip=CKV_AWS_297:The schedule's input is only the action (destroy), no secrets; AWS-owned encryption is enough
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

    input = jsonencode({ action = "destroy" })

    retry_policy {
      maximum_event_age_in_seconds = 300
      maximum_retry_attempts       = 2
    }
  }
}
