# ---------------------------------------------------------------------------
# Service tokens — one Ed25519 key pair per service (docs/auth-users-split.md, 13.2)
#
# Every internal call carries a token signed with the caller's own private key.
# scripts/service-token-keys.sh makes the pairs, outside Terraform, so no private key is
# in Terraform state or a plan (production-readiness review, SEC-01). terraform-live-backend
# runs it before every plan, and deletes the pairs after a destroy. Each pair is two SSM
# parameters in this region:
#   /<app>/<env>/backend/<region>/<service>/service_token/<kid>/private  SecureString
#   /<app>/<env>/backend/<region>/<service>/service_token/<kid>/public   String
# Here:
#   - each runtime's INTERNAL_SIGNING_KEY points at its service's private parameter,
#     which only that service's execution role may read (iam.tf); Terraform never reads it;
#   - the public keys form INTERNAL_PUBLIC_KEYS ({service: {kid: PEM}}), given to every
#     runtime and published as a non-secret SSM parameter.
#
# Rotation: bump the service's version in service-token-versions.json (new kid, new pair;
# the script deletes the old one), run terraform-live-backend apply, then deploy every
# runtime. The old public key isn't kept, so callers' cached keys roll over on redeploy.
# ---------------------------------------------------------------------------

data "aws_caller_identity" "current" {}

locals {
  # {service: version}, read by the key script too; a service not listed is version 1.
  service_token_key_versions = jsondecode(file("${path.module}/service-token-versions.json"))

  signing_kid = { for s in local.split_services : s => "${s}-v${lookup(local.service_token_key_versions, s, 1)}" }

  service_token_prefix = { for s in local.split_services : s => "/${var.app_name}/${var.environment}/backend/${var.aws_region}/${s}/service_token/${local.signing_kid[s]}" }

  # Built from the name: the private key is never read into state.
  signing_key_arn = {
    for s in local.split_services : s => "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${local.service_token_prefix[s]}/private"
  }

  internal_public_keys = {
    for s in local.split_services : s => { (local.signing_kid[s]) = data.aws_ssm_parameter.service_token_public[s].value }
  }
}

# Public keys only (a String parameter); a missing one fails the plan with its name: run
# scripts/service-token-keys.sh ensure first (the workflow always does).
data "aws_ssm_parameter" "service_token_public" {
  for_each = toset(local.split_services)

  name = "${local.service_token_prefix[each.key]}/public"
}

# The public-key map, for anything outside the tasks that verifies service tokens.
resource "aws_ssm_parameter" "internal_public_keys" {
  #checkov:skip=CKV2_AWS_34:Public keys only — not a secret; SecureString adds cost and IAM complexity without security benefit
  provider = aws.ssm

  name  = "/${var.app_name}/${var.environment}/backend/${var.aws_region}/internal_public_keys"
  value = jsonencode(local.internal_public_keys)
  type  = "String"

  tags = { Name = "${var.app_name}-backend-internal-public-keys-${var.environment}-${var.aws_region}" }
}
