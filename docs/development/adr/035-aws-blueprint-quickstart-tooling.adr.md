# ADR-035 — Blueprint Quick-Start Tooling

- **Status**: Accepted (implemented in v1.59.0)
- **Date**: 2026-07-02
- **Relates to**: ADR-034 (environment blueprint — unchanged by this ADR)

## Context

The v1.58.0 blueprint is architecturally right for on-demand environments but operationally
expensive to adopt: ~10 ordered manual steps and two footguns (a pre-existing wildcard ACM
certificate; the postgresql provider's need for a network path to RDS at stamp time). The fork
owner's ask: make it simple for a cloud engineer to set up.

## Decision 1 — One idempotent bootstrap script, not more documentation

`scripts/bootstrap.sh` performs the whole core setup: preflight (binaries, AWS credentials,
docker), state-bucket creation, `backend.hcl` and `core/terraform.tfvars` generation from
flags, core init/apply, and image build/push. Every step is skip-if-done, so the script is
also the recovery path when a step fails halfway. Flags over prompts (`--region`,
`--state-bucket`, `--base-domain`, `--route53-zone-id` | `--certificate-arn`,
`--skip-images`) so it works in CI and copy-paste runbooks alike.

## Decision 2 — Core provisions the wildcard certificate when it can

`certificate_arn` becomes optional. With `route53_zone_id` set and no ARN, core creates the
`*.<base_domain>` certificate (apex as SAN), publishes the DNS validation records into the
zone, and waits for issuance. An explicit ARN always wins; providing neither fails at plan
time. This turns the hardest prerequisite into a variable — engineers with DNS elsewhere keep
the manual path.

## Decision 3 — A default-on SSM bastion removes the stamping footgun

Core provisions a t4g.nano AL2023 instance (`enable_bastion`, default **true**): no key pair,
no inbound ports, IMDSv2 required, SSM-managed only, with database security-group ingress.
`scripts/db-tunnel.sh` opens the port-forward; `new-environment.sh --via-tunnel` (and
`destroy-environment.sh --via-tunnel`) point the postgresql provider at
`127.0.0.1:<port>` via `database_host_override`/`database_port_override` — while the stamped
`DATABASE_URL` secret keeps the real in-VPC host. Default-on is deliberate: ≈ $4/mo buys
"stamping works from a laptop with zero networking knowledge", and one flag turns it off for
shops with their own access patterns.

## Consequences

**Positive**
- Setup is bootstrap → tunnel → stamp: three commands, each failing fast with actionable errors.
- The two adoption footguns become automation (cert) and a documented default (DB path).

**Negative**
- The bastion is a small always-on cost and managed-instance surface (mitigated: SSM-only,
  IMDSv2, no ingress, `enable_bastion = false`).
- Auto-issuance hangs if the hosted zone does not actually serve the domain — surfaced with a
  hint in bootstrap output and ACM's visible validation timeout.
- bootstrap.sh writes tfvars/backend files; engineers must know edits belong in those files
  afterwards (the script never overwrites existing files).
