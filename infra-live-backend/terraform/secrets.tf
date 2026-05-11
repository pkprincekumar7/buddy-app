# ---------------------------------------------------------------------------
# Secrets Manager — application secrets
#
# One JSON secret holds all sensitive env vars for the backend container.
# Terraform creates the secret shell with placeholder values.
#
# BEFORE the first ECS deployment, update the secret with actual values:
#
#   aws secretsmanager put-secret-value \
#     --secret-id "<secret_arn output>" \
#     --secret-string '{
#       "JWT_SECRET":         "<64-char hex>",
#       "GOOGLE_CLIENT_ID":   "<oauth-client-id>.apps.googleusercontent.com",
#       "OPENAI_API_KEY":     "sk-...",
#       "ANTHROPIC_API_KEY":  "sk-ant-...",
#       "GEMINI_API_KEY":     "AIza...",
#       "CORS_ORIGINS":       "https://yourapp.example.com",
#       "COOKIE_DOMAIN":      "",
#       "MONGODB_URI":        "mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/"
#     }'
# ---------------------------------------------------------------------------

resource "aws_secretsmanager_secret" "app" {
  name        = "${var.app_name}/${var.environment}/backend-secrets"
  description = "Application secrets for ${var.app_name} backend ECS tasks (${var.environment})"

  # Force-delete immediately on destroy so the name is free for re-apply.
  # Default (30-day recovery window) causes re-apply to fail with
  # "secret with this name is already scheduled for deletion".
  recovery_window_in_days = 0

  tags = {
    Name = "${var.app_name}-backend-secrets-${var.environment}"
  }
}

resource "aws_secretsmanager_secret_version" "app_placeholder" {
  secret_id = aws_secretsmanager_secret.app.id

  secret_string = jsonencode({
    JWT_SECRET        = "REPLACE_ME"
    GOOGLE_CLIENT_ID  = "REPLACE_ME"
    OPENAI_API_KEY    = "REPLACE_ME"
    ANTHROPIC_API_KEY = "REPLACE_ME"
    GEMINI_API_KEY    = "REPLACE_ME"
    CORS_ORIGINS      = "REPLACE_ME"
    COOKIE_DOMAIN     = ""
    MONGODB_URI       = "REPLACE_ME"
  })

  # Prevent Terraform from overwriting values updated via CLI or Console.
  lifecycle {
    ignore_changes = [secret_string]
  }
}
