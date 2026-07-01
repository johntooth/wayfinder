# Wayfinder on AWS (Terraform)

Deploys Wayfinder to ECS Fargate per ADR-033: an ALB in front of the web
service, RDS PostgreSQL 16 (pgvector), an S3 documents bucket, secrets in AWS
Secrets Manager, and — behind the `enable_semchunk` flag — the semantic
chunking sidecar (ADR-030).

```
ALB (public subnets) ──► web service (private subnets, ECS Fargate)
                            │            │            │
                            ▼            ▼            ▼
                     RDS Postgres     S3 bucket   semchunk sidecar
                     (pgvector)                   (optional, Service Connect
                                                   http://semchunk:8000)
```

Langfuse is not provisioned — point `LANGFUSE_*` at Langfuse Cloud or your own
instance if you want observability.

## 1. One-time bootstrap

Terraform state needs a bucket that this configuration cannot create for itself:

```bash
aws s3api create-bucket --bucket <your-terraform-state-bucket> \
  --region <region> --create-bucket-configuration LocationConstraint=<region>
aws s3api put-bucket-versioning --bucket <your-terraform-state-bucket> \
  --versioning-configuration Status=Enabled
```

Then uncomment the `backend "s3"` block in `versions.tf` and fill it in.

## 2. First apply

```bash
cp terraform.tfvars.example terraform.tfvars   # edit as needed
terraform init
terraform apply
```

The first apply creates the ECR repositories but the services cannot start
until images exist, so expect the web service to flap until step 3 completes.

## 3. Build and push images

```bash
AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REGION=<region>
aws ecr get-login-password --region $REGION \
  | docker login --username AWS --password-stdin $AWS_ACCOUNT.dkr.ecr.$REGION.amazonaws.com

# Web app (from the repo root — production build, AUTH_BYPASS hard-disabled)
docker build -f Dockerfile.web -t $(terraform output -raw web_ecr_repository_url):latest .
docker push $(terraform output -raw web_ecr_repository_url):latest

# Semchunk sidecar (only when enable_semchunk = true)
docker build -t $(terraform output -raw semchunk_ecr_repository_url):latest services/semchunk
docker push $(terraform output -raw semchunk_ecr_repository_url):latest
```

## 4. Populate operator secrets

Most secrets are generated and wired automatically (database URL, auth secret,
S3 credentials). The AI provider key is seeded with `REPLACE_ME` and must be
set by hand — `terraform output operator_secrets` lists the ARN:

```bash
aws secretsmanager put-secret-value \
  --secret-id <ai_provider_api_key arn> --secret-string "sk-..."
```

Then force a fresh deployment so tasks pick it up:

```bash
aws ecs update-service --cluster wayfinder --service web --force-new-deployment
```

## 5. Enable pgvector

RDS supports the `vector` extension but Terraform cannot run SQL. Once, from
anywhere that can reach the database (e.g. an ECS exec shell):

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Migrations run automatically on web-container start (`migrate-if-configured.sh`).

## Enabling the semchunk sidecar

Set `enable_semchunk = true` in `terraform.tfvars`, push the sidecar image
(step 3), and `terraform apply`. The same apply deploys the service, registers
it as `http://semchunk:8000` via Service Connect, restricts its ingress to the
web service's security group, and sets `CHUNKER_PROVIDER=semchunk` +
`SEMCHUNK_URL` on the web task — infra and app config cannot drift apart.
Setting it back to `false` removes all of it.

The sidecar only affects **newly indexed documents**; existing chunks are
untouched (ADR-030 Decision 2 — the corpus re-chunk migration is a separate,
deferred phase). If the sidecar is down, indexing falls back to the in-process
fixed-window chunker and logs the degradation.

## Cost notes

The always-on floor (single NAT gateway ≈ $32/mo + RDS `db.t4g.small`
≈ $25/mo + one 1 vCPU/2 GB Fargate task ≈ $30/mo + ALB ≈ $17/mo) is roughly
**$105/month** in eu-west-2 before traffic. Dev knobs: `db.t4g.micro`,
`db_skip_final_snapshot = true`, keep `enable_semchunk = false` (the sidecar
adds ≈ $9/mo at 0.25 vCPU/512 MB). The NAT gateway is single-AZ by design —
duplicate it per AZ if that is not acceptable.

## Teardown

```bash
terraform destroy
```

With `db_skip_final_snapshot = false` (the default) destroy takes a final RDS
snapshot. The documents bucket must be emptied first — S3 refuses to delete
non-empty buckets.

## Validation without AWS credentials

```bash
terraform init -backend=false
terraform validate
terraform plan   # requires credentials
```
