# ---------------------------------------------------------------------------
# Lambda — GitHub Actions dispatcher
#
# Flow:
#   EventBridge Scheduler (exact IST time)
#     → Lambda (this function)
#     → GitHub workflow_dispatch API
#     → terraform-live-all.yml runs immediately
#
# The function reads the GitHub PAT from Secrets Manager at invocation time
# so a PAT rotation only requires a new terraform apply on secrets.tf —
# no Lambda redeployment needed.
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# IAM role — Lambda execution
# ---------------------------------------------------------------------------
resource "aws_iam_role" "lambda_exec" {
  name = "${var.app_name}-${var.environment}-scheduler-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "lambda_exec" {
  name = "${var.app_name}-${var.environment}-scheduler-lambda-policy"
  role = aws_iam_role.lambda_exec.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat([
      {
        # The log group is Terraform's (below), so the function only writes to it.
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.dispatcher.arn}:*"
      },
      {
        Sid      = "ReadPat"
        Effect   = "Allow"
        Action   = "secretsmanager:GetSecretValue"
        Resource = aws_secretsmanager_secret.github_pat.arn
      }
      ], var.enable_alarms ? [{
        # The on_failure destination (below) publishes as the function's role.
        Sid      = "PublishFailures"
        Effect   = "Allow"
        Action   = "sns:Publish"
        Resource = aws_sns_topic.scheduler_alerts[0].arn
    }] : [])
  })
}

# ---------------------------------------------------------------------------
# Lambda package — zipped from source at plan time
# ---------------------------------------------------------------------------
data "archive_file" "dispatcher" {
  type        = "zip"
  source_file = "${path.module}/../lambda/dispatcher.py"
  output_path = "${path.module}/../lambda/dispatcher.zip"
}

# ---------------------------------------------------------------------------
# Lambda function
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Log group — managed here so it has a retention. Not Lambda's default
# /aws/lambda/<function> name: Lambda creates that group itself on its first
# run, so an environment that has already run would refuse to create it again.
# ---------------------------------------------------------------------------
resource "aws_cloudwatch_log_group" "dispatcher" {
  #checkov:skip=CKV_AWS_158:AWS-managed encryption is sufficient for two dispatch lines a day; a CMK adds cost without meaningful uplift
  #checkov:skip=CKV_AWS_338:30 days covers any failed dispatch's investigation; the lines carry no data worth a year
  name              = "/${var.app_name}/${var.environment}/scheduler/github-dispatcher"
  retention_in_days = 30
}

resource "aws_lambda_function" "dispatcher" {
  #checkov:skip=CKV_AWS_116:Failed invocations aren't retried (aws_lambda_function_event_invoke_config below); they go to the logs and, where enable_alarms, to an on_failure destination (alarms.tf), not a DLQ to replay
  #checkov:skip=CKV_AWS_117:Function only calls GitHub public API and Secrets Manager — VPC not required
  #checkov:skip=CKV_AWS_50:X-Ray tracing not required for this simple dispatcher
  #checkov:skip=CKV_AWS_272:Code signing not required for internal infrastructure Lambda
  #checkov:skip=CKV_AWS_115:Reserved concurrency not required — invoked at most twice daily
  #checkov:skip=CKV_AWS_173:The environment holds only the PAT secret's ARN, the repo/workflow names and the dispatch's ref, environment and regions, no secret values; AWS-managed encryption is enough

  function_name    = "${var.app_name}-${var.environment}-github-dispatcher"
  role             = aws_iam_role.lambda_exec.arn
  runtime          = "python3.13"
  handler          = "dispatcher.lambda_handler"
  filename         = data.archive_file.dispatcher.output_path
  source_code_hash = data.archive_file.dispatcher.output_base64sha256
  timeout          = 30

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.dispatcher.name
  }

  environment {
    variables = {
      GITHUB_PAT_SECRET_ARN = aws_secretsmanager_secret.github_pat.arn
      GITHUB_REPO_OWNER     = var.github_repo_owner
      GITHUB_REPO_NAME      = var.github_repo_name
      GITHUB_WORKFLOW_FILE  = var.github_workflow_file
      # The dispatch is built from these, never from the invoke event, which only picks
      # the action (SEC-03 fix 2). backend_regions is a JSON-array string, as
      # terraform-live-all.yml's input expects, with the complete region set.
      DISPATCH_REF             = var.github_default_branch
      DISPATCH_ENVIRONMENT     = var.environment
      DISPATCH_BACKEND_REGIONS = jsonencode(var.target_aws_regions)
    }
  }
}

# ---------------------------------------------------------------------------
# No async retries (production-readiness review, SCH-01). EventBridge Scheduler
# invokes the function asynchronously, and Lambda would otherwise run a failed
# invocation twice more. A dispatch that GitHub accepted but whose answer was
# lost (a timeout, a dropped connection) would then start the same apply or
# destroy again. A failure stays a failure: it's in the log, and the next run of
# the schedule tries afresh. The schedules' own retry_policy (scheduler.tf) only
# covers delivering the event to Lambda, which can't double a dispatch.
# ---------------------------------------------------------------------------
resource "aws_lambda_function_event_invoke_config" "dispatcher" {
  function_name                = aws_lambda_function.dispatcher.function_name
  maximum_retry_attempts       = 0
  maximum_event_age_in_seconds = 300

  # The failed invocation (the schedule's event and the error) to OPS_EMAIL (alarms.tf).
  dynamic "destination_config" {
    for_each = var.enable_alarms ? [1] : []
    content {
      on_failure {
        destination = aws_sns_topic.scheduler_alerts[0].arn
      }
    }
  }
}
