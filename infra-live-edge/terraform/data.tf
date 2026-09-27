# Frontend S3 bucket — looked up by name (from var) to get the regional domain
# name used in the CloudFront origin config.
data "aws_s3_bucket" "frontend" {
  provider = aws.us_east_1
  bucket   = var.spa_bucket_name
}

# Backend S3 bucket — holds static assets under app-assets/; served via CloudFront
# with a dedicated OAC so no public access is required on the bucket.
data "aws_s3_bucket" "backend" {
  provider = aws.us_east_1
  bucket   = var.assets_bucket_name
}

# Uploads S3 buckets — holds user-generated content (child profile photos,
# 90-day-plan/tracker photos) under uploads/{location}/; served via CloudFront
# OAC so no public S3 access is required. One literal block per supported
# region (provider aliases can't be for_each'd), each only created when that
# region is in var.backend_regions. try(...) guards the map lookup so a
# not-yet-active region's absent key never errors the plan.
data "aws_s3_bucket" "backend_uploads_ap_south_1" {
  count    = contains(var.backend_regions, "ap-south-1") ? 1 : 0
  provider = aws.ap_south_1
  bucket   = try(var.uploads_bucket_names["ap-south-1"], "")
}

data "aws_s3_bucket" "backend_uploads_eu_west_1" {
  count    = contains(var.backend_regions, "eu-west-1") ? 1 : 0
  provider = aws.eu_west_1
  bucket   = try(var.uploads_bucket_names["eu-west-1"], "")
}

data "aws_s3_bucket" "backend_uploads_us_east_1" {
  count    = contains(var.backend_regions, "us-east-1") ? 1 : 0
  provider = aws.us_east_1
  bucket   = try(var.uploads_bucket_names["us-east-1"], "")
}

locals {
  # region => data.aws_s3_bucket, one entry per currently-active backend
  # region. cloudfront.tf iterates this to build the regional uploads origins
  # and cache behaviours.
  regional_uploads_buckets = merge(
    contains(var.backend_regions, "ap-south-1") ? { "ap-south-1" = data.aws_s3_bucket.backend_uploads_ap_south_1[0] } : {},
    contains(var.backend_regions, "eu-west-1") ? { "eu-west-1" = data.aws_s3_bucket.backend_uploads_eu_west_1[0] } : {},
    contains(var.backend_regions, "us-east-1") ? { "us-east-1" = data.aws_s3_bucket.backend_uploads_us_east_1[0] } : {},
  )
}
