# terraform test — mock AWS provider: no credentials, nothing is created.
# Run from modules/redis: terraform init && terraform test

mock_provider "aws" {}

variables {
  app_name               = "superpower"
  environment            = "prod"
  vpc_id                 = "vpc-1"
  subnet_ids             = ["subnet-a", "subnet-b", "subnet-c"]
  client_security_groups = { ecs = { id = "sg-api", description = "Redis from ECS tasks" } }
  node_type              = "cache.t4g.medium"
  replica_count          = 1
  multi_az               = true
  auth_token             = "0123456789abcdef0123" # gitleaks:allow — fake token for the mock provider
}

run "prod_replicated_and_encrypted" {
  command = apply

  assert {
    condition     = aws_elasticache_replication_group.this.replication_group_id == "superpower-backend-redis-prod" && aws_elasticache_replication_group.this.num_cache_clusters == 2
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
    condition     = aws_elasticache_replication_group.this.engine == "valkey" && aws_elasticache_replication_group.this.engine_version == "8.0" && aws_elasticache_parameter_group.this.family == "valkey8" && aws_elasticache_parameter_group.this.name == "superpower-backend-valkey8-prod"
    error_message = "Valkey 8.0 with the valkey8 parameter group (name carries the family)."
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

run "parameter_group_family_follows_the_major_version" {
  command = plan

  variables {
    engine_version = "7.2"
  }

  assert {
    condition     = aws_elasticache_parameter_group.this.family == "valkey7" && aws_elasticache_replication_group.this.engine_version == "7.2"
    error_message = "A 7.x engine gets the valkey7 family."
  }
}

run "engine_version_must_be_major_minor" {
  command = plan

  variables {
    engine_version = "8"
  }

  expect_failures = [var.engine_version]
}
