# ---------------------------------------------------------------------------
# S3 bucket policy — frontend assets bucket (us-east-1)
#
# Grants CloudFront OAC (via this specific distribution ARN) read access to
# the bucket. Direct public access is blocked; only CloudFront can serve
# the assets. The CloudFront ARN is read from SSM (written by infra-live-edge).
# ---------------------------------------------------------------------------

resource "aws_s3_bucket_policy" "frontend" {
  bucket = var.spa_bucket_name

  lifecycle {
    precondition {
      condition     = data.aws_ssm_parameter.s3_bucket_name.value == var.spa_bucket_name
      error_message = "spa_bucket_name (\"${var.spa_bucket_name}\") does not match the bucket name infra-live-edge wrote to SSM. Both come from the SPA_BUCKET_NAME variable: re-apply infra-live-edge so it writes the current value."
    }
  }

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCloudFrontOACGetObject"
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = "s3:GetObject"
        Resource = "arn:aws:s3:::${var.spa_bucket_name}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = data.aws_ssm_parameter.cloudfront_arn.value
          }
        }
      },
      {
        # Lets a missing file be a real 404, not S3's 403 (S3 answers 403 for a missing
        # key when the caller can't list the bucket), so a missing JS or CSS chunk is a 404
        # (production-readiness review, EDGE-03).
        Sid    = "AllowCloudFrontOACListBucket"
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = "s3:ListBucket"
        Resource = "arn:aws:s3:::${var.spa_bucket_name}"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = data.aws_ssm_parameter.cloudfront_arn.value
          }
        }
      },
      {
        # Plain HTTP is refused (production-readiness review, TF-05). Every caller
        # that should reach this bucket (CloudFront, the AWS SDKs and CLI, ALB and
        # CloudTrail log delivery) already uses HTTPS.
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = ["arn:aws:s3:::${var.spa_bucket_name}", "arn:aws:s3:::${var.spa_bucket_name}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      }
    ]
  })
}
