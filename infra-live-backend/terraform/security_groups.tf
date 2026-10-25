# ---------------------------------------------------------------------------
# Task security groups — one per entry in local.services (services.tf).
# The ALB's lives in ../../modules/alb, Redis's in ../../modules/redis and the
# VPC endpoints' in ../../modules/network (TF-01).
#
# Unrestricted egress via NAT for LLM APIs and MongoDB Atlas. In stg/prod, AWS
# service traffic (ECR, Secrets Manager, CloudWatch, X-Ray) routes via VPC
# Interface Endpoints before reaching NAT; in dev/sbx all of it goes through
# NAT. Inbound: an HTTP service's port only from the ALB, and a registered
# runtime's internal port only from internal-callers (service_discovery.tf).
# ---------------------------------------------------------------------------

#trivy:ignore:AVD-AWS-0104
resource "aws_security_group" "service" {
  #checkov:skip=CKV_AWS_382:Unrestricted egress required — tasks need outbound to LLM APIs (OpenAI/Anthropic/Gemini) and MongoDB Atlas on arbitrary ports via NAT
  #checkov:skip=CKV2_AWS_5:Attached to each ECS service via module.service[*]'s security_group_ids (and to Redis/endpoint rules); checkov's graph check doesn't follow module inputs — tests/stack.tftest.hcl asserts the attachment
  for_each = local.services

  name        = "${var.app_name}-${each.key}-sg-${var.environment}"
  description = "${each.value.display_name} tasks: ${each.value.http != null ? "port ${each.value.http.port} from the ALB" : "no ALB"}${each.value.internal_port != null ? ", ${each.value.internal_port} from internal callers" : ""}; unrestricted egress via NAT"
  vpc_id      = module.network.vpc_id

  egress {
    description = "All outbound traffic via NAT (stg/prod: AWS service calls intercepted by VPC Interface Endpoints before NAT)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.app_name}-${each.key}-sg-${var.environment}"
  }
}

resource "aws_vpc_security_group_ingress_rule" "service_from_alb" {
  for_each = local.http_services

  description                  = "${each.value.display_name} from ALB"
  security_group_id            = aws_security_group.service[each.key].id
  ip_protocol                  = "tcp"
  from_port                    = each.value.http.port
  to_port                      = each.value.http.port
  referenced_security_group_id = module.alb.security_group_id
}
