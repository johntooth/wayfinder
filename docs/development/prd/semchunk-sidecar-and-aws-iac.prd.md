# PRD — Semchunk Sidecar (Opt-In) & AWS Infrastructure-as-Code

- **Status**: Draft
- **Date**: 2026-07-01
- **Author**: Claude (from fork owner request)
- **Target version**: 1.57.0 (bump: MINOR — new feature, new deployable service, no schema change)

> **Assumptions recorded up-front** (chosen defaults; flag during doc review if wrong):
> Terraform for IaC · ECS Fargate as the compute target · sidecar is **opt-in via env var**
> and applies to **newly indexed documents only** — the corpus-wide re-chunk/re-embed
> migration remains deferred (ADR-030 Decision 2).

## 1. Problem

Chunking today cuts extracted text into fixed ~500-token windows, so retrieval can surface
half an argument and SMEs curating chunks see arbitrary spans instead of complete thoughts
("Frankenstein chunks", per the curation PRD). ADR-030 already chose `semchunk` behind a
sidecar as the target fix but deferred it. Separately, Wayfinder has no infrastructure-as-code:
the only deployment story is local docker-compose, so standing up a real AWS environment is
manual, unrepeatable, and undocumented.

## 2. Users / Personas

- **SME / knowledge curator** — wants chunks that read as complete thoughts, so curation
  and "View in Source" are meaningful.
- **End user (procurement officer, HR manager, ops lead)** — gets better answers because
  retrieval returns whole ideas, not window fragments.
- **Operator / DevOps engineer** — needs a repeatable, reviewable way to deploy Wayfinder
  (with or without the sidecar) to AWS.

## 3. Goals

- An operator can enable semantic chunking by setting env vars (`CHUNKER_PROVIDER=semchunk`,
  `SEMCHUNK_URL`) and starting the sidecar — no code change, no schema change.
- With the sidecar enabled, newly uploaded / re-indexed documents are chunked by `semchunk`;
  with it disabled or unreachable, indexing works exactly as today (fixed-window fallback).
- A sidecar failure never fails indexing — the adapter degrades to the fallback chunker and
  the degradation is observable in logs.
- `terraform apply` on a fresh AWS account (given bootstrap prerequisites) produces a working
  Wayfinder deployment: web app behind an ALB, RDS Postgres with pgvector, S3 document
  storage, secrets in AWS Secrets Manager.
- Flipping one Terraform variable (`enable_semchunk`) deploys/destroys the sidecar service
  and wires the web service's env vars accordingly.
- Local dev parity: `docker compose --profile semchunk up` runs the sidecar locally.

## 4. Non-goals

- **Re-chunking the existing corpus.** Boundary changes invalidate existing
  `kb_document_chunks` rows and interact with curated status/tags/versions — that migration
  is ADR-030 Decision 2 and stays deferred to its own phase.
- No admin-UI toggle for the chunker (env-var only this phase).
- No Kubernetes/EKS, no multi-region, no autoscaling policies beyond sensible service counts.
- No Langfuse hosting on AWS (operators point `LANGFUSE_*` at Langfuse Cloud or a self-hosted
  instance; noted as future work).
- No CI/CD pipeline for infra (plan/apply is run by the operator; pipeline is future work).

## 5. Key entities

No new domain entities. New port + adapters only:

| Item | Lives in | New / existing | Notes |
| ---- | -------- | -------------- | ----- |
| `IChunker` port | `packages/domain/src/ports/chunker.ts` | new | `chunk(text, options): Promise<Result<string[]>>` per ADR-030 |
| `FixedWindowChunker` | `packages/adapters/src/extraction/fixed-window-chunker.ts` | new (wraps existing `chunkText`) | fallback implementation |
| `SemchunkChunker` | `packages/adapters/src/extraction/semchunk-chunker.ts` | new | HTTP client for the sidecar; failures → `DomainError` |
| `FallbackChunker` | `packages/adapters/src/extraction/fallback-chunker.ts` | new | tries primary, falls back on error; logs degradation |
| Semchunk sidecar | `services/semchunk/` | new | Python FastAPI + `semchunk`; `POST /chunk`, `GET /healthz` |
| AWS IaC | `infra/aws/` | new | Terraform root module + submodules |

## 6. User stories

1. As an operator, I can enable semantic chunking with env vars and a sidecar container, so
   that new documents are chunked into complete thoughts without redeploying app code.
2. As an operator, I can leave the sidecar off entirely and Wayfinder behaves exactly as
   before, so that adopting semchunk is zero-risk.
3. As an SME, when the sidecar is enabled, chunks I curate for newly indexed documents read
   as complete thoughts, so that "View in Source" anchors a full idea.
4. As a DevOps engineer, I can review and apply Terraform to stand up Wayfinder on AWS, so
   that environments are reproducible and changes are code-reviewed.
