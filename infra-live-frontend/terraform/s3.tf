# ---------------------------------------------------------------------------
# S3 — frontend assets bucket (pre-existing, not managed by Terraform)
#
# This bucket is created and owned outside of Terraform to avoid accidental
# loss of the globally-unique bucket name on terraform destroy.
# The bucket name is supplied via var.frontend_bucket_name.
#
# CloudFront accesses the bucket via Origin Access Control (OAC) — the bucket
# is fully private; no direct public access is allowed.
#
# Bucket name convention: person-frontend-{env}-bucket
# ---------------------------------------------------------------------------

data "aws_s3_bucket" "frontend" {
  provider = aws.us_east_1
  bucket   = var.frontend_bucket_name
}

# ---------------------------------------------------------------------------
# Origin Access Control — CloudFront signs requests to S3 with SigV4.
# Replaces the legacy Origin Access Identity (OAI) approach.
# ---------------------------------------------------------------------------
resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "${var.app_name}-frontend-oac-${var.environment}"
  description                       = "OAC for ${var.app_name} frontend S3 bucket (${var.environment})"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Bucket policy — only CloudFront (via OAC) may read objects.
# The Condition ties the policy to this specific distribution, not all CloudFront.
resource "aws_s3_bucket_policy" "frontend" {
  provider = aws.us_east_1
  bucket   = data.aws_s3_bucket.frontend.id

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
        Resource = "${data.aws_s3_bucket.frontend.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.frontend.arn
          }
        }
      }
    ]
  })
}
