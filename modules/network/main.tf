# ---------------------------------------------------------------------------
# network — backend VPC: 3 public + 3 private subnets, IGW, NAT, routing and
# VPC endpoints (TF-01). One instance per (environment, region).
#
# Address plan (NET-01) — derived from var.vpc_cidr (a /16):
#
#   public  /24 ×3   10.x.1.0/24  10.x.2.0/24  10.x.3.0/24   ALB, NAT GWs
#   private /20 ×3   10.x.16.0/20 10.x.32.0/20 10.x.48.0/20  ECS, Redis, endpoints
#
# The public /24s sit inside the first /20 (10.x.0.0/20), which no private
# subnet uses, so the two ranges can't overlap. ~4,091 usable IPs per private
# subnet (~12,270 total) leaves well over 3× the prod peak of ~585 (every
# service's max tasks — API 200, worker 50, auth 30, admin 3 — doubled during a
# deploy, plus endpoint ENIs and Redis nodes) — room for TF-03's smaller tasks. 10.x.64.0–10.x.255.255 is left free.
#
# Subnets, route tables and routes are keyed "1", "2", "3" (the AZ number,
# also used in their names), so module.network.aws_subnet.private["2"] is
# AZ 2's private subnet.
# ---------------------------------------------------------------------------

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  az_keys = ["1", "2", "3"]

  # AZ number → AZ name / public /24 / private /20.
  azs = {
    for i, k in local.az_keys : k => {
      name    = data.aws_availability_zones.available.names[i]
      public  = cidrsubnet(var.vpc_cidr, 8, i + 1)
      private = cidrsubnet(var.vpc_cidr, 4, i + 1)
    }
  }

  # AZ number → index of the NAT Gateway its private subnet routes through.
  # Prod (3 NATs): each AZ uses its own, no cross-AZ data charges. Stg (2):
  # AZ 3 shares AZ 2's — minor cross-AZ charge accepted. Dev/sbx (1): all
  # three share AZ 1's.
  nat_index_for_az = { for i, k in local.az_keys : k => min(i, var.nat_gateway_count - 1) }
}

# ---------------------------------------------------------------------------
# VPC
# ---------------------------------------------------------------------------

resource "aws_vpc" "main" {
  #checkov:skip=CKV2_AWS_11:VPC flow logging disabled — incurs CloudWatch/S3 storage costs; deferred until traffic volume justifies the expense
  #checkov:skip=CKV2_AWS_12:Default SG is not explicitly managed in Terraform; traffic is controlled via dedicated alb_sg and ecs_task_sg security groups

  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "${var.app_name}-backend-vpc-${var.environment}"
  }
}

# ---------------------------------------------------------------------------
# Public subnets — ALB and NAT Gateways (3 AZs)
# ---------------------------------------------------------------------------

#trivy:ignore:AVD-AWS-0164
resource "aws_subnet" "public" {
  #checkov:skip=CKV_AWS_130:map_public_ip_on_launch=true is required for public-facing ALB subnets; ECS tasks run in private subnets and are not affected
  for_each = local.azs

  vpc_id                  = aws_vpc.main.id
  cidr_block              = each.value.public
  availability_zone       = each.value.name
  map_public_ip_on_launch = true

  tags = {
    Name = "${var.app_name}-backend-public-${each.key}-${var.environment}"
  }
}

resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "${var.app_name}-backend-igw-${var.environment}"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "${var.app_name}-backend-public-rt-${var.environment}"
  }
}

resource "aws_route" "internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.igw.id
}

resource "aws_route_table_association" "public" {
  for_each = aws_subnet.public

  subnet_id      = each.value.id
  route_table_id = aws_route_table.public.id
}

# ---------------------------------------------------------------------------
# NAT Gateways — one per AZ for private subnet outbound internet access
# (LLM API calls to OpenAI/Anthropic/Gemini traverse NAT; AWS service
# traffic uses VPC endpoints and never hits NAT)
# ---------------------------------------------------------------------------

resource "aws_eip" "nat" {
  count  = var.nat_gateway_count
  domain = "vpc"
  tags   = { Name = "${var.app_name}-nat-eip-${count.index + 1}-${var.environment}" }
}

resource "aws_nat_gateway" "nat" {
  count         = var.nat_gateway_count
  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[local.az_keys[count.index]].id
  tags          = { Name = "${var.app_name}-nat-${count.index + 1}-${var.environment}" }
  depends_on    = [aws_internet_gateway.igw]
}

# ---------------------------------------------------------------------------
# Private subnets — ECS tasks, ElastiCache, VPC endpoints (3 AZs)
# Each private subnet has its own route table, routed to its NAT per
# local.nat_index_for_az.
# ---------------------------------------------------------------------------

resource "aws_subnet" "private" {
  for_each = local.azs

  vpc_id            = aws_vpc.main.id
  cidr_block        = each.value.private
  availability_zone = each.value.name

  tags = {
    Name = "${var.app_name}-backend-private-${each.key}-${var.environment}"
  }
}

resource "aws_route_table" "private" {
  for_each = local.azs

  vpc_id = aws_vpc.main.id
  tags   = { Name = "${var.app_name}-backend-private-rt-${each.key}-${var.environment}" }
}

resource "aws_route" "private_nat" {
  for_each = local.azs

  route_table_id         = aws_route_table.private[each.key].id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.nat[local.nat_index_for_az[each.key]].id
}

resource "aws_route_table_association" "private" {
  for_each = local.azs

  subnet_id      = aws_subnet.private[each.key].id
  route_table_id = aws_route_table.private[each.key].id
}
