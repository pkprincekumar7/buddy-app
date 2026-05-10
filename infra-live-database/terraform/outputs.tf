# -- VPC / Networking ---------------------------------------------------------

output "vpc_id" {
  description = "Database VPC ID"
  value       = aws_vpc.main.id
}

output "vpc_cidr" {
  description = "Database VPC CIDR — used by infra-live-backend to configure the RDS ingress rule and VPC peering route"
  value       = aws_vpc.main.cidr_block
}

output "private_route_table_id" {
  description = "Private route table ID — infra-live-backend adds a peering route here so RDS can route return traffic back to ECS tasks"
  value       = aws_route_table.private.id
}

output "public_subnet_1_id" {
  description = "Public subnet 1 ID (AZ-1)"
  value       = aws_subnet.public_1.id
}

output "public_subnet_2_id" {
  description = "Public subnet 2 ID (AZ-2)"
  value       = aws_subnet.public_2.id
}

output "private_subnet_1_id" {
  description = "Private subnet 1 ID (AZ-1) — RDS"
  value       = aws_subnet.private_1.id
}

output "private_subnet_2_id" {
  description = "Private subnet 2 ID (AZ-2) — RDS"
  value       = aws_subnet.private_2.id
}

# -- RDS ----------------------------------------------------------------------

output "rds_endpoint" {
  description = "RDS hostname — use as POSTGRES_HOST"
  value       = aws_db_instance.main.address
}

output "rds_port" {
  description = "RDS port"
  value       = aws_db_instance.main.port
}

output "rds_secret_arn" {
  description = "Secrets Manager ARN for the RDS master password"
  value       = one(aws_db_instance.main.master_user_secret[*].secret_arn)
}

output "rds_sg_id" {
  description = "RDS security group ID — infra-live-backend adds the ECS→RDS ingress rule here"
  value       = aws_security_group.rds_sg.id
}
