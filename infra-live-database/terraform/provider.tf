terraform {
  required_version = "~> 1.13.0"

  backend "s3" {
    region       = "us-east-1"
    use_lockfile = true
    # bucket and key are supplied at terraform init via -backend-config
    # bucket: the S3 bucket holding all Terraform state (passed as TF state bucket secret)
    # key pattern: terraform-state-files/{app_name}/{env}/database/{region}/terraform.tfstate
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.28"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = var.app_name
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
