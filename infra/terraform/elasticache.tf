# ---------------------------------------------------------------------------
# ElastiCache (Redis) — per-user LLM rate limiter (sliding window)
#
# Placed in the same private subnets as RDS so it is never reachable from
# the internet.  Access is locked to the EC2 security group only, following
# the same pattern as ec2_to_rds in security_groups.tf.
# ---------------------------------------------------------------------------

resource "aws_elasticache_subnet_group" "redis" {
  name = "${var.app_name}-redis-subnet-group"
  subnet_ids = [
    data.terraform_remote_state.db.outputs.private_subnet_1_id,
    data.terraform_remote_state.db.outputs.private_subnet_2_id,
  ]

  tags = {
    Name = "${var.app_name}-redis-subnet-group"
  }
}

resource "aws_security_group" "elasticache_sg" {
  name        = "${var.app_name}-elasticache-sg"
  description = "Allow Redis access from EC2 only"
  vpc_id      = data.terraform_remote_state.db.outputs.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.app_name}-elasticache-sg"
  }
}

# Ingress rule is defined separately (not inline) so it can reference the EC2
# security group, which lives in the same stack.  Same pattern as ec2_to_rds.
resource "aws_vpc_security_group_ingress_rule" "ec2_to_redis" {
  description                  = "Redis from EC2"
  ip_protocol                  = "tcp"
  from_port                    = 6379
  to_port                      = 6379
  referenced_security_group_id = aws_security_group.ec2_sg.id
  security_group_id            = aws_security_group.elasticache_sg.id
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id = "${var.app_name}-redis"
  description          = "Redis for ${var.app_name} LLM rate limiter"

  # cache.t3.micro — same micro tier as db.t3.micro (RDS); 0.555 GiB RAM is
  # sufficient for sliding-window rate-limit counters.
  node_type = var.elasticache_node_type

  # Single node — matches RDS single-AZ setup; no failover needed at this scale.
  num_cache_clusters         = 1
  automatic_failover_enabled = false
  multi_az_enabled           = false

  engine_version       = "7.1"
  parameter_group_name = "default.redis7"
  port                 = 6379

  subnet_group_name  = aws_elasticache_subnet_group.redis.name
  security_group_ids = [aws_security_group.elasticache_sg.id]

  # Encrypt data at rest — consistent with RDS storage_encrypted = true.
  at_rest_encryption_enabled = true

  tags = {
    Name = "${var.app_name}-redis"
  }
}
