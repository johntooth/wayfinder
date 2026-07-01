# ADR-033 — AWS Infrastructure via Terraform on ECS Fargate

- **Status**: Accepted (implemented in v1.57.0) — **amended by ADR-034** (v1.58.0): the
  single-root layout is restructured into a shared core + per-environment stamps; tool,
  compute, and secrets decisions below are unchanged
- **Date**: 2026-07-01
- **Relates to**: ADR-030 (semchunk sidecar), ADR-016/017 (pgvector + embeddings), ADR-002 (multi-provider AI, incl. Bedrock)

## Context

Wayfinder's only deployment story is local docker-compose (Postgres+pgvector, MinIO,
Langfuse, app containers). The fork needs a repeatable, reviewable AWS deployment that can
optionally include the semchunk sidecar (ADR-030). There is no existing IaC in the repo, so
tool and topology are green-field choices.

## Decision 1 — Terraform, in `infra/aws/`

Infrastructure is defined in Terraform (HCL), rooted at `infra/aws/` with small local
modules (`network`, `database`, `storage`, `ecs`, `semchunk`), an example
`terraform.tfvars.example`, and a README covering bootstrap/apply/teardown.

**Why Terraform over CDK/CloudFormation/Pulumi:** declarative HCL diffs are reviewable in
PRs by non-TypeScript operators; the AWS provider is the de-facto standard; and it keeps
infrastructure independent of the Node toolchain — `pnpm install` and `validate.sh` never
need AWS tooling. CDK (TypeScript) would match the repo language but couples infra to the
app build and synthesizes to CloudFormation, which is slower to iterate and harder to read
in review. If HashiCorp's BUSL licence ever becomes a problem, the HCL is
OpenTofu-compatible as written.

State lives in an S3 bucket with native S3 locking (`use_lockfile`); creating the state
bucket is a documented one-time bootstrap step outside the module (a module cannot manage
its own backend).

## Decision 2 — ECS Fargate as the compute target

One ECS cluster runs the app as Fargate services: `web` (Next.js, behind an ALB) and —
gated by a variable — `semchunk`. Supporting managed services replace the compose stack:

| docker-compose service | AWS resource |
|---|---|
| `postgres` (pgvector/pg16) | RDS PostgreSQL 16 (`vector` extension enabled post-provision) |
| `storage` (MinIO) | S3 bucket (app already supports `MINIO_ENDPOINT=s3.amazonaws.com`, SSL on) |
| `langfuse` | **not provisioned** — operators point `LANGFUSE_*` at Langfuse Cloud/self-hosted |
| app containers | ECS Fargate services from images in ECR |

**Why Fargate over EC2+compose / EKS / App Runner:** no hosts to patch and per-service
sizing (unlike a single EC2 box, which is also a single point of failure); a fraction of
EKS's operational surface for a two-service topology; and unlike App Runner it supports
private service-to-service networking, which the sidecar requires (internal-only, never
internet-facing).

Topology: VPC across two AZs with public subnets (ALB, NAT) and private subnets (ECS tasks,
RDS). Secrets (DB password, `BETTER_AUTH_SECRET`, AI provider keys) live in AWS Secrets
Manager and are injected via the task definition's `secrets` mapping — never in tfvars or
task-definition plaintext. Task roles grant S3 access to the documents bucket (and Bedrock
invoke if enabled), so no static AWS keys are needed in-app.

## Decision 3 — The optional sidecar is a Terraform variable, not a separate stack

`enable_semchunk = true` (default `false`) conditionally creates: the semchunk ECR repo
reference, the Fargate service + task definition, an ECS Service Connect entry
(`semchunk.<namespace>` DNS name), a security-group rule allowing only the web service to
reach port 8000, and the `CHUNKER_PROVIDER=semchunk` / `SEMCHUNK_URL` env vars on the web
task. With the flag off, zero sidecar resources exist and the web task carries no semchunk
config — infra state and app behaviour cannot drift apart.

**Why one variable, not a separate root module:** the sidecar is meaningless without the
app, and the web task's env vars must change in lockstep with the sidecar's existence; a
single apply keeps that atomic.

## Decision 4 — Production app image is a prerequisite, not infra's job

The existing root `Dockerfile` is explicitly dev-only (`next dev`, tsx, AUTH_BYPASS
active). The deployment phase adds a multi-stage production image (`Dockerfile.web`:
`pnpm build` → standalone `next start`, `NODE_ENV=production` so AUTH_BYPASS is
hard-disabled) and `services/semchunk/Dockerfile`. Terraform consumes image tags as
variables; building/pushing to ECR is an operator step documented in the README (CI/CD is
future work).

## Consequences

**Positive**
- Reproducible, code-reviewed environments; `terraform plan` shows every change before apply.
- Sidecar adoption is a one-variable flip with app config wired automatically (ADR-030's
  "opt-in" made concrete).
- Managed Postgres/S3 remove MinIO and self-managed pgvector from the production topology.

**Negative**
- New toolchain (Terraform) and AWS knowledge required of operators; not exercised by
  `validate.sh` beyond optional fmt/validate checks.
- Real monthly cost floor (NAT gateway, RDS, Fargate) even for idle environments — README
  documents estimates and cheap-dev knobs.
- Two Dockerfiles to keep working (dev compose vs production multi-stage).
- Langfuse observability is external to this stack; a self-hosted AWS option is deferred.
