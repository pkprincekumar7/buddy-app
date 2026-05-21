# ---------------------------------------------------------------------------
# ALB — backend only (HTTPS on port 443)
#
# CloudFront terminates TLS for end users and proxies /api/* to this ALB
# using https-only to the internal subdomain (e.g. buddy-internal-dev.learning-dev.com).
# The ACM certificate for the backend region (var.acm_certificate_arn) is resolved
# per-region by the workflow and must cover the internal ALB subdomain.
# ALB→ECS traffic stays within the VPC on HTTP port 8000.
# ---------------------------------------------------------------------------

#trivy:ignore:AVD-AWS-0053
resource "aws_lb" "backend" {
  #checkov:skip=CKV2_AWS_28:WAF not required at this scale; CloudFront WAF handles edge-layer filtering before traffic reaches this ALB
  #checkov:skip=CKV_AWS_150:Deletion protection disabled intentionally — environments are torn down via terraform destroy; enabling it would require a manual disable step before every destroy
  #checkov:skip=CKV_AWS_91:ALB access logs not enabled — S3 log bucket and associated costs deferred; application-level logs go to CloudWatch

  name               = "${var.app_name}-backend-alb-${var.environment}"
  load_balancer_type = "application"
  subnets = [
    aws_subnet.public_1.id,
    aws_subnet.public_2.id,
  ]
  security_groups            = [aws_security_group.alb_sg.id]
  drop_invalid_header_fields = true

  tags = {
    Name = "${var.app_name}-backend-alb-${var.environment}"
  }
}

resource "aws_lb_target_group" "backend" {
  name        = "${var.app_name}-backend-tg-${var.environment}"
  port        = 8000
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.main.id

  health_check {
    path                = "/health"
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = {
    Name = "${var.app_name}-backend-tg-${var.environment}"
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.backend.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.acm_certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.backend.arn
  }
}
