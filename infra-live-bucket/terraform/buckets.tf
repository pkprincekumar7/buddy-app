# ---------------------------------------------------------------------------
# Frontend S3 bucket — pre-existing, us-east-1
#
# Imported into Terraform state so its ARN is available for SSM and downstream
# modules. prevent_destroy = true ensures terraform destroy never deletes it.
# ignore_changes = all means Terraform never modifies the bucket configuration
# — it is owned and managed externally.
#
# To fully tear down an environment, remove from state first:
#   terraform state rm aws_s3_bucket.frontend
# then run terraform destroy (which will only destroy the SSM parameters).
# ---------------------------------------------------------------------------

import {
  to = aws_s3_bucket.frontend
  id = var.frontend_bucket_name
}

resource "aws_s3_bucket" "frontend" {
  bucket = var.frontend_bucket_name

  lifecycle {
    prevent_destroy = true
    ignore_changes  = all
  }
}

# ---------------------------------------------------------------------------
# Backend S3 bucket — pre-existing, us-east-1
# ---------------------------------------------------------------------------

import {
  to = aws_s3_bucket.backend
  id = var.backend_bucket_name
}

resource "aws_s3_bucket" "backend" {
  bucket = var.backend_bucket_name

  lifecycle {
    prevent_destroy = true
    ignore_changes  = all
  }
}
