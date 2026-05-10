# aws_region and environment are supplied via workflow inputs (TF_VAR_*)

app_name = "buddy360"

# Networking — separate CIDR from dev (10.1.x.x) and stg (10.11.x.x)
vpc_cidr              = "10.21.0.0/16"
public_subnet_1_cidr  = "10.21.1.0/24"
public_subnet_2_cidr  = "10.21.2.0/24"
private_subnet_1_cidr = "10.21.3.0/24"
private_subnet_2_cidr = "10.21.4.0/24"

# RDS
db_identifier        = "buddy360"
db_name              = "buddy360"
db_username          = "postgres"
db_instance_class    = "db.t3.medium"
db_allocated_storage = 100
db_multi_az          = true

# Prod: maximum protection
db_deletion_protection = true
db_skip_final_snapshot = false
