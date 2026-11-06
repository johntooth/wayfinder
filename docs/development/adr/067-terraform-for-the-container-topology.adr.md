# ADR-067 — Terraform for the Container Topology on AWS

- **Status**: Proposed (scoped by `aws-terraform-deployment.phase.md`)
- **Date**: 2026-11-06
- **Builds on**: ADR-046 (the container image is the distribution unit),
  ADR-047 (migrations as an explicit command), ADR-056 (Lambda is a second
  deployment topology — the CDK stack this ADR sits beside)

## Context

[`setup-aws.md`](../../guides/setup-aws.md) deploys the container image to ECS
Fargate by hand: RDS, S3, Secrets Manager, two services and an ALB, assembled
step by step. It is the tested reference deployment on AWS, and it has no code
behind it. Every operator rebuilds it, and the guide can drift from what anyone
actually runs.

`deploy/lambda` is the only infrastructure code in the repo, and it is CDK in
TypeScript. Many public-sector AWS estates standardise on Terraform instead:
state in S3, plans reviewed before apply, `terraform test` in CI. An operator in
one of those estates can't adopt a CDK app without bringing in a second
toolchain they don't otherwise run.

Two gaps also showed up when the guide's deployment was put behind CloudFront:

- **Rate limiting.** Better Auth rate-limits sign-in per client address. It reads
  `X-Forwarded-For`, and it trusts that header only when it holds one address.
  Behind CloudFront and an ALB it holds two, so Better Auth falls back to one
  shared bucket for every caller. One noisy client then rate-limits everyone.
- **Migrations.** The guide runs `migrate` by hand before starting the services.
  Infrastructure code can make that ordering enforced rather than remembered.

## Decision

### 1. `deploy/terraform` codifies the container topology. It doesn't add one.

It deploys the same image, the same three commands (`web`, `api`, `migrate`) and
the same services `setup-aws.md` describes. It doesn't change what the image is
or how it is built. The guide stays the explanation; Terraform is one way to
apply it.

Like `deploy/lambda`, it sits outside the pnpm workspace and `.dockerignore`
already excludes `deploy`, so neither the image nor the root CI changes.

### 2. CDK stays for Lambda. Terraform is for the container path only.

Two IaC tools is a cost, so the split is by topology, not by preference: CDK for
the Lambda target (ADR-056), Terraform for the container target. Neither is
ported to the other. If the project later wants one tool, that's a separate
decision; this ADR doesn't pre-empt it.

### 3. The edge is CloudFront, a WAF and an internal ALB.

- The ALB is internal. CloudFront reaches it through a VPC origin, and the ALB
  forwards only requests carrying a secret origin header.
- The WAF blocks self sign-up (`/register`, `/api/auth/sign-up/*`), rate-limits
  sign-in per viewer address, and applies the AWS common and known-bad-inputs
  rule sets. Admin-created accounts and first-run `/setup` don't use the sign-up
  endpoint, so they still work.

### 4. A proxy-written client address is trusted only when the deployment says so.

`TRUSTED_CLIENT_IP_HEADER` names a header that the proxy in front of `web`
overwrites with the client's address. When it's set, Better Auth reads the
address from that header alone, with no fallback to `X-Forwarded-For`. When it's
unset, nothing changes.

It's env-only and has no default, because a header that no proxy overwrites is
whatever the caller sends. Trusting one would give every caller their own
rate-limit bucket. Only the deployment knows whether its proxy overwrites the
header. In `deploy/terraform`, a CloudFront viewer-request function writes
`x-wayfinder-client-ip` from `event.viewer.ip`.

### 5. Migrations gate the rollout.

The apply runs the `migrate` task whenever its task definition changes, waits
for it to stop, and fails if it exits non-zero. `web` and `api` depend on it, so
a new image never starts against an unmigrated schema. This keeps ADR-047's
"migrations are their own command". Terraform only orders that command.

### 6. No secret passes through Terraform state.

- Generated secrets (`BETTER_AUTH_SECRET`, `SETTINGS_ENCRYPTION_KEY`,
  `SCHEDULER_TICK_SECRET`) are ephemeral values written with write-only
  arguments.
- The S3 and Bedrock access keys go from IAM straight to Secrets Manager by a
  script, because the storage adapter and Bedrock provider sign with static keys
  rather than the task role.
- The RDS master password is write-only.

## Consequences

- Operators on Terraform get a reviewed, testable deployment. `terraform test`
  runs offline with mock providers, so CI could run it with no AWS account.
- The repo carries a second IaC toolchain, scoped to `deploy/terraform`.
- Changes to the container contract (a new required variable, a new command)
  now have a second place to land: `setup-aws.md` and `deploy/terraform` both.
- `TRUSTED_CLIENT_IP_HEADER` is available to any deployment behind a proxy that
  overwrites a header, not only this one.

## Alternatives considered

- **CDK for the container path too.** One toolchain, but it doesn't serve the
  operators this is for, who already run Terraform.
- **Better Auth `trustedProxies` with `X-Forwarded-For`.** It would mean listing
  CloudFront's published address ranges and keeping them current. A header
  CloudFront writes itself is simpler and can't go stale.
- **Trusting `CloudFront-Viewer-Address`.** CloudFront can add it through an
  origin request policy, but its value is `address:port`, which Better Auth
  doesn't accept as an address. A header the function writes carries only the
  address.
