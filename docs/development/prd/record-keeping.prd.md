# PRD — Record-Keeping (External Record Export)

- **Status**: Draft
- **Date**: 2026-06-03
- **Author**: Richy Brasier
- **Target version**: 1.25.0  (bump: **MINOR** — new table, new ports; additive)

## 1. Problem

When a flow produces a finished record, that record currently lives only inside
Wayfinder. Agencies keep their authoritative records in an external system of
record (EDRMS / SharePoint / agency line-of-business systems). There is no path
to push a completed Wayfinder record into that system and capture the
system-assigned record id back for traceability.

## 2. Users / Personas

- **Operator** — finishes a record and expects it to land in the agency's record
  system without re-keying.
- **Records officer / auditor** — needs a durable trail of what was exported,
  when, and the external record id it became.
- **Integration owner** — maintains the n8n sub-workflow that writes into the
  agency system.

## 3. Goals

- A finished record can be **exported to an external system via an n8n
  sub-workflow**, reusing the existing HMAC-signed auto-node → webhook pattern
  (ADR-010 / ADR-013).
- Each export is **logged durably** (outbox-style) with status and, on success,
  the **external record id** returned by the callback.
- Export is **non-blocking**: a transport failure marks the log `failed` and
  never breaks the session.
- Export can be triggered by **record finalization** — initially on approval
  (from the Approvals feature) and/or at session completion.

## 4. Non-goals

- Building the agency-side write logic — that lives in n8n / the target system.
- A native in-app records repository (we export *out*; we keep only the log).
- Two-way sync or pulling records back from the external system.
- Retry/backoff sweeper UI (a simple bounded retry only; richer sweeping is
  future work).

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| `RecordExport` | `packages/domain/src/entities/record-export.ts` | new | Outbox row for one export attempt. |
| `IRecordExporter` | `packages/domain/src/ports/record-exporter.ts` | new | "push this record to the external system". |
| `IRecordExportRepository` | `packages/domain/src/ports/record-export-repository.ts` | new | `enqueue`, `markExported`, `markFailed`, `listPending`. |
| `INodeExecutor` | `packages/domain/src/ports/node-executor.ts` | existing | Transport reuse; n8n adapter. |

## 6. User stories

1. As an operator, when my record is finalized, it is sent to the agency record
   system without manual steps.
2. As a records officer, I can see each export, its status, and the external
   record id it produced.
3. As an integration owner, my n8n sub-workflow receives a signed payload and
   returns the external record id via the existing webhook.
4. As an operator, a failed export never blocks me from continuing.

## 7. Pages / surfaces affected

- `apps/api` `POST /v1/webhooks/n8n/:sessionId` — extend the callback to carry
  `externalRecordId` and mark the export row `exported`.
- tRPC: `record.listExports` (read-only trail) — new.
- Session chat — a small "record exported (#id) / export failed" status line.

## 8. Database changes

| Table | Change | Prefix valid? |
| ----- | ------ | ------------- |
| `app_session_records` | NEW | yes (app_) |

`app_session_records` columns: `id`, `session_id`, `flow_id`, `node_id`
(nullable), `trigger` (`approval_granted`|`session_complete`),
`correlation_id`, `payload` (jsonb), `status` (`pending`|`exported`|`failed`),
`external_record_id` (nullable, from callback), `error` (nullable),
`attempts` (smallint), `exported_at` (nullable), `created_at`, `updated_at`.
Unique index on `(session_id, trigger, node_id)` for idempotency.

## 9. Architectural decisions

- **ADR-020 — Record export via n8n** (new): reuse `INodeExecutor` + the signed
  webhook for outbound record writes; the outbox/callback model; the
  `externalRecordId` addition to the callback contract.
- Assumes ADR-010 / ADR-013 (n8n transport, structured fields).
- Consumes the approved snapshot from the Approvals feature and/or the generated
  document from the Scheduling feature's regeneration procedure.

## 10. Acceptance criteria

- [ ] Finalizing a record enqueues a `pending` `app_session_records` row and
      sends a signed payload to n8n.
- [ ] The webhook callback carrying `externalRecordId` flips the row to
      `exported` and stores the id.
- [ ] A transport/callback failure marks `failed` and never breaks the session.
- [ ] Duplicate finalization of the same record does not double-export.
- [ ] `record.listExports` returns the trail; an audit row is written.
- [ ] No n8n/transport import leaks outside `packages/adapters`.
- [ ] `./validate.sh` passes; `VERSION` and `package.json#version` match.

## 11. Out of scope / future work

- A native in-app records browser/repository.
- Bulk re-export and a retry sweeper dashboard.
- Mapping multiple destination systems per flow.

## 12. Risks / open questions

- Idempotency key choice when a record is finalized more than once (re-approval).
- Payload shape/size for large generated documents — link vs inline base64.
- Where the export is triggered (approval vs session-complete vs explicit
  `record` node) — initial trigger set is `approval_granted` + `session_complete`.