5. As a DevOps engineer, I can set `enable_semchunk = true` in my tfvars and get the sidecar
   deployed and wired to the web service, so that infra and app config stay in sync.

## 7. Pages / surfaces affected

- No UI pages change.
- Indexing call sites are unchanged in behaviour signature — `DocumentIndexingService` gains
  an injected `IChunker` (wired in `apps/web/src/lib/container.ts`).
- New service surface: `services/semchunk` HTTP API (`POST /chunk`, `GET /healthz`) —
  internal-only, never exposed on the ALB.
- `docker-compose.yml` — new optional `semchunk` service under a compose profile.
- `.env.example` — `CHUNKER_PROVIDER`, `SEMCHUNK_URL`, `SEMCHUNK_TIMEOUT_MS`.
- `infra/aws/**` — new Terraform tree.

## 8. Database changes

None. Chunks produced by either chunker are stored identically in `kb_document_chunks`.

## 9. Architectural decisions

- **ADR-030** (existing, amended this phase) — semchunk sidecar behind an `IChunker` port with
  fixed-window fallback. This phase executes its opt-in path; the corpus migration
  (Decision 2) remains deferred, so ADR-030 moves to **Accepted (opt-in scope)**.
- **ADR-033** (new) — AWS infrastructure via Terraform on ECS Fargate: tool choice, compute
  choice, state management, secrets handling, and how the optional sidecar is modelled.

## 10. Acceptance criteria

- [ ] `IChunker` port exists in domain with Result-pattern signature; domain stays dependency-free.
- [ ] `FixedWindowChunker` produces byte-identical output to today's `chunkText` for the same
      inputs (regression test reuses existing `text-chunker.test.ts` cases).
- [ ] `SemchunkChunker` POSTs to the sidecar and returns its chunks; timeout, non-2xx, and
      malformed responses map to `DomainError` (never throws).
- [ ] `FallbackChunker` returns primary result on success, fallback result on primary error,
      and surfaces an error only if both fail.
- [ ] With `CHUNKER_PROVIDER` unset or `fixed`, container wiring injects the fixed-window
      chunker and no network call is attempted.
- [ ] Template placeholder stripping (`{{...}}`) still happens before chunking for
      `sourceType === "template"` regardless of chunker.
- [ ] Sidecar: `POST /chunk` with `{text, max_tokens?, overlap_tokens?}` returns
      `{chunks: string[]}`; empty/whitespace text returns `{chunks: []}`; `GET /healthz`
      returns 200. Covered by Python tests run in the sidecar image build.
- [ ] `docker compose --profile semchunk up` starts the sidecar with a healthcheck; the
      default profile is unaffected.
- [ ] `terraform validate` and `terraform plan` succeed against the example tfvars for both
      `enable_semchunk = false` and `true`.
- [ ] With `enable_semchunk = true`, the plan shows the sidecar ECS service, service-connect
      wiring, and `CHUNKER_PROVIDER`/`SEMCHUNK_URL` env vars on the web task definition;
      with `false`, none of these resources exist.
- [ ] Sidecar is only reachable inside the VPC (security groups; no ALB listener to it).
- [ ] `infra/aws/README.md` documents bootstrap (state bucket, ECR image push), apply,
      teardown, and secrets population.
- [ ] `./validate.sh` passes; `VERSION` and root `package.json` bumped to 1.57.0 together.

## 11. Out of scope / future work

- Corpus-wide re-chunk + re-embed migration and curated-state carry-forward (ADR-030
  Decision 2) — its own phase.
- Admin-UI runtime toggle for the chunker (would add an `admin_` settings row).
- CI/CD pipeline for Terraform (plan on PR, apply on merge).
- Langfuse on AWS; production hardening (WAF, multi-region, DR).
- Baking the sidecar image into air-gapped builds (ADR-030 notes it; document only).

## 12. Risks / open questions

- **`semchunk` API drift** — exact Python API (`chunkerify`, overlap support) must be
  verified against the installed version at build time, not from memory (code rule).
- **Chunk size semantics differ** — semchunk counts real tokens (tokeniser-based) while the
  fallback approximates 4 chars/token; both target ~500 tokens but boundaries differ. Fine
  for storage/embedding, but mixed corpora (old fixed-window + new semantic chunks) will
  coexist until the deferred migration — acceptable and explicitly chosen.
- **Production Dockerfile** — the existing root `Dockerfile` is dev-only (`next dev`,
  AUTH_BYPASS active). The AWS deployment needs a production multi-stage image; this phase
  includes it (see phase doc) and it must hard-disable dev bypasses (`NODE_ENV=production`).
- **Cost** — NAT gateway + RDS + Fargate has a real monthly floor; the README must state an
  estimate and the cheap-dev knobs (single NAT, small instance classes).
- **Terraform state bootstrap** — state bucket/lock table cannot be created by the module
  that uses them; documented as a one-time manual step.
