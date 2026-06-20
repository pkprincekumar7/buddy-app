# ---------------------------------------------------------------------------
# Backend S3 bucket policy — CloudFront OAC access only
#
# Grants this CloudFront distribution SigV4-signed read access to app-assets/*.
# The condition pins access to this distribution's ARN so no other CloudFront
# distribution can use this bucket.
#
# Local development uses a completely separate bucket (set via ASSETS_BUCKET_NAME
# in .env) with its own public bucket policy — that bucket is never touched by Terraform.
#
# Only s3:GetObject is granted on the app-assets/ prefix; s3:ListBucket is
# intentionally omitted so directory listing is not possible.
# ---------------------------------------------------------------------------

resource "aws_s3_bucket_policy" "backend_assets_cf" {
  provider = aws.us_east_1
  bucket   = var.assets_bucket_name

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
        Resource = "arn:aws:s3:::${var.assets_bucket_name}/app-assets/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.frontend.arn
          }
        }
      }
    ]
  })
}
