# Phase — Record-Keeping (External Record Export)

- **Status**: Revised — scoped to the existing auto-node (re-run `/doc-review`)
- **Target version**: no code change for the core pattern (docs only); the
  optional auditor view, if built, is **MINOR** (1.23.3 → 1.24.0; new read-only
  feature, no schema change)
- **PRD**: `docs/development/prd/record-keeping.prd.md`
- **ADR**: `docs/development/adr/020-record-export-via-n8n.adr.md`
- **Depends on**: ADR-010 / ADR-013 (auto-node transport + callback), ADR-018
  (approval node, for approval-triggered placement)

## 1. Goal

Capture an external system-of-record id against a session when a record is
exported, by **reusing the existing auto-node** — not by building a new export
subsystem.

## 2. Approach

There is no new transport, table, port, or use-case. Record export is the auto-node
used at a flow's export point:

1. Place an auto-node at the export point (terminal → runs at session completion;
   or downstream of an `approval` node → runs on approval).
2. Put the record payload in `requestFields`; declare the returned id (e.g.
   `externalRecordId`) in `responseFields`.
3. The existing `ApplyAutoNodeResult` callback path persists the response fields
   to `session_step_outputs` — the same store as a generated document's fields.

See ADR-020.

## 3. What is built

**Core pattern: nothing.** It is flow configuration over existing code
(`AutoNodeConfig.requestFields` / `responseFields`, `N8nNodeExecutor`,
`ApplyAutoNodeResult`, `session_step_outputs`).

**Optional, deferrable — auditor view only:**

| Layer | File | Change |
|-------|------|--------|
| apps/web | `apps/web/.../trpc/routers/record.ts` | `listExports` — read-only query over `session_step_outputs` filtered to export nodes. |
| apps/web | session chat / record view | Surface the captured external record id from step output. |

Build the auditor view only when an auditor needs a cross-session list; the id is
already captured without it.

## 4. Database changes

**None.** The external record id lives in the existing `session_step_outputs`
table as a response field. The earlier `app_session_records` table is **not**
built (ADR-020 "Superseded").

## 5. Webhook change

**None.** The callback `data` is already an open record; `externalRecordId` is
just another `responseField`. No Zod schema change.

## 6. Implementation order

If building the optional auditor view (tests first):

1. `record.listExports` query test → resolver (read-only over `session_step_outputs`).
2. Surface the captured id in the session/record view.

Otherwise this phase ships as documentation/flow-configuration guidance with no
code.

## 7. ADR required

ADR-020 (revised) — record export is a usage pattern of the auto-node +
`session_step_outputs`; supersedes the outbox/ports/table sketch.

## 8. Risks / open questions

Carried from PRD §12: generic store vs. lockable ledger (revisit only if
retention/immutability is later required), idempotency on re-finalization
(auto-node `correlationId` dedupe already guards duplicate callbacks), and payload
size (link vs. inline) for large documents.

## 9. Acceptance criteria

Mirror PRD §10:

- [ ] An export auto-node sends the record payload to n8n at its flow position.
- [ ] The returned external record id is persisted to `session_step_outputs`.
- [ ] Transport/callback failure does not break the session (existing behaviour).
- [ ] No new table, port, or callback-schema change is introduced.
- [ ] (If the view is built) `record.listExports` returns the captured fields and
      `./validate.sh` passes with `VERSION`/`package.json#version` matched.
