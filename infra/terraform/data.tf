# Read VPC and subnet IDs provisioned by infra-db/terraform.
# Run `terraform apply` in infra-db/terraform before applying this module.
data "terraform_remote_state" "db" {
  backend = "s3"
  config = {
    bucket = "person-deployment-bucket"
    key    = var.db_state_key
    region = "us-east-1"
  }
}

data "aws_ssm_parameter" "ubuntu_ami" {
  name = "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id"
}
