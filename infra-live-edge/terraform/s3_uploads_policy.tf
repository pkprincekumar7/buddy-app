# ---------------------------------------------------------------------------
# Uploads S3 bucket policies — CloudFront OAC access only
#
# Grants this (single, shared) CloudFront distribution SigV4-signed read
# access to uploads/* in each region's bucket. The condition pins access to
# this distribution's ARN so no other CloudFront distribution can read from
# any of these buckets.
#
# All four S3 Block Public Access settings remain ON — no public access is
# granted. Photos are served exclusively via CloudFront (/uploads/{location}/*
# behaviours — see cloudfront.tf).
#
# Local development uses a separate manually-managed bucket with a public
# GetObject policy on uploads/* — that bucket is never touched by Terraform.
#
# One literal block per supported region, each only created when that region
# is in var.backend_regions — same pattern as data.tf (provider aliases can't
# be for_each'd).
# ---------------------------------------------------------------------------

resource "aws_s3_bucket_policy" "backend_uploads_cf_ap_south_1" {
  count    = contains(var.backend_regions, "ap-south-1") ? 1 : 0
  provider = aws.ap_south_1
  bucket   = try(var.uploads_bucket_names["ap-south-1"], "")

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
        Resource = "arn:aws:s3:::${try(var.uploads_bucket_names["ap-south-1"], "")}/uploads/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.frontend.arn
          }
        }
      }
    ]
  })
}

resource "aws_s3_bucket_policy" "backend_uploads_cf_eu_west_1" {
  count    = contains(var.backend_regions, "eu-west-1") ? 1 : 0
  provider = aws.eu_west_1
  bucket   = try(var.uploads_bucket_names["eu-west-1"], "")

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
        Resource = "arn:aws:s3:::${try(var.uploads_bucket_names["eu-west-1"], "")}/uploads/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.frontend.arn
          }
        }
      }
    ]
  })
}

resource "aws_s3_bucket_policy" "backend_uploads_cf_us_east_1" {
  count    = contains(var.backend_regions, "us-east-1") ? 1 : 0
  provider = aws.us_east_1
  bucket   = try(var.uploads_bucket_names["us-east-1"], "")

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
        Resource = "arn:aws:s3:::${try(var.uploads_bucket_names["us-east-1"], "")}/uploads/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.frontend.arn
          }
        }
      }
    ]
  })
}
