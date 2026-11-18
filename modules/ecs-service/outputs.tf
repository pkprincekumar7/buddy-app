output "service_name" {
  description = "ECS service name (\"<app>-<role>-<env>\")."
  value       = aws_ecs_service.this.name
}

output "service_id" {
  description = "ECS service ID."
  value       = aws_ecs_service.this.id
}

output "task_definition_family" {
  description = "Task definition family — what deploy workflows register new revisions under."
  value       = aws_ecs_task_definition.this.family
}

output "task_definition_arn" {
  description = "ARN of the Terraform-managed (bootstrap) task definition revision."
  value       = aws_ecs_task_definition.this.arn
}

output "autoscaling_resource_id" {
  description = "App Autoscaling resource ID (\"service/<cluster>/<service>\")."
  value       = aws_appautoscaling_target.this.resource_id
}

output "container_definitions" {
  description = "The bootstrap task definition's container definitions (JSON) — what the deploy workflow copies and re-registers with a new image. Holds secret ARNs, not secret values."
  value       = aws_ecs_task_definition.this.container_definitions
}

output "subnet_ids" {
  description = "Subnets the service's tasks run in."
  value       = one(aws_ecs_service.this.network_configuration).subnets
}

output "security_group_ids" {
  description = "Security groups attached to the service's tasks."
  value       = one(aws_ecs_service.this.network_configuration).security_groups
}

output "target_group_arn" {
  description = "Target group the service registers with, or null for a service without a load balancer."
  value       = try(one(aws_ecs_service.this.load_balancer).target_group_arn, null)
}

output "service_discovery_arn" {
  description = "The Cloud Map service the tasks register in, or null without service_discovery."
  value       = try(aws_service_discovery_service.this[0].arn, null)
}

output "service_discovery_name" {
  description = "The DNS label callers resolve, \"<name>.<namespace>\", or null without service_discovery."
  value       = try(aws_service_discovery_service.this[0].name, null)
}

output "internal_port" {
  description = "The internal (Cloud Map) container port, or null."
  value       = var.internal_port
}

output "scaling_policy_names" {
  description = "Autoscaling policy names, keyed as passed in (target-tracking and step policies together)."
  value = merge(
    { for k, p in aws_appautoscaling_policy.target_tracking : k => p.name },
    { for k, p in aws_appautoscaling_policy.step : k => p.name },
  )
}

output "alarm_names" {
  description = "CloudWatch alarm names this module created: step-scaling triggers, sustained and immediate saturation alerts."
  value = merge(
    { for k, a in aws_cloudwatch_metric_alarm.step : "step:${k}" => a.alarm_name },
    { for k, a in aws_cloudwatch_metric_alarm.sustained : "sustained:${k}" => a.alarm_name },
    { for k, a in aws_cloudwatch_metric_alarm.immediate : "immediate:${k}" => a.alarm_name },
  )
}
