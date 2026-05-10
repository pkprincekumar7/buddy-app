# alb_dns_name matches the output key used by infra-live-frontend's remote
# state read — update infra-live-frontend's app_state_key to point here
# when switching from the EC2 ALB to this ECS ALB.
output "alb_dns_name" {
  description = "ALB DNS name — used by infra-live-frontend CloudFront as the /api/* origin"
  value       = aws_lb.backend.dns_name
}

output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = aws_ecs_cluster.backend.name
}

output "ecs_service_name" {
  description = "ECS service name — used by the deploy workflow to trigger rolling updates"
  value       = aws_ecs_service.backend.name
}

output "ecr_repository_url" {
  description = "ECR repository URL — used by the deploy workflow to push images"
  value       = aws_ecr_repository.backend.repository_url
}

output "s3_bucket_name" {
  description = "Backend artifacts S3 bucket name"
  value       = var.backend_bucket_name
}

output "app_secret_arn" {
  description = "Secrets Manager ARN for backend app secrets — populate with actual values before first deploy"
  value       = aws_secretsmanager_secret.app.arn
}

output "cloudwatch_log_group" {
  description = "CloudWatch log group name for ECS container logs"
  value       = aws_cloudwatch_log_group.backend.name
}
