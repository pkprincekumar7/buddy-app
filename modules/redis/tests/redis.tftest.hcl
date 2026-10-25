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

# ── RBAC: one IAM user per service (docs/auth-users-split.md, 9.3, 15.1) ──────

run "rbac_users_per_service" {
  command = apply

  variables {
    auth_token = null
    rbac_services = {
      auth  = { writes_authz = true }
      users = {}
      grow  = { llm_limit = true }
    }
  }

  assert {
    condition     = aws_elasticache_replication_group.this.auth_token == null && length(aws_elasticache_replication_group.this.user_group_ids) == 1
    error_message = "RBAC replaces the shared AUTH token."
  }
  assert {
    condition = alltrue([
      for k, u in aws_elasticache_user.service : u.user_id == "superpower-prod-${k}" && u.user_name == u.user_id && u.engine == "valkey" && one(u.authentication_mode).type == "iam"
    ])
    error_message = "IAM authentication needs user ID = user name: <app>-<env>-<service>."
  }
  assert {
    condition     = aws_elasticache_user.service["users"].access_string == "on ~LIMITS:LIMITER/users/* ~leader:users:* %R~authz:* -@all +@read +@write +@scripting +@connection -@dangerous"
    error_message = "A service reads authz:* only, and uses its own rate-limit and leader keys."
  }
  assert {
    condition     = aws_elasticache_user.service["auth"].access_string == "on ~LIMITS:LIMITER/auth/* ~leader:auth:* ~authz:* -@all +@read +@write +@scripting +@connection -@dangerous"
    error_message = "Only auth writes authz:* (9.3)."
  }
  assert {
    condition     = aws_elasticache_user.service["grow"].access_string == "on ~LIMITS:LIMITER/grow/* ~leader:grow:* %R~authz:* ~llm:hourly:* -@all +@read +@write +@scripting +@connection -@dangerous"
    error_message = "A generating service also shares the hourly LLM limit."
  }
  assert {
    condition     = aws_elasticache_user.default[0].user_name == "default" && aws_elasticache_user.default[0].access_string == "off -@all"
    error_message = "The default user is disabled and can run nothing."
  }
  assert {
    condition = toset(aws_elasticache_user_group.this[0].user_ids) == toset([
      "superpower-prod-auth", "superpower-prod-users", "superpower-prod-grow", "superpower-prod-default",
    ]) && aws_elasticache_user_group.this[0].engine == "valkey"
    error_message = "The user group holds every service's user and the disabled default."
  }
  assert {
    condition     = keys(output.rbac_user_names) == ["auth", "grow", "users"] && output.rbac_user_names["grow"] == "superpower-prod-grow" && length(output.rbac_access_strings) == 3
    error_message = "The user names and access strings are exposed for the task roles and the services' settings."
  }
}

run "rbac_without_the_default_user" {
  command = apply

  variables {
    auth_token           = null
    rbac_services        = { users = {} }
    include_default_user = false
  }

  assert {
    condition     = length(aws_elasticache_user.default) == 0 && aws_elasticache_user_group.this[0].user_ids == toset(["superpower-prod-users"])
    error_message = "No default user when the engine doesn't need one."
  }
}

run "the_token_style_has_no_rbac_resources" {
  command = plan

  assert {
    condition     = length(aws_elasticache_user.service) == 0 && length(aws_elasticache_user_group.this) == 0 && length(aws_elasticache_user.default) == 0
    error_message = "With auth_token there are no users or user group."
  }
}

run "token_and_rbac_together_are_refused" {
  command = plan

  variables {
    rbac_services = { users = {} }
  }

  expect_failures = [aws_elasticache_replication_group.this]
}

run "neither_token_nor_rbac_is_refused" {
  command = plan

  variables {
    auth_token = null
  }

  expect_failures = [aws_elasticache_replication_group.this]
}

run "only_auth_writes_authz" {
  command = plan

  variables {
    auth_token    = null
    rbac_services = { grow = { writes_authz = true } }
  }

  expect_failures = [var.rbac_services]
}

run "rbac_service_names_are_checked" {
  command = plan

  variables {
    auth_token    = null
    rbac_services = { "Grow_Service" = {} }
  }

  expect_failures = [var.rbac_services]
}
