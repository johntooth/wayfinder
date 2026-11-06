# Implementation Summary — AWS Terraform Deployment (ECS Fargate)

- **Version**: 0.42.0 — **MINOR** (new deployment capability, no schema impact)
- **Date**: 2026-11-06
- **Phase doc**: [`aws-terraform-deployment.phase.md`](./aws-terraform-deployment.phase.md)
- **Decision record**: ADR-067 — Terraform for the container topology on AWS

## What was built

`deploy/terraform` deploys the container image to ECS Fargate in its own VPC:
RDS PostgreSQL 16, an S3 documents bucket, `web` and `api` services, and a
`migrate` task. It sits behind CloudFront, a WAF and an internal ALB. It is the
deployment `setup-aws.md` describes by hand, written as code and tested offline.

One app change came with it. Behind CloudFront and the ALB, Better Auth couldn't
trust any client address, so every caller shared one sign-in rate-limit bucket.
`TRUSTED_CLIENT_IP_HEADER` lets a deployment name a header its proxy overwrites,
and the stack sets it to the one its CloudFront function writes.

## Files created

| File | Purpose |
|---|---|
| `deploy/terraform/{main,variables,outputs,versions}.tf` | Root module: providers (region and us-east-1 for the WAF), modules, ALB ingress from CloudFront's VPC-origin security group |
| `deploy/terraform/modules/network/` | VPC, two AZs, one NAT, security groups, interface endpoints (Secrets Manager, Logs, ECR) and an S3 gateway endpoint |
| `deploy/terraform/modules/logging/` | ALB and CloudFront access-log buckets, TLS-only |
| `deploy/terraform/modules/data/` | RDS PostgreSQL 16, encrypted; `DATABASE_URL` secret written write-only |
| `deploy/terraform/modules/storage/` | Documents bucket with access logging, versioning and the storage user's policy |
| `deploy/terraform/modules/service-user/` | IAM user plus an empty key secret (storage, Bedrock) |
| `deploy/terraform/modules/waf/` | CloudFront web ACL: self sign-up blocked, sign-in rate-limited, AWS managed rules |
| `deploy/terraform/modules/app/` | ECS cluster, task definitions, services, migrate step, internal ALB, CloudFront with VPC origin and the client-address function |
| `deploy/terraform/scripts/set-access-key.sh` | Creates a service user's key and pipes it into its secret, never through state |
| `deploy/terraform/tests/wayfinder.tftest.hcl` | 8 offline `run` blocks with mock providers |
| `deploy/terraform/README.md`, `backend.tf.example`, `terraform.tfvars.example`, `.gitignore`, `.terraform.lock.hcl` | Deploy order, checks, examples |
| `docs/development/adr/067-terraform-for-the-container-topology.adr.md` | Why Terraform beside CDK, the edge, the trusted-header rule, the migrate gate |

## Files modified

- `packages/adapters/src/auth/better-auth.ts`: `trustedClientIpHeader` option.
- `packages/adapters/src/auth/__tests__/better-auth.test.ts`: 2 tests.
- `apps/web/src/lib/env.ts`: `TRUSTED_CLIENT_IP_HEADER`, validated as a header name and lowercased.
- `apps/web/src/lib/container.ts`, `apps/web/src/lib/container-auth.ts`: pass it to `createAuth`.
- `docs/guides/setup-aws.md`: the variable in §6, when to set it in §8, Terraform under Alternatives.
- `.env.example`: the variable, blank.
- `VERSION`, `package.json`: 0.42.0.

## Migrations

None.

## Tests

- `better-auth.test.ts`: without the option, Better Auth's own address
  resolution is untouched; with it, only the named header is read.
- `terraform test`: 8 passed, 0 failed. `terraform validate` and
  `terraform fmt -check` are clean.
- E2E: none. The behaviour is adapter configuration and infrastructure, and
  falls in no `e2e-test-policy.md` group.

## Known limitations

- Verified offline only. The tests use mock providers, so they prove the plan's
  shape, not that AWS accepts it.
- Serves at the CloudFront default domain; no custom domain or certificate.
- S3 and Bedrock use static keys held in Secrets Manager, because the adapters
  sign with static keys rather than the task role.
- The migrate step needs the AWS CLI where Terraform runs.
- Embeddings: remote model downloads are off, so the image must be built with
  `VENDOR_EMBEDDINGS_MODEL=true`.

## Deviations

None from the phase doc.
