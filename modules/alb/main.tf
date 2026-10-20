# ---------------------------------------------------------------------------
# alb — backend ALB (HTTPS on 443), one target group per HTTP service,
# listener, origin-verify rules and the ALB security group (TF-01).
#
# CloudFront terminates TLS for end users and proxies /api/* to this ALB over
# https-only to the internal subdomain (e.g. superpower-internal-dev-ap-south-1.learning-dev.com);
# var.certificate_arn must cover that name. ALB→ECS stays within the VPC on
# plain HTTP (each target's port).
#
# var.targets is keyed by service (services.tf). A target with path_patterns
# gets its own rule at its priority; the one without is the catch-all, at the
# lowest priority. Every rule also requires X-Origin-Verify, so nothing
# reaches a target group without it.
# ---------------------------------------------------------------------------

# CloudFront managed prefix list — restricts ALB inbound to CloudFront IPs only.
data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

#trivy:ignore:AVD-AWS-0104
resource "aws_security_group" "alb" {
  #checkov:skip=CKV_AWS_382:Unrestricted egress is standard for ALB — it needs to forward requests to ECS tasks on dynamic ports

  name        = "${var.app_name}-backend-alb-sg-${var.environment}"
  description = "Allow HTTPS from CloudFront only"
  vpc_id      = var.vpc_id

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
  security_group_id = aws_security_group.alb.id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront.id
}

#trivy:ignore:AVD-AWS-0053
resource "aws_lb" "this" {
  #checkov:skip=CKV2_AWS_28:WAF not required at this scale; CloudFront WAF handles edge-layer filtering before traffic reaches this ALB
  #checkov:skip=CKV_AWS_150:Deletion protection disabled intentionally — environments are torn down via terraform destroy; enabling it would require a manual disable step before every destroy
  #checkov:skip=CKV_AWS_91:ALB access logs are conditionally enabled below (access_logs block, gated on var.enable_access_logs) — off on dev/sbx to avoid the S3 storage/PUT cost at low traffic, on for stg/prod by default. Not universally disabled.

  name                       = "${var.app_name}-backend-alb-${var.environment}"
  load_balancer_type         = "application"
  subnets                    = var.public_subnet_ids
  security_groups            = [aws_security_group.alb.id]
  drop_invalid_header_fields = true

  # Absent entirely (not just enabled=false) when off: the provider requires a
  # non-empty bucket whenever this block is present, even with enabled=false.
  dynamic "access_logs" {
    for_each = var.enable_access_logs ? [1] : []
    content {
      bucket  = var.access_logs_bucket
      prefix  = "alb-logs"
      enabled = true
    }
  }

  tags = {
    Name = "${var.app_name}-backend-alb-${var.environment}"
  }

  lifecycle {
    precondition {
      condition     = !var.enable_access_logs || var.access_logs_bucket != ""
      error_message = "enable_access_logs needs access_logs_bucket."
    }
  }
}

# Target group names must be unique per account/region, and port, protocol,
# target type and VPC can't change in place: changing one replaces the group.
# The name ends in a short hash of exactly those settings, so a replacement
# gets a new name and create_before_destroy can bring it up (and repoint the
# listener rule and ECS service) before the old one is deleted. Without it
# the delete fails with ResourceInUse.
locals {
  target_group_base_name = { for k, _ in var.targets : k => "${var.app_name}-${k}-tg-${var.environment}" }
  target_group_name = {
    for k, t in var.targets : k => "${local.target_group_base_name[k]}-${substr(sha1(jsonencode([t.port, "HTTP", "ip", var.vpc_id])), 0, 4)}"
  }
}

resource "aws_lb_target_group" "service" {
  #checkov:skip=CKV_AWS_378:Intentional — ALB→ECS traffic stays within the VPC on plain HTTP; CloudFront terminates TLS for end users and the ALB HTTPS listener re-encrypts CloudFront→ALB, so this HTTP hop never leaves the VPC. Switching it to HTTPS would require ECS to terminate TLS itself, a separate, unrelated change.

  for_each = var.targets

  name        = local.target_group_name[each.key]
  port        = each.value.port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = var.vpc_id

  deregistration_delay = var.deregistration_delay_seconds

  health_check {
    path                = each.value.health_check_path
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = {
    Name = local.target_group_base_name[each.key]
  }

  lifecycle {
    create_before_destroy = true

    precondition {
      # base + "-" + 4-character hash
      condition     = length(local.target_group_base_name[each.key]) + 5 <= 32
      error_message = "Target group name ${local.target_group_base_name[each.key]}-xxxx is over AWS's 32 characters — use a shorter service key."
    }
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn

  # Default action rejects everything. Only the origin-verify rules below
  # forward to ECS.
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
# The security group already restricts inbound traffic to the AWS-managed
# CloudFront prefix list, but that list is shared by every CloudFront
# distribution on AWS — not just this app's. Without this rule, anyone could
# point their own CloudFront distribution's origin at this ALB's public DNS
# name and reach ECS directly, bypassing this app's distribution and therefore
# its Lambda@Edge JWT check entirely.
#
# infra-live-edge sets the same secret as a custom_header on the alb-backend
# origin, so only requests that actually passed through this app's CloudFront
# distribution carry a matching header. values is OR-matched: during a
# rotation it holds both the current and the incoming secret.
#
# One rule per target: header AND path for the path-routed ones, header only
# for the catch-all (priority 50000, AWS's maximum, so it's evaluated last).
# ---------------------------------------------------------------------------
locals {
  catch_all_priority = 50000
}

resource "aws_lb_listener_rule" "from_cloudfront" {
  for_each = var.targets

  listener_arn = aws_lb_listener.https.arn
  priority     = length(each.value.path_patterns) > 0 ? each.value.priority : local.catch_all_priority

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.service[each.key].arn
  }

  condition {
    http_header {
      http_header_name = "X-Origin-Verify"
      values           = var.origin_verify_values
    }
  }

  dynamic "condition" {
    for_each = length(each.value.path_patterns) > 0 ? [1] : []
    content {
      path_pattern {
        values = each.value.path_patterns
      }
    }
  }

  lifecycle {
    precondition {
      # AWS allows 5 condition values per rule, across all its conditions.
      condition     = length(var.origin_verify_values) + length(each.value.path_patterns) <= 5
      error_message = "Listener rule for ${each.key}: origin-verify values + path_patterns is over AWS's 5 condition values per rule. Use fewer (broader) path patterns."
    }
  }
}
