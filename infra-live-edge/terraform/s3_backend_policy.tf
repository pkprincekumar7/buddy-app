# ---------------------------------------------------------------------------
# Backend S3 bucket policy — CloudFront OAC access only
#
# Grants the CloudFront distribution read access to the assets/ prefix via
# OAC (SigV4 signed requests). The condition pins access to this specific
# distribution so no other CloudFront distribution can use this bucket.
#
# Public read access on assets/* is managed manually in the AWS console for
# local dev environments (Vite proxy and nginx proxy fetch directly from S3
# without AWS credentials). It is intentionally omitted here so that a
# terraform destroy does not revoke it and break local dev image loading.
#
# Only s3:GetObject is granted on the assets/ prefix; s3:ListBucket is
# intentionally omitted so directory listing is not possible.
# ---------------------------------------------------------------------------

resource "aws_s3_bucket_policy" "backend_assets_cf" {
  provider = aws.us_east_1
  bucket   = var.backend_bucket_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCloudFrontOACGetAssets"
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = "s3:GetObject"
        Resource = "arn:aws:s3:::${var.backend_bucket_name}/assets/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.frontend.arn
          }
        }
      }
    ]
  })
}
