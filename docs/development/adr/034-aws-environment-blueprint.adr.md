# ADR-034 — AWS Environment Blueprint: Shared Core + Stamped Environments

- **Status**: Accepted (implemented in v1.58.0)
- **Date**: 2026-07-01
- **Relates to**: ADR-033 (single-environment AWS stack — amended by this ADR), ADR-030 (semchunk sidecar)

## Context

ADR-033 shipped a single-environment Terraform stack: one `terraform apply` produces one
Wayfinder deployment. The fork's actual goal is distribution: third parties take this repo and
provision Wayfinder environments **on demand** — Vercel-style, where the repo is the blueprint
and "give me another environment" is one command, not an afternoon of AWS work. A flat
single-root stack cannot express that: stamping a second environment means copying the tree and
paying the full VPC/RDS/ALB cost again.

The isolation stance was confirmed with the fork owner: **shared core, per-environment app** —
environments share expensive infrastructure but nothing application-visible.

## Decision 1 — Two Terraform roots: `core/` (once) and `environments/` (per stamp)

`infra/aws/core` is applied once per AWS account/region: VPC + NAT, ECS cluster + Service
Connect namespace, one shared RDS Postgres 16 server, the ALB with a wildcard HTTPS listener
(fixed-404 default action), and the ECR repositories. `infra/aws/environments` is applied once
**per environment**, using one Terraform **workspace per environment** (`env_name` defaults to
`terraform.workspace`); it reads core outputs via `terraform_remote_state`.

**Why workspaces, not directory-per-env:** consumers should not edit the repo to add an
environment — a workspace is created at stamp time by a script, keeps state per-env in the same
backend, and `destroy` + workspace deletion removes every trace.

Each stamp owns: a Postgres role + database on the shared server, a private S3 bucket + scoped
IAM user, its own secrets and execution/task roles, a web ECS service + target group + host
rule `<env>.<base_domain>`, an optional Route53 record, and optionally a semchunk sidecar
(ADR-030) published as `semchunk-<env>` with ingress restricted to that environment's web
service. Images are shared (core ECR); environments pin tags, so deploying a version to one
environment is push-tag + apply.

## Decision 2 — Per-environment databases via the `cyrilgdn/postgresql` provider

The stamp creates the environment's role and database declaratively in the same apply, using
master credentials read from the core-created secret. Databases die with their environment on
destroy; the per-env owner role is never the master role.

**Trade-off:** the terraform runner needs a network path to RDS at plan/apply time (VPC
runner, SSM port-forward, or temporary IP allow-listing — all three documented). The
alternative — a one-shot ECS bootstrap task — needs no network path but is imperative, fails
after apply instead of during plan, and leaves orphans on destroy. Declarative wins.

## Decision 3 — Host-based routing requires a real domain

Consumers must provide `base_domain` and a wildcard ACM certificate; every environment is
`https://<env>.<base_domain>`. There is deliberately **no HTTP/path-based fallback**: Next.js
auth callbacks and cookies misbehave behind path rewrites, and a blueprint aimed at third
parties must not ship a mode that works until login. Optional `route53_zone_id` automates DNS.

## Decision 4 — On-demand entry points are scripts, plus an optional Actions workflow

`scripts/new-environment.sh <name> [--enable-semchunk] [--plan]` and
`scripts/destroy-environment.sh <name>` wrap workspace management, validation
(`^[a-z][a-z0-9-]{1,14}$` — ALB naming limits, DNS label safety) and apply/destroy. A
`workflow_dispatch` GitHub Actions workflow exposes the same operations from the Actions UI for
consumers who configure AWS credentials secrets; it is optional and inert without them. A full
CI/CD pipeline (plan on PR, apply on merge, per-PR previews) remains future work.

## Consequences

**Positive**
- "Another environment" costs one Fargate task (+ optional sidecar), a bucket, and secrets —
  minutes and cents, not a new VPC/RDS/ALB.
- Environments collide on nothing application-visible: DB, bucket, secrets, IAM, hostnames,
  and sidecar aliases are all namespaced by `env_name`.
- The repo becomes the product: clone → bootstrap → `new-environment.sh tenant-a`.

**Negative**
- Shared RDS/ALB/NAT are noisy-neighbour and blast-radius risks across environments; sizing
  guidance documented, fully-isolated stamping noted as future work.
- The postgres-provider network-path requirement is a real consumer footgun (mitigated in docs
  and script preflight checks).
- **Breaking for v1.57.0 adopters:** the single-root layout is deleted with no state migration
  path — destroy with the old layout before adopting the blueprint.
