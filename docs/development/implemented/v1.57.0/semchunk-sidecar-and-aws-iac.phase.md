# Phase — Semchunk Sidecar (Opt-In) & AWS Infrastructure-as-Code

- **Status**: Implemented in v1.57.0 (see `semchunk-sidecar-and-aws-iac.summary.md`)
- **Target version**: **MINOR** — 1.56.0 → 1.57.0 (new feature + new deployable service; no schema change)
- **PRD**: `docs/development/prd/semchunk-sidecar-and-aws-iac.prd.md`
- **ADRs**: ADR-030 (semchunk sidecar — Accepted, opt-in scope), ADR-033 (AWS via Terraform on ECS Fargate)
- **Depends on**: ADR-016/017 (indexing + embeddings pipeline), existing `DocumentIndexingService`

## 1. Goal

Two workstreams, one phase:

- **A — Semchunk sidecar (opt-in).** Execute ADR-030 Decision 1: a Python `semchunk`
  sidecar behind a new `IChunker` domain port, selected by env var, with the existing
  fixed-window chunker as automatic fallback. Newly indexed documents only; the corpus
  migration (ADR-030 Decision 2) stays deferred.
- **B — AWS IaC.** Terraform under `infra/aws/` deploying Wayfinder to ECS Fargate (ALB,
  RDS Postgres 16 + pgvector, S3, ECR, Secrets Manager), with the sidecar gated by
  `enable_semchunk`.

## 2. Scope

**In:** `IChunker` port; fixed-window/semchunk/fallback adapters; container wiring by env;
`services/semchunk` FastAPI app + Dockerfile + tests; compose profile; production
`Dockerfile.web`; Terraform root + modules + tfvars example + README; `.env.example` and
docs updates.

**Out (PRD §4/§11):** corpus re-chunk/re-embed migration, curated-state carry-forward,
admin-UI chunker toggle, Langfuse-on-AWS, infra CI/CD, EKS/multi-region.

## 3. Database changes

None. Both chunkers write identical `kb_document_chunks` rows.

## 4. What is built (by layer — respects hexagonal boundaries)

| Layer | File(s) | Change |
|-------|---------|--------|
| domain | `packages/domain/src/ports/chunker.ts` (+ export from `ports/index.ts`) | new `IChunker` port: `chunk(text: string, options?: ChunkOptions): Promise<Result<string[]>>`; `ChunkOptions` = `{ targetTokens?, overlapTokens?, stripPlaceholders? }` |
| adapters | `extraction/fixed-window-chunker.ts` | `IChunker` wrapping existing `chunkText` (which stays as the pure utility) |
| adapters | `extraction/semchunk-chunker.ts` | HTTP client: `POST {SEMCHUNK_URL}/chunk`, abort at `SEMCHUNK_TIMEOUT_MS` (default 10s); timeout / non-2xx / bad JSON → `DomainError`, never throws |
| adapters | `extraction/fallback-chunker.ts` | composite `IChunker(primary, fallback)`; on primary error, logs the degradation and uses fallback |
| adapters | `extraction/document-indexing-service.ts` | constructor gains `chunker: IChunker`; replaces the direct `chunkText` call (placeholder-stripping option preserved for templates) |
| apps/web | `src/lib/container.ts` | wire by env: `CHUNKER_PROVIDER=semchunk` → `FallbackChunker(SemchunkChunker, FixedWindowChunker)`; unset/`fixed` → `FixedWindowChunker` |
| apps/web | `src/lib/env.ts`, `.env.example` | `CHUNKER_PROVIDER`, `SEMCHUNK_URL`, `SEMCHUNK_TIMEOUT_MS` |
| service | `services/semchunk/` (`app.py`, `test_app.py`, `pyproject.toml`, `Dockerfile`, `README.md`) | FastAPI: `POST /chunk` `{text, max_tokens?, overlap_tokens?}` → `{chunks: [...]}`; `GET /healthz`; uvicorn on port 8000 |
| root | `docker-compose.yml` | `semchunk` service under `profiles: ["semchunk"]` with healthcheck |
| root | `Dockerfile.web` | multi-stage production image (`pnpm build` → `next start`, `NODE_ENV=production`) |
| infra | `infra/aws/*.tf`, `modules/{network,database,storage,ecs,semchunk}/`, `terraform.tfvars.example`, `README.md` | per ADR-033; sidecar resources + web-task env wiring behind `enable_semchunk` |

