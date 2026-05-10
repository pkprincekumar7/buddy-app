# ---------------------------------------------------------------------------
# ALB — backend only (HTTP on port 80)
# CloudFront terminates TLS for end users and proxies /api/* to this ALB.
# No Route 53 record needed — CloudFront accesses the ALB via its AWS DNS name.
# ---------------------------------------------------------------------------

resource "aws_lb" "backend" {
  name               = "${var.app_name}-backend-alb-${var.environment}"
  load_balancer_type = "application"
  subnets = [
    aws_subnet.public_1.id,
    aws_subnet.public_2.id,
  ]
  security_groups = [aws_security_group.alb_sg.id]

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

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.backend.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.backend.arn
  }
}
