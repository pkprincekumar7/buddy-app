# ---------------------------------------------------------------------------
# Lambda@Edge — RS256 JWT validation
#
# Validates the access_token cookie on every /api/* viewer request before
# the request is forwarded to the ALB. Invalid or missing tokens are
# rejected with 401 at the nearest CloudFront edge location — the request
# never consumes ALB or ECS capacity.
#
# Lambda@Edge must be provisioned in us-east-1 (enforced by AWS).
# This module already targets us-east-1 so no provider alias is needed.
#
# Public keys are injected at deploy time via templatefile() — no code
# edits are needed during key rotation. The private key never leaves
# Secrets Manager. See docs/jwt-keys.md for the full rotation procedure.
# ---------------------------------------------------------------------------

data "archive_file" "jwt_validator_lambda" {
  type        = "zip"
  output_path = "${path.module}/jwt-validator-lambda.zip"

  source {
    content = templatefile(
      "${path.module}/../functions/jwt-validator-lambda.js.tpl",
      {
        jwt_public_keys = var.jwt_public_keys
        jwt_key_id      = var.jwt_key_id
      }
    )
    filename = "index.js"
  }
}

resource "aws_iam_role" "jwt_validator_lambda" {
  name = "${var.app_name}-${var.environment}-jwt-validator-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = [
          "lambda.amazonaws.com",
          "edgelambda.amazonaws.com",
        ]
      }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "jwt_validator_lambda_basic" {
  role       = aws_iam_role.jwt_validator_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# ---------------------------------------------------------------------------
# On destroy, AWS replicates Lambda@Edge to all CloudFront edge locations and
# refuses deletion until every replica is removed. This sleep fires after the
# CloudFront distribution is destroyed, giving AWS time to clean up replicas
# before Terraform attempts to delete the function.
# The wait only applies during destroy — it is a no-op on apply.
# ---------------------------------------------------------------------------
resource "time_sleep" "wait_for_lambda_edge_replica_cleanup" {
  depends_on       = [aws_cloudfront_distribution.frontend]
  destroy_duration = "600s"
}

resource "aws_lambda_function" "jwt_validator" {
  filename         = data.archive_file.jwt_validator_lambda.output_path
  function_name    = "${var.app_name}-${var.environment}-jwt-validator"
  role             = aws_iam_role.jwt_validator_lambda.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  publish          = true
  source_code_hash = data.archive_file.jwt_validator_lambda.output_base64sha256
  memory_size      = 128
  timeout          = 5

  depends_on = [time_sleep.wait_for_lambda_edge_replica_cleanup]
}
