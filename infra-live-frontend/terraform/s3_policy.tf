# ---------------------------------------------------------------------------
# S3 bucket policy — frontend assets bucket (us-east-1)
#
# Grants CloudFront OAC (via this specific distribution ARN) read access to
# the bucket. Direct public access is blocked; only CloudFront can serve
# the assets. The CloudFront ARN is read from SSM (written by infra-live-edge).
# ---------------------------------------------------------------------------

resource "aws_s3_bucket_policy" "frontend" {
  provider = aws.us_east_1
  bucket   = data.aws_ssm_parameter.frontend_bucket_name.value

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
        Resource = "${data.aws_ssm_parameter.frontend_bucket_arn.value}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = data.aws_ssm_parameter.cloudfront_arn.value
          }
        }
      }
    ]
  })
}
