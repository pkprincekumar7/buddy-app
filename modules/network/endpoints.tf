# ---------------------------------------------------------------------------
# VPC Endpoints — keep AWS service traffic off the public internet
#
# Gateway endpoint (S3): free; routes S3 + ECR layer pulls over the AWS
# backbone, eliminating NAT data-processing charges for image pulls.
# Provisioned in all environments (no cost).
#
# Interface endpoints (5 services): each endpoint costs $0.013/AZ/hr.
# Skipped in dev/sbx (nat_gateway_count = 1) — cost too high relative to
# the environment budget. Enabled for stg (2 AZs) and prod (3 AZs).
#
# nat_gateway_count drives both the create/skip decision and the AZ count:
#   1 (dev/sbx) → no interface endpoints
#   2 (stg)     → 2-AZ interface endpoints (~$94/mo)
#   3 (prod)    → 3-AZ interface endpoints (~$140/mo)
# ---------------------------------------------------------------------------

locals {
  create_interface_endpoints = var.nat_gateway_count > 1

  # Private subnets of the first nat_gateway_count AZs.
  endpoint_subnet_ids = [for k in slice(local.az_keys, 0, var.nat_gateway_count) : aws_subnet.private[k].id]

  # Endpoint key (resource address and Name tag) → service name suffix.
  interface_endpoint_services = {
    ecr_api         = "ecr.api"
    ecr_dkr         = "ecr.dkr"
    secretsmanager  = "secretsmanager"
    cloudwatch_logs = "logs"
    xray            = "xray"
  }
}

# ---------------------------------------------------------------------------
# Security group — shared by all AWS Interface Endpoints
# Conditional on create_interface_endpoints; not needed in dev/sbx where
# no interface endpoints are provisioned.
# ---------------------------------------------------------------------------

#trivy:ignore:AVD-AWS-0104
resource "aws_security_group" "vpc_endpoints_sg" {
  #checkov:skip=CKV_AWS_382:Interface endpoints do not initiate outbound connections — no egress rule required; inbound 443 from ECS task SGs is sufficient
  count = local.create_interface_endpoints ? 1 : 0

  name        = "${var.app_name}-vpc-endpoints-sg-${var.environment}"
  description = "Allow HTTPS from ECS task SGs to AWS Interface Endpoints"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "${var.app_name}-vpc-endpoints-sg-${var.environment}"
  }
}

resource "aws_vpc_security_group_ingress_rule" "endpoints_from_client" {
  for_each = local.create_interface_endpoints ? var.endpoint_client_security_groups : {}

  description                  = each.value.description
  security_group_id            = aws_security_group.vpc_endpoints_sg[0].id
  ip_protocol                  = "tcp"
  from_port                    = 443
  to_port                      = 443
  referenced_security_group_id = each.value.id
}

# ---------------------------------------------------------------------------
# S3 Gateway Endpoint — free; attached to all 3 private route tables in all envs
# ---------------------------------------------------------------------------

resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${var.aws_region}.s3"
  vpc_endpoint_type = "Gateway"

  route_table_ids = [for k in local.az_keys : aws_route_table.private[k].id]

  tags = {
    Name = "${var.app_name}-s3-endpoint-${var.environment}"
  }
}

# ---------------------------------------------------------------------------
# Interface Endpoints — ECR API, ECR DKR, Secrets Manager, CloudWatch Logs,
# X-Ray. Skipped for dev/sbx (nat_gateway_count = 1). For stg/prod, placed
# in local.endpoint_subnet_ids (2 AZs for stg, 3 AZs for prod).
# ---------------------------------------------------------------------------

resource "aws_vpc_endpoint" "interface" {
  #checkov:skip=CKV_AWS_123:Endpoint policy not required — access is controlled by ECS task IAM roles and the endpoint security group
  for_each = local.create_interface_endpoints ? local.interface_endpoint_services : {}

  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.${var.aws_region}.${each.value}"
  vpc_endpoint_type   = "Interface"
  private_dns_enabled = true

  subnet_ids         = local.endpoint_subnet_ids
  security_group_ids = [aws_security_group.vpc_endpoints_sg[0].id]

  tags = {
    Name = "${var.app_name}-${replace(each.key, "_", "-")}-endpoint-${var.environment}"
  }
}
