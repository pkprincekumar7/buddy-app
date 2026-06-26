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
# Accepts port 8000 from ALB; unrestricted egress via NAT for LLM APIs and
# MongoDB Atlas. In stg/prod, AWS service traffic (ECR, Secrets Manager,
# CloudWatch, X-Ray) routes via VPC Interface Endpoints before reaching NAT.
# In dev/sbx (no Interface Endpoints) all outbound traffic goes through NAT.
# ---------------------------------------------------------------------------

#trivy:ignore:AVD-AWS-0104
resource "aws_security_group" "ecs_task_sg" {
  #checkov:skip=CKV_AWS_382:Unrestricted egress required — ECS tasks need outbound to LLM APIs (OpenAI/Anthropic/Gemini) and MongoDB Atlas on arbitrary ports via NAT

  name        = "${var.app_name}-ecs-task-sg-${var.environment}"
  description = "Allow port 8000 from ALB; unrestricted egress via NAT (stg/prod: AWS services via VPC endpoints)"
  vpc_id      = aws_vpc.main.id

  egress {
    description = "All outbound traffic via NAT (stg/prod: AWS service calls intercepted by VPC Interface Endpoints before NAT)"
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
  #checkov:skip=CKV_AWS_382:Unrestricted egress required — worker needs outbound via NAT to MongoDB Atlas and LLM APIs (OpenAI/Anthropic/Gemini); in stg/prod AWS service traffic (ECR, Secrets Manager, CloudWatch) routes via VPC Interface Endpoints before NAT; in dev/sbx all traffic traverses NAT

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
