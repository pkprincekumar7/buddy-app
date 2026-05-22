# Frontend S3 bucket — looked up by name (from var) to get the regional domain
# name used in the CloudFront origin config.
data "aws_s3_bucket" "frontend" {
  provider = aws.us_east_1
  bucket   = var.frontend_bucket_name
}

# Backend S3 bucket — holds static assets under app-assets/; served via CloudFront
# with a dedicated OAC so no public access is required on the bucket.
data "aws_s3_bucket" "backend" {
  provider = aws.us_east_1
  bucket   = var.backend_bucket_name
}
