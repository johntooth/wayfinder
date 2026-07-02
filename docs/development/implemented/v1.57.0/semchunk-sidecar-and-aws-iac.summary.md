# Implementation Summary — Semchunk Sidecar (Opt-In) & AWS IaC (v1.57.0)

- **Version**: 1.56.0 → 1.57.0 (**MINOR** — new feature + new deployable service, no schema change)
- **Phase doc**: `semchunk-sidecar-and-aws-iac.phase.md` (this directory)
- **ADRs**: ADR-030 (executed, opt-in scope), ADR-033 (accepted + implemented)

## What was built

**Workstream A — opt-in semantic chunking (ADR-030 Decision 1).**
A new `IChunker` domain port sits between `DocumentIndexingService` and the
chunking implementation. Three adapters implement it: `FixedWindowChunker`
(wraps the existing `chunkText`, byte-identical behaviour), `SemchunkChunker`
(HTTP client for the Python sidecar; timeout / non-2xx / malformed-body /
network failures all map to `DomainError`), and `FallbackChunker` (primary →
fallback composite that logs degradation). Container wiring selects by env:
`CHUNKER_PROVIDER=semchunk` gets `FallbackChunker(SemchunkChunker,
FixedWindowChunker)`; unset/`fixed` gets `FixedWindowChunker` and never
touches the network. Placeholder stripping for templates happens before text
leaves the process. Applies to newly indexed documents only — the corpus
re-chunk migration remains deferred (ADR-030 Decision 2).

The sidecar itself (`services/semchunk/`) is a FastAPI wrapper around
`semchunk` 4.x: `POST /chunk` → `{chunks: string[]}`, `GET /healthz`, 413 over
a 2 MB cap, 422 for invalid input, tiktoken `cl100k_base` token counting with
an offline character-approximation fallback. Its Dockerfile runs the tests
during build and bakes the tiktoken encoding in so the container needs no
runtime egress.

**Workstream B — AWS IaC (ADR-033).** `infra/aws/` Terraform: VPC (2 AZ,
single NAT), RDS Postgres 16 (pgvector note documented), private S3 documents
bucket with a scoped IAM user whose keys land in Secrets Manager, ECS Fargate
cluster with ALB (HTTPS when `certificate_arn` set), ECR repositories, and
generated/operator secrets injected via task-definition `secrets`.
`enable_semchunk = true` deploys the sidecar service behind Service Connect
(`http://semchunk:8000`), restricts ingress to the web service's security
group, and sets `CHUNKER_PROVIDER`/`SEMCHUNK_URL` on the web task in the same
apply; `false` removes every trace. A production web image (`Dockerfile.web`,
real `next build`, `NODE_ENV=production` so AUTH_BYPASS is dead) replaces the
dev-only root Dockerfile for deployment.

## Files created

- `packages/domain/src/ports/chunker.ts`
- `packages/adapters/src/extraction/fixed-window-chunker.ts` (+ test)
- `packages/adapters/src/extraction/semchunk-chunker.ts` (+ test)
- `packages/adapters/src/extraction/fallback-chunker.ts` (+ test)
- `services/semchunk/{app.py,test_app.py,pyproject.toml,Dockerfile,README.md}`
- `Dockerfile.web`
- `infra/aws/{versions,variables,main,outputs}.tf`, `terraform.tfvars.example`, `README.md`
- `infra/aws/modules/{network,storage,database,ecs,semchunk}/*`
- `apps/web/e2e/phase-semchunk-sidecar.spec.ts`

## Files modified

- `packages/adapters/src/extraction/document-indexing-service.ts` — `IChunker` injected (+ tests)
- `packages/adapters/src/extraction/text-chunker.ts` — `stripTemplatePlaceholders` exported for reuse
- `packages/adapters/src/extraction/index.ts`, `packages/domain/src/ports/index.ts` — exports
- `apps/web/src/lib/env.ts` — `CHUNKER_PROVIDER`, `SEMCHUNK_URL`, `SEMCHUNK_TIMEOUT_MS`
- `apps/web/src/lib/container.ts` — chunker wiring
- `docker-compose.yml` — `semchunk` service under `profiles: ["semchunk"]`
- `.env.example` — chunking section
- `validate.sh` — check 16: guarded `terraform fmt`/`validate`
- ADR-030 (status: Accepted, opt-in scope), ADR-033 (status: Accepted)

## Migrations

None. Both chunkers write identical `kb_document_chunks` rows.

## E2E tests added

`apps/web/e2e/phase-semchunk-sidecar.spec.ts` — sidecar contract (healthz,
multi-chunk happy path, blank text, 422 error paths). Executed against a live
sidecar instance during this build: **4/4 passed**. Python contract tests
(`services/semchunk/test_app.py`, 8 tests) also run inside the image build.

## Known limitations

- The corpus-wide re-chunk/re-embed migration and curated-state carry-forward
  are still deferred (ADR-030 Decision 2) — enabling the sidecar affects new
  indexing only, so fixed-window and semantic chunks coexist.
- `terraform validate`/`plan` could not run in the build sandbox (no network
  route to releases.hashicorp.com); validate.sh check 16 enforces fmt/validate
  wherever the terraform binary exists, and the README documents
  `terraform init -backend=false && terraform validate` as the pre-ship step.
- Docker image builds (sidecar + Dockerfile.web) are documented operator steps;
  the sandbox had no Docker daemon, so they were not built here.
- The chunker toggle is env-var only; an admin-UI runtime toggle would be a
  follow-up (`admin_` settings row).
- Langfuse is not provisioned on AWS; CI/CD for Terraform is future work.
