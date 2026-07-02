# Implementation Summary — AWS Blueprint Quick-Start (v1.59.0)

- **Version**: 1.58.0 → 1.59.0 (**MINOR** — new capability, no app code or schema change)
- **Phase doc**: `aws-blueprint-quickstart.phase.md` (this directory)
- **ADRs**: ADR-035 (accepted + implemented); ADR-034 unchanged
- **Why**: adopting the v1.58.0 blueprint took ~10 ordered manual steps with two footguns
  (pre-existing wildcard ACM cert; RDS network path for stamping). The fork owner asked to
  make setup simple for a cloud engineer.

## What was built

Setup is now three commands:

```bash
./scripts/bootstrap.sh --region … --state-bucket … --base-domain … --route53-zone-id …
./scripts/db-tunnel.sh &
./scripts/new-environment.sh dev --via-tunnel
```

- **`scripts/bootstrap.sh`** — idempotent one-command core setup: preflight (aws/terraform
  binaries, credentials; docker optional → auto `--skip-images` with a warning), state-bucket
  create-if-missing (us-east-1 quirk handled), generates `backend.hcl` +
  `core/terraform.tfvars` + `environments/terraform.tfvars` (never overwrites existing files),
  core init/apply, image build/push, next-steps summary. Flags over prompts; `--yes` for
  non-interactive apply.
- **ACM auto-issuance (core)** — `certificate_arn` is now optional: with `route53_zone_id`
  set, core issues `*.<base_domain>` (apex SAN), publishes DNS validation records, and waits
  for issuance; an explicit ARN always wins; neither set fails at plan time via a
  `terraform_data` precondition.
- **SSM bastion (core, `enable_bastion` default true, ≈ $4/mo)** — t4g.nano AL2023, no key
  pair, no inbound ports, IMDSv2 required, `AmazonSSMManagedInstanceCore`, DB
  security-group ingress; `bastion_instance_id` output.
- **`scripts/db-tunnel.sh`** — SSM port-forward to the shared RDS via the bastion (default
  local port 5433); clear errors when core is uninitialised or the bastion is disabled.
- **`--via-tunnel [port]`** on `new-environment.sh` and `destroy-environment.sh` — checks the
  local port is actually listening, then sets `database_host_override`/
  `database_port_override`, which redirect **only** the `cyrilgdn/postgresql` provider; the
  stamped `DATABASE_URL` secret keeps the in-VPC RDS host.
- **Zone inheritance** — environment stamps inherit `route53_zone_id` from core outputs when
  the variable is null; `""` still opts a stamp out of DNS.
- **README** — leads with the three-command quick start; bastion is the documented default
  database-connectivity path; cost notes updated (core floor ≈ $78/mo).

## Files created / modified

- New: `infra/aws/scripts/bootstrap.sh`, `infra/aws/scripts/db-tunnel.sh`, ADR-035
- Modified: `infra/aws/core/{main,variables,outputs}.tf`, `core/terraform.tfvars.example`,
  `infra/aws/environments/{main,variables,versions}.tf`, `environments/terraform.tfvars.example`,
  `infra/aws/scripts/{new,destroy}-environment.sh`, `infra/aws/README.md`,
  `VERSION`/`package.json`

## Migrations

None. Existing v1.58.0 cores pick up the bastion and (if `certificate_arn` was set) keep
their certificate unchanged on the next apply.

## E2E tests

Same documented deviation as v1.58.0 — no runtime surface in the repo. Coverage by direct
execution during the build: bootstrap usage/exit codes, missing-binary and missing-cert/zone
errors; db-tunnel missing-CLI/uninitialised-core errors; `--via-tunnel` flag parsing including
invalid port values; `bash -n` over all four scripts. Terraform fmt/validate enforced by
validate.sh check 16 wherever the binary exists. The sidecar contract spec
(`apps/web/e2e/phase-semchunk-sidecar.spec.ts`) is unaffected and still green from v1.57.0.

## Known limitations

- Terraform could not execute in the build sandbox (network policy) — run
  `terraform -chdir=infra/aws/{core,environments} init -backend=false && … validate` locally.
- Cert auto-issuance hangs if the hosted zone doesn't serve the domain's NS records —
  bootstrap prints a hint before applying.
- The Session Manager plugin for the AWS CLI is assumed for `db-tunnel.sh`.
- Bootstrap covers one account/region; multi-account rollouts remain manual.
