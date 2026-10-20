# terraform test — mock AWS provider: no credentials, nothing is created.
# Run from modules/redis: terraform init && terraform test

mock_provider "aws" {}

variables {
  app_name               = "superpower"
  environment            = "prod"
  vpc_id                 = "vpc-1"
  subnet_ids             = ["subnet-a", "subnet-b", "subnet-c"]
  client_security_groups = { ecs = { id = "sg-api", description = "Redis from ECS tasks" } }
  node_type              = "cache.r6g.4xlarge"
  replica_count          = 2
  multi_az               = true
  auth_token             = "0123456789abcdef0123"
}

run "prod_replicated_and_encrypted" {
  command = apply

  assert {
    condition     = aws_elasticache_replication_group.this.replication_group_id == "superpower-backend-redis-prod" && aws_elasticache_replication_group.this.num_cache_clusters == 3
    error_message = "Name matches the pre-module one; replicas + primary."
  }
  assert {
    condition     = aws_elasticache_replication_group.this.multi_az_enabled && aws_elasticache_replication_group.this.automatic_failover_enabled
    error_message = "Multi-AZ turns on automatic failover too."
  }
  assert {
    condition     = aws_elasticache_replication_group.this.at_rest_encryption_enabled && aws_elasticache_replication_group.this.transit_encryption_enabled && aws_elasticache_replication_group.this.transit_encryption_mode == "required"
    error_message = "Encrypted at rest and in transit (TLS required)."
  }
  assert {
    condition     = aws_elasticache_replication_group.this.engine_version == "7.1" && aws_elasticache_parameter_group.this.family == "redis7"
    error_message = "Redis 7.1 with the redis7 parameter group."
  }
  assert {
    condition     = aws_vpc_security_group_ingress_rule.from_client["ecs"].from_port == 6379 && aws_vpc_security_group_ingress_rule.from_client["ecs"].referenced_security_group_id == "sg-api"
    error_message = "Only the client SG may reach 6379."
  }
}

run "multi_az_needs_a_replica" {
  command = plan

  variables {
    replica_count = 0
  }

  expect_failures = [aws_elasticache_replication_group.this]
}
