# ---------------------------------------------------------------------------
# ALB security group — backend VPC
# Accepts HTTPS (443) from CloudFront IPs only.
# ---------------------------------------------------------------------------

#trivy:ignore:AVD-AWS-0104
resource "aws_security_group" "alb_sg" {
  #checkov:skip=CKV_AWS_382:Unrestricted egress is standard for ALB — it needs to forward requests to ECS tasks on dynamic ports

  name        = "${var.app_name}-backend-alb-sg-${var.environment}"
  description = "Allow HTTPS from CloudFront only"
  vpc_id      = aws_vpc.main.id

  egress {
    description = "All outbound traffic"
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

#trivy:ignore:AVD-AWS-0104
resource "aws_security_group" "ecs_task_sg" {
  #checkov:skip=CKV_AWS_382:Unrestricted egress required — ECS tasks need outbound access to ECR (image pulls), Secrets Manager, CloudWatch, MongoDB Atlas, and LLM APIs (OpenAI/Anthropic/Gemini) on arbitrary ports

  name        = "${var.app_name}-ecs-task-sg-${var.environment}"
  description = "Allow port 8000 from ALB; unrestricted egress"
  vpc_id      = aws_vpc.main.id

  egress {
    description = "All outbound traffic"
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
# Worker security group
# No inbound rules — worker initiates all connections (MongoDB, LLM APIs,
# CloudWatch). Unrestricted egress is required for the same reasons as the
# API task SG (ECR, Secrets Manager, MongoDB Atlas, LLM provider APIs).
# ---------------------------------------------------------------------------

#trivy:ignore:AVD-AWS-0104
resource "aws_security_group" "worker_sg" {
  #checkov:skip=CKV_AWS_382:Unrestricted egress required — worker needs outbound to ECR (image pulls), Secrets Manager, CloudWatch, MongoDB Atlas, and LLM APIs (OpenAI/Anthropic/Gemini)

  name        = "${var.app_name}-worker-sg-${var.environment}"
  description = "Worker: no inbound, unrestricted egress for LLM APIs and MongoDB"
  vpc_id      = aws_vpc.main.id

  egress {
    description = "All outbound traffic"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.app_name}-worker-sg-${var.environment}"
  }
}
