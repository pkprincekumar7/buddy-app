# terraform test — mock AWS provider: no credentials, nothing is created.
# Run from modules/alb: terraform init && terraform test

mock_provider "aws" {
  mock_data "aws_ec2_managed_prefix_list" {
    defaults = {
      id = "pl-cloudfront"
    }
  }
  mock_resource "aws_lb" {
    defaults = {
      arn = "arn:aws:elasticloadbalancing:ap-south-1:111111111111:loadbalancer/app/superpower-backend-alb-prod/0123456789abcdef"
    }
  }
  mock_resource "aws_lb_target_group" {
    defaults = {
      arn = "arn:aws:elasticloadbalancing:ap-south-1:111111111111:targetgroup/superpower-backend-tg-prod/0123456789abcdef"
    }
  }
  mock_resource "aws_lb_listener" {
    defaults = {
      arn = "arn:aws:elasticloadbalancing:ap-south-1:111111111111:listener/app/superpower-backend-alb-prod/0123456789abcdef/0123456789abcdef"
    }
  }
}

variables {
  app_name             = "superpower"
  environment          = "prod"
  vpc_id               = "vpc-1"
  public_subnet_ids    = ["subnet-a", "subnet-b", "subnet-c"]
  certificate_arn      = "arn:aws:acm:ap-south-1:111111111111:certificate/00000000-0000-0000-0000-000000000000"
  origin_verify_values = ["current-secret"]
  targets = {
    backend = { port = 8000 }
  }
}

run "single_catch_all_target" {
  command = apply

  assert {
    condition     = aws_lb.this.name == "superpower-backend-alb-prod" && can(regex("^superpower-backend-tg-prod-[0-9a-f]{4}$", aws_lb_target_group.service["backend"].name)) && aws_lb_target_group.service["backend"].tags.Name == "superpower-backend-tg-prod" && aws_security_group.alb.name == "superpower-backend-alb-sg-prod"
    error_message = "Names match the pre-module ones; target groups add a 4-character hash suffix."
  }
  assert {
    condition     = aws_lb.this.drop_invalid_header_fields && length(aws_lb.this.access_logs) == 0
    error_message = "Invalid headers dropped; no access_logs block when off."
  }
  assert {
    condition     = one(one(aws_lb_listener.https.default_action).fixed_response).status_code == "403" && aws_lb_listener.https.ssl_policy == "ELBSecurityPolicy-TLS13-1-2-2021-06"
    error_message = "Listener default is a fixed 403 on the TLS 1.3 policy."
  }
  assert {
    condition     = aws_vpc_security_group_ingress_rule.alb_from_cloudfront.prefix_list_id == "pl-cloudfront" && aws_vpc_security_group_ingress_rule.alb_from_cloudfront.from_port == 443
    error_message = "Inbound 443 only from the CloudFront prefix list."
  }
  assert {
    condition     = aws_lb_target_group.service["backend"].port == 8000 && one(aws_lb_target_group.service["backend"].health_check).path == "/health"
    error_message = "Target group on 8000 with /health checks by default."
  }
  assert {
    condition     = aws_lb_listener_rule.from_cloudfront["backend"].priority == 50000 && length(aws_lb_listener_rule.from_cloudfront["backend"].condition) == 1
    error_message = "The catch-all rule matches the header only, at the lowest priority."
  }
  assert {
    condition     = aws_lb_target_group.service["backend"].deregistration_delay == "300"
    error_message = "Without an override the target group keeps AWS's 300 s drain."
  }
  assert {
    condition     = keys(output.target_group_arns) == ["backend"] && keys(output.target_group_arn_suffixes) == ["backend"]
    error_message = "One target group per target, in the output maps."
  }
}

run "path_routed_target" {
  command = apply

  variables {
    targets = {
      auth    = { port = 8000, path_patterns = ["/api/v1/auth/*", "/api/v1/user/me"], priority = 10, health_check_path = "/api/health" }
      backend = { port = 8000 }
    }
  }

  assert {
    condition     = startswith(aws_lb_target_group.service["auth"].name, "superpower-auth-tg-prod-") && one(aws_lb_target_group.service["auth"].health_check).path == "/api/health"
    error_message = "Each target gets its own target group and health check path."
  }
  assert {
    condition     = aws_lb_listener_rule.from_cloudfront["auth"].priority == 10 && aws_lb_listener_rule.from_cloudfront["backend"].priority == 50000
    error_message = "The path rule is evaluated before the catch-all."
  }
  assert {
    condition = length(aws_lb_listener_rule.from_cloudfront["auth"].condition) == 2 && toset(flatten([
      for c in aws_lb_listener_rule.from_cloudfront["auth"].condition : [for p in c.path_pattern : p.values]
    ])) == toset(["/api/v1/auth/*", "/api/v1/user/me"])
    error_message = "The path rule requires the header AND one of its paths."
  }
  assert {
    condition = alltrue([
      for r in values(aws_lb_listener_rule.from_cloudfront) : anytrue([for c in r.condition : length(c.http_header) == 1])
    ])
    error_message = "Every rule requires X-Origin-Verify."
  }
}

