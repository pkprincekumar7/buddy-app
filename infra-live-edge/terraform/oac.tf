# ---------------------------------------------------------------------------
# CloudFront Origin Access Control — S3 origin
#
# Signs CloudFront requests to S3 with SigV4. The S3 bucket policy
# (in infra-live-frontend) uses the CloudFront distribution ARN written to
# SSM by this module to restrict access to this specific distribution only.
# ---------------------------------------------------------------------------

resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "${var.app_name}-frontend-oac-${var.environment}"
  description                       = "OAC for ${var.app_name} frontend S3 bucket (${var.environment})"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_origin_access_control" "backend_assets" {
  name                              = "${var.app_name}-backend-assets-oac-${var.environment}"
  description                       = "OAC for ${var.app_name} backend S3 assets (${var.environment})"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}
