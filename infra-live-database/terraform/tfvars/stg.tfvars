# aws_region and environment are supplied via workflow inputs (TF_VAR_*)

app_name = "buddy360"

# Networking — separate CIDR from dev (10.1.x.x) to coexist in the same account
vpc_cidr              = "10.11.0.0/16"
public_subnet_1_cidr  = "10.11.1.0/24"
public_subnet_2_cidr  = "10.11.2.0/24"
private_subnet_1_cidr = "10.11.3.0/24"
private_subnet_2_cidr = "10.11.4.0/24"

# RDS
db_identifier        = "buddy360"
db_name              = "buddy360"
db_username          = "postgres"
db_instance_class    = "db.t3.small"
db_allocated_storage = 50
db_multi_az          = true

# Stg: full protection — mirrors production safety settings
db_deletion_protection = true
db_skip_final_snapshot = false
