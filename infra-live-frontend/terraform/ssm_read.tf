# ---------------------------------------------------------------------------
# SSM reads (us-east-1 control plane via aws.ssm).
# Apply infra-live-edge before applying infra-live-frontend.
# ---------------------------------------------------------------------------

data "aws_ssm_parameter" "cloudfront_arn" {
  provider = aws.ssm

  name = "/${var.app_name}/${var.environment}/edge/cloudfront_arn"
}

# Read back the bucket name written by infra-live-edge to verify it matches
# var.frontend_bucket_name. The precondition on aws_s3_bucket_policy below
# will fail fast if the two values diverge.
data "aws_ssm_parameter" "s3_bucket_name" {
  provider = aws.ssm

  name = "/${var.app_name}/${var.environment}/edge/s3_bucket_name"
}
