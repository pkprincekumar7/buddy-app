# ---------------------------------------------------------------------------
# VPC Peering — backend VPC ↔ database VPC
#
# Allows ECS tasks (backend VPC) to reach RDS (database VPC) over private
# networking without a NAT Gateway or public exposure.
#
# Same-account peering auto-accepts. Routes are added to both VPCs:
#   - backend public route table  → database VPC CIDR (via peering)
#   - database private route table → backend VPC CIDR  (via peering)
#
# Cross-VPC security group references are NOT supported in ingress rules.
# The RDS ingress rule in security_groups.tf uses the backend VPC CIDR instead.
# ---------------------------------------------------------------------------

resource "aws_vpc_peering_connection" "backend_to_db" {
  vpc_id      = aws_vpc.main.id
  peer_vpc_id = data.terraform_remote_state.live_db.outputs.vpc_id
  auto_accept = true

  tags = {
    Name = "${var.app_name}-backend-to-db-peering-${var.environment}"
  }
}

# Route in backend public subnets: ECS tasks → database VPC via peering.
resource "aws_route" "backend_to_db" {
  route_table_id            = aws_route_table.public.id
  destination_cidr_block    = data.terraform_remote_state.live_db.outputs.vpc_cidr
  vpc_peering_connection_id = aws_vpc_peering_connection.backend_to_db.id
}

# Route in backend private subnets: covers any future resource placed here.
resource "aws_route" "backend_private_to_db" {
  route_table_id            = aws_route_table.private.id
  destination_cidr_block    = data.terraform_remote_state.live_db.outputs.vpc_cidr
  vpc_peering_connection_id = aws_vpc_peering_connection.backend_to_db.id
}

# Route in database VPC: return traffic to backend VPC CIDR goes through the peering connection.
# The route table ID is exported from infra-live-database.
resource "aws_route" "db_to_backend" {
  route_table_id            = data.terraform_remote_state.live_db.outputs.private_route_table_id
  destination_cidr_block    = aws_vpc.main.cidr_block
  vpc_peering_connection_id = aws_vpc_peering_connection.backend_to_db.id
}
