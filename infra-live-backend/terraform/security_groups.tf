# ---------------------------------------------------------------------------
# ALB security group — backend VPC
# Accepts HTTPS (443) from CloudFront IPs only.
# ---------------------------------------------------------------------------

resource "aws_security_group" "alb_sg" {
  name        = "${var.app_name}-backend-alb-sg-${var.environment}"
  description = "Allow HTTPS from CloudFront only"
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
  description       = "HTTPS from CloudFront"
  security_group_id = aws_security_group.alb_sg.id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront.id
}

# ---------------------------------------------------------------------------
# ECS task security group — backend VPC
# Accepts port 8000 from ALB; unrestricted egress for ECR pulls, LLM APIs,
# and MongoDB Atlas (external, accessed over the internet).
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
