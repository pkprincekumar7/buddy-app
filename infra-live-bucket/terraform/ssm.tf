# ---------------------------------------------------------------------------
# SSM Parameter Store — bucket registry
#
# Both buckets are in us-east-1 (same as the SSM control-plane region) so a
# single provider is used for everything in this module. Neither bucket path
# includes a region component — there is one bucket per environment, shared
# by all backend regions.
# ---------------------------------------------------------------------------

resource "aws_ssm_parameter" "frontend_bucket_name" {
  name  = "/${var.app_name}/${var.environment}/bucket/frontend_name"
  value = aws_s3_bucket.frontend.bucket
  type  = "String"

  tags = { Name = "${var.app_name}-bucket-frontend-name-${var.environment}" }
}

resource "aws_ssm_parameter" "frontend_bucket_arn" {
  name  = "/${var.app_name}/${var.environment}/bucket/frontend_arn"
  value = aws_s3_bucket.frontend.arn
  type  = "String"

  tags = { Name = "${var.app_name}-bucket-frontend-arn-${var.environment}" }
}

resource "aws_ssm_parameter" "backend_bucket_name" {
  name  = "/${var.app_name}/${var.environment}/bucket/backend_name"
  value = aws_s3_bucket.backend.bucket
  type  = "String"

  tags = { Name = "${var.app_name}-bucket-backend-name-${var.environment}" }
}

resource "aws_ssm_parameter" "backend_bucket_arn" {
  name  = "/${var.app_name}/${var.environment}/bucket/backend_arn"
  value = aws_s3_bucket.backend.arn
  type  = "String"

  tags = { Name = "${var.app_name}-bucket-backend-arn-${var.environment}" }
}
