# ---------------------------------------------------------------------------
# GuardDuty — ap-south-1
# Skipped on dev/sbx (var.enable_guardduty = false) to avoid ~$20/mo cost.
# ECS Runtime Monitoring is enabled so GuardDuty inspects running container
# behaviour — without this the ECS-related cost line item provides no coverage.
# ---------------------------------------------------------------------------

resource "aws_guardduty_detector" "main" {
  #checkov:skip=CKV2_AWS_3:Single-account deployment — AWS Organizations delegation is not used
  count  = var.enable_guardduty ? 1 : 0
  enable = true

  tags = {
    Name = "${var.app_name}-guardduty-${var.environment}"
  }
}

resource "aws_guardduty_detector_feature" "ecs_runtime" {
  count       = var.enable_guardduty ? 1 : 0
  detector_id = aws_guardduty_detector.main[0].id
  name        = "ECS_RUNTIME_MONITORING"
  status      = "ENABLED"
}

# ---------------------------------------------------------------------------
# CloudTrail — ap-south-1 (regional trail)
# Skipped on dev/sbx (var.enable_cloudtrail = false).
# include_global_service_events = false — global events (IAM, STS) are
# captured by the us-east-1 trail in infra-live-edge, not duplicated here.
# depends_on ensures the S3 bucket policy granting CloudTrail write access
# is in place before the trail attempts to write its first log.
# ---------------------------------------------------------------------------

#trivy:ignore:AVD-AWS-0015
resource "aws_cloudtrail" "main" {
  #checkov:skip=CKV_AWS_252:CloudWatch Alarms + SNS ops email is the alerting path; a CloudTrail SNS topic would be redundant
  #checkov:skip=CKV_AWS_67:Intentional split-trail design — us-east-1 trail covers global/IAM events; this trail covers ap-south-1 regional events only
  #checkov:skip=CKV_AWS_35:S3 SSE + log file validation is sufficient for audit log integrity; CMK adds operational overhead for log-only data
  #checkov:skip=CKV2_AWS_10:CloudWatch Logs integration adds per-GB cost; S3 delivery with log file validation meets compliance needs
  count = var.enable_cloudtrail ? 1 : 0

  name                          = "${var.app_name}-trail-${var.environment}"
  s3_bucket_name                = var.regional_logging_bucket_name
  s3_key_prefix                 = "cloudtrail"
  is_multi_region_trail         = false
  include_global_service_events = false
  enable_log_file_validation    = true

  event_selector {
    read_write_type           = "All"
    include_management_events = true
  }

  tags = {
    Name = "${var.app_name}-cloudtrail-${var.environment}"
  }

  depends_on = [aws_s3_bucket_policy.regional_logging]
}
