# ---------------------------------------------------------------------------
# SSM reads (us-east-1 control plane via aws.ssm).
# Apply infra-live-backend before applying infra-live-edge.
# var.backend_region selects which region's ALB FQDN to use as CloudFront origin.
# ---------------------------------------------------------------------------

data "aws_ssm_parameter" "alb_internal_fqdn" {
  provider = aws.ssm

  name = "/${var.app_name}/${var.environment}/backend/${var.backend_region}/alb_internal_fqdn"
}
