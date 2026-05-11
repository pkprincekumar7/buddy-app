output "frontend_bucket_name" {
  description = "Frontend S3 bucket name (us-east-1)"
  value       = aws_s3_bucket.frontend.bucket
}

output "frontend_bucket_arn" {
  description = "Frontend S3 bucket ARN"
  value       = aws_s3_bucket.frontend.arn
}

output "backend_bucket_name" {
  description = "Backend S3 bucket name (us-east-1)"
  value       = aws_s3_bucket.backend.bucket
}

output "backend_bucket_arn" {
  description = "Backend S3 bucket ARN (us-east-1)"
  value       = aws_s3_bucket.backend.arn
}
