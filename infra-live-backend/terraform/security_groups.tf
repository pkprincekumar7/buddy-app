# ---------------------------------------------------------------------------
# ALB security group — backend VPC
# Accepts HTTP from CloudFront IPs only.
# ---------------------------------------------------------------------------

resource "aws_security_group" "alb_sg" {
  name        = "${var.app_name}-backend-alb-sg-${var.environment}"
  description = "Allow HTTP from CloudFront only"
  vpc_id      = aws_vpc.main.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.app_name}-backend-alb-sg-${var.environment}"
  }
}

resource "aws_vpc_security_group_ingress_rule" "alb_from_cloudfront" {
  description       = "HTTP from CloudFront"
  security_group_id = aws_security_group.alb_sg.id
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront.id
}

# ---------------------------------------------------------------------------
# ECS task security group — backend VPC
# Accepts port 8000 from ALB; unrestricted egress for ECR pulls and LLM APIs.
# ---------------------------------------------------------------------------

resource "aws_security_group" "ecs_task_sg" {
  name        = "${var.app_name}-ecs-task-sg-${var.environment}"
  description = "Allow port 8000 from ALB; unrestricted egress"
  vpc_id      = aws_vpc.main.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.app_name}-ecs-task-sg-${var.environment}"
  }
}

resource "aws_vpc_security_group_ingress_rule" "ecs_from_alb" {
  description                  = "FastAPI from ALB"
  security_group_id            = aws_security_group.ecs_task_sg.id
  ip_protocol                  = "tcp"
  from_port                    = 8000
  to_port                      = 8000
  referenced_security_group_id = aws_security_group.alb_sg.id
}

# ---------------------------------------------------------------------------
# Cross-VPC: allow ECS tasks to reach RDS in the database VPC.
#
# VPC peering does not support cross-VPC security group references in ingress
# rules — CIDR must be used instead. The backend VPC CIDR is used here, which
# allows any resource in the backend VPC to reach RDS on port 5432.
# This is acceptable because the backend VPC contains only ECS tasks and ALB.
# ---------------------------------------------------------------------------

resource "aws_vpc_security_group_ingress_rule" "ecs_to_rds" {
  description       = "PostgreSQL from backend VPC (ECS tasks via VPC peering)"
  security_group_id = data.terraform_remote_state.live_db.outputs.rds_sg_id
  ip_protocol       = "tcp"
  from_port         = 5432
  to_port           = 5432
  cidr_ipv4         = aws_vpc.main.cidr_block
}