Apps still import only `@rbrasier/application` / `@rbrasier/adapters`; the sidecar is
plain Python outside the pnpm workspace and Turbo graph.

## 5. Implementation order (tests first — tests are the spec)

1. **Domain port**: `chunker.ts` + exports (type-only; covered by adapter tests).
2. **`FixedWindowChunker`**: test asserts output identical to `chunkText` for the cases in
   `text-chunker.test.ts`; then implement.
3. **`SemchunkChunker`**: tests with a mocked `fetch` — success, timeout, 500, malformed
   body → `DomainError`; then implement.
4. **`FallbackChunker`**: tests for primary-ok / primary-fails / both-fail; then implement.
5. **`DocumentIndexingService`**: extend existing tests to inject a chunker; verify template
   placeholder stripping still applied; then refactor constructor.
6. **Container + env wiring** (`container.ts`, `env.ts`, `.env.example`).
7. **Sidecar**: `test_app.py` first (chunk shape, empty text → `[]`, healthz, oversized
   input cap); then `app.py`. **Verify the installed `semchunk` API in the venv** —
   `chunkerify`/overlap signatures from training data are not to be trusted (code rule).
8. **Compose profile + local smoke**: `docker compose --profile semchunk up`, index a doc
   with `CHUNKER_PROVIDER=semchunk`, confirm chunks + fallback on sidecar stop.
9. **Production image** `Dockerfile.web` (build succeeds; AUTH_BYPASS dead in prod).
10. **Terraform**: modules per ADR-033; `terraform fmt -check` + `validate` + `plan` against
    the example tfvars with `enable_semchunk` both false and true.
11. **Docs + version**: `infra/aws/README.md`, `.env.example`, bump `VERSION` and root
    `package.json` to 1.57.0, run `./validate.sh`.

## 6. Sidecar contract

```
POST /chunk
  { "text": string, "max_tokens": int = 500, "overlap_tokens": int = 50 }
  → 200 { "chunks": string[] }        // [] for empty/whitespace text
  → 422 on missing/invalid fields; 413 over input cap (default 2 MB)
GET /healthz → 200 { "status": "ok" }
```

Internal-only: compose network locally; on AWS reachable solely from the web service's
security group via Service Connect DNS (`http://semchunk:8000`), no ALB exposure.

## 7. Terraform layout (ADR-033)

```
infra/aws/
  main.tf  variables.tf  outputs.tf  versions.tf
  terraform.tfvars.example
  README.md            # bootstrap (state bucket, ECR push), apply, secrets, teardown, cost notes
  modules/
    network/    # VPC, 2 AZs, public+private subnets, NAT
    database/   # RDS Postgres 16, SG from ECS only; vector extension enabled post-provision
    storage/    # S3 documents bucket (private, versioned)
    ecs/        # cluster, ALB+TLS, web service, ECR, Secrets Manager wiring, task roles
    semchunk/   # count = var.enable_semchunk ? 1 : 0 — service, Service Connect, SG rule
```

Key variables: `project_name`, `aws_region`, `enable_semchunk` (default `false`),
`web_image_tag`, `semchunk_image_tag`, `db_instance_class`, `certificate_arn`.
Secrets (DB password, `BETTER_AUTH_SECRET`, provider API keys) are created empty and
populated by the operator — never in tfvars.

## 8. Acceptance criteria

The PRD §10 checklist is the test plan verbatim. Gate for `/build` completion: all PRD §10
boxes checked, `./validate.sh` green, and `terraform plan` output for both `enable_semchunk`
values attached to the implementation summary.

## 9. Risks

- `semchunk`/FastAPI APIs verified against installed versions at build time, not memory.
- Mixed corpus (fixed-window + semantic chunks) coexists until the deferred migration —
  accepted and documented in the PRD.
- Terraform cannot be fully exercised by `validate.sh` (no AWS creds in CI); fmt/validate
  run only when the `terraform` binary is present, guarded so validate.sh stays green
  without it.
