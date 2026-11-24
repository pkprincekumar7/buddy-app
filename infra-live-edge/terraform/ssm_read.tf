# ---------------------------------------------------------------------------
# SSM reads (us-east-1 control plane — the default, unaliased provider; SSM
# parameters are always written/read in us-east-1 regardless of backend
# region, see infra-live-backend/terraform/provider.tf's aws.ssm alias
# comment, so no per-region provider alias is needed here).
# Apply infra-live-backend for a region before adding it to var.backend_regions.
# One read per region — the resulting map is what the jwt_validator
# Lambda@Edge uses to route /api/* by the token's location claim (see
# lambda_edge.tf and ../functions/jwt-validator-lambda.js.tpl). There is no
# single "the" backend region anymore; every region in var.backend_regions is
# an equally valid routing target.
# ---------------------------------------------------------------------------

# terraform-live-backend destroy reads this data source from the edge state to refuse
# a region the edge still routes to (check_destroy_order in scripts/workflow-inputs.sh):
# renaming it means updating edge_routes_to there.
data "aws_ssm_parameter" "alb_internal_fqdn" {
  for_each = toset(var.backend_regions)

  name = "/${var.app_name}/${var.environment}/backend/${each.key}/alb_internal_fqdn"
}

locals {
  regional_alb_fqdns = { for region, param in data.aws_ssm_parameter.alb_internal_fqdn : region => param.value }
}
