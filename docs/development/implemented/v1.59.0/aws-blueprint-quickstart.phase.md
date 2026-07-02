# Phase — AWS Blueprint Quick-Start (One-Command Setup for Cloud Engineers)

- **Status**: Implemented in v1.59.0 (see `aws-blueprint-quickstart.summary.md`)
- **Target version**: **MINOR** — 1.58.0 → 1.59.0 (new capability; no app code or schema change)
- **PRD**: `docs/development/prd/semchunk-sidecar-and-aws-iac.prd.md` (§10a blueprint addendum)
- **ADRs**: ADR-034 (blueprint — unchanged), ADR-035 (new: quick-start tooling decisions)
- **Depends on**: v1.58.0 `infra/aws` blueprint

## 1. Goal / why

A cloud engineer adopting the v1.58.0 blueprint faces ~10 ordered manual steps (state bucket,
backend.hcl, two tfvars files, a pre-existing wildcard ACM cert, init/apply, docker login/build/
push ×2) and two footguns (the RDS network path for stamping; cert prerequisites). Collapse
setup to approximately three commands with the footguns removed or automated.

## 2. Scope

**In:**

1. **`scripts/bootstrap.sh`** — idempotent one-command core setup: preflight (aws/terraform
   binaries, credentials, docker optional), state-bucket create-if-missing (us-east-1
   LocationConstraint handled), `backend.hcl` + `core/terraform.tfvars` generation from flags,
   core init+apply, image build+push (`--skip-images` to omit), next-steps summary.
2. **ACM auto-provisioning (core)** — `certificate_arn` becomes optional: when empty and
   `route53_zone_id` is set, core creates the `*.<base_domain>` certificate (SAN: apex) with
   DNS validation records and waits for issuance. Guard: at least one of
   `certificate_arn`/`route53_zone_id` must be set.
3. **SSM bastion (core, `enable_bastion` default `true`)** — t4g.nano, AL2023 (SSM agent
   built in), no key pair, private subnet, IMDSv2 required, `AmazonSSMManagedInstanceCore`;
   DB security-group ingress from the bastion. ≈ $4/mo, disable-able.
4. **`scripts/db-tunnel.sh`** — opens the SSM port-forward to the shared RDS via the bastion
   (reads core outputs; default local port 5433).
5. **`--via-tunnel` on `new-environment.sh` and `destroy-environment.sh`** — points the
   `postgresql` provider at the tunnel (`database_host_override`/`database_port_override`
   environment-stack variables); the stored `DATABASE_URL` keeps the real in-VPC host.
6. **Route53 zone inheritance** — environments inherit `route53_zone_id` from core outputs
   unless explicitly overridden (nullable var; `""` still means "skip DNS").
7. **README quick-start** — the three-command path first, details after.

**Out:** cross-account/multi-region bootstrap, CI-driven apply pipeline, cert issuance without
Route53 (external DNS validation stays manual with `certificate_arn`), bastion hardening beyond
SSM-only access.

## 3. Database changes

None.

## 4. What is built

| Area | File(s) | Change |
|------|---------|--------|
| tooling | `infra/aws/scripts/bootstrap.sh` | new |
| tooling | `infra/aws/scripts/db-tunnel.sh` | new |
| tooling | `infra/aws/scripts/{new,destroy}-environment.sh` | `--via-tunnel [port]` flag |
| infra | `infra/aws/core/{main,variables,outputs}.tf` | ACM auto-cert, input guard, bastion, `route53_zone_id` var+output |
| infra | `infra/aws/environments/{main,variables}.tf`, `versions.tf` | host/port override vars for the postgresql provider; zone inheritance |
| infra | `infra/aws/core/terraform.tfvars.example` | reflect optional cert / zone-driven path |
| docs | `infra/aws/README.md` | quick-start section |
| docs | ADR-035 | tooling decisions (auto-cert, bastion default-on, tunnel overrides) |

## 5. Acceptance criteria

- [ ] `bootstrap.sh` with no/invalid args prints usage and exits 1; with missing binaries or
      credentials it fails with a specific, actionable message; re-running after success is a
      no-op apart from `terraform apply` convergence (idempotent bucket/backend/tfvars steps).
- [ ] Core accepts: `certificate_arn` only, `route53_zone_id` only (auto-cert), or both
      (explicit ARN wins); neither → plan-time error naming both variables.
- [ ] `enable_bastion = true` produces the SSM-managed instance + DB ingress; `false` produces
      neither and `db-tunnel.sh` fails with a clear "bastion disabled" message.
- [ ] `new-environment.sh tenant-a --via-tunnel` passes the overrides to the provider only —
      the environment's `DATABASE_URL` secret still contains the in-VPC RDS host.
- [ ] `destroy-environment.sh` supports `--via-tunnel` (destroy also needs provider access).
- [ ] Environments use core's `route53_zone_id` when the var is null, skip DNS when `""`.
- [ ] `terraform fmt -check -recursive` clean; both roots `terraform validate` clean (check 16
      wherever the binary exists); `./validate.sh` green; version 1.59.0 in both files.
- [ ] README leads with the quick-start (bootstrap → tunnel → stamp).

## 6. E2E note (deviation — same rationale as v1.58.0)

No runtime surface in the repo; scripts are exercised directly (usage/arg validation, preflight
error paths, flag parsing) and the Terraform gates run wherever the binary exists. Stated in
the implementation summary.

## 7. Risks

- Auto-cert requires the hosted zone to actually serve the domain's NS records — issuance
  hangs otherwise; bootstrap prints a hint and ACM validation has a visible timeout.
- Default-on bastion is a (tiny) always-on cost and an extra managed instance; SSM-only, no
  inbound ports, IMDSv2 — and one flag turns it off.
- `--via-tunnel` assumes the tunnel is already up; scripts check the local port and fail fast
  with the `db-tunnel.sh` invocation to run.
