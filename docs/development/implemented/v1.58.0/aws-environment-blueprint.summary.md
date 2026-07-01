# Implementation Summary — AWS Environment Blueprint (v1.58.0)

- **Version**: 1.57.0 → 1.58.0 (**MINOR** — new capability, no app code or schema change)
- **Phase doc**: `aws-environment-blueprint.phase.md` (this directory)
- **ADRs**: ADR-034 (accepted + implemented), ADR-033 (amended)
- **Why**: the fork owner's goal is distribution — third parties take this repo and stamp
  Wayfinder environments on demand (shared core, cheap per-environment stamps), which the
  v1.57.0 single-root stack could not express.

## What was built

`infra/aws` was restructured from one flat root into a blueprint with two roots:

- **`core/`** — applied once per account/region: VPC + single NAT, ECS cluster + Service
  Connect namespace, one shared RDS Postgres 16 server (master credentials in Secrets
  Manager), ALB with a wildcard HTTPS listener whose default action is a fixed 404, and the
  shared ECR repositories. Requires `base_domain` + a wildcard ACM certificate — no HTTP
  fallback (ADR-034 Decision 3).
- **`environments/`** — one Terraform **workspace per environment** (`env_name` defaults to
  `terraform.workspace`, `default` rejected). Each stamp owns: a Postgres role + database on
  the shared server (created declaratively via `cyrilgdn/postgresql`), a private S3 bucket +
  scoped IAM user, its own secrets and execution/task IAM roles, a web ECS service + target
  group + host rule `https://<env>.<base_domain>`, an optional Route53 alias, and optionally
  its own semchunk sidecar (`semchunk-<env>` Service Connect alias, ingress restricted to
  that environment's web SG) wired with `CHUNKER_PROVIDER`/`SEMCHUNK_URL` in the same apply.
- **Modules**: `network` (web SG removed — SGs are per-environment now), new
  `database-server`, `cluster`, `environment`, `semchunk-service`; the v1.57.0 `database`,
  `storage`, `ecs`, `semchunk` modules and root files were deleted.
- **On-demand tooling**: `scripts/new-environment.sh <name> [--enable-semchunk] [--plan]
  [--web-tag] [--semchunk-tag]` and `scripts/destroy-environment.sh <name>` (name validation,
  workspace lifecycle, post-apply operator checklist); optional
  `.github/workflows/provision-environment.yml` (`workflow_dispatch` plan/apply/destroy,
  inert until AWS variables/OIDC secret are configured).
- **Backends** use partial configuration (`backend.hcl.example`) so local applies and the
  Actions workflow share the same blocks.

## Files created / modified / deleted

- New: `infra/aws/{core,environments}/*`, `infra/aws/modules/{database-server,cluster,environment,semchunk-service}/*`,
  `infra/aws/scripts/*`, `infra/aws/backend.hcl.example`, `.github/workflows/provision-environment.yml`,
  ADR-034, PRD §10a addendum
- Modified: `infra/aws/modules/network` (web SG removed), `infra/aws/.gitignore`,
  `infra/aws/README.md` (rewritten around the blueprint lifecycle), `validate.sh` check 16
  (fmt at the tree root, validate per root), ADR-033 (amendment note), `VERSION`/`package.json`
- Deleted: `infra/aws/{main,variables,outputs,versions}.tf`, `infra/aws/terraform.tfvars.example`,
  `infra/aws/modules/{database,storage,ecs,semchunk}`

## Migrations

None (application schema untouched). **Breaking for v1.57.0 infra adopters**: the flat layout
was replaced with no state migration path — destroy with the old layout (v1.57.0 tag) before
adopting the blueprint. Documented in the README.

## E2E tests

Deviation, stated up front in the phase doc (§9): this enhancement has no runtime surface in
the repo — stamped environments exist only in a consumer's AWS account, so there is nothing a
Playwright spec can drive. Coverage instead: script behaviour verified by execution (usage,
name validation incl. the `default` guard, missing-terraform and uninitialised-backend errors,
`--plan` dry-run path), `terraform fmt`/`validate` enforced by validate.sh check 16 wherever
the binary exists, and the existing `apps/web/e2e/phase-semchunk-sidecar.spec.ts` (4/4 passed
in v1.57.0) still covers the sidecar contract stamped environments deploy.

## Known limitations

- `terraform validate`/`plan` could not run in the build sandbox (no route to
  releases.hashicorp.com) — run `terraform -chdir=infra/aws/{core,environments} init
  -backend=false && … validate` locally; check 16 enforces it wherever terraform exists.
- The postgresql provider needs a network path to RDS at stamp time — three options documented;
  this is the main consumer footgun.
- Shared RDS/ALB/NAT are noisy-neighbour/blast-radius trade-offs (ADR-034); fully isolated
  stamping and per-PR preview automation are future work.
- Per-environment cost knobs exist (`web_cpu/memory`, sidecar sizing) but no autoscaling.
