output "app_url" {
  description = "Public HTTPS URL of the frontend"
  value       = "https://${local.fqdn}"
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID"
  value       = aws_cloudfront_distribution.frontend.id
}

output "cloudfront_domain_name" {
  description = "CloudFront distribution domain name (e.g. d1234abcd.cloudfront.net)"
  value       = aws_cloudfront_distribution.frontend.domain_name
}

output "cloudfront_arn" {
  description = "CloudFront distribution ARN — referenced by the S3 bucket policy in infra-live-frontend"
  value       = aws_cloudfront_distribution.frontend.arn
}

output "waf_web_acl_arn" {
  description = "WAF WebACL ARN (us-east-1)"
  value       = aws_wafv2_web_acl.frontend.arn
}
