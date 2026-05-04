output "alb_dns_name" {
  description = "DNS name of the Application Load Balancer"
  value       = aws_lb.buddy360_alb.dns_name
}

output "app_url" {
  description = "Public HTTPS URL of the application"
  value       = "https://${local.fqdn}"
}

output "ec2_public_ip" {
  description = "Public IP of the EC2 instance"
  value       = aws_instance.buddy360_ec2.public_ip
}

output "vpc_id" {
  description = "VPC ID (sourced from infra-db remote state)"
  value       = data.terraform_remote_state.db.outputs.vpc_id
}

output "frontend_target_group_arn" {
  description = "ARN of the frontend target group"
  value       = aws_lb_target_group.frontend.arn
}

output "backend_target_group_arn" {
  description = "ARN of the backend target group"
  value       = aws_lb_target_group.backend.arn
}
