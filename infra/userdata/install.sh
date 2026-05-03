#!/bin/bash
set -euo pipefail

apt-get update -y

# Install Git
apt-get install -y git

# Install Docker
apt-get install -y docker.io
systemctl start docker
systemctl enable docker

# Install Docker Compose v2 plugin
apt-get install -y docker-compose-v2

# Allow ubuntu user to run docker without sudo
usermod -aG docker ubuntu

# Install and start SSM agent (not pre-installed on Canonical Ubuntu AMIs)
snap install amazon-ssm-agent --classic
systemctl enable snap.amazon-ssm-agent.amazon-ssm-agent.service
systemctl start snap.amazon-ssm-agent.amazon-ssm-agent.service

echo "Bootstrap complete. Trigger the Deploy workflow to start the application." > /home/ubuntu/setup.txt
