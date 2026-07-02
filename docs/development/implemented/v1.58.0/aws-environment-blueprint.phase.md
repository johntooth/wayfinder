# Phase — AWS Environment Blueprint (Shared Core + Stamped Environments)

- **Status**: Implemented in v1.58.0 (see `aws-environment-blueprint.summary.md`)
- **Target version**: **MINOR** — 1.57.0 → 1.58.0 (new capability; no app code or schema change)
- **PRD**: `docs/development/prd/semchunk-sidecar-and-aws-iac.prd.md` (extends its Workstream B; "on-demand environments" was out of scope there)
- **ADRs**: ADR-033 (single-environment stack — amended by this phase), ADR-034 (new: shared core + stamped environments)
- **Depends on**: v1.57.0 `infra/aws` modules, `Dockerfile.web`, `services/semchunk`

> **Assumptions recorded** (interactive confirmation unavailable; flag in doc review if wrong):
> per-environment databases are created declaratively on the shared RDS instance via the
> `cyrilgdn/postgresql` Terraform provider; host-based routing **requires** `base_domain` +
> a wildcard ACM certificate (no HTTP/path-based fallback).

## 1. Goal / why

v1.57.0's `infra/aws` provisions exactly one Wayfinder environment, applied by hand. The fork's
purpose is different: **third parties should be able to take this repo and stamp out Wayfinder
environments on demand** — Vercel-style provisioning where the repo is the blueprint. That means
splitting "expensive things you build once" from "cheap things you stamp per environment", making
the stamp a one-command operation, and keeping per-environment cost near a single Fargate task.

## 2. Scope

**In:**

- Restructure `infra/aws` into two roots: `core/` (apply once per account) and `environments/`
  (one Terraform **workspace per environment**).
- Core: VPC + NAT, ECS cluster + Service Connect namespace, shared RDS Postgres 16 server,
  ALB + wildcard HTTPS listener (404 default action), ECR repositories, master-credentials secret.
- Environment stamp: Postgres role + database on the shared server (`cyrilgdn/postgresql`
  provider), private S3 bucket + scoped IAM user, per-env secrets, per-env execution/task roles,
  web ECS service + target group + host-based listener rule (`<env>.<base_domain>`), optional
  Route53 record, optional per-env semchunk sidecar with a unique Service Connect alias
  (`semchunk-<env>`).
- `scripts/new-environment.sh` / `scripts/destroy-environment.sh` — the on-demand entry points
  (workspace select/new → plan/apply; `--plan` dry-run mode; destroy deletes the workspace).
- Optional `workflow_dispatch` GitHub Actions workflow (`provision-environment.yml`) so an
  operator can stamp/destroy a named environment from the Actions UI when AWS credentials
  secrets are configured.
- `validate.sh` check 16 extended to cover both Terraform roots.
- `infra/aws/README.md` rewritten around the blueprint lifecycle; ADR-034 records the decision.

**Out:** per-PR preview environments wired to CI, autoscaling policies, cross-account /
multi-region cores, Langfuse hosting, app-level multi-tenancy (each stamped environment is a
fully separate Wayfinder install sharing only infrastructure).

## 3. Database changes

None to the application schema. Each environment gets its **own database** on the shared RDS
server, created/destroyed by Terraform; Wayfinder's own migrations run on container start as
today.

## 4. Layout (target)

```
infra/aws/
  README.md                    # blueprint lifecycle: bootstrap → core → stamp → destroy
  core/                        # apply once: state key core/terraform.tfstate
    main.tf variables.tf outputs.tf versions.tf terraform.tfvars.example
  environments/                # one workspace per environment
    main.tf variables.tf outputs.tf versions.tf terraform.tfvars.example
  modules/
    network/                   # (from v1.57.0, web SG removed — SGs become per-env)
    database-server/           # RDS instance + SG + master secret (from database/)
    cluster/                   # ECS cluster, namespace, ALB, wildcard listener, ECR
    environment/               # the stamp: db+role, bucket+IAM, secrets, services, routing
    semchunk-service/          # (from semchunk/, alias + name parameterised)
  scripts/
    new-environment.sh destroy-environment.sh
```

`environments/` consumes core outputs via `terraform_remote_state` (same S3 backend,
`core/terraform.tfstate` key). The `postgresql` provider connects to the shared RDS endpoint
with master credentials read from the core-created secret — **the terraform runner needs a
network path to RDS** (run from inside the VPC, an SSM port-forward, or a temporarily
allow-listed IP; README documents all three).

## 5. Key design points

- **Workspace = environment.** `env_name` defaults to `terraform.workspace`; validation enforces
  `^[a-z][a-z0-9-]{1,14}$` (ALB target-group 32-char limit and DNS label safety).
