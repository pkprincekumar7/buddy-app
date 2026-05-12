# ---------------------------------------------------------------------------
# SSM writes (us-east-1 control plane via aws.ssm) — consumed by
# infra-live-edge (ALB origin) and deploy-live-backend (ECS rolling updates).
# Paths include var.aws_region so parallel multi-region backends don't collide.
# ---------------------------------------------------------------------------

resource "aws_ssm_parameter" "alb_internal_fqdn" {
  provider = aws.ssm

  name  = "/${var.app_name}/${var.environment}/backend/${var.aws_region}/alb_internal_fqdn"
  value = local.alb_internal_fqdn
  type  = "String"

  tags = { Name = "${var.app_name}-backend-alb-fqdn-${var.environment}-${var.aws_region}" }
}

resource "aws_ssm_parameter" "ecr_repository_url" {
  provider = aws.ssm

  name  = "/${var.app_name}/${var.environment}/backend/${var.aws_region}/ecr_repository_url"
  value = aws_ecr_repository.backend.repository_url
  type  = "String"

  tags = { Name = "${var.app_name}-backend-ecr-url-${var.environment}-${var.aws_region}" }
}

resource "aws_ssm_parameter" "ecs_cluster_name" {
  provider = aws.ssm

  name  = "/${var.app_name}/${var.environment}/backend/${var.aws_region}/ecs_cluster_name"
  value = aws_ecs_cluster.backend.name
  type  = "String"

  tags = { Name = "${var.app_name}-backend-ecs-cluster-${var.environment}-${var.aws_region}" }
}

resource "aws_ssm_parameter" "ecs_service_name" {
  provider = aws.ssm

  name  = "/${var.app_name}/${var.environment}/backend/${var.aws_region}/ecs_service_name"
  value = aws_ecs_service.backend.name
  type  = "String"

  tags = { Name = "${var.app_name}-backend-ecs-service-${var.environment}-${var.aws_region}" }
}
