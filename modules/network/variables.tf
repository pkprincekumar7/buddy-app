variable "app_name" {
  description = "Application name — prefix of every resource name and Name tag."
  type        = string
}

variable "environment" {
  description = "Deployment environment (dev, sbx, stg, prod) — suffix of every resource name."
  type        = string
}

variable "aws_region" {
  description = "AWS region the VPC lives in — used for the VPC endpoint service names."
  type        = string
}

variable "vpc_cidr" {
  description = "This region's /16 (one entry of the root's vpc_cidrs, NET-01). Subnets are derived from it — see main.tf."
  type        = string

  validation {
    condition     = can(cidrnetmask(var.vpc_cidr)) && endswith(var.vpc_cidr, "/16")
    error_message = "vpc_cidr must be a /16 — the subnet layout assumes one."
  }
}

variable "nat_gateway_count" {
  description = "NAT Gateways to create, one per AZ starting at AZ 1 (1 for dev/sbx, 2 for stg, 3 for prod). Private subnets without their own NAT use the highest-numbered one (min(az, count)). More than 1 also turns on the interface VPC endpoints."
  type        = number

  validation {
    condition     = contains([1, 2, 3], var.nat_gateway_count)
    error_message = "nat_gateway_count must be 1, 2, or 3."
  }
}

variable "endpoint_client_security_groups" {
  description = "Security groups allowed to reach the interface VPC endpoints on 443, keyed by a short name used in the rule's address and description (e.g. { \"api_task\" = { id = …, description = \"HTTPS from API task SG\" } }). Ignored when no interface endpoints are created."
  type = map(object({
    id          = string
    description = string
  }))
  default = {}
}
