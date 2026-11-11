# ---------------------------------------------------------------------------
# ElastiCache — Valkey 8 (Redis-protocol compatible), encrypted at rest and
# in transit (../../modules/redis, TF-01). Each service signs in as its own RBAC
# user with IAM authentication (9.3): it reads authz:*, only auth writes it, and
# each uses only its own rate-limit and leader keys (the generating services also
# the shared hourly LLM limit). A service's worker uses the service's user.
#
# Node type, count and multi-AZ are controlled per environment via variables:
#   dev/sbx  — cache.t4g.micro, 1 node, no replica, no multi-AZ
#   stg      — cache.t4g.small, 1 node, no replica, no multi-AZ (downtime ok)
#   prod     — cache.t4g.medium, primary + 1 replica, multi-AZ
#
# Lives in the backend VPC's private subnets and only accepts the service
# runtimes (not the collector). Holds only ephemeral data: the authz cache,
# rate-limit counters, the hourly LLM limit and leader locks.
# ---------------------------------------------------------------------------

module "redis" {
  source = "../../modules/redis"

  app_name    = var.app_name
  environment = var.environment
  vpc_id      = module.network.vpc_id
  subnet_ids  = module.network.private_subnet_ids

  client_security_groups = {
    for k, s in local.services : k => { id = aws_security_group.service[k].id, description = "Valkey from ${s.display_name} tasks" } if s.uses_valkey
  }

  node_type     = var.elasticache_node_type
  replica_count = var.elasticache_replica_count
  multi_az      = var.elasticache_multi_az
  rbac_services = {
    for s in local.split_services : s => {
      writes_authz = s == "auth"
      llm_limit    = contains(local.generating_services, s)
    }
  }
}
