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
    condition     = aws_lb.this.name == "superpower-backend-alb-prod" && can(regex("^superpower-backend-prod-[0-9a-f]{4}$", aws_lb_target_group.service["backend"].name)) && aws_lb_target_group.service["backend"].tags.Name == "superpower-backend-prod" && aws_security_group.alb.name == "superpower-backend-alb-sg-prod"
    error_message = "ALB and security group names match the pre-module ones; target groups are <app>-<key>-<env> plus a 4-character hash."
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
    condition     = startswith(aws_lb_target_group.service["auth"].name, "superpower-auth-prod-") && one(aws_lb_target_group.service["auth"].health_check).path == "/api/health"
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

run "at_most_one_catch_all" {
  command = plan

  variables {
    targets = {
      backend = { port = 8000 }
      other   = { port = 8000 }
    }
  }

  expect_failures = [aws_lb_target_group.service]
}

run "no_catch_all_gives_unknown_paths_a_fixed_404" {
  command = apply

  variables {
    targets = {
      auth = { port = 8000, path_patterns = ["/api/v1/auth/*"], priority = 120 }
    }
  }

  assert {
    condition     = keys(aws_lb_listener_rule.from_cloudfront) == ["auth"] && length(aws_lb_listener_rule.not_found) == 1
    error_message = "No catch-all target: the auth rule plus the fixed 404."
  }
  assert {
    condition     = aws_lb_listener_rule.not_found[0].priority == 50000 && one(one(aws_lb_listener_rule.not_found[0].action).fixed_response).status_code == "404"
    error_message = "The fixed 404 is evaluated last, at 50000."
  }
  assert {
    condition     = one(one(aws_lb_listener_rule.not_found[0].condition).http_header).http_header_name == "X-Origin-Verify"
    error_message = "Only requests through CloudFront get the 404; without the header it's the listener's 403."
  }
}

run "a_catch_all_target_needs_no_404_rule" {
  command = plan

  assert {
    condition     = length(aws_lb_listener_rule.not_found) == 0
    error_message = "With a catch-all target nothing reaches priority 50000 unmatched."
  }
}

# The stack reads shared/service-routes.json (build plan 2.5): the same rules, here.
run "routes_from_the_shared_route_list" {
  command = apply

  variables {
    targets = {
      for service in distinct([
        for r in jsondecode(file("../../shared/service-routes.json")).rules : r.service if lookup(r, "built", true)
      ]) : service => { port = 8000 }
    }
    routes = [
      for r in jsondecode(file("../../shared/service-routes.json")).rules : {
        priority      = r.priority
        target        = r.service
        path_patterns = r.paths
      } if lookup(r, "built", true)
    ]
    origin_verify_values = ["current-secret", "next-secret"]
  }

  assert {
    condition     = length(aws_lb_listener_rule.from_cloudfront) == 10 && length(aws_lb_target_group.service) == 9 && length(aws_lb_listener_rule.not_found) == 1
    error_message = "10 rules (13.1, connect not built) to 9 target groups, plus the fixed 404."
  }
  assert {
    condition = toset(flatten([
      for c in aws_lb_listener_rule.from_cloudfront["route-10"].condition : [for p in c.path_pattern : p.values]
    ])) == toset(["/api/v1/children/*/onboarding*"])
    error_message = "A mid-path pattern reaches the rule unchanged."
  }
  assert {
    condition = (
      aws_lb_listener_rule.from_cloudfront["route-10"].priority < aws_lb_listener_rule.from_cloudfront["route-100"].priority
      && one(aws_lb_listener_rule.from_cloudfront["route-10"].action).target_group_arn == aws_lb_target_group.service["onboarding"].arn
      && one(aws_lb_listener_rule.from_cloudfront["route-100"].action).target_group_arn == aws_lb_target_group.service["children"].arn
    )
    error_message = "The circle rules come before children's, which would also match their paths."
  }
  assert {
    condition = (
      one(aws_lb_listener_rule.from_cloudfront["route-130"].action).target_group_arn == aws_lb_target_group.service["platform"].arn
      && one(aws_lb_listener_rule.from_cloudfront["route-140"].action).target_group_arn == aws_lb_target_group.service["platform"].arn
    )
    error_message = "One target can have several rules (platform: 130 and 140)."
  }
  assert {
    condition = alltrue([
      for r in values(aws_lb_listener_rule.from_cloudfront) : anytrue([for c in r.condition : length(c.http_header) == 1])
    ])
    error_message = "Every rule requires X-Origin-Verify."
  }
}

run "routes_need_known_targets" {
  command = plan

  variables {
    targets = { auth = { port = 8000 } }
    routes  = [{ priority = 120, target = "nobody", path_patterns = ["/api/v1/auth/*"] }]
  }

  expect_failures = [var.routes]
}

run "routes_need_unique_priorities_in_range" {
  command = plan

  variables {
    targets = { auth = { port = 8000 } }
    routes = [
      { priority = 120, target = "auth", path_patterns = ["/a/*"] },
      { priority = 120, target = "auth", path_patterns = ["/b/*"] },
    ]
  }

  expect_failures = [var.routes]
}

run "routes_cant_use_the_404s_priority" {
  command = plan

  variables {
    targets = { auth = { port = 8000 } }
    routes  = [{ priority = 50000, target = "auth", path_patterns = ["/a/*"] }]
  }

  expect_failures = [var.routes]
}

run "routes_have_one_to_three_patterns" {
  command = plan

  variables {
    targets = { auth = { port = 8000 } }
    routes  = [{ priority = 120, target = "auth", path_patterns = ["/a", "/b", "/c", "/d"] }]
  }

  expect_failures = [var.routes]
}

run "with_routes_targets_carry_no_paths" {
  command = plan

  variables {
    targets = { auth = { port = 8000, path_patterns = ["/api/v1/auth/*"], priority = 120 } }
    routes  = [{ priority = 120, target = "auth", path_patterns = ["/api/v1/auth/*"] }]
  }

  expect_failures = [aws_lb_target_group.service]
}

run "with_routes_every_target_has_one" {
  command = plan

  variables {
    targets = {
      auth  = { port = 8000 }
      users = { port = 8000 }
    }
    routes = [{ priority = 120, target = "auth", path_patterns = ["/api/v1/auth/*"] }]
  }

  expect_failures = [aws_lb_target_group.service]
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
    condition     = aws_lb_target_group.service["backend"].name == "superpower-backend-prod-${substr(sha1(jsonencode([8000, "HTTP", "ip", "vpc-1"])), 0, 4)}"
    error_message = "The hash covers port, protocol, target type and VPC."
  }
}

run "target_group_name_on_another_port" {
  command = plan

  variables {
    targets = { backend = { port = 8080, health_check_path = "/api/health" } }
  }

  assert {
    condition     = aws_lb_target_group.service["backend"].name == "superpower-backend-prod-${substr(sha1(jsonencode([8080, "HTTP", "ip", "vpc-1"])), 0, 4)}" && aws_lb_target_group.service["backend"].name != "superpower-backend-prod-${substr(sha1(jsonencode([8000, "HTTP", "ip", "vpc-1"])), 0, 4)}"
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
