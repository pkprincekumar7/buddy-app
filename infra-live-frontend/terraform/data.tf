# ---------------------------------------------------------------------------
# Remote state — infra-live-backend module
# Reads the ALB DNS name so CloudFront can proxy /api/* to the backend.
# Apply infra-live-backend/terraform first; this module depends on its outputs.
# ---------------------------------------------------------------------------
data "terraform_remote_state" "app" {
  backend = "s3"
  config = {
    bucket = var.state_bucket
    key    = var.app_state_key
    region = "us-east-1"
  }
}
