# aws_region and environment are supplied via workflow inputs (TF_VAR_*)

app_name = "buddy360"

# Networking — dev uses 10.1.x.x; stg uses 10.11.x.x; prod uses 10.21.x.x
vpc_cidr              = "10.1.0.0/16"
public_subnet_1_cidr  = "10.1.1.0/24"
public_subnet_2_cidr  = "10.1.2.0/24"
private_subnet_1_cidr = "10.1.3.0/24"
private_subnet_2_cidr = "10.1.4.0/24"

# RDS
db_identifier        = "buddy360"
db_name              = "buddy360"
db_username          = "postgres"
db_instance_class    = "db.t3.micro"
db_allocated_storage = 20
db_multi_az          = false

# Dev: allow easy teardown without a snapshot
db_deletion_protection = false
db_skip_final_snapshot = true
