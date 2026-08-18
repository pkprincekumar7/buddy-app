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

# Uploads S3 bucket — holds user-generated content (child profile photos) under
# uploads/; served via CloudFront OAC so no public S3 access is required.
data "aws_s3_bucket" "backend_uploads" {
  provider = aws.ap_south_1
  bucket   = var.uploads_bucket_name
}
