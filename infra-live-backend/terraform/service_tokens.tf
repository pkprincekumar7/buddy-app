# ---------------------------------------------------------------------------
# Service tokens — one Ed25519 key pair per service (docs/auth-users-split.md, 13.2)
#
# Every internal call carries a token signed with the caller's own private key.
# Terraform generates the pairs here:
#   - each private key goes into an SSM SecureString in this region, which only
#     that service's runtimes can read (their execution roles, iam.tf), injected
#     as INTERNAL_SIGNING_KEY;
#   - the public keys form INTERNAL_PUBLIC_KEYS ({service: {kid: PEM}}), given to
#     every runtime and published as a non-secret SSM parameter.
# The private keys are also in Terraform state, which is treated as sensitive.
#
# Rotation (same pattern as JWT_PUBLIC_KEYS): bump the service's entry in
# var.service_token_key_versions (new kid + new key), apply, deploy the service;
# the old public key isn't kept, so callers' cached keys roll over on redeploy.
# ---------------------------------------------------------------------------

resource "tls_private_key" "service" {
  for_each = toset(local.split_services)

  algorithm = "ED25519"
}

locals {
  signing_kid = { for s in local.split_services : s => "${s}-v${lookup(var.service_token_key_versions, s, 1)}" }

  internal_public_keys = {
    for s in local.split_services : s => { (local.signing_kid[s]) = tls_private_key.service[s].public_key_pem }
  }
}

resource "aws_ssm_parameter" "signing_key" {
  #checkov:skip=CKV_AWS_337:AWS-managed key (aws/ssm), as for the service secrets (secrets.tf CKV_AWS_149): access is limited by each execution role's ssm:GetParameters on its own parameter; a CMK adds a key policy per service without changing who can read it
  for_each = toset(local.split_services)

  name        = "/${var.app_name}/${var.environment}/backend/${var.aws_region}/${each.key}/internal_signing_key"
  description = "${each.key}'s service-token private key (Ed25519, kid ${local.signing_kid[each.key]})"
  type        = "SecureString"
  value       = tls_private_key.service[each.key].private_key_pem

  tags = {
    Name    = "${var.app_name}-${each.key}-signing-key-${var.environment}-${var.aws_region}"
    Service = each.key
  }
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
