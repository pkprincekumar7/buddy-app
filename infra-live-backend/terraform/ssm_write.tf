# ---------------------------------------------------------------------------
# SSM writes (us-east-1 control plane via aws.ssm) — consumed by
# infra-live-edge (ALB origin) and deploy-live-backend (ECS rolling updates).
# Paths include var.aws_region so parallel multi-region backends don't collide.
# ---------------------------------------------------------------------------

resource "aws_ssm_parameter" "alb_internal_fqdn" {
  #checkov:skip=CKV2_AWS_34:Non-secret infrastructure config value (ALB hostname) — encryption not required; SecureString adds cost and IAM complexity without security benefit
  provider = aws.ssm

  name  = "/${var.app_name}/${var.environment}/backend/${var.aws_region}/alb_internal_fqdn"
  value = local.alb_internal_fqdn
  type  = "String"

  tags = { Name = "${var.app_name}-backend-alb-fqdn-${var.environment}-${var.aws_region}" }
}

resource "aws_ssm_parameter" "ecr_repository_url" {
  #checkov:skip=CKV2_AWS_34:Non-secret infrastructure config value (ECR URL) — encryption not required; SecureString adds cost and IAM complexity without security benefit
  provider = aws.ssm

  name  = "/${var.app_name}/${var.environment}/backend/${var.aws_region}/ecr_repository_url"
  value = aws_ecr_repository.backend.repository_url
  type  = "String"

  tags = { Name = "${var.app_name}-backend-ecr-url-${var.environment}-${var.aws_region}" }
}

resource "aws_ssm_parameter" "ecs_cluster_name" {
  #checkov:skip=CKV2_AWS_34:Non-secret infrastructure config value (ECS cluster name) — encryption not required; SecureString adds cost and IAM complexity without security benefit
  provider = aws.ssm

  name  = "/${var.app_name}/${var.environment}/backend/${var.aws_region}/ecs_cluster_name"
  value = aws_ecs_cluster.backend.name
  type  = "String"

  tags = { Name = "${var.app_name}-backend-ecs-cluster-${var.environment}-${var.aws_region}" }
}

# Every ECS service in local.services (services.tf), in deploy_order — the
# deploy, restart and promote workflows read this instead of one parameter
# per service, so a new service needs no workflow logic change. JSON array of
#   { name, service, family, container }
# name = the workflows' `service` input; container = whose image a deploy swaps.
resource "aws_ssm_parameter" "ecs_services" {
  #checkov:skip=CKV2_AWS_34:Non-secret infrastructure config value (ECS service names) — encryption not required; SecureString adds cost and IAM complexity without security benefit
  provider = aws.ssm

  name  = "/${var.app_name}/${var.environment}/backend/${var.aws_region}/ecs_services"
  value = jsonencode(local.ecs_services_manifest)
  type  = "String"

  tags = { Name = "${var.app_name}-backend-ecs-services-${var.environment}-${var.aws_region}" }
}
