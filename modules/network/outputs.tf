output "vpc_id" {
  description = "ID of the backend VPC."
  value       = aws_vpc.main.id
}

output "vpc_cidr" {
  description = "CIDR of the backend VPC."
  value       = aws_vpc.main.cidr_block
}

output "public_subnet_ids" {
  description = "Public subnet IDs, AZ 1 to 3 in order (ALB, NAT)."
  value       = [for k in local.az_keys : aws_subnet.public[k].id]
}

output "private_subnet_ids" {
  description = "Private subnet IDs, AZ 1 to 3 in order (ECS, Redis, endpoints)."
  value       = [for k in local.az_keys : aws_subnet.private[k].id]
}

output "private_route_table_ids" {
  description = "Private route table IDs, AZ 1 to 3 in order."
  value       = [for k in local.az_keys : aws_route_table.private[k].id]
}

output "nat_public_ips" {
  description = "Elastic IPs of the NAT Gateways — the addresses outbound traffic (LLM APIs, MongoDB Atlas) comes from, e.g. for an Atlas IP access list."
  value       = aws_eip.nat[*].public_ip
}

output "interface_endpoint_ids" {
  description = "Interface VPC endpoint IDs by service key (empty in dev/sbx, where none are created)."
  value       = { for k, e in aws_vpc_endpoint.interface : k => e.id }
}

output "endpoint_client_security_group_ids" {
  description = "Security groups allowed to reach the interface endpoints (empty when there are none)."
  value       = [for r in aws_vpc_security_group_ingress_rule.endpoints_from_client : r.referenced_security_group_id]
}

output "nat_gateway_count" {
  description = "NAT Gateways created."
  value       = length(aws_nat_gateway.nat)
}
