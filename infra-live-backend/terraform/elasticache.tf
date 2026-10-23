# ---------------------------------------------------------------------------
# ElastiCache — Valkey 8 (Redis-protocol compatible), encrypted at rest and
# in transit with an AUTH token (../../modules/redis, TF-01)
#
# Node type, count and multi-AZ are controlled per environment via variables:
#   dev/sbx  — cache.t4g.micro, 1 node, no replica, no multi-AZ
#   stg      — cache.t4g.small, 1 node, no replica, no multi-AZ (downtime ok)
#   prod     — cache.t4g.medium, primary + 1 replica, multi-AZ
#
# Lives in the backend VPC's private subnets and only accepts services with
# uses_redis = true in services.tf (auth, admin and the API; not the worker).
# Holds only ephemeral rate-limit counters.
# ---------------------------------------------------------------------------

module "redis" {
  source = "../../modules/redis"

  app_name    = var.app_name
  environment = var.environment
  vpc_id      = module.network.vpc_id
  subnet_ids  = module.network.private_subnet_ids

  # Services with uses_redis = true (services.tf).
  client_security_groups = {
    for k, s in local.services : k => { id = aws_security_group.service[k].id, description = "Redis from ${s.display_name} tasks" } if s.uses_redis
  }

  node_type     = var.elasticache_node_type
  replica_count = var.elasticache_replica_count
  multi_az      = var.elasticache_multi_az
  auth_token    = var.redis_auth_token
}
