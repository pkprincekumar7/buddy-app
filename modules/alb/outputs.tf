output "security_group_id" {
  description = "ALB security group — each HTTP service's task SG allows its port from it."
  value       = aws_security_group.alb.id
}

output "dns_name" {
  description = "ALB DNS name (internal Route 53 alias target)."
  value       = aws_lb.this.dns_name
}

output "zone_id" {
  description = "ALB hosted zone ID (internal Route 53 alias)."
  value       = aws_lb.this.zone_id
}

output "arn_suffix" {
  description = "ALB ARN suffix (CloudWatch LoadBalancer dimension, ALB request-count scaling label)."
  value       = aws_lb.this.arn_suffix
}

output "target_group_arns" {
  description = "Target group ARN per target key — each HTTP service registers with its own."
  value       = { for k, tg in aws_lb_target_group.service : k => tg.arn }
}

output "target_group_arn_suffixes" {
  description = "Target group ARN suffix per target key (CloudWatch TargetGroup dimension, ALB request-count scaling label)."
  value       = { for k, tg in aws_lb_target_group.service : k => tg.arn_suffix }
}

output "https_listener_arn" {
  description = "HTTPS listener ARN."
  value       = aws_lb_listener.https.arn
}
