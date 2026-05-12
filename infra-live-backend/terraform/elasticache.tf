# ---------------------------------------------------------------------------
# ElastiCache — Redis 7, single-node, encrypted at rest
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

resource "aws_elasticache_replication_group" "main" {
  replication_group_id = "${var.app_name}-backend-redis-${var.environment}"
  description          = "Redis for ${var.app_name} LLM rate limiter (${var.environment})"

  node_type = var.elasticache_node_type

  num_cache_clusters         = 1
  automatic_failover_enabled = false
  multi_az_enabled           = false

  engine_version       = "7.1"
  parameter_group_name = "default.redis7.1"
  port                 = 6379

  subnet_group_name  = aws_elasticache_subnet_group.main.name
  security_group_ids = [aws_security_group.elasticache_sg.id]

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  # Require TLS for all connections (matches rediss:// in ECS task env).
  # No auth_token — connections are VPC-internal only; TLS provides transport
  # security without a password, which is intentional for this private service.
  transit_encryption_mode = "required"

  tags = {
    Name = "${var.app_name}-backend-redis-${var.environment}"
  }
}
