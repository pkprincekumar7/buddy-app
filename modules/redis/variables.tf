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
  description = "Redis AUTH token (16–128 printable ASCII chars, no spaces, quotes, @ or /)."
  type        = string
  sensitive   = true
}

variable "engine_version" {
  description = "Redis engine version."
  type        = string
  default     = "7.1"
}
