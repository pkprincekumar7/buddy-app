# ---------------------------------------------------------------------------
# Secrets Manager — application secrets
#
# One JSON secret holds all sensitive env vars for the backend container.
# Terraform creates the secret with REPLACE_ME placeholder values.
#
# The terraform-live-backend workflow auto-populates real values from GitHub
# secrets on the FIRST apply only (when REPLACE_ME placeholders are detected).
# Subsequent applies skip the update to preserve manually rotated values.
#
# To rotate or update a secret after initial setup:
#
#   aws secretsmanager put-secret-value \
#     --secret-id "<secret_arn output>" \
#     --region {backend-region} \
#     --secret-string '{
#       "JWT_PRIVATE_KEY":    "-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----",
#       "GOOGLE_CLIENT_ID":   "<oauth-client-id>.apps.googleusercontent.com",
#       "OPENAI_API_KEY":     "sk-...",
#       "ANTHROPIC_API_KEY":  "sk-ant-...",
#       "GEMINI_API_KEY":     "AIza...",
#       "MONGODB_URI":        "mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/",
#       "REDIS_AUTH_TOKEN":   "<token>"
#     }'
# WARNING: put-secret-value replaces the entire JSON. Always include ALL keys
# in the payload or omitted keys will be silently dropped from the secret.
# Note: CORS_ORIGINS and COOKIE_DOMAIN are plain env vars in the task definition,
# not secrets. Set them via the CORS_ORIGINS / COOKIE_DOMAIN GitHub environment secrets.
# ---------------------------------------------------------------------------

resource "aws_secretsmanager_secret" "app" {
  #checkov:skip=CKV_AWS_149:AWS-managed encryption is sufficient for this threat model; CMK rotation and key policy overhead deferred
  #checkov:skip=CKV2_AWS_57:Automatic rotation requires a dedicated Lambda rotator function; deferred — secrets are rotated manually via CLI when needed

  name        = "${var.app_name}/${var.environment}/backend-secrets"
  description = "Application secrets for ${var.app_name} backend ECS tasks (${var.environment})"

  # Force-delete immediately on destroy so the name is free for re-apply.
  # Default (30-day recovery window) causes re-apply to fail with
  # "secret with this name is already scheduled for deletion".
  # Intentional for ALL environments including prod — operators must back up
  # credentials externally before running destroy. The GitHub environment
  # secrets used to populate the secret on apply serve as that backup.
  recovery_window_in_days = 0

  tags = {
    Name = "${var.app_name}-backend-secrets-${var.environment}"
  }
}

resource "aws_secretsmanager_secret_version" "app_placeholder" {
  secret_id = aws_secretsmanager_secret.app.id

  secret_string = jsonencode({
    JWT_PRIVATE_KEY   = "REPLACE_ME"
    GOOGLE_CLIENT_ID  = "REPLACE_ME"
    OPENAI_API_KEY    = "REPLACE_ME"
    ANTHROPIC_API_KEY = "REPLACE_ME"
    GEMINI_API_KEY    = "REPLACE_ME"
    MONGODB_URI       = "REPLACE_ME"
    REDIS_AUTH_TOKEN  = "REPLACE_ME"
  })

  # Prevent Terraform from overwriting values updated via CLI or Console.
  lifecycle {
    ignore_changes = [secret_string]
  }
}
