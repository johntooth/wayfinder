# Wayfinder on AWS — Environment Blueprint

This tree turns the repo into a **blueprint**: apply the shared core once, then stamp complete
Wayfinder environments on demand — one command each (ADR-034). Environments share expensive
infrastructure (VPC, ECS cluster, one RDS server, the ALB) and own everything
application-visible (database, S3 bucket, secrets, IAM, services, hostname).

```
                        ┌────────────── core (apply once) ──────────────┐
   https://a.example ─► │ ALB ── *.base_domain listener (404 default)   │
   https://b.example ─► │ VPC · NAT · ECS cluster · RDS Postgres · ECR  │
                        └──────┬──────────────────────────┬─────────────┘
                 host rule for │            host rule for │
        ┌── environment "a" ───▼──┐      ┌── environment "b" ─▼─────────┐
        │ web service  · db `w_a` │      │ web service  · db `w_b`      │
        │ bucket · secrets · IAM  │      │ bucket · secrets · IAM       │
        │ (semchunk-a sidecar)    │      │ (no sidecar)                 │
        └─────────────────────────┘      └──────────────────────────────┘
```

Requirements: a domain (`base_domain`) — every environment is `https://<env>.<base_domain>`;
there is deliberately no HTTP/path fallback (ADR-034 Decision 3). Langfuse is not provisioned;
point `LANGFUSE_*` at Langfuse Cloud or your own instance.

## Quick start (three commands)

With the domain's hosted zone in Route53, `aws`/`terraform`/`docker` installed, and AWS
credentials configured:

```bash
./scripts/bootstrap.sh --region eu-west-2 --state-bucket my-tf-state \
  --base-domain wayfinder.example.com --route53-zone-id Z0123456789ABC

./scripts/db-tunnel.sh &                       # SSM tunnel for stamping
./scripts/new-environment.sh dev --via-tunnel  # first environment
```

Bootstrap is idempotent (re-run it after any failure) and does everything in §1–2 below:
state bucket, config files, core apply — **including issuing the wildcard ACM certificate via
the hosted zone** — and building/pushing both images. If DNS lives outside Route53, pass
`--certificate-arn` with a pre-issued `*.<base_domain>` cert instead of `--route53-zone-id`.
Each stamp prints its URL plus the two follow-ups (AI-key secret, pgvector). The sections
below are the manual path and the reference detail.

## 1. One-time bootstrap (manual path)

State bucket (Terraform cannot create its own backend):

```bash
aws s3api create-bucket --bucket <your-terraform-state-bucket> \
  --region <region> --create-bucket-configuration LocationConstraint=<region>
aws s3api put-bucket-versioning --bucket <your-terraform-state-bucket> \
  --versioning-configuration Status=Enabled
cp backend.hcl.example backend.hcl   # fill in bucket + region (gitignored)
```

## 2. Core (apply once per account/region)

```bash
cd core
cp terraform.tfvars.example terraform.tfvars   # region, base_domain, route53_zone_id or certificate_arn
terraform init -backend-config=../backend.hcl
terraform apply
```

Certificate: set `route53_zone_id` and core issues + DNS-validates `*.<base_domain>` itself
(issuance hangs if the zone doesn't actually serve the domain's NS records); or set
`certificate_arn` to bring your own — an explicit ARN always wins. Core also provisions an
SSM bastion for environment stamping (`enable_bastion = true` by default, ≈ $4/mo — see
"Database connectivity" below).

Then build and push the shared images (from the repo root):

```bash
AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
aws ecr get-login-password --region <region> \
  | docker login --username AWS --password-stdin $AWS_ACCOUNT.dkr.ecr.<region>.amazonaws.com

docker build -f Dockerfile.web -t $(terraform -chdir=infra/aws/core output -raw web_ecr_repository_url):latest .
docker push $(terraform -chdir=infra/aws/core output -raw web_ecr_repository_url):latest

docker build -t $(terraform -chdir=infra/aws/core output -raw semchunk_ecr_repository_url):latest services/semchunk
docker push $(terraform -chdir=infra/aws/core output -raw semchunk_ecr_repository_url):latest
```

## 3. Stamp environments (one command each)

```bash
cd environments
cp terraform.tfvars.example terraform.tfvars   # region, state_bucket, optional route53_zone_id
terraform init -backend-config=../backend.hcl

../scripts/new-environment.sh tenant-a
../scripts/new-environment.sh tenant-b --enable-semchunk
../scripts/new-environment.sh tenant-c --plan          # dry run
```

