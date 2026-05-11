# ---------------------------------------------------------------------------
# SSM reads — values written by infra-live-bucket (us-east-1 control plane).
# Apply infra-live-bucket before applying infra-live-backend.
# Both buckets are in us-east-1 and shared across all backend regions, so
# the paths have no region component.
# ---------------------------------------------------------------------------

data "aws_ssm_parameter" "backend_bucket_name" {
  provider = aws.ssm

  name = "/${var.app_name}/${var.environment}/bucket/backend_name"
}

data "aws_ssm_parameter" "backend_bucket_arn" {
  provider = aws.ssm

  name = "/${var.app_name}/${var.environment}/bucket/backend_arn"
}
