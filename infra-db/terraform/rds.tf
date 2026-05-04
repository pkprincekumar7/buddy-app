resource "aws_db_subnet_group" "buddy360_db" {
  name       = "${var.app_name}-db-subnet-group"
  subnet_ids = [aws_subnet.private_1.id, aws_subnet.private_2.id]

  tags = {
    Name = "${var.app_name}-db-subnet-group"
  }
}

resource "aws_security_group" "rds_sg" {
  name        = "${var.app_name}-rds-sg"
  description = "Allow PostgreSQL from EC2 only — ingress rule managed by infra/terraform"
  vpc_id      = aws_vpc.buddy360_vpc.id

  tags = {
    Name = "${var.app_name}-rds-sg"
  }
}

resource "aws_db_instance" "buddy360_db" {
  identifier     = var.db_identifier
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.db_instance_class

  allocated_storage = var.db_allocated_storage
  storage_type      = "gp3"
  storage_encrypted = true

  db_name  = var.db_name
  username = var.db_username

  # AWS generates the password and stores it in Secrets Manager automatically.
  # Retrieve with: aws secretsmanager get-secret-value --secret-id <rds_secret_arn output>
  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.buddy360_db.name
  vpc_security_group_ids = [aws_security_group.rds_sg.id]

  publicly_accessible     = false
  multi_az                = false
  backup_retention_period = 7

  deletion_protection = var.db_deletion_protection
  skip_final_snapshot = !var.db_deletion_protection

  tags = {
    Name = "${var.app_name}-db"
  }
}
