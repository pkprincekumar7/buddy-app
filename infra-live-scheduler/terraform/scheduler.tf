# ---------------------------------------------------------------------------
# GitHub Actions scheduler via AWS EventBridge Scheduler
#
# Flow:
#   EventBridge Scheduler (exact IST time)
#     → API Destination (POST …/actions/workflows/terraform-live-all.yml/dispatches)
#     → GitHub workflow_dispatch event on terraform-live-all.yml
#     → Full-stack apply or destroy runs immediately (no queue delay)
#
# schedule_expression_timezone is set via var.schedule_timezone (tfvars) — cron times
# are written in that timezone directly; no UTC conversion needed.
#
# To enable or disable schedules: re-run terraform-live-scheduler.yml with
# the schedule_enabled input set to true or false — no code change needed.
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# EventBridge Connection — stores GitHub PAT for API auth
# Injected as Authorization: Bearer <token> on every HTTP request.
# Value is sourced from var.github_pat (GitHub environment secret).
# ---------------------------------------------------------------------------
resource "aws_cloudwatch_event_connection" "github" {
  name               = "${var.app_name}-${var.environment}-github-api"
  authorization_type = "API_KEY"

  auth_parameters {
    api_key {
      key   = "Authorization"
      value = "Bearer ${var.github_pat}"
    }

    invocation_http_parameters {
      header {
        key   = "Accept"
        value = "application/vnd.github+json"
      }
      header {
        key   = "Content-Type"
        value = "application/json"
      }
      header {
        key   = "X-GitHub-Api-Version"
        value = "2022-11-28"
      }
    }
  }
}

# ---------------------------------------------------------------------------
# API Destination — GitHub workflow_dispatch endpoint for terraform-live-all
# Triggers terraform-live-all.yml directly; no intermediate schedule wrapper.
# Rate limited to 1 req/sec (GitHub API limit is 5000/hr — this is conservative).
# ---------------------------------------------------------------------------
resource "aws_cloudwatch_event_api_destination" "github_dispatch" {
  name                             = "${var.app_name}-${var.environment}-github-dispatch"
  connection_arn                   = aws_cloudwatch_event_connection.github.arn
  invocation_endpoint              = "https://api.github.com/repos/${var.github_repo_owner}/${var.github_repo_name}/actions/workflows/${var.github_workflow_file}/dispatches"
  http_method                      = "POST"
  invocation_rate_limit_per_second = 1
}

# ---------------------------------------------------------------------------
# IAM role — allows EventBridge Scheduler to invoke the API destination
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
      Action   = "events:InvokeApiDestination"
      Resource = aws_cloudwatch_event_api_destination.github_dispatch.arn
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
    arn      = aws_cloudwatch_event_api_destination.github_dispatch.arn
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
    arn      = aws_cloudwatch_event_api_destination.github_dispatch.arn
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
  }
}
