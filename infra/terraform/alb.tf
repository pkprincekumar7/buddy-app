resource "aws_lb" "buddy360_alb" {
  name               = "${var.app_name}-alb"
  load_balancer_type = "application"
  subnets            = [data.terraform_remote_state.db.outputs.public_subnet_1_id, data.terraform_remote_state.db.outputs.public_subnet_2_id]
  security_groups    = [aws_security_group.alb_sg.id]

  tags = {
    Name = "${var.app_name}-alb"
  }
}

# ── Target Groups ─────────────────────────────────────────────────────────────

resource "aws_lb_target_group" "frontend" {
  name     = "${var.app_name}-frontend-tg"
  port     = 5173
  protocol = "HTTP"
  vpc_id   = data.terraform_remote_state.db.outputs.vpc_id

  health_check {
    path                = "/"
    protocol            = "HTTP"
    matcher             = "200-399"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = {
    Name = "${var.app_name}-frontend-tg"
  }
}

resource "aws_lb_target_group" "backend" {
  name     = "${var.app_name}-backend-tg"
  port     = 8000
  protocol = "HTTP"
  vpc_id   = data.terraform_remote_state.db.outputs.vpc_id

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
    Name = "${var.app_name}-backend-tg"
  }
}

resource "aws_lb_target_group_attachment" "frontend_attach" {
  target_group_arn = aws_lb_target_group.frontend.arn
  target_id        = aws_instance.buddy360_ec2.id
  port             = 5173
}

resource "aws_lb_target_group_attachment" "backend_attach" {
  target_group_arn = aws_lb_target_group.backend.arn
  target_id        = aws_instance.buddy360_ec2.id
  port             = 8000
}

# ── Listeners ─────────────────────────────────────────────────────────────────

# HTTP → HTTPS redirect
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.buddy360_alb.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"

    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

# HTTPS listener — serves frontend by default, /api/* goes to backend
resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.buddy360_alb.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.acm_certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.frontend.arn
  }
}

resource "aws_lb_listener_rule" "backend_api" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 10

  condition {
    path_pattern {
      values = ["/api/*"]
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.backend.arn
  }
}

# ── Route 53 ──────────────────────────────────────────────────────────────────

resource "aws_route53_record" "app" {
  zone_id = var.hosted_zone_id
  name    = local.fqdn
  type    = "A"

  alias {
    name                   = aws_lb.buddy360_alb.dns_name
    zone_id                = aws_lb.buddy360_alb.zone_id
    evaluate_target_health = true
  }
}
