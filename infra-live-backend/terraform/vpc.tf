data "aws_availability_zones" "available" {
  state = "available"
}

# ---------------------------------------------------------------------------
# VPC — backend (ECS, ALB, ElastiCache)
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
resource "aws_subnet" "public_1" {
  #checkov:skip=CKV_AWS_130:map_public_ip_on_launch=true is required for public-facing ALB subnets; ECS tasks run in private subnets and are not affected

  vpc_id                  = aws_vpc.main.id
  cidr_block              = var.public_subnet_1_cidr
  availability_zone       = data.aws_availability_zones.available.names[0]
  map_public_ip_on_launch = true

  tags = {
    Name = "${var.app_name}-backend-public-1-${var.environment}"
  }
}

#trivy:ignore:AVD-AWS-0164
resource "aws_subnet" "public_2" {
  #checkov:skip=CKV_AWS_130:map_public_ip_on_launch=true is required for public-facing ALB subnets; ECS tasks run in private subnets and are not affected

  vpc_id                  = aws_vpc.main.id
  cidr_block              = var.public_subnet_2_cidr
  availability_zone       = data.aws_availability_zones.available.names[1]
  map_public_ip_on_launch = true

  tags = {
    Name = "${var.app_name}-backend-public-2-${var.environment}"
  }
}

#trivy:ignore:AVD-AWS-0164
resource "aws_subnet" "public_3" {
  #checkov:skip=CKV_AWS_130:map_public_ip_on_launch=true is required for public-facing ALB subnets; ECS tasks run in private subnets and are not affected

  vpc_id                  = aws_vpc.main.id
  cidr_block              = var.public_subnet_3_cidr
  availability_zone       = data.aws_availability_zones.available.names[2]
  map_public_ip_on_launch = true

  tags = {
    Name = "${var.app_name}-backend-public-3-${var.environment}"
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

resource "aws_route_table_association" "public_1" {
  subnet_id      = aws_subnet.public_1.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "public_2" {
  subnet_id      = aws_subnet.public_2.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "public_3" {
  subnet_id      = aws_subnet.public_3.id
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
  subnet_id     = [aws_subnet.public_1.id, aws_subnet.public_2.id, aws_subnet.public_3.id][count.index]
  tags          = { Name = "${var.app_name}-nat-${count.index + 1}-${var.environment}" }
  depends_on    = [aws_internet_gateway.igw]
}

# ---------------------------------------------------------------------------
# Private subnets — ECS tasks, ElastiCache, VPC endpoints (3 AZs)
# Each private subnet has its own route table. In prod (3 NAT GWs) each AZ
# routes to its local NAT, avoiding cross-AZ data charges. In stg (2 NAT GWs)
# private_3 shares AZ2's NAT — minor cross-AZ charge accepted. In dev/sbx
# (1 NAT GW) all three private subnets share the single NAT in AZ1.
# ---------------------------------------------------------------------------

resource "aws_subnet" "private_1" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = var.private_subnet_1_cidr
  availability_zone = data.aws_availability_zones.available.names[0]

  tags = {
    Name = "${var.app_name}-backend-private-1-${var.environment}"
  }
}

resource "aws_subnet" "private_2" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = var.private_subnet_2_cidr
  availability_zone = data.aws_availability_zones.available.names[1]

  tags = {
    Name = "${var.app_name}-backend-private-2-${var.environment}"
  }
}

resource "aws_subnet" "private_3" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = var.private_subnet_3_cidr
  availability_zone = data.aws_availability_zones.available.names[2]

  tags = {
    Name = "${var.app_name}-backend-private-3-${var.environment}"
  }
}

resource "aws_route_table" "private_1" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${var.app_name}-backend-private-rt-1-${var.environment}" }
}

resource "aws_route_table" "private_2" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${var.app_name}-backend-private-rt-2-${var.environment}" }
}

resource "aws_route_table" "private_3" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${var.app_name}-backend-private-rt-3-${var.environment}" }
}

resource "aws_route" "private_nat_1" {
  route_table_id         = aws_route_table.private_1.id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.nat[0].id
}

resource "aws_route" "private_nat_2" {
  route_table_id         = aws_route_table.private_2.id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.nat[min(1, var.nat_gateway_count - 1)].id
}

resource "aws_route" "private_nat_3" {
  route_table_id         = aws_route_table.private_3.id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.nat[min(2, var.nat_gateway_count - 1)].id
}

resource "aws_route_table_association" "private_1" {
  subnet_id      = aws_subnet.private_1.id
  route_table_id = aws_route_table.private_1.id
}

resource "aws_route_table_association" "private_2" {
  subnet_id      = aws_subnet.private_2.id
  route_table_id = aws_route_table.private_2.id
}

resource "aws_route_table_association" "private_3" {
  subnet_id      = aws_subnet.private_3.id
  route_table_id = aws_route_table.private_3.id
}
