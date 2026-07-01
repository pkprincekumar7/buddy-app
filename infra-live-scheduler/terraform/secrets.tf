# ---------------------------------------------------------------------------
# Secrets Manager — GitHub Personal Access Token
#
# The token value comes from the GitHub Actions environment secret
# GIT_ACTIONS_PAT, passed as TF_VAR_github_pat by the workflow.
# GitHub environment secret is the source of truth — every terraform apply
# syncs the Secrets Manager value to whatever the workflow passed in.
#
# Required PAT permissions:
#   Classic token  : repo + workflow scopes
#   Fine-grained   : Actions — Read and Write
#
# WARNING: The secret value is a plain string (not JSON) — just the raw
# token. Do NOT wrap it in a JSON object.
# ---------------------------------------------------------------------------

resource "aws_secretsmanager_secret" "github_pat" {
  #checkov:skip=CKV_AWS_149:AWS-managed encryption is sufficient for this threat model; CMK rotation deferred
  #checkov:skip=CKV2_AWS_57:Automatic rotation not applicable — PAT is a GitHub credential rotated via GitHub

  name        = "${var.app_name}/${var.environment}/github-actions-pat"
  description = "GitHub PAT for EventBridge Scheduler (${var.environment}) to trigger GitHub Actions workflows"

  # Force-delete immediately on destroy so the name is free for re-apply.
  recovery_window_in_days = 0

  tags = {
    Name = "${var.app_name}-${var.environment}-github-actions-pat"
  }
}

resource "aws_secretsmanager_secret_version" "github_pat" {
  secret_id     = aws_secretsmanager_secret.github_pat.id
  secret_string = var.github_pat
  # No lifecycle ignore_changes — GitHub environment secret drives this value.
}
