# The Atlas side of the PrivateLink endpoint (atlas.tf, DEC-02), stg and prod only.

mock_resource "mongodbatlas_privatelink_endpoint" {
  defaults = {
    endpoint_service_name = "com.amazonaws.vpce.ap-south-1.vpce-svc-0123456789abcdef0"
    private_link_id       = "65f0a1b2c3d4e5f6a7b8c9d0"
  }
}
