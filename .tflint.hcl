# TFLint config for every stack and module (production-readiness review, CI-15).
# check.sh and check.yml pass it to each run with --config (an absolute path, since
# --chdir moves into the stack). Install the plugin once with:
#   tflint --init --config="$PWD/.tflint.hcl"
#
# No deep_check: it needs AWS credentials, which the Check workflow doesn't have.

plugin "terraform" {
  enabled = true
  preset  = "recommended"
}

# Checks the AWS provider's values Terraform itself can't: instance and node types,
# regions, engine versions, IAM policy JSON, invalid enum values and the like.
# Upgrade by changing the version here and re-running tflint --init.
plugin "aws" {
  enabled = true
  version = "0.49.0"
  source  = "github.com/terraform-linters/tflint-ruleset-aws"
}
