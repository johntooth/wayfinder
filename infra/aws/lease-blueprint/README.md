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

## Code changes Wayfinder still needs for true zero-config

The blueprint is ready, but three things in the app repo make it *actually*
turnkey. None is large:

1. **Read the Bedrock model from env.** `packages/adapters/src/ai/providers.ts`
   hardcodes the bedrock default (`anthropic.claude-sonnet-4-5-…`, a raw
   foundation-model id that isn't even on-demand invokable). The blueprint sets
   `WAYFINDER_BEDROCK_MODEL` in `.env.lease`; wire the runtime config to honour
   it and default it to an `apac.` inference-profile id.
2. **Pass ambient creds through.** Confirm `apps/*/lib/container.ts` sends
   `aiKeys.bedrock` as **undefined** when `AWS_BEDROCK_ACCESS_KEY_ID` is empty
   (not `{region, accessKeyId:"", …}`). `factory.ts` already coerces absent →
   `null`, and `providers.ts` already does `createAmazonBedrock({})` → IMDS role.
   Empty strings would break that chain.
3. **Next.js base path under the proxy.** The app is reached at
   `…/proxy/3000/`. Set Next.js `basePath`/`assetPrefix` (e.g. from an env var)
   so assets resolve under the sub-path — otherwise the SPA loads blank. For a
   quick demo you can instead SSH-tunnel the port; for the hosted-in-lease
   experience, basePath is the fix.

## Follow-up (not needed for a demo lease)

- **Persistent documents in real S3.** This bundle keeps documents in
  in-container MinIO (dies with the lease — fine for dev/demo). To use a real S3
  bucket with role auth, swap the storage adapter from the MinIO client to
  `@aws-sdk/client-s3` (picks up the notebook role automatically) and add an
  `AWS::S3::Bucket` + `s3:*Object` statements to `NotebookRole`.
