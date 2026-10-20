# ---------------------------------------------------------------------------
# Network — backend VPC, subnets, NAT, routing and VPC endpoints
# (../../modules/network, TF-01). This region's /16 comes from var.vpc_cidrs
# (NET-01); the subnet layout is derived inside the module:
#
#   public  /24 ×3   10.x.1.0/24  10.x.2.0/24  10.x.3.0/24   ALB, NAT GWs
#   private /20 ×3   10.x.16.0/20 10.x.32.0/20 10.x.48.0/20  ECS, Redis, endpoints
#
# nat_gateway_count also decides the interface endpoints: none in dev/sbx (1),
# two AZs in stg (2), three in prod (3). See the module for the details.
# ---------------------------------------------------------------------------

module "network" {
  source = "../../modules/network"

  app_name          = var.app_name
  environment       = var.environment
  aws_region        = var.aws_region
  vpc_cidr          = var.vpc_cidrs[var.aws_region]
  nat_gateway_count = var.nat_gateway_count

  # Every service's tasks reach ECR, Secrets Manager, CloudWatch Logs and
  # X-Ray through the interface endpoints (stg/prod).
  endpoint_client_security_groups = {
    for k, s in local.services : k => { id = aws_security_group.service[k].id, description = "HTTPS from ${s.display_name} task SG" }
  }
}
