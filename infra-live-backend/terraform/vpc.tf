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
# Public subnets — ALB and ECS tasks (assign_public_ip = true)
# ---------------------------------------------------------------------------

#trivy:ignore:AVD-AWS-0164
resource "aws_subnet" "public_1" {
  #checkov:skip=CKV_AWS_130:map_public_ip_on_launch=true is required for public-facing ALB subnets by design; ECS task public IPs are separately controlled via assign_public_ip in the ECS service

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
  #checkov:skip=CKV_AWS_130:map_public_ip_on_launch=true is required for public-facing ALB subnets by design; ECS task public IPs are separately controlled via assign_public_ip in the ECS service

  vpc_id                  = aws_vpc.main.id
  cidr_block              = var.public_subnet_2_cidr
  availability_zone       = data.aws_availability_zones.available.names[1]
  map_public_ip_on_launch = true

  tags = {
    Name = "${var.app_name}-backend-public-2-${var.environment}"
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

# ---------------------------------------------------------------------------
# Private subnets — ElastiCache (no internet access needed)
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

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "${var.app_name}-backend-private-rt-${var.environment}"
  }
}

resource "aws_route_table_association" "private_1" {
  subnet_id      = aws_subnet.private_1.id
  route_table_id = aws_route_table.private.id
}

resource "aws_route_table_association" "private_2" {
  subnet_id      = aws_subnet.private_2.id
  route_table_id = aws_route_table.private.id
}
