# ---------------------------------------------------------------------------
# MongoDB Atlas PrivateLink (production-readiness review, DEC-02)
#
# stg and prod each have one Atlas M10 cluster in ap-south-1 and are served from that
# region only (shared/routing.json served_from, DEC-01). Their tasks reach it through an
# AWS PrivateLink interface endpoint in this VPC, never the internet, so no Atlas IP
# access list is needed. Terraform makes both halves, so a full destroy and re-apply needs
# no console step:
#   1. mongodbatlas_privatelink_endpoint: Atlas's endpoint service in this region;
#   2. aws_vpc_endpoint: the interface endpoint to it, in the private subnets;
#   3. mongodbatlas_privatelink_endpoint_service: Atlas accepts that endpoint.
# The services then use the cluster's private-endpoint connection string (MONGODB_URIS,
# "mongodb+srv://<cluster>-pl-0.<id>.mongodb.net/..."). dev and sbx (Atlas M0, which has
# no PrivateLink) keep the public string and leave var.atlas_project_id empty.
#
# Credentials: MONGODB_ATLAS_PUBLIC_KEY / MONGODB_ATLAS_PRIVATE_KEY in the environment
# (terraform-live-backend passes them on the plan and apply steps only), a project-scoped
# Atlas API key.
# ---------------------------------------------------------------------------

locals {
  atlas_private_endpoint = var.atlas_project_id != ""
}

# The provider refuses to start without credentials even when nothing uses it, so where there's
# no private endpoint (dev, sbx) it gets a placeholder it never sends: no Atlas resource, no
# API call. Where there is one (stg, prod), null reads the real keys from the environment.
provider "mongodbatlas" {
  public_key  = local.atlas_private_endpoint ? null : "unused-no-atlas-resources"
  private_key = local.atlas_private_endpoint ? null : "unused-no-atlas-resources"
}

resource "mongodbatlas_privatelink_endpoint" "atlas" {
  count = local.atlas_private_endpoint ? 1 : 0

  project_id    = var.atlas_project_id
  provider_name = "AWS"
  region        = var.aws_region
}

# Atlas's endpoint service accepts connections on 1024–65535 (one port per cluster node).
resource "aws_security_group" "atlas_endpoint" {
  #checkov:skip=CKV2_AWS_5:Attached to aws_vpc_endpoint.atlas below (security_group_ids); checkov's graph check doesn't follow the counted reference
  count = local.atlas_private_endpoint ? 1 : 0

  name        = "${var.app_name}-atlas-endpoint-${var.environment}"
  description = "Atlas PrivateLink endpoint: Atlas ports from the service tasks only"
  vpc_id      = module.network.vpc_id

  tags = {
    Name = "${var.app_name}-atlas-endpoint-${var.environment}"
  }
}

resource "aws_vpc_security_group_ingress_rule" "atlas_endpoint_from_tasks" {
  #checkov:skip=CKV_AWS_25:The source is the internal-callers security group, not 0.0.0.0/0; 3389 only falls inside Atlas's PrivateLink port range (1024-65535), and nothing listens on it
  count = local.atlas_private_endpoint ? 1 : 0

  description                  = "MongoDB from every service task (the internal-callers group)"
  security_group_id            = aws_security_group.atlas_endpoint[0].id
  ip_protocol                  = "tcp"
  from_port                    = 1024
  to_port                      = 65535
  referenced_security_group_id = aws_security_group.internal_callers.id
}

resource "aws_vpc_endpoint" "atlas" {
  count = local.atlas_private_endpoint ? 1 : 0

  vpc_id             = module.network.vpc_id
  service_name       = mongodbatlas_privatelink_endpoint.atlas[0].endpoint_service_name
  vpc_endpoint_type  = "Interface"
  subnet_ids         = module.network.private_subnet_ids
  security_group_ids = [aws_security_group.atlas_endpoint[0].id]

  tags = {
    Name = "${var.app_name}-atlas-endpoint-${var.environment}"
  }
}

resource "mongodbatlas_privatelink_endpoint_service" "atlas" {
  count = local.atlas_private_endpoint ? 1 : 0

  project_id          = var.atlas_project_id
  private_link_id     = mongodbatlas_privatelink_endpoint.atlas[0].private_link_id
  endpoint_service_id = aws_vpc_endpoint.atlas[0].id
  provider_name       = "AWS"
}
