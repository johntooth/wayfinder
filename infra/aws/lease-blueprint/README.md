# Wayfinder — Sandbox-Lease Blueprint

IaC an admin drops into the **GovAI Innovation Sandbox** so that from the moment
a user clicks **request lease**, a working Wayfinder dev/demo instance exists in
the leased account with **no material configuration** — no API keys, no domain,
no manual steps.

This is a deliberately different animal from `infra/aws/` (the always-on
VPC/ECS/RDS/ALB blueprint for permanent hosting). A lease is ephemeral,
cost-capped, guardrailed, and has no domain — so this blueprint collapses the
whole stack onto **one SageMaker notebook running docker-compose**, and gets its
AI from **Amazon Bedrock via the notebook's execution role** (the trick that
deletes the `sk-...` secret — the only material config Wayfinder otherwise has).

```
request lease ─► account enters Active OU ─► StackSet auto-deploys this template
                                              │
                                              ▼
                         SageMaker notebook (non-VPC, docker)
                         ├─ postgres (pgvector)     ┐ all in-container,
                         ├─ minio (object store)    │ host-networked,
                         ├─ wayfinder web  :3000     │ zero external deps
                         └─ wayfinder api  :3001     ┘ except…
                                              │
                                              ▼  IMDS → execution role
                                    Amazon Bedrock  (no key)
```

## Files

| File | What it is |
|---|---|
| `wayfinder-lease-blueprint.yaml` | CloudFormation: notebook + execution role + lifecycle bootstrap |
| `docker-compose.lease.yml` | The single-host runtime bundle the notebook brings up |

## Why SageMaker notebook, not ECS/Fargate

The only compute we have **evidence** the lease guardrail permits is SageMaker —
the `advanced-rag-workshop` blueprint proves SageMaker + Bedrock + IAM are
allowed. This account's un-leased pool state denies EC2/ECS/RDS/S3/ELB outright,
so betting the app host on Fargate is unsafe until the active-lease allow-list is
confirmed. A non-VPC notebook instance:

- runs a normal Docker daemon → the existing compose bundle "just works",
- needs **no `ec2:*`** from the lease principal (SageMaker manages the instance),
- reaches Bedrock through the instance role via IMDS (host networking keeps
  containers at metadata hop-limit 1).

If the guardrail turns out to allow Fargate, a lighter host is possible later;
this is the constraint-safe baseline.

## Deploying it so it fires "on lease"

Register the template as an **account baseline** in Innovation Sandbox:

1. Create a **service-managed CloudFormation StackSet** from
   `wayfinder-lease-blueprint.yaml` in the org management (or delegated admin)
   account.
2. Set its deployment target to the **Active / leased OU** with **automatic
   deployment enabled**. When Innovation Sandbox moves a freshly-leased account
   into that OU, the StackSet instantiates the stack automatically — that is the
   "runs when they click request lease" hook.
3. First boot takes a few minutes (clone → `docker build` → `compose up`, all
   backgrounded); watch `SageMaker/wayfinder-bootstrap.log` on the notebook.

(If your Innovation Sandbox edition uses Service Catalog blueprints instead of
StackSets, publish the same template as a product in the portfolio shared to the
Active OU — the template is mechanism-agnostic.)

## Confirm before you rely on it

These couldn't be verified from the un-leased pool account (it denies everything
but SSM). Check them against the **active-lease guardrail SCP**:

- [ ] `sagemaker:CreateNotebookInstance` + `...LifecycleConfig` allowed, and the
      chosen `NotebookInstanceType` isn't blocked by a cost guardrail.
- [ ] `bedrock:InvokeModel` allowed for `BedrockModelId`, **and that model's
      access is already enabled** in leased accounts. CloudFormation cannot
      enable Bedrock model access — the account baseline must (the RAG workshop
      enables Titan Embed + Claude Haiku, so `apac.anthropic.claude-3-5-haiku…`
      is the safe default; Sonnet/Opus only if the baseline enables them).
- [ ] Outbound internet from a non-VPC notebook is permitted (git + image pulls).

## App-side support (landed alongside this blueprint)

The three changes that make the app actually turnkey under a lease are now in
the repo:

1. **Bedrock model from env.** `WAYFINDER_BEDROCK_MODEL` (honoured only when
   `AI_DEFAULT_PROVIDER=bedrock`) pins the model for every AI purpose, overriding
   the built-in defaults. The blueprint sets it in `.env.lease` — default an
   `apac.` inference-profile id, since modern Claude on Bedrock isn't invokable
   as a raw foundation-model id.
2. **Ambient credentials.** `apps/*/lib/container.ts` already resolves the
   Bedrock creds to `null` when the static keys are absent, and
   `providers.ts` does `createAmazonBedrock({})` → the AWS default credential
   chain → the notebook execution role via IMDS. So empty keys in `.env.lease`
   = auth by role, no key. (Region resolves from `AWS_REGION`.)
3. **Next.js base path.** `WAYFINDER_BASE_PATH` sets Next.js `basePath` so assets
   resolve under a proxy sub-path. The blueprint sets it to `/proxy/absolute/3000`
   and hands out the matching `/proxy/absolute/3000/` URL. (The *absolute* proxy
   form preserves the prefix; the plain `/proxy/3000/` form strips it and the SPA
   loads blank. To skip the proxy entirely, SSH-tunnel the port and leave
   `WAYFINDER_BASE_PATH` unset.)

## Follow-up (not needed for a demo lease)

- **Persistent documents in real S3.** This bundle keeps documents in
  in-container MinIO (dies with the lease — fine for dev/demo). To use a real S3
  bucket with role auth, swap the storage adapter from the MinIO client to
  `@aws-sdk/client-s3` (picks up the notebook role automatically) and add an
  `AWS::S3::Bucket` + `s3:*Object` statements to `NotebookRole`.
