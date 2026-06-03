# ADR-018 — Approval Step Type & Approver Resolution

- **Status**: Proposed
- **Date**: 2026-06-03
- **Relates to**: ADR-010 (`INodeExecutor` / `pending_approval`), Email
  Notifications (`INotificationSender`)

## Context

Flows must be able to halt at a point of human sign-off — typically the
operator's first-line supervisor — and only continue once that person decides.
The `pending_approval` status already exists in `NodeExecutionOutput` and the n8n
webhook schema but was deferred (ADR-010), so the gate is half-scaffolded.

Two design questions must be settled:

1. **Where does "approval" live in the flow** — as configuration on an existing
   step, or as its own node type?
2. **How is the approver determined** at runtime?

## Decision

### Approval is its own node type

Add `approval` to the `FlowNode` type union (`conversational` | `auto` |
`approval`). It is a first-class node on the canvas, not a flag on another step.

Rationale:

- It is a distinct point in the graph with its own inbound/outbound edges
  (reject can route back; approve routes forward) — that is a node, not a flag.
- It keeps `conversational`/`auto` node config clean and makes the gate visible
  on the canvas where authors reason about flow.
- `reject` / `request_changes` edges become explicit graph edges rather than
  hidden control flow.

The `approval` node `config` shape:

```ts
interface ApprovalNodeConfig {
  position: string;            // e.g. "first_line_supervisor"
  allowManualFallback: boolean; // default true
  instructions?: string;       // shown to the approver
}
```

When a session reaches an `approval` node it produces `status:
'pending_approval'` — the previously-reserved value is now used — creates an
`app_session_approvals` row, and the session does not advance. Reusing the
existing status means the webhook/agent plumbing already understands the pause.

### Approver resolution: position with manual fallback

A new domain port resolves a position to a person **relative to the requester**:

```ts
export interface IReportingLineResolver {
  resolve(input: {
    position: string;
    requesterUserId: string;
  }): Promise<Result<{ approverUserId: string } | { unresolved: true }>>;
}
```

The v1 adapter resolves `first_line_supervisor` by reading
`core_users.supervisor_user_id` for the requester. If it returns `unresolved`
(no supervisor recorded) **and** `allowManualFallback`, the operator is prompted
in-session to pick an approver; the chosen approval row is flagged
`is_manual_fallback = true`. If fallback is disabled and resolution fails, the
node surfaces a blocking error to the author/operator rather than silently
advancing.

### Reporting-line storage: a column, not a table (for now)

We add `supervisor_user_id uuid` (nullable, self-referential FK) to
`core_users`. Rejected for v1: a dedicated `core_reporting_lines` /
`core_positions` table.

- The only position needed now is "first-line supervisor", which is a single
  edge per user — a column expresses it exactly.
- A positions/reporting table is the right shape once multiple positions,
  effective-dated lines, or matrix reporting appear; that is future work and
  this column migrates into it cleanly.

### Decisions and effects

Decisions are `approved` | `rejected` | `changes_requested`, each with an
optional `comment`, recorded on the approval row and in `core_audit_log`.

- **Approved** → session advances along the approve edge; the approved
  `record_snapshot` is retained for the record-regeneration procedure
  (Scheduling PRD) and/or export (Record-Keeping PRD).
- **Rejected / changes requested** → the comment is surfaced to the operator;
  the session does not advance (routes back along the reject edge if present).

Notifications reuse `INotificationSender`: `approval_requested` to the approver,
`approval_decided` to the requester. Mail failure is non-blocking (outbox model,
per the Email Notifications ADR).

## Consequences

**Positive**

- Uses the reserved `pending_approval` status — minimal new control flow.
- Approver logic is relative and reusable across operators via one column.
- Manual fallback guarantees a flow is never unroutable.

**Negative**

- Resolution is only as good as `supervisor_user_id` data; until populated,
  every approval falls back to manual pick.
- A new node type touches the canvas, executor, and session-advance paths.

## Open questions

- Position vocabulary: free-text vs an admin-managed enum. Start with a small
  documented key set.
- Whether a future `core_reporting_lines` table supersedes the column — noted as
  the migration path, not done now.
