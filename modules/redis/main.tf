# ---------------------------------------------------------------------------
# redis — ElastiCache running the Valkey engine (open-source, Redis-protocol
# compatible: the app's Redis clients and Lua scripts work unchanged),
# encrypted at rest and in transit, reachable only from the given client
# security groups (TF-01). Clients sign in either with one shared AUTH token
# (today's stack) or as one RBAC user per service with IAM authentication
# (rbac_services, docs/auth-users-split.md 9.3 and 15.1). Resource names still say "redis"
# so existing replication groups and security groups aren't replaced.
#
# Node count and multi-AZ come from the caller per environment. Destroying
# the backend stack destroys Redis too — intentional, since Redis only holds
# ephemeral rate-limit counters (no persistent data worth protecting).
# ---------------------------------------------------------------------------

resource "aws_elasticache_subnet_group" "this" {
  name       = "${var.app_name}-backend-redis-subnet-group-${var.environment}"
  subnet_ids = var.subnet_ids

  tags = {
    Name = "${var.app_name}-backend-redis-subnet-group-${var.environment}"
  }
}

resource "aws_security_group" "this" {
  name        = "${var.app_name}-backend-elasticache-sg-${var.environment}"
  description = "Allow Redis from ECS tasks only"
  vpc_id      = var.vpc_id

  tags = {
    Name = "${var.app_name}-backend-elasticache-sg-${var.environment}"
  }
}

resource "aws_vpc_security_group_ingress_rule" "from_client" {
  for_each = var.client_security_groups

  description                  = each.value.description
  security_group_id            = aws_security_group.this.id
  ip_protocol                  = "tcp"
  from_port                    = 6379
  to_port                      = 6379
  referenced_security_group_id = each.value.id
}

# The family must match the engine's major version; the name carries it, so a
# family change creates a new group. create_before_destroy makes Terraform
# create the new group and move the replication group onto it before deleting
# the old one; deleting first fails while the cluster still uses it.
resource "aws_elasticache_parameter_group" "this" {
  name   = "${var.app_name}-backend-${local.parameter_group_family}-${var.environment}"
  family = local.parameter_group_family

  tags = {
    Name = "${var.app_name}-backend-${local.parameter_group_family}-${var.environment}"
  }

  lifecycle {
    create_before_destroy = true
  }
}

locals {
  # "8.0" → "valkey8"
  parameter_group_family = "valkey${split(".", var.engine_version)[0]}"
}

resource "aws_elasticache_replication_group" "this" {
  #checkov:skip=CKV_AWS_191:AWS-managed AES-256 at-rest encryption is sufficient for ephemeral rate-limit counters; CMK not required at this scale

  replication_group_id = "${var.app_name}-backend-redis-${var.environment}"
  description          = "Valkey for ${var.app_name} rate limiters (${var.environment})"

  node_type = var.node_type

  num_cache_clusters         = var.replica_count + 1
  automatic_failover_enabled = var.multi_az
  multi_az_enabled           = var.multi_az

  engine               = "valkey"
  engine_version       = var.engine_version
  parameter_group_name = aws_elasticache_parameter_group.this.name
  port                 = 6379

  subnet_group_name  = aws_elasticache_subnet_group.this.name
  security_group_ids = [aws_security_group.this.id]

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  transit_encryption_mode    = "required"

  # One or the other (a replication group can't take both).
  auth_token     = local.rbac ? null : var.auth_token
  user_group_ids = local.rbac ? [aws_elasticache_user_group.this[0].user_group_id] : null

  lifecycle {
    precondition {
      condition     = !(var.multi_az && var.replica_count == 0)
      error_message = "elasticache_multi_az = true requires elasticache_replica_count >= 1."
    }
    precondition {
      condition     = local.rbac != (var.auth_token != null)
      error_message = "Set exactly one of auth_token (one shared token) or rbac_services (one IAM user per service)."
    }
  }

  tags = {
    Name = "${var.app_name}-backend-redis-${var.environment}"
  }
}

# ---------------------------------------------------------------------------
# RBAC: one IAM-authenticated user per service (9.3, 15.1)
#
# IAM authentication needs the user ID and user name to be the same, so both are
# "<app>-<env>-<service>". A task connects as that user with a short-lived token
# from its task role (elasticache:Connect on the replication group and the user).
#
# Key permissions: "%R~" is read-only (Redis 7 / Valkey ACL syntax), "~" read and
# write. Commands: reads, writes and scripts (the limiters and the authz CAS are
# Lua), but nothing in @dangerous.
# ---------------------------------------------------------------------------
locals {
  rbac = length(var.rbac_services) > 0

  rbac_user_id = { for k, _ in var.rbac_services : k => "${var.app_name}-${var.environment}-${k}" }

  access_string = {
    for k, s in var.rbac_services : k => join(" ", concat(
      ["on"],
      [
        "~LIMITS:LIMITER/${k}/*",
        "~leader:${k}:*",
        s.writes_authz ? "~authz:*" : "%R~authz:*",
      ],
      s.llm_limit ? ["~llm:hourly:*"] : [],
      ["-@all", "+@read", "+@write", "+@scripting", "+@connection", "-@dangerous"],
    ))
  }
}

resource "aws_elasticache_user" "service" {
  for_each = var.rbac_services

  engine        = "valkey"
  user_id       = local.rbac_user_id[each.key]
  user_name     = local.rbac_user_id[each.key]
  access_string = local.access_string[each.key]

  authentication_mode {
    type = "iam"
  }

  tags = {
    Name    = local.rbac_user_id[each.key]
    Service = each.key
  }

  lifecycle {
    precondition {
      condition     = length(local.rbac_user_id[each.key]) <= 40
      error_message = "ElastiCache user ID ${local.rbac_user_id[each.key]} is over 40 characters."
    }
  }
}

# A disabled "default" user: some engines require one in every user group. "off"
# means it can't sign in, and -@all that it could run nothing if it did.
resource "aws_elasticache_user" "default" {
  count = local.rbac && var.include_default_user ? 1 : 0

  engine        = "valkey"
  user_id       = "${var.app_name}-${var.environment}-default"
  user_name     = "default"
  access_string = "off -@all"

  authentication_mode {
    type = "no-password-required"
  }

  tags = {
    Name = "${var.app_name}-${var.environment}-default"
  }
}

resource "aws_elasticache_user_group" "this" {
  count = local.rbac ? 1 : 0

  engine        = "valkey"
  user_group_id = "${var.app_name}-backend-valkey-users-${var.environment}"
  user_ids = concat(
    [for u in aws_elasticache_user.service : u.user_id],
    [for u in aws_elasticache_user.default : u.user_id],
  )

  tags = {
    Name = "${var.app_name}-backend-valkey-users-${var.environment}"
  }
}
