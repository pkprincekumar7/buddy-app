resource "aws_instance" "buddy360_ec2" {
  ami           = data.aws_ssm_parameter.ubuntu_ami.value
  instance_type = var.instance_type
  subnet_id     = data.terraform_remote_state.db.outputs.public_subnet_1_id

  vpc_security_group_ids = [aws_security_group.ec2_sg.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2_profile.name
  key_name               = var.key_name

  user_data = file("${path.module}/../userdata/install.sh")

  # Prevent accidental replacement; update user_data via new AMI or SSM instead
  lifecycle {
    ignore_changes = [user_data]
  }

  tags = {
    Name = "${var.app_name}-ec2"
  }
}