Each stamp creates its own Postgres database on the shared server, S3 bucket, secrets, IAM
roles, ECS service, and `https://<env>.<base_domain>` routing (DNS automated when
`route53_zone_id` is set). `--enable-semchunk` adds that environment's private semantic-chunking
sidecar (ADR-030) and wires `CHUNKER_PROVIDER`/`SEMCHUNK_URL` in the same apply.

Post-stamp, per environment (the script prints these):

1. Populate the AI provider key: `terraform output operator_secrets`, then
   `aws secretsmanager put-secret-value --secret-id <arn> --secret-string "sk-..."`.
2. Enable pgvector once in the environment's database: `CREATE EXTENSION IF NOT EXISTS vector;`
3. Force a fresh deployment so tasks pick the secret up:
   `aws ecs update-service --cluster wayfinder --service <env>-web --force-new-deployment`

App migrations run automatically on container start.

### Database connectivity for stamping

Environment stamps create Postgres roles/databases via the `cyrilgdn/postgresql` provider, so
**the machine running terraform needs a network path to the shared RDS server** at plan/apply
time (ADR-034 Decision 2).

**Default path — the core bastion (zero setup):**

```bash
./scripts/db-tunnel.sh &                            # SSM port-forward, local port 5433
./scripts/new-environment.sh tenant-a --via-tunnel  # provider goes via the tunnel
./scripts/destroy-environment.sh tenant-a --via-tunnel
```

`--via-tunnel` only redirects the terraform provider; the environment's stored `DATABASE_URL`
keeps the real in-VPC host. Needs the AWS Session Manager plugin
(`aws ssm start-session` must work). The bastion is SSM-only — no key pair, no inbound ports,
IMDSv2 — and `enable_bastion = false` in core removes it.

Alternatives if the bastion is disabled: run terraform from inside the VPC (CI runner in a
private subnet), or temporarily add your IP to the database security group (remove it
afterwards). Either way the runner needs its own ingress rule on the core database security
group — stamps only open access for their own web tasks (and the bastion).

### From the GitHub Actions UI

`.github/workflows/provision-environment.yml` exposes plan/apply/destroy per environment via
`workflow_dispatch`. It is inert until you configure the `AWS_REGION` and `TF_STATE_BUCKET`
repository variables and an `AWS_PROVISIONER_ROLE_ARN` OIDC secret — and the runner is subject
to the same database-connectivity requirement above.

## 4. Deploy a new version to an environment

Push a new image tag, then re-apply the stamp pinned to it:

```bash
docker build -f Dockerfile.web -t <web-repo-url>:v1.58.0 . && docker push <web-repo-url>:v1.58.0
../scripts/new-environment.sh tenant-a --web-tag v1.58.0
```

(Re-running with the same tag? `aws ecs update-service ... --force-new-deployment` instead.)

## 5. Destroy an environment

```bash
../scripts/destroy-environment.sh tenant-a
```

Empty the environment's documents bucket first — S3 refuses to delete non-empty buckets. The
environment's database, secrets, IAM user, services, and workspace all go with it. Core is
destroyed with `terraform -chdir=core destroy` only once no environments remain.

## Cost notes

Core is the floor: single NAT gateway ≈ $32/mo + shared RDS `db.t4g.small` ≈ $25/mo + ALB
≈ $17/mo + SSM bastion (t4g.nano) ≈ $4/mo ≈ **$78/month** before any environment
(`enable_bastion = false` shaves the last item). Each environment adds one 1 vCPU/2 GB Fargate
task ≈ $30/mo (+ ≈ $9/mo with the semchunk sidecar at 0.25 vCPU/512 MB) plus cents for
S3/Secrets. Size `db_instance_class` for the number of environments — the shared server is a
deliberate noisy-neighbour trade-off (ADR-034); fully isolated stamping is future work.

## Migrating from the v1.57.0 single-environment layout

The v1.57.0 flat root was replaced wholesale in v1.58.0 and there is **no state migration
path**: `terraform destroy` with the old layout (check out the v1.57.0 tag) before adopting
the blueprint.

## Validation without AWS credentials

```bash
terraform -chdir=core init -backend=false && terraform -chdir=core validate
terraform -chdir=environments init -backend=false && terraform -chdir=environments validate
terraform -chdir=. fmt -check -recursive
```

`validate.sh` check 16 runs these automatically wherever the terraform binary exists.
