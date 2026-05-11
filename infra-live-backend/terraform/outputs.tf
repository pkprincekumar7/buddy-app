# Key SSM parameter paths for this environment are:
#   /{app}/{env}/backend/alb_internal_fqdn
#   /{app}/{env}/backend/ecr_repository_url
#   /{app}/{env}/backend/ecs_cluster_name
#   /{app}/{env}/backend/ecs_service_name
# These are written as Terraform resources in ssm_write.tf.

output "alb_internal_fqdn" {
  description = "Internal ALB FQDN used by CloudFront as the /api/* origin"
  value       = local.alb_internal_fqdn
}

output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = aws_ecs_cluster.backend.name
}

output "ecs_service_name" {
  description = "ECS service name"
  value       = aws_ecs_service.backend.name
}

output "ecr_repository_url" {
  description = "ECR repository URL"
  value       = aws_ecr_repository.backend.repository_url
}

output "app_secret_arn" {
  description = "Secrets Manager ARN — used by the workflow to populate app secrets after apply"
  value       = aws_secretsmanager_secret.app.arn
}

output "cloudwatch_log_group" {
  description = "CloudWatch log group name for ECS container logs"
  value       = aws_cloudwatch_log_group.backend.name
}
