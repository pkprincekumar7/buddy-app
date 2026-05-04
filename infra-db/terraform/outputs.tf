output "vpc_id" {
  description = "VPC ID — consumed by app infra via remote state"
  value       = aws_vpc.buddy360_vpc.id
}

output "public_subnet_1_id" {
  description = "Public subnet 1 ID — consumed by app infra via remote state"
  value       = aws_subnet.public_1.id
}

output "public_subnet_2_id" {
  description = "Public subnet 2 ID — consumed by app infra via remote state"
  value       = aws_subnet.public_2.id
}

output "rds_endpoint" {
  description = "RDS hostname — use as POSTGRES_HOST in the application"
  value       = aws_db_instance.buddy360_db.address
}

output "rds_port" {
  description = "RDS port"
  value       = aws_db_instance.buddy360_db.port
}

output "rds_secret_arn" {
  description = "Secrets Manager ARN holding the master password — retrieve with: aws secretsmanager get-secret-value --secret-id <arn> --query SecretString --output text"
  value       = aws_db_instance.buddy360_db.master_user_secret[0].secret_arn
}

output "rds_sg_id" {
  description = "RDS security group ID — consumed by infra/terraform to attach the EC2→RDS ingress rule"
  value       = aws_security_group.rds_sg.id
}
