# ADR-020 — Record Export via the Existing Auto-Node

- **Status**: Proposed (supersedes the earlier outbox/`app_session_records` sketch
  of this ADR)
- **Date**: 2026-06-03
- **Relates to**: ADR-010 (external workflow integration), ADR-013 (auto-node
  structured data), ADR-018 (approval step), Record-Keeping PRD

## Context

A finished Wayfinder record must be pushed into an agency's external system of
record (EDRMS / SharePoint / line-of-business system), which returns a
system-assigned record id we want to keep against the session for traceability.

The first draft of this ADR proposed a new subsystem to do that: an
`IRecordExporter` port, a `DrizzleRecordExportRepository`, an `app_session_records`
outbox table, two new use-cases, and an `externalRecordId` field added to the n8n
callback contract.

Reviewing that against the code showed it largely **reinvents infrastructure that
already ships**. The auto-node already is an outbound write to n8n whose response
is captured as end-of-step metadata:

- `AutoNodeConfig.requestFields` declares the fields sent **to** n8n
  (`packages/domain/src/entities/flow-node.ts`).
- `AutoNodeConfig.responseFields` declares the fields n8n is configured to
  **return**.
- On the inbound callback, `ApplyAutoNodeResult.persistStepOutput` coerces the
  returned `data` into those `responseFields` and writes them to
  `session_step_outputs` — the **same** `ISessionStepOutputRepository.create`
  call `GenerateDocument` uses to persist a generated document's structured
  fields. One shared "structured data at the end of a step" path.
- The callback's `data` is already an open `z.record(z.unknown())`
  (`apps/api/src/routes/webhooks.ts`), so an `externalRecordId` returning from
  n8n needs **no schema change** — it is just another `responseField`.

## Decision

### Record export is a usage pattern of the existing auto-node, not a new subsystem

To export a record:

1. Place an **auto-node** at the export point of the flow.
2. Configure its `requestFields` with the record payload to send to n8n (the n8n
   sub-workflow performs the agency-side write — unchanged, out of scope here).
3. Configure its `responseFields` to include the field n8n returns for the
   external record id (e.g. `externalRecordId`).
4. The existing callback path persists those response fields to
   `session_step_outputs` against the session, node, and flow. The external
   record id is now captured as end-of-step metadata, exactly like a generated
   document's fields.

No `IRecordExporter`, no `app_session_records` table, no new repository, no new
use-cases, and no change to the callback Zod schema.

### Triggering uses the graph, not a new finalization hook

The earlier draft proposed firing export on `approval_granted` / `session_complete`
signals. The flow graph already provides both:

- An export auto-node placed **terminally** runs when reached and, having no
  outgoing edges, completes the session (`ApplyAutoNodeResult.advance`).
- An export auto-node placed **immediately downstream of an `approval` node**
  (ADR-018) runs once the approval advances the session.

So positioning the node is the trigger. No finalization-signal plumbing is added.

### The only potentially-new code is a read-only audit view, and it is deferrable

Records officers/auditors may want a single "what was exported, when, and the
external id it became" view across sessions. That is a **read-only query over
`session_step_outputs` filtered to export nodes** (a tRPC `record.listExports`),
not a new table. It is optional and can be deferred until an auditor actually
needs it; the data is already captured without it.

## Consequences

**Positive**

- Zero new transport, persistence, ports, or callback-contract surface. One
  integration and one metadata store to operate and audit.
- The external record id is captured against the session via the mechanism that
  already captures generated-document fields — consistent and already tested.
- Record-keeping stops being a "phase" of net-new code and becomes a
  flow-configuration pattern (plus an optional read view).

**Negative**

- `session_step_outputs` is a general metadata store, not a purpose-built export
  ledger. If a future requirement demands a hard legal-retention or
  immutability/locking guarantee that step outputs cannot give, a dedicated table
  can be introduced **then**, with that requirement as its justification. We do
  not pre-build it (YAGNI).

## Superseded

This replaces the first draft's outbox design: `IRecordExporter`,
`IRecordExportRepository`, `app_session_records`, `RecordExport`,
`export-record` / `apply-record-export-result` use-cases, and the
`externalRecordId` callback-schema addition. None are needed.
