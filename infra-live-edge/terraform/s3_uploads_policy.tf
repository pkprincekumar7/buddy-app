# ---------------------------------------------------------------------------
# Uploads S3 bucket policy — CloudFront OAC access only
#
# Grants this CloudFront distribution SigV4-signed read access to uploads/*.
# The condition pins access to this distribution's ARN so no other CloudFront
# distribution can read from this bucket.
#
# All four S3 Block Public Access settings remain ON — no public access is
# granted. Photos are served exclusively via CloudFront (/uploads/* behaviour).
#
# Local development uses a separate manually-managed bucket with a public
# GetObject policy on uploads/* — that bucket is never touched by Terraform.
# ---------------------------------------------------------------------------

resource "aws_s3_bucket_policy" "backend_uploads_cf" {
  provider = aws.ap_south_1
  bucket   = var.uploads_bucket_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCloudFrontOACGetUploads"
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = "s3:GetObject"
        Resource = "arn:aws:s3:::${var.uploads_bucket_name}/uploads/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.frontend.arn
          }
        }
      }
    ]
  })
}
