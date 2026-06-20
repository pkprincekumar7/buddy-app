# ---------------------------------------------------------------------------
# S3 bucket policy — frontend assets bucket (us-east-1)
#
# Grants CloudFront OAC (via this specific distribution ARN) read access to
# the bucket. Direct public access is blocked; only CloudFront can serve
# the assets. The CloudFront ARN is read from SSM (written by infra-live-edge).
# ---------------------------------------------------------------------------

resource "aws_s3_bucket_policy" "frontend" {
  bucket = var.spa_bucket_name

  lifecycle {
    precondition {
      condition     = data.aws_ssm_parameter.s3_bucket_name.value == var.spa_bucket_name
      error_message = "spa_bucket_name in tfvars (\"${var.spa_bucket_name}\") does not match the bucket name written to SSM by infra-live-edge. Update the tfvars value to match the SSM parameter."
    }
  }

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCloudFrontOAC"
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = "s3:GetObject"
        Resource = "arn:aws:s3:::${var.spa_bucket_name}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = data.aws_ssm_parameter.cloudfront_arn.value
          }
        }
      }
    ]
  })
}
