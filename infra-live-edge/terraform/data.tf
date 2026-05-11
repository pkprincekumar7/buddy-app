# Frontend S3 bucket — looked up by name from SSM to get regional domain name
# for the CloudFront origin config.
data "aws_s3_bucket" "frontend" {
  provider = aws.us_east_1
  bucket   = data.aws_ssm_parameter.frontend_bucket_name.value
}
