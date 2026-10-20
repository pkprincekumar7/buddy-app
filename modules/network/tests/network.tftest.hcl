# terraform test — runs against a mock AWS provider: no credentials, nothing
# is created. Run from modules/network: terraform init && terraform test

mock_provider "aws" {
  override_data {
    target = data.aws_availability_zones.available
    values = {
      names = ["ap-south-1a", "ap-south-1b", "ap-south-1c", "ap-south-1d"]
    }
  }
}

variables {
  app_name          = "superpower"
  environment       = "prod"
  aws_region        = "ap-south-1"
  vpc_cidr          = "10.22.0.0/16"
  nat_gateway_count = 3
  endpoint_client_security_groups = {
    api_task    = { id = "sg-api", description = "HTTPS from API task SG" }
    worker_task = { id = "sg-worker", description = "HTTPS from worker task SG" }
  }
}

run "prod_address_plan_and_names" {
  command = apply

  assert {
    condition     = aws_vpc.main.cidr_block == "10.22.0.0/16"
    error_message = "VPC CIDR must be the region's /16."
  }
  assert {
    condition     = [for k in ["1", "2", "3"] : aws_subnet.public[k].cidr_block] == ["10.22.1.0/24", "10.22.2.0/24", "10.22.3.0/24"]
    error_message = "Public subnets must be 10.x.1–3.0/24."
  }
  assert {
    condition     = [for k in ["1", "2", "3"] : aws_subnet.private[k].cidr_block] == ["10.22.16.0/20", "10.22.32.0/20", "10.22.48.0/20"]
    error_message = "Private subnets must be 10.x.16/32/48.0/20."
  }
  assert {
    condition     = [for k in ["1", "2", "3"] : aws_subnet.private[k].availability_zone] == ["ap-south-1a", "ap-south-1b", "ap-south-1c"]
    error_message = "One subnet per AZ, in the first three AZs."
  }
  assert {
    condition     = alltrue([for s in aws_subnet.public : s.map_public_ip_on_launch]) && !anytrue([for s in aws_subnet.private : s.map_public_ip_on_launch])
    error_message = "Only public subnets auto-assign public IPs."
  }
  assert {
    condition     = aws_subnet.private["2"].tags.Name == "superpower-backend-private-2-prod" && aws_route_table.private["3"].tags.Name == "superpower-backend-private-rt-3-prod"
    error_message = "Resource names must match the pre-module names."
  }
  assert {
    condition     = length(aws_nat_gateway.nat) == 3 && [for k in ["1", "2", "3"] : aws_route.private_nat[k].nat_gateway_id] == aws_nat_gateway.nat[*].id
    error_message = "With 3 NATs, each AZ routes through its own."
  }
  assert {
    condition     = aws_nat_gateway.nat[2].subnet_id == aws_subnet.public["3"].id
    error_message = "NAT n lives in public subnet n."
  }
  assert {
    condition     = length(aws_vpc_endpoint.interface) == 5 && length(aws_vpc_endpoint.interface["ecr_api"].subnet_ids) == 3
    error_message = "Prod gets all five interface endpoints in three AZs."
  }
  assert {
    condition     = aws_vpc_endpoint.interface["cloudwatch_logs"].service_name == "com.amazonaws.ap-south-1.logs" && aws_vpc_endpoint.interface["cloudwatch_logs"].tags.Name == "superpower-cloudwatch-logs-endpoint-prod"
    error_message = "Endpoint service names and Name tags must match the pre-module ones."
  }
  assert {
    condition     = length(aws_vpc_security_group_ingress_rule.endpoints_from_client) == 2 && aws_vpc_security_group_ingress_rule.endpoints_from_client["worker_task"].referenced_security_group_id == "sg-worker"
    error_message = "Each client SG gets a 443 ingress rule on the endpoint SG."
  }
  assert {
    condition     = length(aws_vpc_endpoint.s3.route_table_ids) == 3
    error_message = "The S3 gateway endpoint is attached to all three private route tables."
  }
  assert {
    condition     = output.private_subnet_ids == [for k in ["1", "2", "3"] : aws_subnet.private[k].id]
    error_message = "private_subnet_ids is ordered AZ 1 to 3."
  }
}

run "stg_two_nats_share_az2" {
  command = apply

  variables {
    environment       = "stg"
    vpc_cidr          = "10.13.0.0/16"
    nat_gateway_count = 2
  }

  assert {
    condition     = length(aws_nat_gateway.nat) == 2 && aws_route.private_nat["3"].nat_gateway_id == aws_nat_gateway.nat[1].id && aws_route.private_nat["1"].nat_gateway_id == aws_nat_gateway.nat[0].id
    error_message = "With 2 NATs, AZ 3 shares AZ 2's NAT."
  }
  assert {
    condition     = length(aws_vpc_endpoint.interface) == 5 && length(aws_vpc_endpoint.interface["xray"].subnet_ids) == 2
    error_message = "Stg gets interface endpoints in two AZs."
  }
  assert {
    condition     = aws_subnet.public["1"].cidr_block == "10.13.1.0/24"
    error_message = "Subnets follow the region's /16."
  }
}

run "dev_single_nat_no_interface_endpoints" {
  command = apply

  variables {
    environment       = "dev"
    vpc_cidr          = "10.2.0.0/16"
    nat_gateway_count = 1
  }

  assert {
    condition     = length(aws_nat_gateway.nat) == 1 && alltrue([for r in aws_route.private_nat : r.nat_gateway_id == aws_nat_gateway.nat[0].id])
    error_message = "With 1 NAT, all private subnets share it."
  }
  assert {
    condition     = length(aws_vpc_endpoint.interface) == 0 && length(aws_security_group.vpc_endpoints_sg) == 0 && length(aws_vpc_security_group_ingress_rule.endpoints_from_client) == 0
    error_message = "Dev/sbx get no interface endpoints, endpoint SG or rules."
  }
  assert {
    condition     = aws_vpc_endpoint.s3.vpc_endpoint_type == "Gateway"
    error_message = "The free S3 gateway endpoint exists in every environment."
  }
}

run "rejects_a_non_slash_16" {
  command = plan

  variables {
    vpc_cidr = "10.22.0.0/20"
  }

  expect_failures = [var.vpc_cidr]
}
