# Phase — AWS Terraform Deployment (ECS Fargate)

- **Status**: Implemented
- **Date**: 2026-11-06
- **Target version**: 0.42.0 — **MINOR** (new deployment capability, no schema impact)
- **Base branch**: `main` (new feature — see **Release Branching** in [`CLAUDE.md`](../../../../../CLAUDE.md))
- **Decision record**: [ADR-067](../../../adr/067-terraform-for-the-container-topology.adr.md) — Terraform for the container topology on AWS
- **Relates to**: ADR-046 (container image), ADR-047 (migrations as a command),
  ADR-056 (the Lambda topology and its CDK stack), [`setup-aws.md`](../../../../guides/setup-aws.md)

## 1. Goal

Give operators who run Terraform a reviewed, testable way to deploy the
container image to AWS, matching the ECS Fargate deployment `setup-aws.md`
describes by hand, with a hardened edge in front of it.

## 2. Change summary

### Business rules changing

- When `TRUSTED_CLIENT_IP_HEADER` is set, Better Auth takes the client address
  for sign-in rate limiting from that header only. When it is unset, behaviour
  is unchanged.
- In a `deploy/terraform` deployment, requests to `/register` and
  `/api/auth/sign-up/*` are refused at the WAF, so accounts come only from an
  admin or first-run `/setup`.
- In a `deploy/terraform` deployment, a new image never starts until its
  migrations have run and exited 0.

### UI / visible behaviour

- No UI change. In a Terraform deployment, `/register` returns the WAF's 403.

### Database & migration impact

- None. No tables, no migration.

### Risks

- A deployment that sets `TRUSTED_CLIENT_IP_HEADER` without a proxy that
  overwrites the header lets callers pick their own rate-limit bucket. It's
  env-only, has no default, and the guide says when to set it.
- The migrate step runs the AWS CLI on the machine applying, so that machine
  needs the CLI and `ecs:RunTask` permission. `run_migrations = false` turns it off.

### Out of scope

- A custom domain and ACM certificate: the stack serves at the CloudFront
  default domain.
- Moving S3 and Bedrock from static keys to the task role. The storage adapter
  and the Bedrock provider sign with static keys today.
- Running `terraform test` in root CI.
- Porting either IaC stack to the other tool (ADR-067 §2).

## 3. What is built

| Area | Change |
|---|---|
| `deploy/terraform/` | Root module and seven modules: network, logging, data, storage, service-user, waf, app. Offline `terraform test` with mock providers. |
| `packages/adapters` `auth/better-auth.ts` | `trustedClientIpHeader` option → `advanced.ipAddress.ipAddressHeaders`, only when set. |
| `apps/web` `lib/env.ts`, `lib/container.ts`, `lib/container-auth.ts` | `TRUSTED_CLIENT_IP_HEADER` read, validated as a header name, and passed through. |
| `docs/guides/setup-aws.md`, `.env.example` | The new variable, when to set it, and a pointer to `deploy/terraform`. |

## 4. Implementation order (tests first)

1. `createAuth` client-address tests, then the option.
2. Env schema and container wiring.
3. Terraform modules, with `tests/wayfinder.tftest.hcl` covering image pinning,
   task shape, secrets kept out of plain environment, the edge, the WAF, data at
   rest, IAM policies and the client-address header.
4. Guide and `.env.example`.

## 5. Build details

- **Architecture**: complies with ADR-001. The option lives in the auth adapter;
  the app only reads env and wires it.
- **Unit tests**: 1 file amended (`better-auth.test.ts`, 2 tests), written before
  the option.
- **E2E**: none. Rate-limit address resolution is adapter configuration, covered
  at the adapter layer; nothing falls in an `e2e-test-policy.md` group.
- **Terraform tests**: 8 `run` blocks, offline.
- **Version**: MINOR → 0.42.0, branch `feature/aws-terraform/claude-johntooth`, base and PR target `main`.
