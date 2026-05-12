# CloudFront managed prefix list — restricts ALB inbound to CloudFront IPs only.
data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}