- **Routing.** Core's HTTPS listener default action is a fixed 404; each environment adds a
  host-header listener rule (priority auto-assigned) plus an optional Route53 alias record when
  `route53_zone_id` is set. `BETTER_AUTH_URL = https://<env>.<base_domain>`.
- **Isolation stance (user-confirmed):** shared VPC/RDS-server/ALB/cluster; per-env database,
  bucket, secrets, IAM, services. Per-env cost ≈ one Fargate task (+ sidecar if enabled).
- **Semchunk per environment.** Alias `semchunk-<env>` in the shared namespace; the env's web
  task gets `SEMCHUNK_URL=http://semchunk-<env>:8000`; sidecar SG admits only that env's web SG.
- **Images are shared, tags are per-env inputs.** ECR lives in core; each environment pins
  `web_image_tag` / `semchunk_image_tag`, so "deploy" for an env = push tag + apply (or
  force-new-deployment).
- **Migration from v1.57.0 layout:** the single-root files are replaced. Anyone who applied
  v1.57.0 must `terraform destroy` with the old layout before adopting the blueprint (no state
  migration path is provided — documented in the README and release summary).

## 6. What is built (all infra/tooling — no packages/apps code)

| Area | File(s) | Change |
|------|---------|--------|
| infra | `infra/aws/core/*`, `infra/aws/environments/*` | new roots |
| infra | `infra/aws/modules/{database-server,cluster,environment,semchunk-service}` | new/split modules |
| infra | `infra/aws/modules/network` | web SG removed (per-env now) |
| infra | `infra/aws/{main,variables,outputs,versions}.tf`, `terraform.tfvars.example` | **deleted** (replaced by roots) |
| infra | `infra/aws/modules/{database,storage,ecs,semchunk}` | **deleted** (superseded by the split) |
| tooling | `infra/aws/scripts/new-environment.sh`, `destroy-environment.sh` | stamp entry points |
| tooling | `.github/workflows/provision-environment.yml` | optional workflow_dispatch stamp |
| repo | `validate.sh` check 16 | fmt at `infra/aws` root; validate per root when initialised |
| docs | `infra/aws/README.md`, ADR-034, ADR-033 amendment | blueprint lifecycle + decision record |

## 7. Implementation order

1. ADR-034 + ADR-033 amendment note.
2. Module split (`network` trim, `database-server`, `cluster`, `semchunk-service`).
3. `environment` module (db/role, bucket/IAM, secrets, roles, web service, routing, sidecar).
4. `core/` and `environments/` roots + tfvars examples; delete the v1.57.0 root files.
5. Scripts (+ `--plan` dry-run), GitHub workflow.
6. validate.sh check 16 update; README rewrite; version bump 1.58.0.

## 8. Acceptance criteria

- [ ] `terraform fmt -check -recursive` clean at `infra/aws`; `terraform validate` passes in
      `core/` and `environments/` (run wherever the binary exists — validate.sh check 16).
- [ ] Stamping is one command: `scripts/new-environment.sh <name> [--enable-semchunk] [--plan]`;
      destroy symmetric; both refuse invalid env names and missing prerequisites with clear errors.
- [ ] With `--enable-semchunk`, the plan contains the sidecar service, `semchunk-<env>` alias,
      env-scoped SG rule, and the web task's `CHUNKER_PROVIDER`/`SEMCHUNK_URL`; without it, none.
- [ ] Two stamped environments collide on nothing: names, hosts, DBs, buckets, secrets, aliases,
      target groups (verified by plan inspection for `env_name=a` and `env_name=b`).
- [ ] No secrets in tfvars; master DB credentials only in Secrets Manager; per-env DB owner role
      is not the master role.
- [ ] README documents: bootstrap, core apply, stamp, deploy-new-version, destroy, the
      postgres-provider network-path requirement, per-env cost, and the v1.57.0 migration note.
- [ ] `./validate.sh` green; `VERSION` + root `package.json` = 1.58.0.

## 9. E2E note (deviation)

This enhancement has **no runtime surface in the repo** — nothing a Playwright spec can drive
(the stamped environments exist only in a consumer's AWS account). Coverage is: validate.sh
check 16 (fmt/validate), the scripts' `--plan` dry-run mode, and plan-inspection acceptance
criteria above. The existing `apps/web/e2e/phase-semchunk-sidecar.spec.ts` still covers the
sidecar contract that stamped environments deploy. This deviation is stated in the
implementation summary rather than papered over with a fake test.

## 10. Risks

- `cyrilgdn/postgresql` provider needs DB connectivity at plan/apply time — the biggest consumer
  footgun; mitigated with three documented connection paths and a clear error in the script.
- Listener-rule auto-priority is convenient but opaque; collisions impossible (AWS assigns), but
  rule ordering across envs is unspecified — acceptable since host headers are disjoint.
- Shared RDS is a noisy-neighbour risk across environments; documented, with `db_instance_class`
  sizing guidance and the fully-isolated pattern noted as future work.
