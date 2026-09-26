terraform {
  required_version = "~> 1.16.0"

  backend "s3" {
    region       = "us-east-1"
    use_lockfile = true
    # bucket and key are supplied at terraform init via -backend-config
    # key pattern: terraform-state-files/{app_name}/{env}/edge/us-east-1/terraform.tfstate
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.28"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
    time = {
      source  = "hashicorp/time"
      version = "~> 0.12"
    }
  }
}

provider "aws" {
  region = "us-east-1"

  default_tags {
    tags = {
      Project     = var.app_name
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# WAF WebACL for CloudFront must be provisioned in us-east-1 (scope = CLOUDFRONT).
# OAC and S3 bucket data source also use this alias.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      Project     = var.app_name
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# Backend region providers — used to manage each region's uploads S3 bucket
# policy (see data.tf, s3_uploads_policy.tf). One static alias per supported
# region — provider aliases can't be generated with for_each/count, so this is
# a fixed set of 3, matching backend_regions' validated allow-list. A region
# not present in var.backend_regions simply has no resources created against
# its alias (see the count guards in data.tf/s3_uploads_policy.tf) — the
# provider block itself is a no-op until then.
provider "aws" {
  alias  = "ap_south_1"
  region = "ap-south-1"

  default_tags {
    tags = {
      Project     = var.app_name
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

provider "aws" {
  alias  = "eu_west_1"
  region = "eu-west-1"

  default_tags {
    tags = {
      Project     = var.app_name
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# A us-east-1 backend region reuses the existing aws.us_east_1 alias above
# (same account, same region — no third alias needed).
