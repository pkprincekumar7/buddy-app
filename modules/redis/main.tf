# ---------------------------------------------------------------------------
# redis — ElastiCache Redis, encrypted at rest and in transit with an AUTH
# token, reachable only from the given client security groups (TF-01).
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

resource "aws_elasticache_parameter_group" "this" {
  name   = "${var.app_name}-backend-redis7-${var.environment}"
  family = "redis7"

  tags = {
    Name = "${var.app_name}-backend-redis7-${var.environment}"
  }
}

resource "aws_elasticache_replication_group" "this" {
  #checkov:skip=CKV_AWS_191:AWS-managed AES-256 at-rest encryption is sufficient for ephemeral rate-limit counters; CMK not required at this scale

  replication_group_id = "${var.app_name}-backend-redis-${var.environment}"
  description          = "Redis for ${var.app_name} LLM rate limiter (${var.environment})"

  node_type = var.node_type

  num_cache_clusters         = var.replica_count + 1
  automatic_failover_enabled = var.multi_az
  multi_az_enabled           = var.multi_az

  engine_version       = var.engine_version
  parameter_group_name = aws_elasticache_parameter_group.this.name
  port                 = 6379

  subnet_group_name  = aws_elasticache_subnet_group.this.name
  security_group_ids = [aws_security_group.this.id]

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  transit_encryption_mode    = "required"
  auth_token                 = var.auth_token

  lifecycle {
    precondition {
      condition     = !(var.multi_az && var.replica_count == 0)
      error_message = "elasticache_multi_az = true requires elasticache_replica_count >= 1."
    }
  }

  tags = {
    Name = "${var.app_name}-backend-redis-${var.environment}"
  }
}
