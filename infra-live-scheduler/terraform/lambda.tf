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
    Statement = [
      {
        Sid    = "Logs"
        Effect = "Allow"
        Action = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/${var.app_name}-${var.environment}-github-dispatcher:*"
      },
      {
        Sid      = "ReadPat"
        Effect   = "Allow"
        Action   = "secretsmanager:GetSecretValue"
        Resource = aws_secretsmanager_secret.github_pat.arn
      }
    ]
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
resource "aws_lambda_function" "dispatcher" {
  #checkov:skip=CKV_AWS_116:Scheduler retry_policy handles retries — DLQ not required
  #checkov:skip=CKV_AWS_117:Function only calls GitHub public API and Secrets Manager — VPC not required
  #checkov:skip=CKV_AWS_50:X-Ray tracing not required for this simple dispatcher
  #checkov:skip=CKV_AWS_272:Code signing not required for internal infrastructure Lambda
  #checkov:skip=CKV_AWS_115:Reserved concurrency not required — invoked at most twice daily

  function_name    = "${var.app_name}-${var.environment}-github-dispatcher"
  role             = aws_iam_role.lambda_exec.arn
  runtime          = "python3.12"
  handler          = "dispatcher.lambda_handler"
  filename         = data.archive_file.dispatcher.output_path
  source_code_hash = data.archive_file.dispatcher.output_base64sha256
  timeout          = 30

  environment {
    variables = {
      GITHUB_PAT_SECRET_ARN = aws_secretsmanager_secret.github_pat.arn
      GITHUB_REPO_OWNER     = var.github_repo_owner
      GITHUB_REPO_NAME      = var.github_repo_name
      GITHUB_WORKFLOW_FILE  = var.github_workflow_file
    }
  }
}
