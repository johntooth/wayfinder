# PRD — Record-Keeping (External Record Export)

- **Status**: Draft (revised — scoped to the existing auto-node)
- **Date**: 2026-06-03
- **Author**: Richy Brasier
- **Target version**: no code change for the core pattern (docs only); the
  optional auditor view, if built, is a **MINOR** (new read-only feature, no
  schema change)

## 1. Problem

When a flow produces a finished record, that record currently lives only inside
Wayfinder. Agencies keep their authoritative records in an external system of
record (EDRMS / SharePoint / line-of-business systems). We want a path to push a
completed Wayfinder record into that system and capture the system-assigned
record id back against the session for traceability.

## 2. Key insight (why this is small)

The mechanism already exists. The auto-node (ADR-010/013) is an outbound write to
n8n whose configured response fields are saved as end-of-step metadata:

- `AutoNodeConfig.requestFields` — fields sent **to** n8n.
- `AutoNodeConfig.responseFields` — fields n8n is configured to **return**.
- On the callback, those response fields are persisted to `session_step_outputs`
  via the same path `GenerateDocument` uses for a generated document's fields.
- The callback `data` is already an open record, so an `externalRecordId` coming
  back needs no schema change.

Record export is therefore an **auto-node placed at the export point of a flow**,
with the external record id declared as a response field. There is no new
subsystem to build. See ADR-020.

## 3. Goals

- A finished record can be exported to an external system via an n8n
  sub-workflow, **reusing the existing auto-node** (HMAC-signed request → webhook
  callback).
- The **external record id returned by n8n is captured against the session** as
  step-output metadata, via the existing `responseFields` mechanism.
- Export is **non-blocking**: the auto-node is already best-effort and a transport
  failure does not break the session.
- Export is triggered by **flow position** — a terminal export node (runs at
  session completion) or a node downstream of an `approval` node (runs on
  approval). No new trigger code.

## 4. Non-goals

- Building the agency-side write logic — that lives in the n8n sub-workflow.
- A native in-app records repository (we export *out*).
- Two-way sync or pulling records back.
- A new outbox table, export ports, or export use-cases — explicitly **not**
  built; the auto-node + `session_step_outputs` already cover this (ADR-020).

## 5. Key entities

No new domain entities or ports. The feature reuses:

| Entity / port | Lives in | Role |
| ------------- | -------- | ---- |
| `AutoNodeConfig.requestFields` / `responseFields` | `packages/domain/src/entities/flow-node.ts` | Declares the record payload sent and the fields (incl. external record id) returned. |
| `INodeExecutor` / `N8nNodeExecutor` | domain / adapters | Existing signed transport. |
| `ISessionStepOutputRepository` (`session_step_outputs`) | domain / adapters | Existing end-of-step metadata store; holds the captured external record id. |
| `ApplyAutoNodeResult` | application | Existing callback handler that persists response fields. |

## 6. User stories

1. As an operator, when my export auto-node is reached at the end of a flow, the
   record is sent to the agency system without manual steps.
2. As a records officer, the external record id n8n returns is stored against the
   session (step-output metadata) and is visible there.
3. As an integration owner, my n8n sub-workflow receives a signed payload and
   returns the external record id like any other auto-node response field.
4. As an operator, a failed export never blocks me — the auto-node is already
   best-effort.

## 7. Pages / surfaces affected

- **None required** for the core pattern — it is flow configuration over existing
  surfaces.
- **Optional, deferrable**: a read-only tRPC `record.listExports` that queries
  `session_step_outputs` filtered to export nodes, for an auditor view. No schema
  change. Build only when an auditor needs the cross-session view.

## 8. Database changes

**None.** The external record id is stored in the existing `session_step_outputs`
table as a response field. (The earlier draft's `app_session_records` table is
not built — see ADR-020 "Superseded".)

## 9. Architectural decisions

- **ADR-020 — Record export via the existing auto-node** (revised): record export
  is a usage pattern of the auto-node + `session_step_outputs`, not a new
  subsystem. Supersedes the earlier outbox/ports/table sketch.
- Assumes ADR-010 / ADR-013 (n8n transport, structured fields) and ADR-018
  (approval node, for the approval-triggered placement).

## 10. Acceptance criteria

- [ ] An auto-node configured with the record payload in `requestFields` sends a
      signed payload to n8n at its flow position.
- [ ] The external record id returned by n8n, declared as a `responseField`, is
      persisted to `session_step_outputs` against the session/flow/node.
- [ ] A transport/callback failure does not break the session (existing
      best-effort behaviour).
- [ ] (Optional) `record.listExports` returns the captured export fields across
      sessions for auditors.
- [ ] No new table, port, or callback-schema change is introduced.
- [ ] `./validate.sh` passes; `VERSION` and `package.json#version` match.

## 11. Out of scope / future work

- A native in-app records browser/repository.
- A purpose-built, lockable export ledger — revisit **only** if a hard
  legal-retention/immutability requirement appears that `session_step_outputs`
  cannot satisfy (ADR-020 "Consequences").
- Bulk re-export and a retry sweeper dashboard.

## 12. Risks / open questions

- **Generic store vs. ledger**: `session_step_outputs` is general-purpose. If
  immutability or retention guarantees are later required, a dedicated table is
  introduced then (not pre-built).
- **Idempotency on re-finalization**: re-running an export node re-sends; the
  auto-node's `correlationId`/`pendingExecutions` dedupe already guards duplicate
  callbacks. If re-approval must produce a fresh export vs. overwrite, decide at
  flow-design time.
- **Payload size for large generated documents** — prefer a storage link over
  inline base64 in the request fields.
