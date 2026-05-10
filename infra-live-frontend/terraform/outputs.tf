output "app_url" {
  description = "Public HTTPS URL of the frontend"
  value       = "https://${local.fqdn}"
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID — required to invalidate cache after each frontend deploy (aws cloudfront create-invalidation --distribution-id <id> --paths '/*')"
  value       = aws_cloudfront_distribution.frontend.id
}

output "cloudfront_domain_name" {
  description = "CloudFront distribution domain name (e.g. d1234abcd.cloudfront.net)"
  value       = aws_cloudfront_distribution.frontend.domain_name
}

output "s3_bucket_name" {
  description = "S3 bucket name — upload built frontend assets here to deploy"
  value       = data.aws_s3_bucket.frontend.bucket
}

output "s3_bucket_arn" {
  description = "S3 bucket ARN"
  value       = data.aws_s3_bucket.frontend.arn
}

output "waf_web_acl_arn" {
  description = "WAF WebACL ARN (us-east-1)"
  value       = aws_wafv2_web_acl.frontend.arn
}
