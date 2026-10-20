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

output "client_security_group_ids" {
  description = "Security groups allowed to reach Redis on 6379."
  value       = [for r in aws_vpc_security_group_ingress_rule.from_client : r.referenced_security_group_id]
}