run "rotation_and_access_logs" {
  command = apply

  variables {
    origin_verify_values = ["current-secret", "next-secret"]
    enable_access_logs   = true
    access_logs_bucket   = "superpower-logs-ap-south-1"
  }

  assert {
    condition     = one(one(aws_lb_listener_rule.from_cloudfront["backend"].condition).http_header).values == toset(["current-secret", "next-secret"])
    error_message = "Both values are accepted during a rotation."
  }
  assert {
    condition     = one(aws_lb.this.access_logs).bucket == "superpower-logs-ap-south-1" && one(aws_lb.this.access_logs).prefix == "alb-logs"
    error_message = "Access logs go to the bucket under alb-logs/."
  }
}

run "access_logs_need_a_bucket" {
  command = plan

  variables {
    enable_access_logs = true
  }

  expect_failures = [aws_lb.this]
}

run "needs_an_origin_verify_value" {
  command = plan

  variables {
    origin_verify_values = []
  }

  expect_failures = [var.origin_verify_values]
}

run "needs_exactly_one_catch_all" {
  command = plan

  variables {
    targets = {
      auth    = { port = 8000, path_patterns = ["/api/v1/auth/*"], priority = 10 }
      backend = { port = 8000, path_patterns = ["/api/v1/*"], priority = 20 }
    }
  }

  expect_failures = [var.targets]
}

run "path_targets_need_a_unique_priority" {
  command = plan

  variables {
    targets = {
      auth    = { port = 8000, path_patterns = ["/api/v1/auth/*"], priority = 10 }
      reports = { port = 8000, path_patterns = ["/api/v1/reports/*"], priority = 10 }
      backend = { port = 8000 }
    }
  }

  expect_failures = [var.targets]
}

run "path_targets_need_a_priority" {
  command = plan

  variables {
    targets = {
      auth    = { port = 8000, path_patterns = ["/api/v1/auth/*"] }
      backend = { port = 8000 }
    }
  }

  expect_failures = [var.targets]
}

run "rule_condition_values_are_capped_at_five" {
  command = plan

  variables {
    origin_verify_values = ["current-secret", "next-secret"]
    targets = {
      auth    = { port = 8000, path_patterns = ["/a/*", "/b/*", "/c/*", "/d/*"], priority = 10 }
      backend = { port = 8000 }
    }
  }

  expect_failures = [aws_lb_listener_rule.from_cloudfront]
}

run "target_group_names_fit_in_32_characters" {
  command = plan

  variables {
    targets = {
      a-very-long-service-key = { port = 8000, path_patterns = ["/x/*"], priority = 10 }
      backend                 = { port = 8000 }
    }
  }

  expect_failures = [aws_lb_target_group.service]
}

run "target_group_name_changes_with_its_replacement_settings" {
  # A port (or VPC) change replaces the group; the new one needs a new name
  # for create_before_destroy. A health check change doesn't replace it.
  command = plan

  variables {
    targets = { backend = { port = 8000 } }
  }

  assert {
    condition     = aws_lb_target_group.service["backend"].name == "superpower-backend-tg-prod-${substr(sha1(jsonencode([8000, "HTTP", "ip", "vpc-1"])), 0, 4)}"
    error_message = "The hash covers port, protocol, target type and VPC."
  }
}

run "target_group_name_on_another_port" {
  command = plan

  variables {
    targets = { backend = { port = 8080, health_check_path = "/api/health" } }
  }

  assert {
    condition     = aws_lb_target_group.service["backend"].name == "superpower-backend-tg-prod-${substr(sha1(jsonencode([8080, "HTTP", "ip", "vpc-1"])), 0, 4)}" && aws_lb_target_group.service["backend"].name != "superpower-backend-tg-prod-${substr(sha1(jsonencode([8000, "HTTP", "ip", "vpc-1"])), 0, 4)}"
    error_message = "A different port gives a different name."
  }
}

run "deregistration_delay_is_configurable" {
  command = plan

  variables {
    deregistration_delay_seconds = 120
    targets = {
      auth    = { port = 8000, path_patterns = ["/api/v1/auth/*"], priority = 10 }
      backend = { port = 8000 }
    }
  }

  assert {
    condition     = alltrue([for tg in values(aws_lb_target_group.service) : tg.deregistration_delay == "120"])
    error_message = "Every target group drains for deregistration_delay_seconds."
  }
}

run "deregistration_delay_must_be_in_range" {
  command = plan

  variables {
    deregistration_delay_seconds = 3601
  }

  expect_failures = [var.deregistration_delay_seconds]
}
