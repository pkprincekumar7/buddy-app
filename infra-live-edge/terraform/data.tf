# Frontend S3 bucket — looked up by name (from var) to get the regional domain
# name used in the CloudFront origin config.
data "aws_s3_bucket" "frontend" {
  provider = aws.us_east_1
  bucket   = var.frontend_bucket_name
}
