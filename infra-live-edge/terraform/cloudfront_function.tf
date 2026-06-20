# ---------------------------------------------------------------------------
# CloudFront Function — RS256 JWT validation
#
# Validates the access_token cookie on every /api/* viewer request before
# the request is forwarded to the ALB. Invalid or missing tokens are
# rejected with 401 at the nearest CloudFront edge location — the request
# never consumes ALB or ECS capacity.
#
# Public keys are injected at deploy time via templatefile() — no template
# edits are needed during key rotation. The private key never leaves
# Secrets Manager. See docs/jwt-keys.md for the full rotation procedure.
# ---------------------------------------------------------------------------

resource "aws_cloudfront_function" "jwt_validator" {
  name    = "${var.app_name}-${var.environment}-jwt-validator"
  runtime = "cloudfront-js-2.0"
  publish = true

  code = templatefile(
    "${path.module}/../functions/jwt-validator.js.tpl",
    {
      jwt_public_keys = var.jwt_public_keys
      jwt_key_id      = var.jwt_key_id
    }
  )
}
