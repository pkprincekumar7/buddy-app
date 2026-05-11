# ---------------------------------------------------------------------------
# SSM reads (us-east-1 control plane via aws.ssm).
# Apply infra-live-bucket and infra-live-edge before applying infra-live-frontend.
# ---------------------------------------------------------------------------

data "aws_ssm_parameter" "cloudfront_arn" {
  provider = aws.ssm

  name = "/${var.app_name}/${var.environment}/edge/cloudfront_arn"
}

data "aws_ssm_parameter" "frontend_bucket_name" {
  provider = aws.ssm

  name = "/${var.app_name}/${var.environment}/bucket/frontend_name"
}

data "aws_ssm_parameter" "frontend_bucket_arn" {
  provider = aws.ssm

  name = "/${var.app_name}/${var.environment}/bucket/frontend_arn"
}
