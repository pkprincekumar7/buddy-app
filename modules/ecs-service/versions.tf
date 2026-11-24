terraform {
  # Any 1.x from 1.16: CI runs exactly TF_VERSION (the workflows), and Terraform 1.x reads
  # any 1.x state. A ~> 1.16.0 pin also stopped Dependabot, whose updater runs the latest
  # Terraform (1.17.2, 2026-11), from initialising the stack to update the providers.
  required_version = ">= 1.16.0, < 2.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.28"
    }
  }
}
