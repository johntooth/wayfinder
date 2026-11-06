# `deploy/terraform`: Wayfinder on AWS (ECS Fargate)

Terraform for one Wayfinder deployment on ECS Fargate. It builds what
[`docs/guides/setup-aws.md`](../../docs/guides/setup-aws.md) describes by hand,
and adds an edge in front of it: CloudFront, a WAF, and an internal ALB.

Like `deploy/lambda`, it sits outside the pnpm workspace and `.dockerignore`
already excludes `deploy`, so it doesn't affect the image or the root CI.

```
main.tf               providers (region + us-east-1 for the WAF), modules, ALB ingress from CloudFront
modules/network       own VPC (10.30.0.0/16), 2 AZs, one NAT, security groups, VPC endpoints
modules/logging       ALB and CloudFront access-log buckets
modules/data          RDS PostgreSQL 16; DATABASE_URL secret (write-only password)
modules/storage       documents bucket with access logging, and the storage user's policy
modules/service-user  IAM user + empty key secret (used for storage and Bedrock)
modules/waf           CloudFront web ACL: blocks self sign-up, rate limits sign-in, AWS managed rules
modules/app           ECS cluster, web/api services, migrate task, internal ALB, CloudFront (VPC origin)
scripts/set-access-key.sh  creates a service user's key and writes it to its secret
tests/                offline `terraform test` (mock providers, no AWS account needed)
```

## What is deployed and why

- **Edge.** Users reach the app through CloudFront, at its default `*.cloudfront.net` URL.
  - CloudFront reaches an internal ALB through a VPC origin. The ALB has no public address.
  - The ALB forwards only requests that carry CloudFront's secret origin header. Anything else gets a 403.
- **Sign-up.** Self sign-up is blocked at the WAF: `/register` and `/api/auth/sign-up/*`.
  - Accounts are made by an admin in **Admin → Users**, followed by **Reset password**.
  - That path and the first-run `/setup` don't use the sign-up endpoint, so they still work.
- **Sign-in rate limit.** Better Auth rate-limits sign-in per client address. Behind CloudFront and the ALB, `X-Forwarded-For` holds several addresses and Better Auth trusts none of them, so every caller would share one bucket.
  - A CloudFront viewer-request function writes the viewer's address to `x-wayfinder-client-ip`, replacing anything the viewer sent.
  - `web` gets `TRUSTED_CLIENT_IP_HEADER=x-wayfinder-client-ip`, so Better Auth reads the address from there.
  - The WAF rate-limits sign-in per viewer address as well.
- **Processes.** `web` serves users. `api` takes no inbound traffic, and reaches `web` at `http://web:3000` over Service Connect for the scheduler heartbeat.
- **Migrations.** `migrate` is its own task (ADR-047). The apply runs it (`terraform_data.migrate`, with the AWS CLI on the applying machine) whenever its task definition changes, before `web` and `api` roll out, and stops if it fails. `run_migrations = false` turns this off; the offline tests do.
- **Static keys for S3 and Bedrock.** Wayfinder's storage adapter and Bedrock provider sign with a static key pair, not the task role.
  - Each has its own IAM user, limited to the documents bucket or to Anthropic models.
  - The keys go straight from IAM to Secrets Manager (`scripts/set-access-key.sh`), never through Terraform state.
- **Generated secrets.** `BETTER_AUTH_SECRET`, `SETTINGS_ENCRYPTION_KEY` and `SCHEDULER_TICK_SECRET` are generated as ephemeral values and written with write-only arguments, so they aren't in state either.
  - Back up `SETTINGS_ENCRYPTION_KEY` from Secrets Manager. Losing it makes stored integration credentials unreadable.
- **Embeddings.** Remote model downloads are off (`EMBEDDINGS_ALLOW_REMOTE_MODELS=false`), so the image must be built with the model vendored in.

## Deploy

0. **Image.** Build from the commit you want and push it to an ECR repository. Set the repository to immutable tags.

   ```bash
   docker build --build-arg VENDOR_EMBEDDINGS_MODEL=true -t wayfinder:<sha> .
   ```

   Put the digest that `aws ecr describe-images` reports into `terraform.tfvars`, starting from `terraform.tfvars.example`. The stack accepts only a digest-pinned image.
1. **Apply.** Copy `backend.tf.example` to `backend.tf` (git-ignored) and fill it in. Then plan to a file and apply the saved plan.

   ```bash
   terraform init
   terraform plan -out=wayfinder.tfplan
   terraform apply wayfinder.tfplan
   ```

   The apply runs the migrations before starting the services. The services fail until step 2 is done; the deployment circuit breaker stops them retrying forever.
2. **Access keys.** Write the two keys to their secrets:

   ```bash
   scripts/set-access-key.sh storage
   scripts/set-access-key.sh bedrock
   ```

   Enable access to the chosen Anthropic model in the Bedrock console.
3. **Start the services.** Once the keys are in, run `aws ecs update-service --force-new-deployment` for `web`, then for `api`. (Migrations already ran in step 1; to rerun them by hand, `aws ecs run-task` the `migrate_task` from `terraform output ecs` in its subnets and security group.)
4. **First login.** Open the `/setup?token=…` link from the `web` log stream and create the admin. Only `admin_seed_email` can do this.

## Checks

From this folder, with no AWS credentials needed:

```bash
terraform fmt -check -recursive
terraform init -backend=false
terraform validate
terraform test
```
