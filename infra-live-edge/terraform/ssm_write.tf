# ---------------------------------------------------------------------------
# SSM writes — consumed by infra-live-frontend (bucket policy) and
# deploy-live-frontend (CloudFront invalidation + S3 sync).
# ---------------------------------------------------------------------------

resource "aws_ssm_parameter" "cloudfront_distribution_id" {
  #checkov:skip=CKV2_AWS_34:Non-sensitive configuration value (CloudFront distribution ID); KMS encryption on plain String params adds cost without security benefit

  name  = "/${var.app_name}/${var.environment}/edge/cloudfront_distribution_id"
  value = aws_cloudfront_distribution.frontend.id
  type  = "String"

  tags = { Name = "${var.app_name}-edge-cf-dist-id-${var.environment}" }
}

resource "aws_ssm_parameter" "cloudfront_arn" {
  #checkov:skip=CKV2_AWS_34:Non-sensitive configuration value (CloudFront ARN); KMS encryption on plain String params adds cost without security benefit

  name  = "/${var.app_name}/${var.environment}/edge/cloudfront_arn"
  value = aws_cloudfront_distribution.frontend.arn
  type  = "String"

  tags = { Name = "${var.app_name}-edge-cf-arn-${var.environment}" }
}

resource "aws_ssm_parameter" "app_url" {
  #checkov:skip=CKV2_AWS_34:Non-sensitive configuration value (public app URL); KMS encryption on plain String params adds cost without security benefit

  name  = "/${var.app_name}/${var.environment}/edge/app_url"
  value = "https://${local.fqdn}"
  type  = "String"

  tags = { Name = "${var.app_name}-edge-app-url-${var.environment}" }
}

resource "aws_ssm_parameter" "s3_bucket_name" {
  #checkov:skip=CKV2_AWS_34:Non-sensitive configuration value (S3 bucket name); KMS encryption on plain String params adds cost without security benefit

  name  = "/${var.app_name}/${var.environment}/edge/s3_bucket_name"
  value = var.frontend_bucket_name
  type  = "String"

  tags = { Name = "${var.app_name}-edge-s3-bucket-${var.environment}" }
}
