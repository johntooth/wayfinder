# Phase — Record-Keeping (External Record Export)

- **Status**: Sketched (awaiting `/doc-review`)
- **Target version**: 1.25.0 (bump: **MINOR** — new table, new ports)
- **PRD**: `docs/development/prd/record-keeping.prd.md`
- **ADR**: `docs/development/adr/020-record-export-via-n8n.adr.md`
- **Depends on**: ADR-010 / ADR-013 (n8n transport + webhook), Step Approvals
  (`approval_granted` trigger) — degrades to `session_complete` only if Approvals
  is not yet shipped.

## 1. Goal

Push a finalized record to an external system of record via the existing n8n
auto-node transport, log every export durably (outbox), and capture the
returned external record id via the webhook callback. Export is non-blocking.

## 2. Approach

Outbox over the existing n8n integration:

1. Record finalization commits a `pending` `app_session_records` row, idempotent
   on `(session_id, trigger, node_id)`.
2. `IRecordExporter` (adapter delegates to `N8nNodeExecutor`) sends the signed
   payload with a `correlationId`.
3. The extended webhook callback carries `externalRecordId`; an
   `apply-record-export-result` use-case flips the row to `exported` (or
   `failed`).

See ADR-020.

## 3. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| domain | `packages/domain/src/entities/record-export.ts` | New `RecordExport` (outbox row). |
| domain | `packages/domain/src/ports/record-exporter.ts` | New `IRecordExporter`. |
| domain | `packages/domain/src/ports/record-export-repository.ts` | New `IRecordExportRepository` (`enqueue`, `markExported`, `markFailed`, `listPending`, `existsFor`). |
| application | `packages/application/src/use-cases/records/export-record.ts` | Compose payload + dedupe + enqueue + send. |
| application | `packages/application/src/use-cases/records/apply-record-export-result.ts` | Apply callback; set `external_record_id`. |
| adapters | `packages/adapters/src/records/n8n-record-exporter.ts` | Delegates to `N8nNodeExecutor`. |
| adapters | `packages/adapters/src/repositories/drizzle-record-export-repository.ts` | Persistence. |
| adapters | `packages/adapters/src/db/schema/wayfinder.ts` | New `app_session_records`. |
| adapters | `packages/adapters/drizzle/<next>.sql` | Migration. |
| apps/api | `apps/api/src/routes/webhooks.ts` | Extend callback schema with `externalRecordId`; route to `apply-record-export-result`. |
| apps/web | `apps/web/lib/container.ts` | Wire exporter, repo, use-cases. |
| apps/web | `apps/web/.../trpc/routers/record.ts` | `listExports` (read-only). |
| apps/web | finalization hooks (approval-granted / session-complete) | Invoke `export-record`. |
| apps/web | session chat components | "record exported (#id) / failed" status line. |

## 4. Database changes

### New table: `app_session_records`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `session_id` | uuid FK → `app_sessions` | |
| `flow_id` | uuid FK → `app_flows` | |
| `node_id` | uuid | nullable |
| `trigger` | text | `approval_granted`\|`session_complete` |
| `correlation_id` | text | matches the n8n callback |
| `payload` | jsonb | record sent |
| `status` | text | `pending`\|`exported`\|`failed` |
| `external_record_id` | text | nullable, from callback |
| `error` | text | nullable |
| `attempts` | smallint | default 0 |
| `exported_at` | timestamptz | nullable |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

Unique index on `(session_id, trigger, node_id)` for idempotency.

## 5. Webhook change

Extend the `apps/api` n8n callback Zod schema with optional `externalRecordId`.
Additive and backward compatible — existing auto-node callbacks are unaffected.

## 6. Implementation order (tests first)

1. `app_session_records` schema + migration; repository test → repository.
2. `IRecordExporter` test (delegation + signed payload) → `N8nRecordExporter`.
3. `export-record` use-case test (dedupe, non-blocking failure) → use-case.
4. `apply-record-export-result` use-case test (set id, mark exported/failed) →
   use-case; extend webhook route + its schema test.
5. Wire finalization triggers; `record.listExports`; chat status line.

Write the test file before each implementation file (CLAUDE.md rule).

## 7. ADR required

ADR-020 (written) — reuse n8n transport, outbox + callback record id, trigger set.

## 8. Risks / open questions

Carried from PRD §12: idempotency on re-finalization, payload size (link vs
inline), and the trigger set (`approval_granted` + `session_complete` for v1).

## 9. Acceptance criteria

Mirror PRD §10. At minimum:

- [ ] Finalization enqueues a `pending` row and sends a signed n8n payload.
- [ ] Callback with `externalRecordId` flips the row to `exported` + stores id.
- [ ] Transport/callback failure marks `failed`; session never breaks.
- [ ] Duplicate finalization does not double-export.
- [ ] `record.listExports` returns the trail; audit written; no transport import
      outside `packages/adapters`.
- [ ] `./validate.sh` passes; `VERSION` and `package.json#version` match.
