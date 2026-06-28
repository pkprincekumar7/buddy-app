# ---------------------------------------------------------------------------
# Security — GuardDuty (us-east-1) + CloudTrail (us-east-1)
#
# GuardDuty in us-east-1 covers CloudFront and WAF management events.
# ECS Runtime Monitoring is not required here — no ECS workloads in us-east-1.
#
# CloudTrail in us-east-1 is the only trail with include_global_service_events = true
# so IAM/STS/global-service events are captured exactly once. The ap-south-1
# trail sets include_global_service_events = false to avoid duplicate records.
#
# Env matrix:
#   dev/sbx  — both disabled (cost)
#   stg      — GuardDuty enabled; CloudTrail skipped (no global logging bucket)
#   prod     — both enabled
# ---------------------------------------------------------------------------

resource "aws_guardduty_detector" "main" {
  #checkov:skip=CKV2_AWS_3:Single-account deployment — AWS Organizations delegation is not used
  count    = var.enable_guardduty ? 1 : 0
  provider = aws.us_east_1
  enable   = true

  tags = {
    Name = "${var.app_name}-guardduty-edge-${var.environment}"
  }
}

#trivy:ignore:AVD-AWS-0015
resource "aws_cloudtrail" "main" {
  #checkov:skip=CKV_AWS_252:CloudWatch Alarms + SNS ops email is the alerting path; a CloudTrail SNS topic would be redundant
  #checkov:skip=CKV_AWS_67:Intentional split-trail design — this trail covers global/IAM events only; ap-south-1 regional events are covered by the infra-live-backend trail
  #checkov:skip=CKV_AWS_35:S3 SSE + log file validation is sufficient for audit log integrity; CMK adds operational overhead for log-only data
  #checkov:skip=CKV2_AWS_10:CloudWatch Logs integration adds per-GB cost; S3 delivery with log file validation meets compliance needs
  # Requires global_logging_bucket_name to be set — bucket policy must exist first.
  count    = var.enable_cloudtrail ? 1 : 0
  provider = aws.us_east_1

  name                          = "${var.app_name}-edge-trail-${var.environment}"
  s3_bucket_name                = var.global_logging_bucket_name
  s3_key_prefix                 = "cloudtrail"
  is_multi_region_trail         = false
  include_global_service_events = true
  enable_log_file_validation    = true

  event_selector {
    read_write_type           = "All"
    include_management_events = true
  }

  depends_on = [aws_s3_bucket_policy.global_logging]
}
