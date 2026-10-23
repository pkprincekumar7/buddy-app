# Terraform modules

Shared building blocks for the `infra-live-*` stacks (TF-01). Each stack folder stays the root
that wires them together and owns its state, providers and `.terraform.lock.hcl`. Modules
declare provider *requirements* only, never `provider` blocks.

| Module | What it creates | Used by |
|---|---|---|
| [`network`](network) | VPC, 3 public `/24` + 3 private `/20` subnets (from the region's `/16`, NET-01), IGW, NAT Gateways (`nat_gateway_count`), route tables, S3 gateway endpoint, interface endpoints (stg/prod) and their security group | `infra-live-backend` |
| [`ecs-service`](ecs-service) | One Fargate service: task definition (main container + optional ADOT sidecar), service, autoscaling target, target-tracking and step-scaling policies, step alarms, sustained and immediate saturation alarms | `infra-live-backend`, once per entry in `services.tf` (`module.service["<key>"]`) |
| [`alb`](alb) | ALB, one target group + listener rule per HTTP service (`targets`: path-routed rules first, one catch-all last, every rule requires `X-Origin-Verify`), HTTPS listener (default 403), ALB security group (CloudFront prefix list only) | `infra-live-backend` |
| [`redis`](redis) | ElastiCache Valkey replication group (engine version is a variable, default `8.0`), subnet group, parameter group (family derived from the version), security group + ingress from the given clients | `infra-live-backend` |

Resource **names** (AWS names and `Name` tags) are the same as before the refactor. Only the
Terraform addresses changed, e.g. `aws_subnet.private_1` → `module.network.aws_subnet.private["1"]`,
`aws_ecs_service.backend` → `module.service["backend"].aws_ecs_service.this`. No environment had state when the
modules were introduced, so there are no `moved {}` blocks. If an environment created before this
change is ever found, add `moved {}` blocks to `infra-live-backend/terraform` until its
`terraform plan` shows **0 to destroy**.

## Calling a module

```hcl
module "network" {
  source = "../../modules/network"

  app_name          = var.app_name
  environment       = var.environment
  aws_region        = var.aws_region
  vpc_cidr          = var.vpc_cidrs[var.aws_region]
  nat_gateway_count = var.nat_gateway_count
}
```

Each module's `variables.tf` documents its inputs, and `outputs.tf` what it exposes.
`infra-live-backend/terraform/{vpc,alb,elasticache,ecs}.tf` are the real examples. To add a backend service, see `docs/infra-operations.md` → "Adding a backend service": it's one entry in `infra-live-backend/terraform/services.tf`.

## Tests

Every module has `tests/*.tftest.hcl`, and `infra-live-backend/terraform/tests/stack.tftest.hcl`
checks how the modules are wired together. They run against a **mock** AWS provider: no
credentials, nothing is created.

```bash
cd modules/network && terraform init && terraform test
```

```bash
cd infra-live-backend/terraform && terraform init -backend=false && terraform test
```

CI (`check.yml` → Terraform Lint) and `./check.sh` run all of them, plus `tflint`, checkov and
`trivy config` on `modules/`.

## Conventions

- **Keyed resources over numbered copies.** Repeated resources use `for_each` with stable keys
  (`"1"`, `"2"`, `"3"` for AZs; `"cpu"`, `"pending-jobs"` for policies), so adding one never
  renumbers the others.
- **Scanner suppressions live with the resource** (`#checkov:skip=…` / `#trivy:ignore:…`, each
  with its reason), inside the module.
- **Optional container fields are left out, not set to `null`** in task definition JSON
  (`ecs-service`), so the JSON matches what ECS stores and doesn't show a perpetual diff.
- **One-off settings stay in the root.** Things only one caller needs, such as the API's
  environment variables or the worker's queue-depth scaling, are passed in rather than hard-coded
  in a module.
