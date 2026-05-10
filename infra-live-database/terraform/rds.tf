# ---------------------------------------------------------------------------
# RDS — PostgreSQL 16, single-AZ by default, encrypted at rest
#
# Password is managed by AWS Secrets Manager automatically
# (manage_master_user_password = true). Retrieve with:
#   aws secretsmanager get-secret-value \
#     --secret-id "<rds_secret_arn output>" \
#     --query SecretString --output text
#
# The RDS security group has no ingress rules here — they are added by
# infra-live-backend when the ECS task security group is known.
#
# deletion_protection defaults to true. To decommission intentionally:
#   1. Set db_deletion_protection = false and db_skip_final_snapshot = true in tfvars
#   2. Remove (or comment out) the prevent_destroy lifecycle block in this file
#   3. Run terraform apply  (removes the RDS deletion-protection flag)
#   4. Run terraform destroy
# ---------------------------------------------------------------------------

resource "aws_db_subnet_group" "main" {
  name       = "${var.app_name}-db-subnet-group-${var.environment}"
  subnet_ids = [aws_subnet.private_1.id, aws_subnet.private_2.id]

  tags = {
    Name = "${var.app_name}-db-subnet-group-${var.environment}"
  }
}

resource "aws_security_group" "rds_sg" {
  name        = "${var.app_name}-rds-sg-${var.environment}"
  description = "RDS PostgreSQL — ingress rules managed by infra-live-backend"
  vpc_id      = aws_vpc.main.id

  # Egress: AWS default allow-all-egress rule is left in place (not managed here).
  # To restrict egress (e.g., to a Secrets Manager VPC endpoint only), add an
  # explicit egress = [] block to remove the default, then add the targeted rule.

  tags = {
    Name = "${var.app_name}-rds-sg-${var.environment}"
  }
}

resource "aws_db_instance" "main" {
  identifier     = "${var.db_identifier}-${var.environment}"
  engine                     = "postgres"
  engine_version             = "16.3"
  auto_minor_version_upgrade = false # pin to 16.3; bump explicitly in code when ready
  instance_class             = var.db_instance_class

  allocated_storage  = var.db_allocated_storage
  storage_type       = "gp3"
  iops               = 3000  # gp3 baseline; explicit to avoid provider-default drift
  storage_throughput = 125   # gp3 baseline MB/s
  storage_encrypted  = true

  db_name  = var.db_name
  username = var.db_username

  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds_sg.id]

  publicly_accessible     = false
  multi_az                = var.db_multi_az
  backup_retention_period = 7

  deletion_protection       = var.db_deletion_protection
  skip_final_snapshot       = var.db_skip_final_snapshot
  final_snapshot_identifier = "${var.db_identifier}-${var.environment}-final"

  lifecycle {
    # Prevent Terraform from destroying this resource — data is permanent.
    # To decommission: set db_deletion_protection = false, apply, then destroy.
    prevent_destroy = true
  }

  tags = {
    Name = "${var.app_name}-db-${var.environment}"
  }
}
