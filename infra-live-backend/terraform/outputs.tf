# Key SSM parameter paths for this environment are:
#   /{app}/{env}/backend/{region}/alb_internal_fqdn
#   /{app}/{env}/backend/{region}/ecr_repository_url
#   /{app}/{env}/backend/{region}/ecs_cluster_name
#   /{app}/{env}/backend/{region}/ecs_services   (JSON list of every service)
# These are written as Terraform resources in ssm_write.tf.

output "alb_internal_fqdn" {
  description = "Internal ALB FQDN used by CloudFront as the /api/* origin"
  value       = local.alb_internal_fqdn
}

output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = aws_ecs_cluster.backend.name
}

output "ecs_services" {
  description = "Every ECS service (services.tf) in deploy_order: name, ECS service, task family, container — the same list written to SSM for the deploy workflows."
  value       = local.ecs_services_manifest
}

output "ecr_repository_url" {
  description = "ECR repository URL"
  value       = aws_ecr_repository.backend.repository_url
}

output "app_secret_arn" {
  description = "Secrets Manager ARN — used by the workflow to populate app secrets after apply"
  value       = aws_secretsmanager_secret.app.arn
}

output "cloudwatch_log_groups" {
  description = "CloudWatch log group per service (key → name)"
  value       = { for k, g in aws_cloudwatch_log_group.service : k => g.name }
}
