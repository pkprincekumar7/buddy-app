# ---------------------------------------------------------------------------
# ElastiCache — Redis 7, encrypted at rest and in transit with AUTH token
#
# Node count and multi-AZ are controlled per environment via variables:
#   dev/sbx  — 1 node, no replica, no multi-AZ (t4g.micro, burstable)
#   stg      — 1 node, no replica, no multi-AZ (t4g.medium, downtime ok)
#   prod     — 2 nodes (primary + replica), multi-AZ enabled (t4g.medium
#              up to 100K users; m7g.large above 100K users)
#
# Lives in the backend VPC's private subnets. Destroying infra-live-backend
# destroys Redis too — this is intentional since Redis only holds ephemeral
# rate-limit counters (no persistent data worth protecting).
# ---------------------------------------------------------------------------

resource "aws_elasticache_subnet_group" "main" {
  name = "${var.app_name}-backend-redis-subnet-group-${var.environment}"
  subnet_ids = [
    aws_subnet.private_1.id,
    aws_subnet.private_2.id,
    aws_subnet.private_3.id,
  ]

  tags = {
    Name = "${var.app_name}-backend-redis-subnet-group-${var.environment}"
  }
}

resource "aws_security_group" "elasticache_sg" {
  name        = "${var.app_name}-backend-elasticache-sg-${var.environment}"
  description = "Allow Redis from ECS tasks only"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "${var.app_name}-backend-elasticache-sg-${var.environment}"
  }
}

resource "aws_vpc_security_group_ingress_rule" "ecs_to_redis" {
  description                  = "Redis from ECS tasks"
  security_group_id            = aws_security_group.elasticache_sg.id
  ip_protocol                  = "tcp"
  from_port                    = 6379
  to_port                      = 6379
  referenced_security_group_id = aws_security_group.ecs_task_sg.id
}

resource "aws_elasticache_parameter_group" "redis7" {
  name   = "${var.app_name}-backend-redis7-${var.environment}"
  family = "redis7"

  tags = {
    Name = "${var.app_name}-backend-redis7-${var.environment}"
  }
}

resource "aws_elasticache_replication_group" "main" {
  #checkov:skip=CKV_AWS_191:AWS-managed AES-256 at-rest encryption is sufficient for ephemeral rate-limit counters; CMK not required at this scale

  replication_group_id = "${var.app_name}-backend-redis-${var.environment}"
  description          = "Redis for ${var.app_name} LLM rate limiter (${var.environment})"

  node_type = var.elasticache_node_type

  num_cache_clusters         = var.elasticache_replica_count + 1
  automatic_failover_enabled = var.elasticache_multi_az
  multi_az_enabled           = var.elasticache_multi_az

  engine_version       = "7.1"
  parameter_group_name = aws_elasticache_parameter_group.redis7.name
  port                 = 6379

  subnet_group_name  = aws_elasticache_subnet_group.main.name
  security_group_ids = [aws_security_group.elasticache_sg.id]

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  transit_encryption_mode    = "required"
  auth_token                 = var.redis_auth_token

  lifecycle {
    precondition {
      condition     = !(var.elasticache_multi_az && var.elasticache_replica_count == 0)
      error_message = "elasticache_multi_az = true requires elasticache_replica_count >= 1."
    }
  }

  tags = {
    Name = "${var.app_name}-backend-redis-${var.environment}"
  }
}
