# Key SSM parameter paths for this environment are:
#   /{app}/{env}/backend/{region}/alb_internal_fqdn
#   /{app}/{env}/backend/{region}/ecs_cluster_name
#   /{app}/{env}/backend/{region}/ecs_services          (JSON list of every runtime)
#   /{app}/{env}/backend/{region}/internal_public_keys  (service-token public keys)
# These are written as Terraform resources in ssm_write.tf and service_tokens.tf.

output "alb_internal_fqdn" {
  description = "Internal ALB FQDN used by CloudFront as the /api/* origin"
  value       = local.alb_internal_fqdn
}

output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = aws_ecs_cluster.backend.name
}

output "ecs_services" {
  description = "Every ECS service (services.tf) in deploy_order: name, ECS service, task family, container, image service and ECR repository — the same list written to SSM for the deploy workflows."
  value       = local.ecs_services_manifest
}

output "ecr_repository_urls" {
  description = "ECR repository URL per service (service → URL)"
  value       = { for s, r in aws_ecr_repository.service : s => r.repository_url }
}

output "service_secret_arns" {
  description = "Secrets Manager ARN per service (service → ARN) — the workflow fills each one's keys after apply"
  value       = { for s, sec in aws_secretsmanager_secret.service : s => sec.arn }
}

output "internal_dns_namespace" {
  description = "Cloud Map namespace for internal calls (<service>.<namespace>)"
  value       = aws_service_discovery_private_dns_namespace.internal.name
}

output "event_topic_arns" {
  description = "SNS topic ARN per producing service"
  value       = module.events.topic_arns
}

output "event_queue_urls" {
  description = "SQS queue URL per consuming service"
  value       = module.events.queue_urls
}

output "cloudwatch_log_groups" {
  description = "CloudWatch log group per runtime (key → name)"
  value       = { for k, g in aws_cloudwatch_log_group.service : k => g.name }
}
