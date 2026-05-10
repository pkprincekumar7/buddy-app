# ---------------------------------------------------------------------------
# S3 — backend application bucket (pre-existing, not managed by Terraform)
#
# This bucket is created and owned outside of Terraform to avoid accidental
# data loss on terraform destroy. The bucket name is supplied via var.backend_bucket_name.
#
# The bucket is used by ECS tasks for:
#   - User file uploads / exports
#   - Pre-signed URL generation for browser-side direct uploads/downloads
#
# Bucket name convention: person-backend-{env}-app-bucket
# ---------------------------------------------------------------------------
