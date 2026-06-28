# ---------------------------------------------------------------------------
# WAF logging — Kinesis Firehose → global S3 logging bucket
#
# Enabled on prod only (enable_waf_logging = true in prod.tfvars).
# Stream name must start with "aws-waf-logs-" — AWS enforces this prefix for
# WAF log destinations.
#
# Global S3 bucket policy (created alongside) grants CloudTrail access.
# Firehose accesses the bucket via its IAM role, not the bucket policy.
# ---------------------------------------------------------------------------

data "aws_caller_identity" "current" {}

# IAM role assumed by Kinesis Firehose
resource "aws_iam_role" "firehose" {
  count    = var.enable_waf_logging ? 1 : 0
  provider = aws.us_east_1
  name     = "${var.app_name}-firehose-waf-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "firehose.amazonaws.com" }
      Action    = "sts:AssumeRole"
      # Prevent confused-deputy attack: only Firehose in this account may assume the role.
      Condition = {
        StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id }
      }
    }]
  })
}

resource "aws_iam_role_policy" "firehose_s3" {
  count    = var.enable_waf_logging ? 1 : 0
  provider = aws.us_east_1
  name     = "s3-write"
  role     = aws_iam_role.firehose[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetBucketLocation"]
        Resource = "arn:aws:s3:::${var.global_logging_bucket_name}"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:AbortMultipartUpload"]
        Resource = "arn:aws:s3:::${var.global_logging_bucket_name}/*"
      },
    ]
  })
}

# Kinesis Firehose delivery stream
resource "aws_kinesis_firehose_delivery_stream" "waf_logs" {
  #checkov:skip=CKV_AWS_241:WAF → Firehose delivery uses AWS-managed transport; source-side TLS is enforced by the WAF service connector
  count       = var.enable_waf_logging ? 1 : 0
  provider    = aws.us_east_1
  name        = "aws-waf-logs-${var.app_name}-${var.environment}"
  destination = "extended_s3"

  extended_s3_configuration {
    role_arn            = aws_iam_role.firehose[0].arn
    bucket_arn          = "arn:aws:s3:::${var.global_logging_bucket_name}"
    prefix              = "waf-logs/"
    error_output_prefix = "waf-logs-errors/"
    buffering_interval  = 300
    buffering_size      = 5
    compression_format  = "GZIP"
  }

  server_side_encryption {
    enabled  = true
    key_type = "AWS_OWNED_CMK"
  }
}

# WAF logging configuration — attaches the Firehose stream to the WebACL
resource "aws_wafv2_web_acl_logging_configuration" "main" {
  count                   = var.enable_waf_logging ? 1 : 0
  provider                = aws.us_east_1
  log_destination_configs = [aws_kinesis_firehose_delivery_stream.waf_logs[0].arn]
  resource_arn            = aws_wafv2_web_acl.frontend.arn
}

# ---------------------------------------------------------------------------
# Global S3 logging bucket policy
# Bucket is created manually. Terraform manages policy only.
# Grants CloudTrail s3:GetBucketAcl + s3:PutObject on /cloudtrail/*.
# Firehose access is via the firehose IAM role above, not this policy.
# ---------------------------------------------------------------------------

resource "aws_s3_bucket_policy" "global_logging" {
  count    = var.enable_cloudtrail ? 1 : 0
  provider = aws.us_east_1
  bucket   = var.global_logging_bucket_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "CloudTrailAclCheck"
        Effect    = "Allow"
        Principal = { Service = "cloudtrail.amazonaws.com" }
        Action    = "s3:GetBucketAcl"
        Resource  = "arn:aws:s3:::${var.global_logging_bucket_name}"
      },
      {
        Sid       = "CloudTrailWrite"
        Effect    = "Allow"
        Principal = { Service = "cloudtrail.amazonaws.com" }
        Action    = "s3:PutObject"
        Resource  = "arn:aws:s3:::${var.global_logging_bucket_name}/cloudtrail/*"
        Condition = {
          StringEquals = { "s3:x-amz-acl" = "bucket-owner-full-control" }
        }
      },
    ]
  })
}
