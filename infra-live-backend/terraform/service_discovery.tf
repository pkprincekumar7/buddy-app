# ---------------------------------------------------------------------------
# Service discovery — Cloud Map and the internal-callers group (docs/auth-users-split.md, 13.2)
#
# Internal calls go straight to the callee's tasks, found through Cloud Map DNS:
# "<service>.<app>-<env>.internal" answers up to 8 healthy task IPs. The
# namespace is a private hosted zone on this VPC; each runtime with an internal
# port registers in it (modules/ecs-service, service_discovery).
#
# Network: every service runtime joins the shared internal-callers group. A
# registered runtime admits its internal port only from that group, so only the
# app's own tasks can reach /internal/* (port 8001) or the collector (4318). The
# public ALB still reaches port 8000 only.
# ---------------------------------------------------------------------------

resource "aws_service_discovery_private_dns_namespace" "internal" {
  name        = local.internal_dns_namespace
  description = "Internal service discovery for ${var.app_name} (${var.environment}, ${var.aws_region})"
  vpc         = module.network.vpc_id

  tags = {
    Name = "${local.internal_dns_namespace}-${var.aws_region}"
  }
}

#trivy:ignore:AVD-AWS-0104
resource "aws_security_group" "internal_callers" {
  #checkov:skip=CKV_AWS_382:A membership group, not a policy: it grants nothing itself, and its egress mirrors the task groups'
  #checkov:skip=CKV2_AWS_5:Attached to every service runtime via module.service[*]'s security_group_ids; checkov's graph check doesn't follow module inputs — tests/stack.tftest.hcl asserts the attachment
  name        = "${var.app_name}-internal-callers-${var.environment}"
  description = "Tasks that make internal calls; registered runtimes admit their internal port from this group only"
  vpc_id      = module.network.vpc_id

  egress {
    description = "All outbound traffic (the task groups egress applies too)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.app_name}-internal-callers-${var.environment}"
  }
}

resource "aws_vpc_security_group_ingress_rule" "internal_from_callers" {
  for_each = { for k, s in local.services : k => s if s.internal_port != null }

  description                  = "${each.value.display_name} internal port from internal callers"
  security_group_id            = aws_security_group.service[each.key].id
  ip_protocol                  = "tcp"
  from_port                    = each.value.internal_port
  to_port                      = each.value.internal_port
  referenced_security_group_id = aws_security_group.internal_callers.id
}
