output "primary_endpoint_address" {
  description = "Primary endpoint hostname — the API's REDIS_URL is rediss://<this>:6379."
  value       = aws_elasticache_replication_group.this.primary_endpoint_address
}

output "replication_group_id" {
  description = "Replication group ID — member nodes are \"<id>-001\", \"<id>-002\", …"
  value       = aws_elasticache_replication_group.this.id
}

output "security_group_id" {
  description = "Redis security group ID."
  value       = aws_security_group.this.id
}

output "node_count" {
  description = "Cache nodes (primary + replicas)."
  value       = aws_elasticache_replication_group.this.num_cache_clusters
}

output "replication_group_arn" {
  description = "Replication group ARN: with rbac_services, each task role needs elasticache:Connect on it and on its own user (rbac_user_arns)."
  value       = aws_elasticache_replication_group.this.arn
}

output "rbac_user_names" {
  description = "The user each service connects as (IAM authentication), keyed by service; empty without rbac_services."
  value       = { for k, u in aws_elasticache_user.service : k => u.user_name }
}

output "rbac_user_arns" {
  description = "Each service's ElastiCache user ARN, for its task role's elasticache:Connect."
  value       = { for k, u in aws_elasticache_user.service : k => u.arn }
}

output "rbac_access_strings" {
  description = "Each service's access string, keyed by service (what it may read, write and run)."
  value       = local.access_string
}

output "client_security_group_ids" {
  description = "Security groups allowed to reach Redis on 6379."
  value       = [for r in aws_vpc_security_group_ingress_rule.from_client : r.referenced_security_group_id]
}
