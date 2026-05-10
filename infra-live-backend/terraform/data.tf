# ---------------------------------------------------------------------------
# Remote state — infra-live-database module
# Provides: database VPC ID/CIDR, private route table ID, RDS endpoint,
#           RDS port, RDS secret ARN, RDS SG ID.
# Apply infra-live-database/terraform before this module.
# ---------------------------------------------------------------------------
data "terraform_remote_state" "live_db" {
  backend = "s3"
  config = {
    bucket = var.state_bucket
    key    = var.db_state_key
    region = "us-east-1"
  }
}

# CloudFront managed prefix list — restricts ALB inbound to CloudFront IPs only.
data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}
