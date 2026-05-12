# ---------------------------------------------------------------------------
# SSM writes — consumed by infra-live-frontend (bucket policy) and
# deploy-live-frontend (CloudFront invalidation + S3 sync).
# ---------------------------------------------------------------------------

resource "aws_ssm_parameter" "cloudfront_distribution_id" {
  provider = aws.ssm

  name  = "/${var.app_name}/${var.environment}/edge/cloudfront_distribution_id"
  value = aws_cloudfront_distribution.frontend.id
  type  = "String"

  tags = { Name = "${var.app_name}-edge-cf-dist-id-${var.environment}" }
}

resource "aws_ssm_parameter" "cloudfront_arn" {
  provider = aws.ssm

  name  = "/${var.app_name}/${var.environment}/edge/cloudfront_arn"
  value = aws_cloudfront_distribution.frontend.arn
  type  = "String"

  tags = { Name = "${var.app_name}-edge-cf-arn-${var.environment}" }
}

resource "aws_ssm_parameter" "app_url" {
  provider = aws.ssm

  name  = "/${var.app_name}/${var.environment}/edge/app_url"
  value = "https://${local.fqdn}"
  type  = "String"

  tags = { Name = "${var.app_name}-edge-app-url-${var.environment}" }
}

resource "aws_ssm_parameter" "s3_bucket_name" {
  provider = aws.ssm

  name  = "/${var.app_name}/${var.environment}/edge/s3_bucket_name"
  value = var.frontend_bucket_name
  type  = "String"

  tags = { Name = "${var.app_name}-edge-s3-bucket-${var.environment}" }
}
