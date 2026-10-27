variable "app_name" {
  description = "Application name — prefix of every resource name."
  type        = string
}

variable "environment" {
  description = "Deployment environment — suffix of every resource name."
  type        = string
}

variable "vpc_id" {
  description = "VPC the Redis security group lives in."
  type        = string
}

variable "subnet_ids" {
  description = "Private subnets for the cache subnet group."
  type        = list(string)
}

variable "client_security_groups" {
  description = "Security groups allowed to reach Redis on 6379, keyed by a short name used in the rule's address (e.g. { \"ecs\" = { id = …, description = \"Redis from ECS tasks\" } })."
  type = map(object({
    id          = string
    description = string
  }))
}

variable "node_type" {
  description = "ElastiCache node type."
  type        = string
}

variable "replica_count" {
  description = "Replica nodes (0 = primary only). Total nodes = replica_count + 1."
  type        = number

  validation {
    condition     = contains([0, 1, 2], var.replica_count)
    error_message = "replica_count must be 0, 1, or 2."
  }
}

variable "multi_az" {
  description = "Multi-AZ with automatic failover. Requires replica_count >= 1."
  type        = bool
}

variable "auth_token" {
  description = "AUTH token (16–128 printable ASCII chars, no spaces, quotes, @ or /), shared by every client. Today's stack; the split's services use rbac_services instead. A replication group takes one or the other, never both."
  type        = string
  sensitive   = true
  default     = null
}

variable "rbac_services" {
  description = <<-EOT
    One ElastiCache user per service, signing in with IAM (no password to store or
    rotate), instead of auth_token (docs/auth-users-split.md, 9.3, 15.1). Keyed by
    service. Every user can:
      - read authz:* (only auth, writes_authz = true, can write it);
      - use its own rate-limit keys, LIMITS:LIMITER/<service>/*, and leader locks,
        leader:<service>:*;
      - with llm_limit = true (discover, grow, transform, release), the shared hourly
        LLM limit, llm:hourly:*.
    Nothing else: no other keys, and no dangerous commands (KEYS, FLUSHALL, CONFIG…).
  EOT
  type = map(object({
    writes_authz = optional(bool, false)
    llm_limit    = optional(bool, false)
  }))
  default = {}

  validation {
    condition     = alltrue([for k in keys(var.rbac_services) : can(regex("^[a-z][a-z0-9-]{0,24}$", k))])
    error_message = "rbac_services keys are service names: lowercase letters, digits and hyphens, at most 25 characters."
  }
  validation {
    condition     = alltrue([for k, s in var.rbac_services : !s.writes_authz || k == "auth"])
    error_message = "Only auth writes the authz cache (9.3): writes_authz is for the auth service only."
  }
}

variable "include_default_user" {
  description = "Add a disabled user named \"default\" to the RBAC user group, for engines that require one in every group. It can't sign in or run anything."
  type        = bool
  default     = true
}

variable "engine_version" {
  description = "Valkey engine version (major.minor, e.g. \"8.0\"). The parameter group family is derived from the major version."
  type        = string
  default     = "8.0"

  validation {
    condition     = can(regex("^[0-9]+\\.[0-9]+$", var.engine_version))
    error_message = "engine_version must be major.minor, e.g. \"8.0\"."
  }
}
