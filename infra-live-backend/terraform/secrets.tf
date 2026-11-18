# ---------------------------------------------------------------------------
# Secrets Manager — one secret per service (docs/auth-users-split.md, 15.1)
#
# "<app>/<env>/<service>-secrets", a JSON object with the keys in
# local.secret_keys (services.tf): every service's own MONGODB_URI (its Atlas
# database user), auth's JWT private key, Google client id and email HMAC pepper,
# and the LLM keys of the generating services and shared. A service and its
# worker share it; each runtime injects only the keys it needs.
#
# Terraform creates each secret with REPLACE_ME placeholders and never touches
# the value again (ignore_changes): the terraform-live-backend workflow fills in
# real values on the first apply, and later changes are made with
#   aws secretsmanager put-secret-value --secret-id <arn> --secret-string '{...}'
# (it replaces the whole JSON: include every key).
#
# The service-token signing keys are not here: Terraform generates them
# (service_tokens.tf).
# ---------------------------------------------------------------------------

resource "aws_secretsmanager_secret" "service" {
  #checkov:skip=CKV_AWS_149:AWS-managed encryption is sufficient for this threat model; CMK rotation and key policy overhead deferred
  #checkov:skip=CKV2_AWS_57:Automatic rotation requires a dedicated Lambda rotator function; deferred — secrets are rotated manually via CLI when needed
  for_each = local.secret_keys

  name        = "${var.app_name}/${var.environment}/${each.key}-secrets"
  description = "Secrets for ${var.app_name}'s ${each.key} service (${var.environment})"

  # Force-delete on destroy so the name is free for the next apply (the
  # environments are destroyed and rebuilt; the GitHub environment secrets that
  # fill these are the backup).
  recovery_window_in_days = 0

  tags = {
    Name    = "${var.app_name}-${each.key}-secrets-${var.environment}"
    Service = each.key
  }
}

resource "aws_secretsmanager_secret_version" "placeholder" {
  for_each = local.secret_keys

  secret_id     = aws_secretsmanager_secret.service[each.key].id
  secret_string = jsonencode({ for key in each.value : key => "REPLACE_ME" })

  # Values set via the workflow, CLI or console are never overwritten.
  lifecycle {
    ignore_changes = [secret_string]
  }
}
