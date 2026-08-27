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
    aws_subnet.public_3.id,
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

  # Default action rejects everything. Only the listener rule below (matching
  # the CloudFront origin-verify header) forwards to ECS — see
  # aws_lb_listener_rule.from_cloudfront and var.origin_verify_secret.
  default_action {
    type = "fixed-response"

    fixed_response {
      content_type = "text/plain"
      message_body = "Forbidden"
      status_code  = "403"
    }
  }
}

# ---------------------------------------------------------------------------
# Origin-verify listener rule
#
# The ALB security group (see security_groups.tf) already restricts inbound
# traffic to the AWS-managed CloudFront prefix list, but that list is shared
# by every CloudFront distribution on AWS — not just this app's. Without this
# rule, anyone could point their own CloudFront distribution's origin at this
# ALB's public DNS name and reach ECS directly, bypassing this app's
# distribution and therefore its Lambda@Edge JWT check entirely.
#
# infra-live-edge sets the same secret as a custom_header on the alb-backend
# origin, so only requests that actually passed through this app's
# CloudFront distribution carry a matching header.
# ---------------------------------------------------------------------------
resource "aws_lb_listener_rule" "from_cloudfront" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 1

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.backend.arn
  }

  condition {
    http_header {
      http_header_name = "X-Origin-Verify"
      values           = [var.origin_verify_secret]
    }
  }
}
